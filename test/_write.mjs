import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { setText, typeAndSend } from '../src/write.js';

function withDom(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const w = dom.window;
  // Gör globala DOM-konstruktörer synliga för write.js (den körs i content-context).
  for (const k of ['InputEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'DataTransfer', 'ClipboardEvent', 'DataTransferItem']) {
    if (w[k]) globalThis[k] = w[k];
  }
  globalThis.PointerEvent = w.PointerEvent || w.MouseEvent;
  return w.document;
}

// Simulera Reacts value-tracking: en egen 'value'-descriptor på noden som SYNKAR
// trackern (precis som React), plus en input-lyssnare som bara fyrar onChange när
// trackern skiljer sig från live-värdet.
function makeReactControlled(el) {
  const proto = Object.getPrototypeOf(el);
  const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value').set;
  const nativeGet = Object.getOwnPropertyDescriptor(proto, 'value').get;
  let tracked = nativeGet.call(el);
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() { return nativeGet.call(this); },
    set(v) { nativeSet.call(this, v); tracked = String(v); }, // React synkar trackern här
  });
  el._valueTracker = { getValue: () => String(tracked), setValue: (v) => { tracked = String(v); } };
  const st = { onChange: 0 };
  el.addEventListener('input', () => {
    if (el._valueTracker.getValue() !== el.value) { st.onChange++; el._valueTracker.setValue(el.value); }
  });
  return st;
}

test('setText fyrar onChange på React-kontrollerad textarea (prototyp-setter kringgår trackern)', () => {
  const doc = withDom('<textarea id="t"></textarea>');
  const el = doc.getElementById('t');
  const st = makeReactControlled(el);
  const ok = setText(el, 'jag vill ha pengarna tillbaka');
  assert.equal(ok, true);
  assert.equal(el.value, 'jag vill ha pengarna tillbaka');
  assert.equal(st.onChange, 1, 'React onChange måste ha fyrat exakt en gång');
});

test('naiv el.value=x fyrar INTE onChange (reproducerar buggen fixen löser)', () => {
  const doc = withDom('<textarea id="t"></textarea>');
  const el = doc.getElementById('t');
  const st = makeReactControlled(el);
  el.value = 'x';
  el.dispatchEvent(new globalThis.InputEvent('input', { bubbles: true }));
  assert.equal(st.onChange, 0, 'React sväljer programmatisk .value-tilldelning');
});

test('setText på <input> kastar inte Illegal invocation (setter läses via getPrototypeOf)', () => {
  const doc = withDom('<input id="i" type="text">');
  const el = doc.getElementById('i');
  assert.doesNotThrow(() => setText(el, 'hej'));
  assert.equal(el.value, 'hej');
});

test('input-eventet bubblar (React 17+ lyssnar på rot-containern)', () => {
  const doc = withDom('<form id="f"><textarea id="t"></textarea></form>');
  const el = doc.getElementById('t');
  let bubbled = false;
  doc.getElementById('f').addEventListener('input', () => { bubbled = true; });
  setText(el, 'hej');
  assert.equal(bubbled, true);
});

test('typeAndSend klickar den markerade skicka-knappen', () => {
  const doc = withDom('<textarea id="t"></textarea><button id="s">Skicka</button>');
  const el = doc.getElementById('t');
  const btn = doc.getElementById('s');
  let clicked = 0; btn.addEventListener('click', () => clicked++);
  const res = typeAndSend(el, 'hej', btn);
  assert.equal(res.ok, true);
  assert.equal(res.how, 'button');
  assert.equal(clicked, 1);
});

test('typeAndSend vägrar skriva i disabled composer (knappdriven bot)', () => {
  const doc = withDom('<textarea id="t" disabled></textarea>');
  const res = typeAndSend(doc.getElementById('t'), 'hej', null);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'composer-disabled');
});

test('contenteditable-fallback landar text (jsdom saknar execCommand)', () => {
  const doc = withDom('<div id="c" contenteditable="true"></div>');
  const el = doc.getElementById('c');
  // jsdom: isContentEditable kan vara false utan layout — tvinga flaggan.
  Object.defineProperty(el, 'isContentEditable', { value: true, configurable: true });
  const ok = setText(el, 'hej där');
  assert.equal(ok, true);
  assert.ok((el.innerText || el.textContent || '').includes('hej där'));
});
