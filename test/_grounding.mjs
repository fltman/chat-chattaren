import { test } from 'node:test';
import assert from 'node:assert';
import { checkGrounding, groundTokens } from '../src/guards/grounding.js';

const FACTS = 'Ordernummer: 12345. Produkten kom trasig. Betalade 1 500 kr.';

test('uppdiktat ordernummer blockeras', () => {
  const v = checkGrounding('det gäller order 99999', FACTS, '');
  assert.equal(v.block, true);
  assert.equal(v.reason, 'ogrundad uppgift');
  assert.ok(v.spans.some((s) => s.includes('99999')));
  assert.equal(v.override, true, 'grundning är overridebar (kan vara en känd men oskriven uppgift)');
});

test('grundat ordernummer från faktarutan släpps', () => {
  const v = checkGrounding('det gäller order 12345', FACTS, '');
  assert.equal(v.block, false);
});

test('beloppsnormalisering: "1 500 kr" i fakta grundar "1500 kr" i utkast', () => {
  const v = checkGrounding('jag betalade 1500 kr', FACTS, '');
  assert.equal(v.block, false, 'separatorer i siffergrupper ska normaliseras bort');
});

test('motpartens siffra grundar och taggas "deras svar"', () => {
  const theirs = 'Vi ser order 99999 kopplad till ditt konto.';
  const v = checkGrounding('ja, order 99999 stämmer', FACTS, theirs);
  assert.equal(v.block, false);
  const tags = groundTokens('order 99999 och 12345', FACTS, theirs);
  const t99 = tags.find((t) => t.token.includes('99999'));
  const t12 = tags.find((t) => t.token.includes('12345'));
  assert.equal(t99.source, 'deras svar');
  assert.equal(t12.source, 'faktaruta');
});

test('små tal (1-2 siffror) släpps utan grundning', () => {
  const v = checkGrounding('jag har väntat i 3 veckor nu', FACTS, '');
  assert.equal(v.block, false);
});

test('uppdiktad mejladress blockeras', () => {
  const v = checkGrounding('maila mig på fake@bluff.se', FACTS, '');
  assert.equal(v.block, true);
});
