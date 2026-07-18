// transcript.js — två delar:
//   REN logik (ingen DOM): forHash, forModel, isTyping, hash, echo-detektering.
//     Körs i content-scriptet (billiga grinden) och är enhetstestbar i Node.
//   DOM-del: extractTranscript, harvestReplies. Kräver document, testas med jsdom.
//
// Kärnbeslut: läs aldrig rå container.innerText. Klona containern, ta bort
// input-ankarets subträd (så composer/placeholder/utkast inte förorenar), och
// etikettera varje block DU:/DEM: efter geometri. Se plan §5.

/* ==================== REN LOGIK ==================== */

// Skrivindikatorer: "Anna skriver…", "is typing", animerade prickar.
const TYPING_RE = /(skriver\s*(just nu)?\s*[.…]*|is typing|typing[.…]*|•\s*•\s*•|…|\.\.\.)/gi;

// 1) För MODELLEN: lätt städning, behåll versaler och betydelse.
export function forModel(raw) {
  return String(raw).replace(/[​﻿]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// 2) För HASHEN: förstör allt som re-renderas utan mänsklig input (tidsstämplar,
//    klockslag, kvitton, skrivindikatorer) så en tickande "2 min sedan" inte
//    triggar ett betalt anrop in i en död chatt.
export function forHash(raw) {
  return String(raw)
    .normalize('NFKC')
    .replace(/[​﻿]/g, '')
    // Talaretiketter (DU:/DEM:) är struktur, inte innehåll — strippa dem så själveko-
    // detekteringen inte snubblar på ett kvarlämnat "du:" efter borttaget eget meddelande.
    .replace(/(^|\s)(du|dem):\s*/gi, '$1')
    .replace(/\b\d+\s*(sek|sekunder|min|minut(er)?|tim|timm(e|ar)|dag(ar)?|sec(onds?)?|minutes?|hours?|days?)\s*(sedan|ago)\b/gi, '')
    .replace(/\b(just nu|nyss|precis|i går|igår|yesterday|just now|moments ago|now)\b/gi, '')
    .replace(/\b\d{1,2}[:.]\d{2}(:\d{2})?\s*(am|pm)?\b/gi, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\b(skickat|levererat|läst|sett|delivered|read|seen|sent|delivered)\b/gi, '')
    .replace(TYPING_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isTyping(raw) { TYPING_RE.lastIndex = 0; return TYPING_RE.test(String(raw)); }

// FNV-1a 32-bit: synkron, snabb, ingen crypto.subtle-await i en het loop.
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// --- själveko: vi VET vad vi skickade, så härled aldrig avsändare ur DOM:en ---
export function makeEchoTracker() {
  const sent = []; // normaliserade strängar vi skickat
  return {
    remember(msg) { sent.push(forHash(msg)); },
    get sent() { return sent; },
    // True om allt nytt sedan förra gången bara är vårt eget meddelande som ekar.
    deltaIsOnlyOurs(prevNorm, currNorm) {
      if (!currNorm.startsWith(prevNorm)) return false; // omskrivning: vet ej, var säker
      let delta = currNorm.slice(prevNorm.length).trim();
      if (!delta) return true;
      for (const s of sent) if (s && delta.includes(s)) delta = delta.replace(s, '').trim();
      return delta.length < 3;
    },
    // Hård vakt: vägra skicka något ~identiskt med våra 2 senaste meddelanden.
    isRepeat(msg) {
      const n = forHash(msg);
      return sent.slice(-2).some((p) => p === n || (p.length > 20 && (p.includes(n) || n.includes(p))));
    },
  };
}

/* ==================== DOM-DEL (kräver document) ==================== */

// Etikettera ett block efter geometri: höger halva = vi (DU:), vänster = motparten (DEM:).
function speakerLabel(el, containerRect) {
  const r = el.getBoundingClientRect();
  if (r.width === 0) return 'DEM:'; // hopfällt/osynligt: anta motpart, människan fångar fel i REVIEW
  const centerX = r.left + r.width / 2;
  const frac = (centerX - containerRect.left) / (containerRect.width || 1);
  return frac > 0.55 ? 'DU:' : 'DEM:';
}

/**
 * Läs ut utskriften ur den markerade konversationsytan, utan composer-förorening.
 * @param {Element} container konversationsankarets element
 * @param {Element|null} inputEl input-ankarets element (tas bort ur klonen)
 * @returns {{text:string}}
 */
export function extractTranscript(container, inputEl) {
  if (!container) return { text: '' };
  const containerRect = container.getBoundingClientRect();

  // Etikettera direkta block-barn efter geometri PÅ ORIGINALEN (klonen har ingen layout),
  // men läs text ur en klon där input-subträdet är borttaget.
  const clone = container.cloneNode(true);

  // Ta bort input-ankarets subträd ur klonen: composer, placeholder, utkast, pågående
  // tangenttryck ska aldrig läsas som transkript. Matcha via en markör vi sätter först.
  if (inputEl && container.contains(inputEl)) {
    inputEl.setAttribute('data-cc-input', '1');
    const cloneCopy = container.cloneNode(true);
    const mark = cloneCopy.querySelector('[data-cc-input]');
    if (mark) mark.remove();
    inputEl.removeAttribute('data-cc-input');
    return { text: labelledText(container, cloneCopy, containerRect) };
  }
  return { text: labelledText(container, clone, containerRect) };
}

// Bygg etiketterad text: gå igenom originalets direkta block-barn (för geometri),
// och plocka motsvarande text ur den rensade klonen barn-för-barn.
function labelledText(origContainer, cleanClone, containerRect) {
  const origKids = [...origContainer.children];
  const cloneKids = [...cleanClone.children];
  const lines = [];
  for (let i = 0; i < origKids.length; i++) {
    const orig = origKids[i];
    const clean = cloneKids[i];
    if (!clean) continue;
    const t = (clean.innerText || clean.textContent || '').trim();
    if (!t) continue;
    lines.push(`${speakerLabel(orig, containerRect)} ${t}`);
  }
  // Fallback: om containern inte har block-barn (allt är inline), ta hela texten.
  if (!lines.length) {
    const t = (cleanClone.innerText || cleanClone.textContent || '').trim();
    return t;
  }
  return lines.join('\n');
}

/**
 * Skörda synliga svarsknappar (quick-reply chips) inom konversationsytan men utanför
 * input-subträdet. Löser S1: knappdrivna bottar.
 * @returns {Array<{label:string, idx:number}>}
 */
export function harvestReplies(container, inputEl, sendEl) {
  if (!container) return [];
  const sel = 'button, [role="button"], a[role="button"], [role="option"], li[role="option"]';
  const nodes = [...container.querySelectorAll(sel)];
  const out = [];
  let idx = 0;
  for (const n of nodes) {
    if (inputEl && (n === inputEl || inputEl.contains(n) || n.contains(inputEl))) continue;
    if (sendEl && (n === sendEl || sendEl.contains(n))) continue;
    const label = (n.innerText || n.textContent || '').trim();
    if (!label || label.length > 120) continue;      // tom/ikon-only eller uppenbar icke-chip
    const r = n.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;    // osynlig
    out.push({ label, idx: idx++ });
  }
  return out;
}
