// anchor.js — gör om ett klick till en lagringsbar, återfinningsbar referens.
// Ingen build. Laddas som content script (module) eller via importScripts-stil.

/* ---------- 1. Skräpdetektor: är detta namn maskingenererat? ---------- */

// Kända CSS-in-JS-prefix. Prefixet i sig är inte skräp — suffixet är det.
const GENERATED_CLASS_RE = [
  /^css-[0-9a-z]{4,}$/i,          // emotion
  /^sc-[a-zA-Z0-9]{6,}$/,        // styled-components
  /^jsx-\d+$/,                    // styled-jsx
  /^makeStyles-.*-\d+$/,          // MUI v4
  /^[A-Za-z]+_[A-Za-z0-9]+__[a-zA-Z0-9_-]{5,}$/, // CSS modules: Button_root__x7Fq2
  /^[a-z]+-[0-9a-f]{6,}$/i,      // generisk hash-svans
  /^_[a-zA-Z0-9]{5,}$/,          // vite/parcel scoping
];

// React useId ger ":r1:", ":r2h:" — börjar och slutar med kolon.
const REACT_USE_ID_RE = /^:[a-zA-Z0-9]+:$/;
// Angular view encapsulation
const NG_ATTR_RE = /^_ng(content|host)-/;
// UUID / lång hex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX_RE = /^[0-9a-f]{16,}$/i;
// Vue/webpack scope-attribut
const VUE_SCOPE_RE = /^data-v-[0-9a-f]{6,}$/;

/**
 * Entropi-heuristik lånad från Playwright (isGuidLike):
 * räkna teckenklass-övergångar (gemener→versaler, bokstav→siffra …).
 * Slumpade strängar byter klass ofta; ord gör det sällan.
 */
function transitionCount(s) {
  s = s.replace(/[-_]/g, ''); // avgränsare är inte entropi: "zd-chat-input" är ord
  let n = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    const cls = (c) =>
      /[a-z]/.test(c) ? 0 : /[A-Z]/.test(c) ? 1 : /[0-9]/.test(c) ? 2 : 3;
    if (cls(a) !== cls(b)) n++;
  }
  return n;
}

/**
 * Ordlikhet lånad från @medv/finder:
 * varje segment ska vara ≥3 tecken och inte ha 4+ konsonanter i rad.
 */
function looksLikeWords(name) {
  if (!/^[a-z][a-z0-9\-_]*$/i.test(name)) return false;
  const parts = name.split(/[-_]|(?=[A-Z])/).filter(Boolean);
  for (const p of parts) {
    if (p.length < 2) return false;
    if (/[^aeiouAEIOU0-9]{5,}/.test(p)) return false;
    // Segment som börjar på siffra men innehåller bokstäver = hash-svans ("1abc", "2x3f").
    if (/^\d/.test(p) && /[a-z]/i.test(p)) return false;
  }
  return true;
}

export function isJunkName(name) {
  if (!name) return true;
  if (REACT_USE_ID_RE.test(name)) return true;
  if (UUID_RE.test(name) || LONG_HEX_RE.test(name)) return true;
  if (GENERATED_CLASS_RE.some((re) => re.test(name))) return true;
  if (/\d{4,}/.test(name)) return true;                    // långa löpnummer
  if (name.length > 30) return true;
  // Entropitest: Playwrights tröskel, men bara på strängar långa nog att mäta.
  if (name.length >= 6 && transitionCount(name) >= name.length / 4) return true;
  if (!looksLikeWords(name)) return true;
  return false;
}

export function isJunkAttrName(attr) {
  return NG_ATTR_RE.test(attr) || VUE_SCOPE_RE.test(attr);
}

/* ---------- 2. Kandidatgenerering för ETT element ---------- */

const TESTID_ATTRS = [
  'data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy',
  'data-automation-id', 'data-tracking-id',
];

const css = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));

/** Rot = document eller en ShadowRoot. Unik inom sin rot. */
function isUnique(root, sel, el) {
  let found;
  try { found = root.querySelectorAll(sel); } catch { return false; }
  return found.length === 1 && found[0] === el;
}

/**
 * Returnerar kandidater för elementet, sorterade — lägre score = bättre.
 * Score-skalan är medvetet Playwrights (kTestIdScore=1 … kNthScore=10000).
 */
function localCandidates(el) {
  const out = [];
  const tag = el.nodeName.toLowerCase();
  const attr = (n) => el.getAttribute(n);

  for (const a of TESTID_ATTRS) {
    const v = attr(a);
    if (v && !isJunkName(v)) out.push({ sel: `[${a}="${css(v)}"]`, score: a === 'data-testid' ? 1 : 2 });
  }
  const aria = attr('aria-label');
  if (aria && aria.trim()) out.push({ sel: `${tag}[aria-label="${css(aria.trim())}"]`, score: 100 });

  const ph = attr('placeholder');
  if (ph && ph.trim()) out.push({ sel: `${tag}[placeholder="${css(ph.trim())}"]`, score: 120 });

  const name = attr('name');
  if (name && !isJunkName(name)) out.push({ sel: `${tag}[name="${css(name)}"]`, score: 130 });

  const role = attr('role');
  const id = attr('id');
  if (id && !isJunkName(id)) out.push({ sel: `#${css(id)}`, score: 500 });
  if (role) out.push({ sel: `${tag}[role="${css(role)}"]`, score: 510 });

  const type = attr('type');
  if (type && tag === 'input') out.push({ sel: `input[type="${css(type)}"]`, score: 520 });
  if (el.isContentEditable) out.push({ sel: `${tag}[contenteditable]`, score: 520 });

  for (const c of el.classList) {
    if (!isJunkName(c)) out.push({ sel: `${tag}.${css(c)}`, score: 525 });
  }
  out.push({ sel: tag, score: 530 });
  return out.sort((a, b) => a.score - b.score);
}

function nthSelector(el) {
  const tag = el.nodeName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const sibs = [...parent.children].filter((c) => c.nodeName === el.nodeName);
  if (sibs.length === 1) return tag;
  return `${tag}:nth-of-type(${sibs.indexOf(el) + 1})`;
}

/** Rot för ett element: närmaste ShadowRoot eller document. */
function rootOf(el) {
  const r = el.getRootNode();
  return r;
}

/**
 * Bygg en unik CSS-sträng för el INOM sin egen rot (går aldrig över shadow-gräns).
 * Klättrar uppåt tills unikhet, med nth-of-type som sista utväg.
 */
function selectorWithinRoot(el, root) {
  // Snabbväg: en enda stark lokal kandidat räcker ofta.
  for (const c of localCandidates(el)) {
    if (c.score <= 530 && isUnique(root, c.sel, el)) return c.sel;
  }
  // Annars: bygg stig uppåt.
  const parts = [];
  let cur = el;
  const stop = root.host ? root : root.documentElement ? root.documentElement : root;
  while (cur && cur !== stop && cur.nodeType === 1) {
    const best = localCandidates(cur)[0];
    const piece = best && best.score < 530 ? best.sel : nthSelector(cur);
    parts.unshift(piece);
    const sel = parts.join(' > ');
    if (isUnique(root, sel, el)) return sel;
    cur = cur.parentElement;
  }
  // Absolut sista utväg: full nth-stig.
  const abs = [];
  cur = el;
  while (cur && cur.nodeType === 1 && cur !== stop) { abs.unshift(nthSelector(cur)); cur = cur.parentElement; }
  return abs.join(' > ');
}

/* ---------- 3. Shadow-medveten stig ---------- */

/**
 * Returnerar en array av CSS-strängar, en per shadow-nivå.
 * ["my-widget", "#input"] betyder:
 *   document.querySelector("my-widget").shadowRoot.querySelector("#input")
 * En enda post = inga shadow-gränser.
 */
export function buildPath(el) {
  const steps = [];
  let node = el;
  for (let guard = 0; guard < 20; guard++) {
    const root = rootOf(node);
    steps.unshift(selectorWithinRoot(node, root));
    if (root.host) node = root.host; // klättra ut ur shadow root
    else break;
  }
  return steps;
}

export function resolvePath(steps, doc = document) {
  let ctx = doc;
  for (let i = 0; i < steps.length; i++) {
    let el;
    try { el = ctx.querySelector(steps[i]); } catch { return null; }
    if (!el) return null;
    if (i === steps.length - 1) return el;
    if (!el.shadowRoot) return null; // stängd shadow root eller fel element
    ctx = el.shadowRoot;
  }
  return null;
}

/* ---------- 4. Fingeravtryck + poängsatt återfinning ---------- */

export function fingerprint(el) {
  const attrs = {};
  for (const a of el.attributes) {
    if (isJunkAttrName(a.name)) continue;
    if (a.name === 'style') continue;
    if (a.name === 'class') continue;
    attrs[a.name] = a.value.slice(0, 120);
  }
  const r = el.getBoundingClientRect();
  return {
    tag: el.nodeName.toLowerCase(),
    attrs,
    classes: [...el.classList].filter((c) => !isJunkName(c)),
    editable: !!el.isContentEditable,
    textEntry: isTextEntry(el),
    text: (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') ? '' : (el.innerText || '').slice(0, 80),
    // Relativ position: tål fönsterstorlek bättre än px.
    rel: { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight },
    area: r.width * r.height,
  };
}

/** Skapa hela den lagringsbara ankarposten. */
export function createAnchor(el, kind) {
  return {
    kind,                       // 'input' | 'conversation' | 'send'
    v: 1,
    path: buildPath(el),
    fingerprint: fingerprint(el),
    frameUrl: location.href.split('#')[0],
    origin: location.origin,
    savedAt: Date.now(),
  };
}

/** Är elementet ett textinmatningsfält, oavsett tagg? */
function isTextEntry(el) {
  const t = el.nodeName.toLowerCase();
  if (t === 'textarea') return true;
  if (t === 'input') return /^(text|search|email|tel|url|)$/.test(el.getAttribute('type') || '');
  return el.isContentEditable || el.getAttribute('role') === 'textbox';
}

function scoreMatch(el, fp) {
  let s = 0;
  // Taggbyte är en STARK signal om fel element, men aldrig ett veto:
  // widgets uppgraderar textarea -> div[contenteditable] när de får rich text.
  if (el.nodeName.toLowerCase() !== fp.tag) {
    const bothText = fp.textEntry && isTextEntry(el);
    s -= bothText ? 5 : 25;
  }
  for (const [k, v] of Object.entries(fp.attrs)) {
    const got = el.getAttribute(k);
    if (got === v) s += (k === 'data-testid' || k === 'aria-label' || k === 'placeholder' || k === 'name') ? 40 : 10;
    else if (got != null) s += 2;
  }
  const cls = new Set(el.classList);
  for (const c of fp.classes) if (cls.has(c)) s += 8;
  if (!!el.isContentEditable === fp.editable) s += 5;

  // Geometri är BONUS, aldrig diskvalificerande: chattwidgeten är hopfälld vid
  // sidladdning, så rätt element har ofta 0x0 tills användaren öppnar den.
  const r = el.getBoundingClientRect();
  const area = r.width * r.height;
  if (area > 0 && fp.area > 0) {
    const dx = (r.left + r.width / 2) / innerWidth - fp.rel.x;
    const dy = (r.top + r.height / 2) / innerHeight - fp.rel.y;
    s += Math.max(0, 25 - Math.hypot(dx, dy) * 100);     // närhetsbonus
    s += (Math.min(area, fp.area) / Math.max(area, fp.area)) * 10;
  }
  return s;
}

/** Gå igenom document + alla ÖPPNA shadow roots. */
function* allElements(root = document) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  // currentNode startar PÅ roten, som kan vara document/ShadowRoot — inte ett Element.
  let n = walker.currentNode.nodeType === 1 ? walker.currentNode : walker.nextNode();
  while (n) {
    yield n;
    if (n.shadowRoot) yield* allElements(n.shadowRoot);
    n = walker.nextNode();
  }
}

const MIN_HEAL_SCORE = 45;

/**
 * Hitta elementet igen. Först stigen, sedan självläkning via fingeravtryck.
 * Returnerar {el, how} där how = 'path' | 'healed' | null.
 */
export function findAnchor(anchor) {
  // En stig som fortfarande löser ut är i sig starkt bevis — döm inte ut den
  // på taggbyte. Kräv bara att den inte är uppenbart fel sorts element.
  const direct = resolvePath(anchor.path, document);
  if (direct && (!anchor.fingerprint.textEntry || isTextEntry(direct))) {
    return { el: direct, how: 'path' };
  }
  let best = null, bestScore = MIN_HEAL_SCORE;
  for (const el of allElements()) {
    const s = scoreMatch(el, anchor.fingerprint);
    if (s > bestScore) { bestScore = s; best = el; }
  }
  return best ? { el: best, how: 'healed', score: bestScore } : { el: null, how: null };
}

/** Efter lyckad läkning: skriv om stigen så nästa gång går snabbt. */
export function rehealAnchor(anchor, el) {
  anchor.path = buildPath(el);
  anchor.fingerprint = fingerprint(el);
  anchor.savedAt = Date.now();
  return anchor;
}
