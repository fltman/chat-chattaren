import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<!doctype html><body><div id="app"></div></body>`, { pretendToBeVisual: true });
for (const k of ['window','document','Element','NodeFilter','CSS','location']) globalThis[k] = dom.window[k] ?? dom.window;
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.innerWidth = 1024; globalThis.innerHeight = 768;
const { createAnchor, findAnchor, rehealAnchor, buildPath } = await import('/Users/andersbj/Projekt/chat-chattaren/src/anchor.js');
const app = document.getElementById('app');

// Fall 4: INGA bra ankare alls — bara skräpklasser. Tvingar nth-fallback.
app.innerHTML = `<div class="css-a1b2c3"><div class="css-d4e5f6"></div>
  <div class="css-g7h8i9"><textarea class="css-j1k2l3"></textarea></div></div>`;
let ta = app.querySelector('textarea');
const a4 = createAnchor(ta, 'input');
console.log('4) path utan ankare:', JSON.stringify(a4.path));
console.log('   hittar direkt:', findAnchor(a4).how === 'path');

// Fall 5: DOM omstrukturerad — textarea flyttad, wrapper tillagd, hashar nya.
// Selektorn MÅSTE brytas här.
app.innerHTML = `<section class="css-newhash1"><div class="css-newhash2">
  <div class="css-newhash3"><div class="css-newhash4">
  <textarea class="css-newhash5" placeholder="Skriv ett meddelande"></textarea>
  </div></div></div></section>`;
const ta5 = app.querySelector('textarea');
const r5 = findAnchor(a4);
console.log('5) efter omstrukturering:', r5.how, '| rätt element:', r5.el === ta5, '| score:', r5.score);

// Fall 6: läkning med starkt ankare som flyttats djupt
const a6 = createAnchor(ta5, 'input');
console.log('6) path med placeholder:', JSON.stringify(a6.path));
app.innerHTML = `<div class="x"><div class="y"><div class="z">
  <textarea placeholder="Skriv ett meddelande"></textarea></div></div></div>`;
const ta6 = app.querySelector('textarea');
const r6 = findAnchor(a6);
console.log('   efter flytt:', r6.how, '| rätt element:', r6.el === ta6);

// Fall 7: två liknande textareas — får inte välja fel
app.innerHTML = `<textarea placeholder="Sök"></textarea>
  <textarea placeholder="Skriv ett meddelande"></textarea>`;
const r7 = findAnchor(a6);
console.log('7) tvetydig sida:', r7.how, '| valde rätt:', r7.el === app.querySelectorAll('textarea')[1]);
