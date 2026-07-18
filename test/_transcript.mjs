import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { forHash, hash, isTyping, makeEchoTracker, extractTranscript, harvestReplies } from '../src/transcript.js';

test('relativa tidsstämplar ändrar inte hashen', () => {
  const a = forHash('DEM: Hej!\nskickat 2 min sedan');
  const b = forHash('DEM: Hej!\nskickat 5 min sedan');
  assert.equal(hash(a), hash(b), '"2 min sedan" vs "5 min sedan" ska hasha lika');
});

test('klockslag och läskvitton ändrar inte hashen', () => {
  const a = forHash('DEM: Hej! 14:32 Läst');
  const b = forHash('DEM: Hej! 15:07 Levererat');
  assert.equal(hash(a), hash(b));
});

test('skrivindikator upptäcks', () => {
  assert.equal(isTyping('Anna skriver…'), true);
  assert.equal(isTyping('DEM: Hej, vad gäller det?'), false);
});

test('äkta nytt meddelande ändrar hashen', () => {
  const a = forHash('DEM: Hej!');
  const b = forHash('DEM: Hej!\nDEM: Vad gäller ditt ärende?');
  assert.notEqual(hash(a), hash(b));
});

test('echo-tracker klassar vårt eget eko som no-op', () => {
  const t = makeEchoTracker();
  const prev = forHash('DEM: Hej, vad gäller det?');
  t.remember('jag vill ha pengarna tillbaka');
  const curr = forHash('DEM: Hej, vad gäller det?\nDU: jag vill ha pengarna tillbaka');
  assert.equal(t.deltaIsOnlyOurs(prev, curr), true);
});

test('echo-tracker släpper igenom motpartens nya svar', () => {
  const t = makeEchoTracker();
  const prev = forHash('DEM: Hej');
  t.remember('jag vill ha pengarna tillbaka');
  const curr = forHash('DEM: Hej\nDU: jag vill ha pengarna tillbaka\nDEM: Vi behöver ordernummer');
  assert.equal(t.deltaIsOnlyOurs(prev, curr), false);
});

test('isRepeat vägrar upprepa senaste meddelandet', () => {
  const t = makeEchoTracker();
  t.remember('jag vill ha pengarna tillbaka för order 12345');
  assert.equal(t.isRepeat('jag vill ha pengarna tillbaka för order 12345'), true);
  assert.equal(t.isRepeat('kan ni bekräfta att återbetalningen är på väg?'), false);
});

test('extractTranscript tar bort composer-subträdet och etiketterar DU:/DEM:', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="conv" style="width:400px">
      <div class="msg them">Hej, vad gäller ditt ärende?</div>
      <div class="msg me">jag vill ha pengarna tillbaka</div>
      <div class="composer"><textarea id="inp">HEMLIGT UTKAST som inte ska läsas</textarea></div>
    </div></body>`);
  const doc = dom.window.document;
  // Geometri: jsdom ger 0-rects, så vi stubbar getBoundingClientRect per element.
  const conv = doc.getElementById('conv');
  const kids = [...conv.children];
  conv.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 300 });
  kids[0].getBoundingClientRect = () => ({ left: 10, width: 180, top: 0, height: 40 });   // vänster → DEM
  kids[1].getBoundingClientRect = () => ({ left: 210, width: 180, top: 40, height: 40 });  // höger → DU
  kids[2].getBoundingClientRect = () => ({ left: 0, width: 400, top: 80, height: 60 });
  global.window = dom.window; // extract läser inte window direkt, men var trygg

  const inp = doc.getElementById('inp');
  const { text } = extractTranscript(conv, inp);
  assert.ok(!text.includes('HEMLIGT UTKAST'), 'composer-text ska vara borttagen');
  assert.ok(text.includes('DEM: Hej, vad gäller ditt ärende?'), text);
  assert.ok(text.includes('DU: jag vill ha pengarna tillbaka'), text);
});

test('harvestReplies plockar snabbknappar men inte skicka-knappen', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="conv">
      <div class="msg">Vad gäller det?</div>
      <button id="b1">Retur/återbetalning</button>
      <button id="b2">Orderstatus</button>
      <div class="composer"><textarea id="inp"></textarea><button id="send">Skicka</button></div>
    </div></body>`);
  const doc = dom.window.document;
  for (const id of ['b1', 'b2', 'send']) doc.getElementById(id).getBoundingClientRect = () => ({ width: 120, height: 32 });
  const conv = doc.getElementById('conv');
  const replies = harvestReplies(conv, doc.getElementById('inp'), doc.getElementById('send'));
  const labels = replies.map((r) => r.label);
  assert.deepEqual(labels, ['Retur/återbetalning', 'Orderstatus']);
});
