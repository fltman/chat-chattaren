import { test } from 'node:test';
import assert from 'node:assert';
import { scanOutgoing } from '../src/guards/pii.js';

test('personnummer fångas — alla format', () => {
  for (const s of ['850709-9805', '19850709-9805', '8507099805', 'mitt personnummer är 850709-9805 tack']) {
    const v = scanOutgoing(s);
    assert.equal(v.block, true, `borde blockera: ${s}`);
    assert.equal(v.reason, 'personnummer');
    assert.equal(v.override, false, 'personnummer får aldrig overridas');
  }
});

test('ordernummer (icke-Luhn/icke-datum) släpps igenom', () => {
  for (const s of ['ordernummer 12345678', 'ordernr 123456789012345', 'gäller order 100200300']) {
    const v = scanOutgoing(s);
    assert.equal(v.block, false, `borde släppa: ${s} (fick reason=${v.reason})`);
  }
});

test('kortnummer fångas via Luhn', () => {
  // 4111 1111 1111 1111 är ett känt Luhn-giltigt testkortnummer.
  const v = scanOutgoing('kortet är 4111 1111 1111 1111');
  assert.equal(v.block, true);
  assert.equal(v.reason, 'kortnummer');
  assert.equal(v.override, false);
});

test('personnummer FÖRE kort — pnr klassas som pnr, inte kort', () => {
  const v = scanOutgoing('850709-9805');
  assert.equal(v.reason, 'personnummer');
});

test('credential-lexikon blockeras', () => {
  for (const s of ['min bankid', 'lösenordet är hunter2', 'engångskod 5566', 'cvv 123']) {
    assert.equal(scanOutgoing(s).block, true, `borde blockera: ${s}`);
  }
});

test('AI-förnekelse blockeras och kan ej overridas', () => {
  for (const s of ['nej jag är ingen bot', 'jag är en människa', "no i'm a real person"]) {
    const v = scanOutgoing(s);
    assert.equal(v.block, true, `borde blockera: ${s}`);
    assert.equal(v.override, false);
  }
});

test('vanligt meddelande släpps', () => {
  assert.equal(scanOutgoing('hej, jag vill ha pengarna tillbaka för min trasiga vara').block, false);
});
