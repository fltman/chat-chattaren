// machine.js — tillståndsmaskinen (körs i panelen). Äger sessionen: räknare, tak,
// hashar, faser. Ren av chrome/DOM: allt I/O går via injicerade deps så den kan
// testas. panel.js kopplar deps till chrome-meddelanden och UI.
//
// deps = { decide, sendToFrame, requestExtract, render, now }
//   decide({goal,facts,transcript,replies,apiKey}) -> Promise<decision>
//   sendToFrame(msg) -> Promise<result>   (cc/typeAndSend | cc/clickReply)
//   requestExtract() -> void              (be content-scriptet läsa om, för wait)
//   render(view) -> void                  (rita panelen)

import { evaluateSend, DEFAULT_LIMITS } from './gate.js';
import { groundTokens } from './guards/grounding.js';
import { asksForAttachment } from './guards/classes.js';
import { TerminalApiError, TransientApiError } from './openrouter.js';

const SEND_FAIL_MS = 8000;
const MAX_CONSEC_WAITS = 8; // tålmodigare — ge inte upp bara för att motparten är seg
const MAX_CONSEC_API_ERRORS = 3;

export function createMachine(deps) {
  const limits = { ...DEFAULT_LIMITS };
  let S = null;             // sessionsobjekt, null före start
  let proposal = null;      // aktuellt förslag som väntar på människan
  let waitTimer = null, failTimer = null;
  let consecWaits = 0, consecApiErrors = 0;

  function view(extra = {}) {
    return {
      phase: S?.phase || 'NEED_PROFILE',
      goal: S?.goal || '', facts: S?.facts || '',
      counters: S?.counters || null, limits,
      proposal, ...extra,
    };
  }
  function toPhase(p, extra) { if (S) S.phase = p; deps.render(view(extra)); }

  function start({ goal, facts, apiKey, tabId, frameId, mode, persona }) {
    S = {
      goal, facts, apiKey, tabId, frameId, persona,
      mode: mode === 'auto' ? 'auto' : 'copilot',
      phase: 'RUNNING',
      counters: { sent: 0, calls: 0, startedAt: deps.now(), lastSentAt: 0, spendUsd: 0 },
      transcriptHash: null, hashAtLastSend: null, lastForeign: '',
    };
    proposal = null; consecWaits = 0; consecApiErrors = 0;
    toPhase('RUNNING', { note: 'Väntar på nästa svar från motparten…' });
  }

  // Nytt settlat innehåll från content-scriptet.
  async function onSettled({ text, foreign, replies, hash }) {
    if (!S || S.phase === 'DONE' || S.phase === 'HANDOFF' || S.phase === 'ERROR' || S.phase === 'STOPPED') return;
    // Ignorera medan ett anrop/en sändning redan pågår (undvik re-entrans/dubbelanrop).
    // Ett nytt svar under REVIEW/WAITING får däremot ersätta det väntande förslaget.
    if (S.phase === 'DECIDING' || S.phase === 'SENDING') return;
    clearTimeout(failTimer); failTimer = null; // ett svar kom → skickmisslyckande-vakten avförs
    S.transcriptHash = hash;
    S.lastForeign = foreign || '';

    // Inget nytt från motparten sedan vår senaste sändning (bara vårt eget eko) → vänta.
    if (S.hashAtLastSend != null && hash === S.hashAtLastSend) {
      return toPhase('RUNNING', { note: 'Skickat. Väntar på svar…' });
    }

    // Bilaga-begäran är en hård HANDOFF: verktyget kan inte bifoga filer.
    if (asksForAttachment(foreign)) return handOver('de ber om en bild/bilaga — det klarar inte verktyget');

    if (S.counters.calls >= limits.maxCalls) return handOver('maxantal anrop nått');
    toPhase('DECIDING', { note: 'Funderar…' });

    let d;
    try {
      d = await deps.decide({ goal: S.goal, facts: S.facts, transcript: text, replies, apiKey: S.apiKey, persona: S.persona });
      consecApiErrors = 0;
    } catch (e) {
      return onApiError(e, { text, foreign, replies, hash });
    }
    S.counters.calls += 1;
    S.counters.spendUsd += Number.isFinite(d.cost) ? d.cost : limits.maxSpendUsd; // fail closed
    S.lastReplies = replies;

    switch (d.action) {
      case 'done': return finish(d.reason);
      case 'hand_over': return handOver(d.reason);
      case 'wait': return waitThenReextract(d);
      case 'click': return proposeClick(d, replies);
      case 'send': default: return proposeSend(d);
    }
  }

  function proposeSend(d) {
    consecWaits = 0;
    const verdict = evaluateSend(d.message, gateCtx(false));
    if (verdict.type === 'halt') return handOver(verdict.reason);
    const tokens = groundTokens(d.message, S.facts, S.lastForeign);
    proposal = { kind: 'send', text: d.message, observation: d.observation, reason: d.reason, verdict, tokens };
    renderProposal();
  }

  function proposeClick(d, replies) {
    consecWaits = 0;
    const chip = replies.find((r) => r.idx === d.click_index) || replies[d.click_index];
    if (!chip) return proposeSend({ ...d, message: d.message || '' }); // ingen sådan knapp → fall till send
    const verdict = evaluateSend(chip.label, gateCtx(true));
    if (verdict.type === 'halt') return handOver(verdict.reason);
    proposal = { kind: 'click', idx: chip.idx, label: chip.label, observation: d.observation, reason: d.reason, verdict };
    renderProposal();
  }

  function renderProposal() {
    if (proposal.verdict.type === 'blocked' && !proposal.verdict.override) return toPhase('BLOCKED');
    if (proposal.verdict.type === 'blocked') return toPhase('REVIEW'); // overridebar → människa ÄVEN i auto
    // Rent meddelande: i autoläge skickas det direkt, i co-pilot väntar det på godkännande.
    if (S.mode === 'auto') return approve();
    toPhase('REVIEW');
  }

  function gateCtx(isReply) {
    return {
      counters: S.counters, limits,
      transcriptHash: S.transcriptHash, hashAtLastSend: S.hashAtLastSend,
      userTouched: false, now: deps.now(),
      facts: S.facts, foreignTranscript: S.lastForeign, isReply,
    };
  }

  // Människan godkände det aktuella förslaget (ev. redigerat).
  async function approve(editedText) {
    if (!S || !proposal) return;
    const isReply = proposal.kind === 'click';
    const text = isReply ? proposal.label : (editedText != null ? editedText : proposal.text);

    // Re-grinda den (ev. redigerade) texten — utom PII/denial som aldrig får overridas
    // togs redan om hand i BLOCKED (den vägen har ingen godkänn-knapp).
    if (!isReply && editedText != null) {
      const v = evaluateSend(text, gateCtx(false));
      if (v.type === 'blocked' && !v.override) { proposal.verdict = v; return toPhase('BLOCKED'); }
      if (v.type === 'halt') return handOver(v.reason);
    }

    toPhase('SENDING', { note: 'Skickar…' });
    // Pacea sändningen: skriv aldrig snabbare än minSendGapMs sedan förra sändningen
    // (anti-dubbeltext och för att inte flagga chatten som bot-trafik).
    const gap = limits.minSendGapMs - (deps.now() - S.counters.lastSentAt);
    if (gap > 0 && S.counters.lastSentAt > 0) await new Promise((r) => setTimeout(r, gap));

    const msg = isReply ? { t: 'cc/clickReply', idx: proposal.idx, label: proposal.label } : { t: 'cc/typeAndSend', text };
    let res;
    try { res = await deps.sendToFrame(msg); } catch { res = { ok: false, reason: 'no-frame' }; }

    if (!res || !res.ok) {
      if (res && res.reason === 'anchor-lost') return anchorLost('input', res.diag);
      if (res && res.reason === 'would-repeat') return handOver('jag var på väg att upprepa mig');
      return handOver(`kunde inte skicka (${res?.reason || 'okänt'}${res?.error ? ': ' + res.error : ''})`);
    }

    S.counters.sent += 1;
    S.counters.lastSentAt = deps.now();
    S.hashAtLastSend = S.transcriptHash;
    const shown = isReply ? `▸ ${proposal.label}` : text;
    proposal = null;

    // Skickmisslyckande-vakt: om det inte gick via knappen och fältet inte tömdes, och
    // inget nytt svar kommer inom 8 s → lämna över. Retry ALDRIG.
    if (res.how !== 'button' && res.cleared === false) {
      failTimer = setTimeout(() => handOver('meddelandet verkar inte ha skickats'), SEND_FAIL_MS);
    }
    // I autoläge: visa vad som skickades så människan kan följa med.
    const note = S.mode === 'auto' ? `Skickade: "${shown.slice(0, 90)}" — väntar på svar…` : 'Skickat. Väntar på svar…';
    toPhase('RUNNING', { note });
  }

  function edit(newText) { return approve(newText); }

  function skip() {
    if (!S) return;
    // Hoppa över: acceptera nuläget som baslinje så vi inte återföreslår samma sak.
    S.hashAtLastSend = S.transcriptHash;
    proposal = null;
    toPhase('RUNNING', { note: 'Överhoppat. Väntar på nästa svar…' });
  }

  function waitThenReextract(d) {
    if (++consecWaits >= MAX_CONSEC_WAITS) return stop('inget hände på ett tag — stoppar för att inte bränna anrop');
    toPhase('WAITING', { note: d.reason || 'Väntar in motparten…' });
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => { if (S && S.phase === 'WAITING') deps.requestExtract(); }, d.wait_ms || 3000);
  }

  function onApiError(e, retryPayload) {
    if (e instanceof TerminalApiError) return error(e.message);
    if (++consecApiErrors >= MAX_CONSEC_API_ERRORS) return handOver('API:t svarar inte');
    const backoff = (e?.retryAfter ?? 2 ** consecApiErrors) * 1000;
    toPhase('RUNNING', { note: `Tillfälligt fel, försöker igen om ${Math.round(backoff / 1000)} s…` });
    setTimeout(() => onSettled(retryPayload), backoff);
  }

  function userTouched(why) { stop(`du tog över själv (${why})`); }
  function anchorLost(kind, diag) {
    const base = `tappade ${kind === 'input' ? 'skrivfältet' : 'konversationsytan'} — peka ut det igen`;
    stop(diag ? `${base}\n[${diag}]` : base);
  }

  function finish(reason) { proposal = null; clearAll(); toPhase('DONE', { note: reason }); }
  function handOver(reason) { proposal = null; clearAll(); toPhase('HANDOFF', { note: reason }); }
  function error(reason) { proposal = null; clearAll(); toPhase('ERROR', { note: reason }); }
  function stop(reason) { proposal = null; clearAll(); toPhase('STOPPED', { note: reason }); }
  function clearAll() { clearTimeout(waitTimer); clearTimeout(failTimer); waitTimer = failTimer = null; }

  // Återuppta efter ett mjukt stopp (t.ex. "inget hände på ett tag") utan att börja om.
  // Nollställ väntar-/fel-räknarna, gå tillbaka till RUNNING och läs om — då fortsätter loopen.
  function resume() {
    if (!S) return;
    consecWaits = 0; consecApiErrors = 0;
    clearAll(); proposal = null;
    toPhase('RUNNING', { note: 'Fortsätter…' });
    deps.requestExtract();
  }

  return {
    start, onSettled, approve, edit, skip, resume, abort: () => stop('du avslutade'),
    userTouched, anchorLost,
    get session() { return S; },
    get proposal() { return proposal; },
    setLimits(o) { Object.assign(limits, o); },
  };
}
