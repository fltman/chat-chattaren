// panel.js — panelens glue-lager. Äger sessionen via machine.js, injicerar pickern,
// pratar med rätt frame direkt via chrome.tabs.sendMessage(...,{frameId}). Nyckeln bor
// här (och i storage.session), aldrig i content-scriptet. Panel stängs = loopen dör.

import { createMachine } from './src/machine.js';
import { decide } from './src/openrouter.js';
import { getKey, setKey, getProfile, saveProfile, pathBucket } from './src/store.js';

const $ = (id) => document.getElementById(id);
const now = () => Date.now();

let tab = null;               // {id, url}
let draft = null;             // profil under uppbyggnad
let verified = { input: false, conversation: false, send: false }; // löser ankaret NU?
let sessionFrameId = null;    // frameId för widget-framen (lärs vid pick/registrering)
let widgetHref = null;        // frameHref från en pick, för behörighetsbegäran
let machine = null;
let running = false;

/* ---------- boot ---------- */

async function boot() {
  let t;
  try { [t] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch { /* ignore */ }
  tab = { id: t?.id, url: t?.url || '' };
  try { await maybeOnboard(); } catch (e) { console.warn('onboarding', e); }
  const key = await getKey();
  if (!key) return show('v-key');
  try { draft = (await getProfile(tab.url)) || newDraft(); } catch { draft = newDraft(); }
  refreshDots();
  show('v-profile');
}

function newDraft() {
  let origin = '', host = '', pathname = '/';
  try { const u = new URL(tab.url); origin = u.origin; host = u.host; pathname = u.pathname; } catch { /* tab.url saknas */ }
  return { host, pathBucket: pathBucket(pathname), origins: origin ? [origin] : [], origin, input: null, conversation: null, send: null };
}

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  $('footer').hidden = id !== 'v-run';
}

// Visa/dölj en liten hjälptext (t.ex. #grant-note).
function note(id, text) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

/* ---------- onboarding (engångs) ---------- */

const DISCLOSURE = `
<h3>Innan du börjar</h3>
<p>Chat-chattaren skriver i chatten åt dig, i ditt namn, från din dator. Det är fortfarande
<em>du</em> som för samtalet — verktyget skriver bara orden. Tre saker att veta:</p>
<p><strong>1. Många företags villkor förbjuder automatiserad kontakt.</strong> Du använder deras
chatt för ditt eget ärende — men villkoren skiljer sällan på det. I värsta fall kan de avsluta
samtalet eller ditt konto. Risken är liten men verklig, och den är din.</p>
<p><strong>2. Verktyget kan ha fel.</strong> Det får inte hitta på ordernummer, datum eller belopp
— det spärras automatiskt — men det kan formulera sig klumpigt. Läs innan du skickar.</p>
<p><strong>3. Det ljuger aldrig om vad det är.</strong> Frågar motparten om du är en bot lämnar det
över till dig. Det påstår aldrig att det är en människa.</p>
<p class="muted">Din OpenRouter-nyckel sparas okrypterat i webbläsaren på den här datorn. Chattens
innehåll skickas till OpenRouter för att kunna besvaras.</p>
<div class="db-actions"><button id="ob-ok" class="primary">Jag har läst och förstått</button></div>`;

async function maybeOnboard() {
  const { onboarded } = await chrome.storage.local.get('onboarded');
  if (onboarded) return;
  const dlg = $('onboarding');
  dlg.innerHTML = DISCLOSURE;
  try { dlg.showModal(); } catch { return; } // om dialogen inte kan visas: blockera aldrig starten
  const accepted = await new Promise((res) => {
    $('ob-ok').onclick = () => res(true);
    dlg.addEventListener('close', () => res(false), { once: true }); // Escape/stängning hänger inte
  });
  dlg.close();
  if (accepted) await chrome.storage.local.set({ onboarded: true });
}

/* ---------- nyckel ---------- */

$('key-save').onclick = async () => {
  const k = $('key-input').value.trim();
  if (!k) return;
  await setKey(k, $('key-remember').checked);
  draft = (await getProfile(tab.url)) || newDraft();
  refreshDots();
  show('v-profile');
};

/* ---------- pekning ---------- */

for (const btn of document.querySelectorAll('.pick')) {
  btn.onclick = () => startPick(btn.dataset.kind);
}

async function startPick(kind) {
  // Behörighet för sidans ALLA frames — inte bara toppsidan. Chattwidgetar ligger ofta
  // i en cross-origin iframe (Intercom/Zendesk/egna widgets); utan behörighet för iframens
  // origin injiceras pekaren aldrig därinne, och klicket markerar bara själva iframen.
  try {
    const origins = new Set([new URL(tab.url).origin + '/*']);
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      for (const f of frames || []) {
        try { const o = new URL(f.url).origin; if (/^https?:$/.test(new URL(f.url).protocol)) origins.add(o + '/*'); } catch { /* about:blank m.m. */ }
      }
    } catch { /* webNavigation kan saknas — fortsätt med toppsidan */ }
    const list = [...origins];
    const has = await chrome.permissions.contains({ origins: list });
    if (!has) await chrome.permissions.request({ origins: list });
    // Kom ihåg iframe-origins så den varaktiga behörigheten vid Start täcker dem.
    draft.origins = [...new Set([...(draft.origins || []), ...list.map((o) => o.replace(/\/\*$/, ''))])];
  } catch { /* fortsätt — activeTab kan ändå räcka */ }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['src/cs-loader.js'],
    });
  } catch (e) {
    return note('grant-note', 'Kunde inte nå sidan: ' + (e?.message || e) + '. Ladda om fliken och försök igen.');
  }
  note('grant-note', '');
  // Låt content.js hinna laddas (dynamisk import) i ALLA frames, även iframen, innan
  // vi bredsänder — annars når startPick bara toppsidan.
  await new Promise((res) => setTimeout(res, 400));
  // Bredsänd cc/startPick (utan frameId = alla frames) tills någon lyssnare svarar.
  for (let i = 0; i < 25; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { t: 'cc/startPick', kind });
      if (r?.ok) return;
    } catch { /* lyssnaren inte redo än */ }
    await new Promise((res) => setTimeout(res, 120));
  }
  note('grant-note', 'Pekaren startade inte. Ladda om fliken och försök igen.');
}

/* ---------- meddelanden från frames ---------- */

chrome.runtime.onMessage.addListener((msg, sender) => {
  const frameId = sender.frameId;
  switch (msg?.t) {
    case 'cc/picked': {
      draft[msg.kind] = msg.anchor;
      verified[msg.kind] = true; // optimistiskt grön, probe:n nedan korrigerar
      if (msg.kind === 'conversation' || msg.kind === 'input') sessionFrameId = frameId;
      widgetHref = msg.frameHref;
      if (sender.url) { try { draft.origins = [...new Set([...draft.origins, new URL(sender.url).origin])]; } catch {} }
      chrome.tabs.sendMessage(tab.id, { t: 'cc/cancelPick' }).catch(() => {}); // städa övriga frames overlays
      refreshDots();
      verify(); // bekräfta att ankaret faktiskt löser NU, och läk om möjligt
      break;
    }
    case 'cc/registered':
      // En (om)laddad frame anmäler sig. Uppdatera frameId; återuppta om vi kör.
      sessionFrameId = frameId;
      if (running && machine?.session) toFrame({ t: 'cc/observe', profile: draft }).catch(() => {});
      break;
    case 'cc/settled':
      if (running && machine) machine.onSettled(msg);
      break;
    case 'cc/userTouched':
      if (running && machine) machine.userTouched(msg.why);
      break;
    case 'cc/anchorLost':
      if (running && machine) machine.anchorLost(msg.kind);
      break;
    case 'cc/pollDebug': {
      const el = $('polldbg');
      if (el) el.textContent =
        `pollar: ${msg.chars} tecken · stabil ${msg.stable} · ${msg.differs ? 'NYTT' : 'oförändrat'}\n`
        + `echo=${msg.echo} startsWith=${msg.startsWith} sent=${msg.sent}\n`
        + `delta: ${msg.delta || '(tom)'}\n`
        + `svans: …${msg.tail}`;
      break;
    }
  }
});

function refreshDots() {
  for (const dot of document.querySelectorAll('.dot')) {
    const kind = dot.dataset.for;
    const picked = !!draft?.[kind];
    dot.classList.toggle('done', picked && verified[kind] !== false);
    dot.classList.toggle('warn', picked && verified[kind] === false);
  }
  // Kräv att både fält OCH lista faktiskt löser (inte bara pickats).
  const ok = draft?.input && draft?.conversation && verified.input !== false && verified.conversation !== false;
  $('activate').disabled = !ok;
  note('grant-note', (draft?.input && verified.input === false) ? 'Skrivfältet hittades inte där du pekade — peka ut det igen (klicka mitt i själva fältet).' : '');
}

// Bekräfta att de markerade ankarena faktiskt löser i sidan NU (och läk om möjligt).
async function verify() {
  if (sessionFrameId == null || !draft) return;
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { t: 'cc/probe', profile: draft }, { frameId: sessionFrameId });
    if (r?.ok && r.matched) { verified = r.matched; refreshDots(); }
  } catch { /* content-scriptet inte redo än */ }
}

/* ---------- starta session ---------- */

$('activate').onclick = async () => {
  const goal = $('goal').value.trim();
  const facts = $('facts').value.trim();
  if (!goal) { $('goal').focus(); return; }
  if (!draft.input || !draft.conversation) return;

  await saveProfile(draft);

  // Be om varaktig behörighet (sajt + widget-origin) så agenten överlever omladdning.
  // Fortsätt även om den nekas — content-scriptet lever redan i framen tills navigering.
  try {
    const origins = [...new Set(draft.origins.map((o) => o + '/*'))];
    const granted = await chrome.permissions.request({ origins });
    if (granted) {
      await chrome.scripting.registerContentScripts([{
        id: 'cc-' + draft.host,
        matches: origins,
        allFrames: true,
        matchOriginAsFallback: true,
        runAt: 'document_idle',
        js: ['src/cs-loader.js'],
      }]).catch(() => {});
      note('grant-note', '');
    } else {
      note('grant-note', 'Utan behörighet stannar sessionen om du laddar om sidan.');
    }
  } catch { /* redan registrerad e.d. */ }

  const apiKey = await getKey();
  machine = createMachine({
    now,
    decide: (p) => decide({ ...p, apiKey }),
    sendToFrame: (m) => toFrame(m),
    requestExtract: async () => { const r = await toFrame({ t: 'cc/extract' }); if (r?.ok) machine.onSettled(r); },
    render,
  });
  running = true;
  show('v-run');
  $('footer').hidden = false;

  const r = await toFrame({ t: 'cc/observe', profile: draft });
  if (!r?.ok) return machine.anchorLost('conversation');
  const mode = $('auto-mode')?.checked ? 'auto' : 'copilot';
  const persona = $('persona')?.value || 'balanserad';
  machine.start({ goal, facts, apiKey, tabId: tab.id, frameId: sessionFrameId, mode, persona });

  // Initiera samtalet direkt: läs det som redan står (hälsning/tomt) och föreslå
  // öppningsmeddelandet — vänta inte på att motparten skriver något nytt.
  const first = await toFrame({ t: 'cc/extract' });
  if (first?.ok) machine.onSettled(first);
};

function toFrame(msg) {
  if (sessionFrameId == null) return Promise.resolve({ ok: false, reason: 'no-frame' });
  return chrome.tabs.sendMessage(tab.id, msg, { frameId: sessionFrameId }).catch(() => ({ ok: false, reason: 'no-frame' }));
}

/* ---------- rendering ---------- */

function render(v) {
  // Kostnad + tak i foten.
  if (v.counters) {
    const c = v.counters, L = v.limits;
    $('cost').hidden = false;
    $('cost').textContent = `${(c.spendUsd * 10).toFixed(2)} kr`; // ~10 kr/USD, grov visning
    $('caps').textContent = `${c.sent}/${L.maxMessages} meddelanden · ${c.calls}/${L.maxCalls} anrop`;
  }

  const review = $('review'), terminal = $('terminal'), status = $('status');
  const terminalPhases = { DONE: 'done', HANDOFF: 'handoff', ERROR: 'error', STOPPED: 'stopped' };

  if (terminalPhases[v.phase]) {
    review.hidden = true; status.hidden = true; terminal.hidden = false;
    terminal.className = 'terminal ' + terminalPhases[v.phase];
    const labels = { DONE: '✓ Klart', HANDOFF: 'Över till dig', ERROR: 'Fel', STOPPED: 'Stoppad' };
    $('term-msg').textContent = `${labels[v.phase]}${v.note ? ' — ' + v.note : ''}`;
    // "Fortsätt" bara vid mjuka stopp (den gav upp/väntade ut) — inte vid klart eller hårt fel.
    const cont = $('btn-continue');
    if (cont) cont.hidden = !(v.phase === 'STOPPED' || v.phase === 'HANDOFF');
    return;
  }
  terminal.hidden = true;

  if ((v.phase === 'REVIEW' || v.phase === 'BLOCKED') && v.proposal) {
    status.hidden = true; review.hidden = false;
    renderProposal(v.proposal, v.phase);
    return;
  }

  review.hidden = true; status.hidden = false;
  status.textContent = v.note || '…';
}

function renderProposal(p, phase) {
  $('obs').textContent = p.observation || '';
  const draftEl = $('draft'), chipEl = $('chip'), verdictEl = $('verdict'), tokensEl = $('tokens');

  if (p.kind === 'click') {
    draftEl.parentElement.querySelector('#draft').hidden = true;
    draftEl.hidden = true; chipEl.hidden = false;
    chipEl.textContent = '▸ ' + p.label;
  } else {
    chipEl.hidden = true; draftEl.hidden = false;
    draftEl.contentEditable = 'false';
    renderDraftText(draftEl, p.text, p.verdict);
  }

  // Verdikt-banner.
  if (p.verdict.type === 'blocked') {
    verdictEl.hidden = false;
    verdictEl.className = 'verdict ' + (p.verdict.override ? 'warn' : 'block');
    const spans = (p.verdict.spans || []).join(', ');
    verdictEl.textContent = p.verdict.override
      ? `⚠ ${p.verdict.reason}${spans ? ': ' + spans : ''}. ${p.verdict.hint || 'Granska extra noga.'}`
      : `⛔ Spärrat: ${p.verdict.reason}${spans ? ' (' + spans + ')' : ''}. Kan inte skickas.`;
  } else verdictEl.hidden = true;

  // Källtaggar för siffror.
  if (p.tokens && p.tokens.length) {
    tokensEl.hidden = false; tokensEl.innerHTML = '';
    for (const t of p.tokens) {
      const el = document.createElement('span');
      const cls = t.source === 'faktaruta' ? 'faktaruta' : t.source === 'deras svar' ? 'deras' : 'okänd';
      el.className = 'tok ' + cls;
      el.textContent = `${t.token} – ${t.source}`;
      tokensEl.appendChild(el);
    }
  } else tokensEl.hidden = true;

  // Knappar: ingen "Skicka" på ovridbar spärr.
  const blockedHard = phase === 'BLOCKED' && p.verdict.type === 'blocked' && !p.verdict.override;
  $('btn-send').disabled = blockedHard;
  $('btn-edit').disabled = p.kind === 'click';
}

function renderDraftText(el, text, verdict) {
  el.textContent = text;
  // Markera fällande spann i texten (ogrundade siffror, PII).
  if (verdict.type === 'blocked' && verdict.spans?.length) {
    let html = escapeHtml(text);
    for (const s of verdict.spans) {
      html = html.replaceAll(escapeHtml(s), `<mark>${escapeHtml(s)}</mark>`);
    }
    el.innerHTML = html;
  }
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- review-knappar ---------- */

$('btn-send').onclick = () => {
  const d = $('draft');
  const edited = d.contentEditable === 'true' ? d.innerText : null;
  d.contentEditable = 'false';
  machine?.approve(edited);
};
$('btn-edit').onclick = () => {
  const d = $('draft');
  d.contentEditable = 'true';
  d.focus();
  // Placera markören sist.
  const r = document.createRange(); r.selectNodeContents(d); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
};
$('btn-skip').onclick = () => machine?.skip();
$('btn-abort').onclick = () => { machine?.abort(); running = false; };
$('btn-continue').onclick = () => machine?.resume();
$('btn-restart').onclick = () => { running = false; machine = null; show('v-profile'); };

boot();
