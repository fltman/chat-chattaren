// content.js — frame-roten. Kör i VARJE frame (all_frames). Äger DOM:en, aldrig
// nyckeln eller målet. Ansvar:
//   - pekning (picker.js) i den frame användaren klickar i
//   - självregistrering: läs profil ur storage.local, självtesta, anmäl dig till panelen
//   - den BILLIGA settle-grinden: pollar textytans hash tills den stabiliserat sig
//   - extraktion (composer borttagen, DU:/DEM:-etiketter), snabbknapps-skörd
//   - skrivning + skicka, med eko-bokföring och närvarovakt
// Ser bara den literala strängen som ska skrivas / etiketten som ska klickas.

import { startPicker } from './picker.js';
import { resolvePath, findAnchor, rehealAnchor, createAnchor } from './anchor.js';
import {
  extractTranscript, harvestReplies, forHash, forModel, hash, isTyping, makeEchoTracker,
} from './transcript.js';
import { typeAndSend as domTypeAndSend, clickReply as domClickReply } from './write.js';
import { getProfile, saveProfile } from './store.js';

const POLL_MS = 500;          // hur ofta vi läser textytan
// Adaptiv stabilisering: en avslutad STREAM (flera snabba ändringar i rad) → svaret är klart,
// reagera snabbt. En ENSAM ändring → vänta längre ifall svaret kommer i flera stycken, eller
// motparten fortfarande letar/skriver långsamt.
const STABLE_FAST = 2;        // ~1,0 s efter en stream
const STABLE_SLOW = 5;        // ~2,5 s efter en isolerad ändring
const COOLDOWN_MS = 1200;     // dämpa medan vårt eget meddelande renderas in

const S = {
  profile: null,
  inputEl: null, convEl: null, sendEl: null,
  pollTimer: null, running: false,
  prevHash: null, prevNorm: '', repliesSig: '',     // baslinje för "vad vi senast agerade på"
  lastPollHash: null, lastPollSig: null, stableCount: 0, changingPolls: 0, // stabiliseringsspårning
  suppressing: false,           // sant medan vi själva skriver (undvik eget eko + falsk närvaro)
  echo: makeEchoTracker(),
};

let activePicker = null;
let suppressPickCancel = false;

/* ---------- ankarupplösning ---------- */

// Snappa pekningen till rätt sorts element: klickade man på en wrapper runt fältet/
// knappen, hitta det riktiga inuti (eller närmaste ovanför). Löser att chattwidgetar
// ofta har ett overlay-lager över själva textarean.
function snapAnchor(kind, anchor, el) {
  if (!el) return anchor;
  if (kind === 'input' && !isTextEntryEl(el)) {
    const inner = el.querySelector('textarea, input:not([type=hidden]), [contenteditable=""], [contenteditable=true], [role=textbox]')
      || el.closest('textarea, input, [contenteditable], [role=textbox]');
    if (inner && isTextEntryEl(inner)) return createAnchor(inner, 'input');
  }
  if (kind === 'send') {
    const t = el.nodeName.toLowerCase();
    if (t !== 'button' && el.getAttribute('role') !== 'button' && t !== 'a') {
      const btn = el.closest('button, [role=button], a') || el.querySelector('button, [role=button]');
      if (btn) return createAnchor(btn, 'send');
    }
  }
  return anchor;
}

// Är elementet ett textinmatningsfält, oavsett tagg?
function isTextEntryEl(el) {
  const t = el.nodeName.toLowerCase();
  if (t === 'textarea') return true;
  if (t === 'input') return /^(text|search|email|tel|url|)$/.test(el.getAttribute('type') || '');
  return el.isContentEditable || el.getAttribute('role') === 'textbox';
}

// input: path först; miss → läk MEN acceptera bara ett textinmatningselement (aldrig ett
// sökfält av annan typ), så en re-render inte hårdstoppar men vi heller aldrig skriver fel.
function resolveInput(anchor) {
  if (!anchor) return null;
  const direct = resolvePath(anchor.path, document);
  if (direct && isTextEntryEl(direct)) return direct;
  const r = findAnchor(anchor);
  if (r.el && isTextEntryEl(r.el)) {
    if (r.how === 'healed') { rehealAnchor(anchor, r.el); saveProfile(S.profile).catch(() => {}); }
    return r.el;
  }
  return null;
}
// send: path först; miss → läk men bara till en knapp/klickbar (annars null → Enter-fallback).
function resolveSend(anchor) {
  if (!anchor) return null;
  const direct = resolvePath(anchor.path, document);
  if (direct) return direct;
  const r = findAnchor(anchor);
  const t = r.el && r.el.nodeName.toLowerCase();
  if (r.el && (t === 'button' || r.el.getAttribute('role') === 'button' || t === 'a')) {
    if (r.how === 'healed') { rehealAnchor(anchor, r.el); saveProfile(S.profile).catch(() => {}); }
    return r.el;
  }
  return null;
}
// conversation: läkning på (läsning är ofarlig; fel text fångas av människan i REVIEW).
function resolveConversation(anchor) {
  if (!anchor) return null;
  const r = findAnchor(anchor);
  if (r.el && r.how === 'healed') { rehealAnchor(anchor, r.el); saveProfile(S.profile).catch(() => {}); }
  return r.el;
}

function bind(profile) {
  S.profile = profile;
  S.inputEl = resolveInput(profile.input);
  S.convEl = resolveConversation(profile.conversation);
  S.sendEl = profile.send ? resolveSend(profile.send) : null;
  return { input: !!S.inputEl, conversation: !!S.convEl, send: !!S.sendEl };
}

/* ---------- pollningsbaserad settle-grind ---------- */
// MutationObserver är opålitlig i vissa widgetar (mutationer i shadow DOM fyrar inte
// alltid som väntat). Vi pollar istället textytans hash på fast intervall och agerar
// först när den stått still i STABLE_POLLS pollningar — funkar oavsett hur svaret dyker upp.

function foreignLines(labelledText) {
  return labelledText.split('\n').filter((l) => l.startsWith('DEM:')).join('\n');
}

function poll() {
  if (!S.running || S.suppressing) return;
  if (!alive()) return teardown(); // gammalt script efter en reload → sluta tyst
  // Konversationsytan kan bytas ut vid re-render → återupplös (läk) innan vi ger upp.
  if (!S.convEl || !S.convEl.isConnected) {
    const re = resolveConversation(S.profile?.conversation);
    if (re && re.isConnected) S.convEl = re;
    else { emitAnchorLost('conversation'); return; }
  }
  const { text } = extractTranscript(S.convEl, S.inputEl);
  const replies = harvestReplies(S.convEl, S.inputEl, S.sendEl);
  const norm = forHash(text);
  const h = hash(norm);
  const sig = replies.map((r) => r.label).join('|');

  // Ändrades något sedan förra pollningen? Räkna längden på den pågående ändrings-"skuren"
  // (många snabba ändringar = en stream), och återställ stabiliseringsräknaren.
  if (h !== S.lastPollHash || sig !== S.lastPollSig) {
    S.lastPollHash = h; S.lastPollSig = sig; S.stableCount = 0;
    S.changingPolls = (S.changingPolls || 0) + 1;
    return;
  }
  // Oförändrat. Välj väntefönster: streamade det (>=2 ändringar) → kort; ensam ändring → långt.
  const threshold = (S.changingPolls || 0) >= 2 ? STABLE_FAST : STABLE_SLOW;

  // Live-diagnostik till panelen (var ~2 s) — visar om pollningen läser och stabiliseras.
  S._dbg = (S._dbg || 0) + 1;
  if (S._dbg % 4 === 0) {
    const sw = norm.startsWith(S.prevNorm);
    const delta = sw ? norm.slice(S.prevNorm.length).trim() : '(!startsWith)';
    send({
      t: 'cc/pollDebug', chars: text.length, stable: `${S.stableCount}/${threshold}`, differs: h !== S.prevHash,
      echo: S.echo.deltaIsOnlyOurs(S.prevNorm, norm), startsWith: sw,
      delta: String(delta).slice(0, 60), tail: norm.slice(-60), sent: S.echo.sent.length,
    });
  }

  if (++S.stableCount < threshold) return;              // ännu inte stabilt nog
  S.changingPolls = 0;                                  // skuren är över

  // Stabilt. Är det nytt jämfört med det vi senast agerade på?
  if (h === S.prevHash && sig === S.repliesSig) return;                 // inget nytt
  if (S.echo.deltaIsOnlyOurs(S.prevNorm, norm)) {                       // bara vårt eget eko
    S.prevHash = h; S.prevNorm = norm; S.repliesSig = sig; return;
  }
  S.prevHash = h; S.prevNorm = norm; S.repliesSig = sig;
  send({ t: 'cc/settled', text: forModel(text), foreign: foreignLines(text), replies, isTyping: false, hash: h });
}

function startObserving() {
  if (!S.convEl) return false;
  S.running = true;
  // Baslinje: nuläget ska inte trigga ett settle, bara verkliga ändringar efteråt.
  const { text } = extractTranscript(S.convEl, S.inputEl);
  S.prevNorm = forHash(text); S.prevHash = hash(S.prevNorm);
  S.repliesSig = harvestReplies(S.convEl, S.inputEl, S.sendEl).map((r) => r.label).join('|');
  S.lastPollHash = S.prevHash; S.lastPollSig = S.repliesSig; S.stableCount = 0; S.changingPolls = 0;
  clearInterval(S.pollTimer);
  S.pollTimer = setInterval(poll, POLL_MS);
  attachPresenceWatch();
  return true;
}

function stopAll() {
  S.running = false;
  clearInterval(S.pollTimer); S.pollTimer = null;
  detachPresenceWatch();
}

/* ---------- närvarovakt: användaren tar över ---------- */

function onUserKey(e) { if (e.isTrusted && !S.suppressing) reportTouched(e.type === 'paste' ? 'paste' : 'keydown'); }
function onUserClick(e) { if (e.isTrusted && !S.suppressing) reportTouched('click'); }

function attachPresenceWatch() {
  if (S.inputEl) { S.inputEl.addEventListener('keydown', onUserKey, true); S.inputEl.addEventListener('paste', onUserKey, true); }
  if (S.convEl) S.convEl.addEventListener('click', onUserClick, true);
}
function detachPresenceWatch() {
  if (S.inputEl) { S.inputEl.removeEventListener('keydown', onUserKey, true); S.inputEl.removeEventListener('paste', onUserKey, true); }
  if (S.convEl) S.convEl.removeEventListener('click', onUserClick, true);
}
function reportTouched(why) { send({ t: 'cc/userTouched', why }); stopAll(); }

/* ---------- skrivning ---------- */

async function doTypeAndSend(text) {
  // Föredra det element vi redan band vid observe om det fortfarande lever — det är
  // mest pålitligt (en läkning kan i värsta fall träffa fel fält). Är det borta
  // (widgeten bytte ut noden) återupplöser vi ankaret med säker läkning.
  // OBS: .isConnected (INTE document.contains) — det korsar shadow-gränser; ett fält
  // inuti en shadow root (som IKEA:s <syndeo-chat>) räknas annars felaktigt som borta.
  let el = (S.inputEl && S.inputEl.isConnected && isTextEntryEl(S.inputEl)) ? S.inputEl : null;
  if (!el) el = resolveInput(S.profile.input);
  if (!el || !el.isConnected) {
    // Diagnostik: varför hittades inte fältet? (visas i panelen)
    const a = S.profile.input;
    const direct = a ? resolvePath(a.path, document) : null;
    const healed = a ? findAnchor(a) : { how: null };
    const diag = `cache=${!!S.inputEl}/${!!(S.inputEl && S.inputEl.isConnected)} path=${!!direct} heal=${healed.how || 'nej'}${healed.score ? '@' + Math.round(healed.score) : ''} steg=${(a?.path || []).length} sel=${JSON.stringify((a?.path || [])).slice(0, 90)}`;
    return { ok: false, reason: 'anchor-lost', diag };
  }
  // Uppdatera även skicka-knappen ifall den re-renderats sedan observe.
  S.sendEl = S.profile.send ? resolveSend(S.profile.send) : null;
  if (el.type === 'password' || /current-password|new-password|one-time-code|cc-number/.test(el.autocomplete || '')) {
    return { ok: false, reason: 'password-field' };
  }
  // Jämför mot INPUT-ankarets origin (satt i den frame pekningen gjordes — kan vara en
  // iframe med annan origin än toppsidan), inte toppsidans origin.
  const anchorOrigin = S.profile.input?.origin;
  if (anchorOrigin && location.origin !== anchorOrigin) return { ok: false, reason: 'origin-changed' };
  if (S.echo.isRepeat(text)) return { ok: false, reason: 'would-repeat' };
  S.inputEl = el;

  S.suppressing = true;
  S.echo.remember(text);
  const res = domTypeAndSend(el, text, S.sendEl);
  // Kolla om fältet tömdes (de flesta widgets tömmer vid lyckad sändning).
  await sleep(800);
  const readback = (el.value ?? el.innerText ?? '');
  const cleared = !readback.includes(text.slice(0, 20));
  // Släpp dämpningen efter cooldown; pollningen återupptas då automatiskt och fångar
  // motpartens svar. Baslinjen (prevHash/prevNorm) rörs INTE — eko-spåraren skiljer vårt
  // eget meddelande från nya svar, så vi svälljer aldrig motpartens svar.
  setTimeout(() => { S.suppressing = false; }, COOLDOWN_MS);
  return { ...res, cleared };
}

async function doClickReply(idx, label) {
  const replies = harvestReplies(S.convEl, S.inputEl, S.sendEl);
  // Matcha primärt på etikett (index kan ha skiftat vid re-render), idx som tiebreak.
  let target = replies.find((r) => r.label === label);
  if (!target) target = replies.find((r) => r.idx === idx);
  if (!target) return { ok: false, reason: 'gone' };
  const nodes = [...S.convEl.querySelectorAll('button, [role="button"], a[role="button"], [role="option"], li[role="option"]')]
    .filter((n) => !(S.inputEl && (n === S.inputEl || S.inputEl.contains(n))) && !(S.sendEl && n === S.sendEl));
  const node = nodes.find((n) => (n.innerText || n.textContent || '').trim() === target.label);
  if (!node) return { ok: false, reason: 'gone' };
  S.suppressing = true;
  S.echo.remember(label);
  const res = domClickReply(node);
  setTimeout(() => { S.suppressing = false; }, COOLDOWN_MS);
  return res;
}

function emitAnchorLost(kind) { send({ t: 'cc/anchorLost', kind }); stopAll(); }

/* ---------- meddelanderouter ---------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!alive()) return; // föräldralöst script efter en reload → svara inte
  try {
  switch (msg?.t) {
    case 'cc/startPick':
      if (activePicker) { sendResponse({ ok: true }); return; } // redan igång → arma inte om
      activePicker = startPicker(msg.kind, (anchor, el) => {
        const silent = suppressPickCancel; suppressPickCancel = false;
        activePicker = null;
        if (silent) return; // avbruten för att en annan frame vann pick:en
        if (!anchor) return send({ t: 'cc/pickCancelled' });
        send({ t: 'cc/picked', kind: msg.kind, anchor: snapAnchor(msg.kind, anchor, el), frameHref: location.href });
      });
      sendResponse({ ok: true });
      return;

    case 'cc/cancelPick':
      if (activePicker) { suppressPickCancel = true; activePicker.cancel(); activePicker = null; }
      sendResponse({ ok: true });
      return;

    case 'cc/probe': {
      const matched = bind(msg.profile);
      sendResponse({ ok: true, matched });
      return;
    }

    case 'cc/observe': {
      bind(msg.profile);
      if (!S.convEl) { sendResponse({ ok: false, reason: 'conversation-lost' }); return; }
      const ok = startObserving();
      sendResponse({ ok });
      return;
    }

    case 'cc/extract': {
      if (!S.convEl) { sendResponse({ ok: false, reason: 'conversation-lost' }); return; }
      const { text } = extractTranscript(S.convEl, S.inputEl);
      const replies = harvestReplies(S.convEl, S.inputEl, S.sendEl);
      sendResponse({ ok: true, text: forModel(text), foreign: foreignLines(text), replies, isTyping: isTyping(text), hash: hash(forHash(text)) });
      return;
    }

    case 'cc/typeAndSend':
      // Svara ALLTID, även vid undantag — annars stängs kanalen och panelen tror "no-frame".
      doTypeAndSend(msg.text).then(sendResponse, (e) => sendResponse({ ok: false, reason: 'error', error: String(e?.message || e) }));
      return true; // async

    case 'cc/clickReply':
      doClickReply(msg.idx, msg.label).then(sendResponse, (e) => sendResponse({ ok: false, reason: 'error', error: String(e?.message || e) }));
      return true; // async

    case 'cc/stop':
      stopAll();
      sendResponse({ ok: true });
      return;
  }
  } catch (e) {
    if (!alive()) { teardown(); return; }
    try { sendResponse({ ok: false, reason: 'error', error: String(e?.message || e) }); } catch { /* kanalen stängd */ }
  }
});

/* ---------- självregistrering ---------- */

// Lever tilläggskontexten fortfarande? Efter en omladdning av tillägget blir det gamla
// injicerade scriptet föräldralöst — då är chrome.runtime.id undefined och alla anrop
// kastar "Extension context invalidated". Vi upptäcker det och stänger av oss själva.
function alive() { try { return chrome.runtime?.id != null; } catch { return false; } }

function send(m) {
  if (!alive()) return teardown();
  try { chrome.runtime.sendMessage(m).catch(() => {}); } catch { teardown(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let regObserver = null;
function teardown() { stopAll(); regObserver?.disconnect(); regObserver = null; }

async function selfRegister() {
  if (!alive()) return teardown();
  if (S.running) return;
  let profile;
  try { profile = await getProfile(); } catch { return; }
  if (!profile) return;
  const originOk = !profile.origins?.length || profile.origins.includes(location.origin) || location.origin === profile.origin;
  if (!originOk) return;
  // Lätt predikat-kontroll (ingen läkningsvandring) — den dyra bind() sker först vid
  // cc/observe från panelen.
  if (!resolvePath(profile.input.path, document) || !resolvePath(profile.conversation.path, document)) return;
  S.profile = profile;
  // Panelen läser sender.frameId ur DETTA meddelande — vi skickar aldrig frameId själva.
  send({ t: 'cc/registered', href: location.href });
}

// Kör vid varje load OCH på sena SPA-mutationer som kan montera widgeten efteråt.
selfRegister();
let regTimer = null;
regObserver = new MutationObserver(() => { clearTimeout(regTimer); regTimer = setTimeout(selfRegister, 1000); });
regObserver.observe(document.documentElement, { childList: true, subtree: true });
