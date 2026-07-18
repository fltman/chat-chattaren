import { test } from 'node:test';
import assert from 'node:assert';
import { evaluateSend, DEFAULT_LIMITS } from '../src/gate.js';

const base = () => ({
  counters: { sent: 0, calls: 1, startedAt: 1000, lastSentAt: 0, spendUsd: 0 },
  limits: DEFAULT_LIMITS,
  transcriptHash: 111,
  hashAtLastSend: null,
  userTouched: false,
  now: 1000 + 5000,
  facts: 'Ordernummer: 12345.',
  foreignTranscript: 'DEM: Vad gäller det?',
  isReply: false,
});

test('rent meddelande passerar grinden', () => {
  const r = evaluateSend('jag vill ha pengarna tillbaka för order 12345', base());
  assert.equal(r.type, 'clean');
});

test('strikt alternering: två sändningar utan hashändring är omöjligt', () => {
  const ctx = base();
  ctx.hashAtLastSend = 111; // samma som transcriptHash → inget nytt svar
  const r = evaluateSend('hej igen', ctx);
  assert.equal(r.type, 'halt');
  assert.match(r.reason, /inget nytt svar/);
});

test('meddelandetak stoppar', () => {
  const ctx = base();
  ctx.counters.sent = DEFAULT_LIMITS.maxMessages;
  assert.equal(evaluateSend('hej', ctx).type, 'halt');
});

test('kostnadstak stoppar', () => {
  const ctx = base();
  ctx.counters.spendUsd = DEFAULT_LIMITS.maxSpendUsd;
  assert.equal(evaluateSend('hej', ctx).type, 'halt');
});

test('användarnärvaro avbryter', () => {
  const ctx = base();
  ctx.userTouched = true;
  assert.equal(evaluateSend('hej', ctx).type, 'halt');
});

test('personnummer i utkast blockeras ovridbart', () => {
  const r = evaluateSend('mitt personnummer är 850709-9805', base());
  assert.equal(r.type, 'blocked');
  assert.equal(r.klass, 'pii');
  assert.equal(r.override, false);
});

test('ogrundat ordernummer blockeras men kan overridas', () => {
  const r = evaluateSend('det gäller order 99999', base());
  assert.equal(r.type, 'blocked');
  assert.equal(r.klass, 'grounding');
  assert.equal(r.override, true);
});

test('åtagande tvingar granskning (blocked, override)', () => {
  const r = evaluateSend('ja tack, jag accepterar erbjudandet', base());
  assert.equal(r.type, 'blocked');
  assert.equal(r.klass, 'commitment');
});

test('knappklick hoppar över PII/grundning men kör commitment på etiketten', () => {
  const ctx = base();
  ctx.isReply = true;
  assert.equal(evaluateSend('Orderstatus', ctx).type, 'clean');
  assert.equal(evaluateSend('Acceptera erbjudande', ctx).klass, 'commitment');
});
