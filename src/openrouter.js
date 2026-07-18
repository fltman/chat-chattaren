// openrouter.js — LLM-anropet. Körs på PANELSIDAN (inte service workern): ett LLM-svar
// >30 s dödar en service worker och sendResponse fyrar aldrig tyst. Panelen är lika
// origin-isolerad från sidan — nyckeln är exakt lika skyddad, utan 30s-fällan.

import { DECISION_SCHEMA, buildSystemPrompt, buildUserContent } from './prompt.js';

const MODEL = 'x-ai/grok-4.5';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export class TerminalApiError extends Error {}  // 401/402/403 → stoppa loopen, retry aldrig
export class TransientApiError extends Error {}  // 429/502/503 → backoff

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n | 0));

/**
 * @param {{apiKey:string, goal:string, facts:string, transcript:string, replies:Array, persona:string}} p
 * @returns {Promise<{observation,action,message,click_index,wait_ms,reason,cost,reasoningTokens}>}
 */
export async function decide({ apiKey, goal, facts, transcript, replies, persona }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Chat-chattaren',
      // HTTP-Referer utelämnas med flit: chrome-extension://<id> är meningslöst för attribution.
    },
    body: JSON.stringify({
      model: MODEL,
      // STABIL PREFIX FÖRST (system+mål+fakta) för implicit cache; muterande transkript SIST.
      messages: [
        { role: 'system', content: buildSystemPrompt(goal, facts, persona) },
        { role: 'user', content: buildUserContent(transcript, replies) },
      ],
      response_format: { type: 'json_schema', json_schema: DECISION_SCHEMA },
      temperature: 0.4,
      // reasoning PÅ (Grok 4.5 default) — låt den tänka igenom sina grepp mot tröga bottar.
      // Inget max_tokens: reasoning + svar ska få plats utan att kapas.
    }),
  });

  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch { /* tom */ }
    const msg = body?.error?.message || res.statusText;
    if ([401, 402, 403].includes(res.status)) throw new TerminalApiError(`${res.status}: ${msg}`);
    const retryAfter = Number(res.headers.get('Retry-After')) || null;
    throw Object.assign(new TransientApiError(`${res.status}: ${msg}`), { retryAfter });
  }

  const data = await res.json();
  let d;
  try { d = JSON.parse(data.choices[0].message.content); }
  catch { throw new TransientApiError('kunde inte tolka modellens svar'); }

  const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

  // Kostnadstaket måste läsas ur API:ts rapporterade usage. Saknas fältet: fail closed
  // (rapportera en icke-noll kostnad så taket inte kringgås av ett saknat fält).
  const cost = typeof data.usage?.cost === 'number' ? data.usage.cost : NaN;

  return {
    observation: String(d.observation || ''),
    action: d.action,
    message: String(d.message || ''),
    click_index: clamp(d.click_index || 0, 0, 999),
    wait_ms: clamp(d.wait_ms || 0, 1000, 15000),
    reason: String(d.reason || ''),
    cost,
    reasoningTokens,
  };
}
