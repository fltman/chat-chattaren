import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<!doctype html><body>
  <div class="css-1x2y3z"><div class="sc-bdVaJa">
    <div class="css-9a8b7c" id=":r3:">
      <textarea class="css-4f5g6h" placeholder="Skriv ett meddelande" id=":r4:"></textarea>
    </div>
  </div></div>
  <div id="widget-host"></div>
</body>`, { pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element; globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.innerWidth = 1024; globalThis.innerHeight = 768;
globalThis.CSS = dom.window.CSS; globalThis.location = dom.window.location;

// Bygg en shadow root med input inuti
const host = document.getElementById('widget-host');
const sr = host.attachShadow({ mode: 'open' });
sr.innerHTML = `<div class="wrap"><input class="css-zzz111" type="text" aria-label="Meddelande"></div>`;

const { buildPath, resolvePath, createAnchor, findAnchor } = await import('/Users/andersbj/Projekt/chat-chattaren/src/anchor.js');

// Fall 1: vanlig textarea begravd i emotion-skräp
const ta = document.querySelector('textarea');
const p1 = buildPath(ta);
console.log('1) path:', JSON.stringify(p1));
console.log('   löser till samma element:', resolvePath(p1) === ta);

// Fall 2: element i öppen shadow root
const inp = sr.querySelector('input');
const p2 = buildPath(inp);
console.log('2) shadow path:', JSON.stringify(p2));
console.log('   löser till samma element:', resolvePath(p2) === inp);

// Fall 3: re-render — alla emotion-klasser byter hash, id:n regenereras
const anchor = createAnchor(ta, 'input');
document.querySelectorAll('[class*="css-"],[class*="sc-"]').forEach(el => {
  el.className = el.className.replace(/(css|sc)-\w+/g, (m,p)=> p+'-'+Math.random().toString(36).slice(2,8));
});
document.querySelectorAll('[id^=":r"]').forEach(el => el.id = ':r'+Math.floor(Math.random()*99)+':');
const found = findAnchor(anchor);
console.log('3) efter re-render med nya hashar:', found.how, '| rätt element:', found.el === ta);
