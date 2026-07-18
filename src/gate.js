// gate.js — enda beslutspunkten för om ett utgående meddelande (eller knappklick) får gå.
// REN funktion: caps, strikt alternering, närvaro och grindkedjan. DOM-revalideringen
// av input-ankaret sker separat i content-scriptet vid cc/typeAndSend (den kräver DOM).
//
// Returnerar ett diskriminerat resultat:
//   {type:'halt', reason}              — vägra fortsätta (sessionsnivå)
//   {type:'blocked', reason, spans, override, klass} — en innehållsgrind slog till
//   {type:'clean'}                     — ok att visa i REVIEW / skicka

import { scanOutgoing } from './guards/pii.js';
import { checkGrounding } from './guards/grounding.js';
import { classify } from './guards/classes.js';

export const DEFAULT_LIMITS = {
  maxMessages: 15,   // utrymme att verkligen kämpa sig igenom en trög bot
  maxCalls: 50,
  maxSessionMs: 20 * 60 * 1000,
  maxSpendUsd: 0.75, // grok-4.5 med reasoning är dyr ($2/M in, $6/M ut) — utrymme för en hel kamp
  minSendGapMs: 3000,
};

/**
 * @param {string} textOrLabel utkastet, eller knappetiketten om isReply
 * @param {object} ctx {
 *   counters:{sent,calls,startedAt,lastSentAt,spendUsd},
 *   limits, transcriptHash, hashAtLastSend, userTouched, now,
 *   facts, foreignTranscript, isReply
 * }
 */
export function evaluateSend(textOrLabel, ctx) {
  const L = ctx.limits || DEFAULT_LIMITS;
  const c = ctx.counters;
  const now = ctx.now;

  // 1. Runaway-tak (alla synliga i panelfoten).
  if (c.sent >= L.maxMessages) return halt('maxantal meddelanden nått');
  if (c.calls >= L.maxCalls) return halt('maxantal anrop nått');
  if (now - c.startedAt > L.maxSessionMs) return halt('tidsgräns nådd');
  if (c.spendUsd >= L.maxSpendUsd) return halt('kostnadstak nått');
  // OBS: minSendGapMs gäller vid SÄNDNING (approve), inte här — supporten kan svara
  // snabbt och vi ska ändå få föreslå ett svar; luckan pacear bara själva sändningen.

  // 2. Strikt alternering — runaway-dödaren. Inget skickas utan en inkommande ändring.
  if (ctx.transcriptHash === ctx.hashAtLastSend) return halt('inget nytt svar från motparten');

  // 3. Närvaro — vilken tangenttryckning/klick som helst i chatten avslutar sessionen.
  if (ctx.userTouched) return halt('du började själv i chatten');

  // 4. Innehållsgrindar.
  // Ett knappklick har ingen fritext att grunda/PII-scanna — men commitment/legal
  // gäller ändå (en "[Acceptera erbjudande]"-knapp är ett åtagande).
  if (!ctx.isReply) {
    const pii = scanOutgoing(textOrLabel);
    if (pii.block) return blocked(pii, 'pii');

    const g = checkGrounding(textOrLabel, ctx.facts, ctx.foreignTranscript);
    if (g.block) return blocked(g, 'grounding');
  }

  const klass = classify(textOrLabel);
  if (klass.commitment) return blocked({ reason: 'bindande åtagande', override: true }, 'commitment');
  if (klass.legal) return blocked({ reason: 'juridisk framställning', override: true }, 'legal');

  return { type: 'clean' };
}

function halt(reason) { return { type: 'halt', reason }; }
function blocked(v, klass) {
  return { type: 'blocked', reason: v.reason, spans: v.spans || [], override: !!v.override, hint: v.hint || '', klass };
}
