import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<!doctype html><body><div id="app"></div></body>`, { pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element; globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.CSS = dom.window.CSS; globalThis.location = dom.window.location;
globalThis.innerWidth = 1024; globalThis.innerHeight = 768;
const { createAnchor, findAnchor, rehealAnchor } = await import('/Users/andersbj/Projekt/chat-chattaren/src/anchor.js');
const app = document.getElementById('app');

// Vecka 1: widget med data-testid
app.innerHTML = `<div class="composer"><textarea data-testid="chat-composer-input"
  placeholder="Skriv ett meddelande" aria-label="Meddelandefält"></textarea>
  <button data-testid="chat-send">Skicka</button></div>`;
const anchor = createAnchor(app.querySelector('textarea'), 'input');
console.log('path vecka 1:', JSON.stringify(anchor.path));

// Vecka 2: leverantören döpte om testid OCH bytte placeholder-text.
// Selektorn är nu helt död. Bara aria-label + tag + form kvar.
app.innerHTML = `<div class="composer-v2">
  <textarea data-testid="composer-input-v2" placeholder="Ditt meddelande…"
    aria-label="Meddelandefält"></textarea>
  <button data-testid="send-v2">Skicka</button></div>`;
const ta2 = app.querySelector('textarea');
const r = findAnchor(anchor);
console.log('8) testid+placeholder ändrade:', r.how, '| rätt:', r.el === ta2, '| score:', r.score?.toFixed(1));

if (r.how === 'healed') {
  rehealAnchor(anchor, r.el);
  console.log('   omskriven path:', JSON.stringify(anchor.path));
  console.log('   direkt träff nästa gång:', findAnchor(anchor).how === 'path');
}

// Fall 9: ALLT ändrat — inget att läka på. Ska ge upp, inte gissa fel element.
app.innerHTML = `<div><input type="search" placeholder="Sök i hjälpcenter"></div>`;
const r9 = findAnchor(anchor);
console.log('9) inget matchande element:', r9.how, '| el:', r9.el);
