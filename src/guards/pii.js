// guards/pii.js — körs på det FÖRESLAGNA UTGÅENDE meddelandet, aldrig på utskriften.
// Hårda kodkontroller som överlever prompt injection: modellen kan luras att vilja
// skicka ett personnummer, men den här grinden bryr sig inte om varför.
//
// Ordningen är kritisk: personnummer FÖRE kort. Ett svenskt personnummer passerar
// Luhn-kontrollen, så en kort-först-koll skulle felklassa det som ett kortnummer.

function luhn(d) {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

// YYMMDD-XXXX / YYYYMMDD-XXXX / bara 10 siffror. Datumdelen valideras för att skära
// bort falska positiva (ett rent löpnummer som råkar Luhn-validera).
const PNR_RE = /(?<!\d)(?:19|20)?(\d{2})(\d{2})(\d{2})[-+\s]?(\d{4})(?!\d)/g;

function findPersonnummer(text) {
  const hits = []; let m; PNR_RE.lastIndex = 0;
  while ((m = PNR_RE.exec(text))) {
    const [, , mm, dd, last4] = m;
    if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) continue; // inte ett datum -> inte ett pnr
    if (luhn(m[1] + mm + dd + last4)) hits.push(m[0]);
  }
  return hits;
}

const CARD_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

function findCardNumber(text) {
  const hits = []; let m; CARD_RE.lastIndex = 0;
  while ((m = CARD_RE.exec(text))) {
    const d = m[0].replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) hits.push(m[0]);
  }
  return hits;
}

// Kontonummer/IBAN/clearing — grov form, blockeras hellre en gång för mycket.
const IBAN_RE = /\b[A-Z]{2}\d{2}[ ]?(?:\d[ ]?){10,30}\b/g;

// \w* i slutet fångar svenska böjningar: lösenord -> lösenordet, engångskod -> engångskoden.
const CREDENTIAL_RE = /\b(bankid|mobilt\s*bankid|lösenord|losenord|engångskod|engangskod|verifieringskod|verification code|cvv|cvc|säkerhetskod|sakerhetskod|pinkod|pin[- ]?kod)\w*/i;

const AI_DENIAL_RE = /\b(jag är (en |)(människa|manniska|riktig person|verklig person)|jag är (inte|ingen) (en |)(bot|ai|robot|maskin|dator)|nej,? (jag är|det är) (inte|ingen) (en |)(bot|ai|robot)|i('| a)?m (a |)(human|real person|not a bot|not an ai))\b/i;

/**
 * @param {string} msg det föreslagna utgående meddelandet
 * @returns {{block:boolean, reason?:string, spans?:string[], override?:boolean}}
 * override:false => "Skicka ändå" renderas aldrig. Ingen inställning återaktiverar.
 */
export function scanOutgoing(msg) {
  const pnr = findPersonnummer(msg);
  if (pnr.length) return { block: true, reason: 'personnummer', spans: pnr, override: false };

  const card = findCardNumber(msg);
  if (card.length) return { block: true, reason: 'kortnummer', spans: card, override: false };

  const iban = msg.match(IBAN_RE);
  if (iban) return { block: true, reason: 'kontonummer', spans: [iban[0]], override: false };

  const cred = msg.match(CREDENTIAL_RE);
  if (cred) return { block: true, reason: 'inloggningsuppgift', spans: [cred[0]], override: false };

  const deny = msg.match(AI_DENIAL_RE);
  if (deny) return { block: true, reason: 'förnekar att vara AI', spans: [deny[0]], override: false };

  return { block: false };
}
