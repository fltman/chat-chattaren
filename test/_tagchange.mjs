import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<!doctype html><body><div id="app"></div></body>`, { pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element; globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.CSS = dom.window.CSS; globalThis.location = dom.window.location;
globalThis.innerWidth = 1024; globalThis.innerHeight = 768;
const { createAnchor, findAnchor } = await import('/Users/andersbj/Projekt/chat-chattaren/src/anchor.js');
const app = document.getElementById('app');

// Widgeten uppgraderas: textarea -> contenteditable div (rich text). Vanligt!
app.innerHTML = `<textarea data-testid="composer" aria-label="Meddelande"></textarea>`;
const a = createAnchor(app.querySelector('textarea'), 'input');
app.innerHTML = `<div contenteditable="true" role="textbox" data-testid="composer" aria-label="Meddelande"></div>`;
const r = findAnchor(a);
console.log('10) textarea -> contenteditable div:', r.how, '| rätt:', r.el === app.querySelector('div'));
