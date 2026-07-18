// guards/grounding.js — den strukturella fixen mot uppdiktade ordernummer/datum/belopp.
// Varje siffergrupp ≥3, datum, belopp och mejladress i utkastet MÅSTE finnas antingen
// i faktarutan (som användaren skrev) eller i text som MOTPARTEN skrev. Allt annat är
// en ny siffra = hallucination = blockera.
//
// Tokeniserad mängd + numerisk normalisering, INTE substring-jämförelse: substring
// gav både falska negativa ("456" matchade inuti "0701234567") och falska positiva
// mot formatering. Här jämförs hela normaliserade tokens.

// Normalisera en token till jämförbar form: bort med separatorer inuti siffergrupper,
// gemener. "1 500" -> "1500", "12-345" -> "12345", "2026-01-05" -> "20260105".
const normToken = (s) => s.replace(/[\s\-–—.,/:]/g, '').toLowerCase();

// Bygg mängden av tillåtna tokens ur en text: alla siffergrupper ≥3, datum, belopp, mejl.
const CLAIM_RES = [
  /(?<!\d)\d[\d\s.\-–—/]{1,}\d(?!\d)/g,                  // siffergrupper (ev. med separatorer)
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g,                        // mejladresser
];

function tokensOf(text) {
  const set = new Set();
  for (const re of CLAIM_RES) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text))) {
      const t = normToken(m[0]);
      if (t.length >= 3) set.add(t);
    }
  }
  return set;
}

// Det modellen kan hitta på och som ett företag kan agera på.
const DRAFT_CLAIM_RES = [
  /(?<!\d)\d[\d\s.\-–—/]{1,}\d(?!\d)/g,                  // siffergrupp ≥3 (order/faktura/kundnr/belopp/datum)
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g,                        // mejl
];

/**
 * @param {string} draft utkastet
 * @param {string} factsSheet användarens faktaruta (rå text)
 * @param {string} foreignTranscript ENBART motpartens (DEM:) text — aldrig agentens egna
 *   tidigare meddelanden, annars kan en hallucination bootstrappa nästa.
 * @returns {{block:boolean, reason?:string, spans?:string[], override?:boolean, hint?:string}}
 */
export function checkGrounding(draft, factsSheet, foreignTranscript) {
  const allowed = new Set([...tokensOf(factsSheet || ''), ...tokensOf(foreignTranscript || '')]);
  const ungrounded = [];

  for (const re of DRAFT_CLAIM_RES) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(draft))) {
      const raw = m[0].trim();
      const token = normToken(raw);
      if (token.length < 3) continue;              // 1–2 siffror ("2 veckor", "3 gånger") släpps
      if (!allowed.has(token)) ungrounded.push(raw);
    }
  }

  if (ungrounded.length) {
    return {
      block: true,
      reason: 'ogrundad uppgift',
      spans: [...new Set(ungrounded)],
      override: true, // människan FÅR godkänna — kan vara en uppgift hen vet men inte skrev
      hint: 'Lägg till uppgiften i faktarutan om den stämmer.',
    };
  }
  return { block: false };
}

/**
 * Källtagga siffror/mejl i ett utkast så REVIEW kan visa proveniens per token.
 * @returns {Array<{token:string, source:'faktaruta'|'deras svar'|'okänd'}>}
 */
export function groundTokens(draft, factsSheet, foreignTranscript) {
  const facts = tokensOf(factsSheet || '');
  const theirs = tokensOf(foreignTranscript || '');
  const out = [];
  for (const re of DRAFT_CLAIM_RES) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(draft))) {
      const raw = m[0].trim();
      const t = normToken(raw);
      if (t.length < 3) continue;
      const source = facts.has(t) ? 'faktaruta' : theirs.has(t) ? 'deras svar' : 'okänd';
      out.push({ token: raw, source });
    }
  }
  return out;
}
