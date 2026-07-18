import { test } from 'node:test';
import assert from 'node:assert';
import { createMachine } from '../src/machine.js';
import { DEFAULT_LIMITS } from '../src/gate.js';

// Bygg en maskin med mockade deps och en styrbar klocka + skriptbara decide-svar.
function harness(decisions) {
  const views = [];
  const sent = [];
  let t = 100000;
  let i = 0;
  let extractCalls = 0;
  const m = createMachine({
    now: () => t,
    decide: async () => {
      const d = decisions[Math.min(i++, decisions.length - 1)];
      return { observation: 'obs', message: '', click_index: 0, wait_ms: 0, reason: 'r', cost: 0.001, ...d };
    },
    sendToFrame: async (msg) => { sent.push(msg); return { ok: true, how: 'button', cleared: true }; },
    requestExtract: () => { extractCalls++; },
    render: (v) => views.push(v),
  });
  return {
    m, views, sent,
    tick: (ms) => { t += ms; },
    last: () => views[views.length - 1],
    get extractCalls() { return extractCalls; },
  };
}

test('lyckad tur: fråga → förslag → godkänn → skickat', async () => {
  const h = harness([{ action: 'send', message: 'jag vill ha pengarna tillbaka för order 12345' }]);
  h.m.start({ goal: 'pengarna tillbaka', facts: 'Order 12345.', apiKey: 'k', tabId: 1, frameId: 2 });
  assert.equal(h.last().phase, 'RUNNING');

  await h.m.onSettled({ text: 'DEM: Vad gäller det?', foreign: 'DEM: Vad gäller det?', replies: [], hash: 11 });
  assert.equal(h.last().phase, 'REVIEW');
  assert.equal(h.last().proposal.text, 'jag vill ha pengarna tillbaka för order 12345');
  assert.equal(h.last().proposal.verdict.type, 'clean');

  h.tick(4000);
  await h.m.approve();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].t, 'cc/typeAndSend');
  assert.equal(h.m.session.counters.sent, 1);
  assert.equal(h.last().phase, 'RUNNING');
});

test('vårt eget eko (samma hash som vid sändning) utlöser inget nytt anrop', async () => {
  const h = harness([{ action: 'send', message: 'hej det gäller order 12345' }]);
  h.m.start({ goal: 'g', facts: 'Order 12345.', apiKey: 'k', tabId: 1, frameId: 2 });
  await h.m.onSettled({ text: 'DEM: hej?', foreign: 'DEM: hej?', replies: [], hash: 11 });
  h.tick(4000); await h.m.approve();
  const callsBefore = h.m.session.counters.calls;
  // Samma hash som vid sändning → inget nytt från motparten.
  await h.m.onSettled({ text: 'DEM: hej?', foreign: 'DEM: hej?', replies: [], hash: 11 });
  assert.equal(h.m.session.counters.calls, callsBefore, 'inget nytt decide-anrop på eget eko');
  assert.equal(h.last().phase, 'RUNNING');
});

test('PII i förslaget blockeras hårt (ingen skicka-knapp)', async () => {
  const h = harness([{ action: 'send', message: 'mitt personnummer är 850709-9805' }]);
  h.m.start({ goal: 'g', facts: '', apiKey: 'k', tabId: 1, frameId: 2 });
  await h.m.onSettled({ text: 'DEM: vi behöver id', foreign: 'DEM: vi behöver id', replies: [], hash: 11 });
  assert.equal(h.last().phase, 'BLOCKED');
  assert.equal(h.last().proposal.verdict.klass, 'pii');
  assert.equal(h.last().proposal.verdict.override, false);
});

test('bilaga-begäran från motparten → HANDOFF', async () => {
  const h = harness([{ action: 'send', message: 'okej' }]);
  h.m.start({ goal: 'g', facts: '', apiKey: 'k', tabId: 1, frameId: 2 });
  await h.m.onSettled({ text: 'DEM: skicka en bild på varan', foreign: 'DEM: skicka en bild på varan', replies: [], hash: 11 });
  assert.equal(h.last().phase, 'HANDOFF');
  assert.match(h.last().note, /bild|bilaga/);
});

test('done avslutar sessionen', async () => {
  const h = harness([{ action: 'done', reason: 'återbetalning bekräftad' }]);
  h.m.start({ goal: 'g', facts: '', apiKey: 'k', tabId: 1, frameId: 2 });
  await h.m.onSettled({ text: 'DEM: pengarna är på väg', foreign: 'DEM: pengarna är på väg', replies: [], hash: 11 });
  assert.equal(h.last().phase, 'DONE');
});

test('meddelandetak → HANDOFF vid taket', async () => {
  const cap = DEFAULT_LIMITS.maxMessages;
  const decisions = Array.from({ length: cap + 2 }, (_, i) => ({ action: 'send', message: `försök nummer ${i}` }));
  const h = harness(decisions);
  h.m.start({ goal: 'g', facts: '', apiKey: 'k', tabId: 1, frameId: 2 });
  let hash = 10;
  for (let n = 0; n < cap; n++) {
    hash += 1;
    h.tick(4000); // låt luckan mellan sändningar passera före nästa tur
    await h.m.onSettled({ text: `DEM: svar ${n}`, foreign: `DEM: svar ${n}`, replies: [], hash });
    if (h.last().phase === 'REVIEW') { await h.m.approve(); }
    else break;
  }
  assert.equal(h.m.session.counters.sent, cap);
  hash += 1;
  await h.m.onSettled({ text: 'DEM: en till', foreign: 'DEM: en till', replies: [], hash });
  assert.equal(h.last().phase, 'HANDOFF', 'vid taket ska den lämna över');
});

const flush = () => new Promise((r) => setTimeout(r, 15));

test('autoläge: rent meddelande skickas utan REVIEW', async () => {
  const h = harness([{ action: 'send', message: 'jag vill ha pengarna tillbaka för order 12345' }]);
  h.m.start({ goal: 'g', facts: 'Order 12345.', apiKey: 'k', tabId: 1, frameId: 2, mode: 'auto' });
  await h.m.onSettled({ text: 'DEM: Vad gäller det?', foreign: 'DEM: Vad gäller det?', replies: [], hash: 11 });
  await flush();
  assert.equal(h.sent.length, 1, 'skulle ha auto-skickat');
  assert.equal(h.sent[0].t, 'cc/typeAndSend');
  assert.equal(h.last().phase, 'RUNNING');
  assert.match(h.last().note, /Skickade/);
});

test('autoläge: PII stoppar ändå (ingen auto-sändning)', async () => {
  const h = harness([{ action: 'send', message: 'mitt personnummer är 850709-9805' }]);
  h.m.start({ goal: 'g', facts: '', apiKey: 'k', tabId: 1, frameId: 2, mode: 'auto' });
  await h.m.onSettled({ text: 'DEM: id tack', foreign: 'DEM: id tack', replies: [], hash: 11 });
  await flush();
  assert.equal(h.sent.length, 0, 'PII får aldrig auto-skickas');
  assert.equal(h.last().phase, 'BLOCKED');
});

test('autoläge: uppdiktad uppgift stoppar för människan (REVIEW, ej auto)', async () => {
  const h = harness([{ action: 'send', message: 'det gäller order 99999' }]);
  h.m.start({ goal: 'g', facts: 'Order 12345.', apiKey: 'k', tabId: 1, frameId: 2, mode: 'auto' });
  await h.m.onSettled({ text: 'DEM: ordernr?', foreign: 'DEM: ordernr?', replies: [], hash: 11 });
  await flush();
  assert.equal(h.sent.length, 0, 'ogrundad uppgift får aldrig auto-skickas');
  assert.equal(h.last().phase, 'REVIEW');
});

test('autoläge: bindande åtagande stoppar för människan', async () => {
  const h = harness([{ action: 'send', message: 'ja tack, jag accepterar erbjudandet' }]);
  h.m.start({ goal: 'g', facts: '', apiKey: 'k', tabId: 1, frameId: 2, mode: 'auto' });
  await h.m.onSettled({ text: 'DEM: 50% kompensation ok?', foreign: 'DEM: 50% kompensation ok?', replies: [], hash: 11 });
  await flush();
  assert.equal(h.sent.length, 0, 'åtagande får aldrig auto-skickas');
  assert.equal(h.last().phase, 'REVIEW');
});

test('resume: efter ett mjukt stopp går den tillbaka till RUNNING och läser om', async () => {
  const h = harness([{ action: 'send', message: 'hej' }]);
  h.m.start({ goal: 'g', facts: '', apiKey: 'k', tabId: 1, frameId: 2 });
  h.m.userTouched('keydown'); // → STOPPED
  assert.equal(h.last().phase, 'STOPPED');
  const before = h.extractCalls;
  h.m.resume();
  assert.equal(h.last().phase, 'RUNNING');
  assert.equal(h.extractCalls, before + 1, 'resume ska läsa om (requestExtract)');
});

test('klickförslag på snabbknapp → REVIEW som chip', async () => {
  const h = harness([{ action: 'click', click_index: 0 }]);
  h.m.start({ goal: 'g', facts: '', apiKey: 'k', tabId: 1, frameId: 2 });
  await h.m.onSettled({ text: 'DEM: välj', foreign: 'DEM: välj', replies: [{ label: 'Retur/återbetalning', idx: 0 }], hash: 11 });
  assert.equal(h.last().phase, 'REVIEW');
  assert.equal(h.last().proposal.kind, 'click');
  assert.equal(h.last().proposal.label, 'Retur/återbetalning');
  h.tick(4000); await h.m.approve();
  assert.equal(h.sent[0].t, 'cc/clickReply');
});
