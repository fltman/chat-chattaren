// guards/classes.js — mjuka lexikon som tvingar HANDOFF. Dessa är ett NÄT, inte en vägg:
// de fångar de uppenbara formuleringarna men missar parafras ("det låter rimligt för mig").
// Det är hela skälet till att co-pilot är default i v1 — en människa läser före varje sändning.

// Åtaganden som binder användaren. Testas på BÅDE utkast och chip-etiketter
// (en "[Acceptera erbjudande]"-knapp är ett åtagande precis som en mening är det).
export const COMMITMENT_RE = /\b(jag (accepterar|godkänner|godkanner|går med på|gar med pa|samtycker|bekräftar|bekraftar)|ja tack|det går bra|det gar bra|det låter bra|det later bra|jag betalar|jag köper|jag koper|beställ|bestall|säg upp|sag upp|avsluta (mitt |)(abonnemang|konto|avtal)|avboka|jag tar det|jag accepterar erbjudandet|acceptera erbjudande|godkänn|godkann)\b/i;

// Juridiska markörer — en människa ska alltid stå bakom en juridisk framställning.
export const LEGAL_RE = /\b(arn|allmänna reklamationsnämnden|allmanna reklamationsnamnden|konsumentverket|konsumentombudsman|stämma|stamma|stämning|stamning|advokat|jurist|polisanmäl|polisanmal|kronofogd|bedrägeri|bedrageri|rättslig|rattslig|vite|skadestånd|skadestand)\b/i;

// Motparten ber om en bilaga — verktyget kan inte bifoga filer och får inte låtsas.
// Testas på MOTPARTENS senaste text (inkommande), inte på utkastet.
export const ATTACHMENT_REQ_RE = /\b(bifoga|bifogar|ladda upp|ladda ner|skicka (en |ett |)(bild|foto|kvitto|faktura|screenshot|skärmdump|skarmdump|fil|dokument|pdf)|attach|upload|send (a |an |)(photo|picture|image|receipt|screenshot|file))\b/i;

/**
 * Klassificera ett UTGÅENDE utkast/etikett. Returnerar vilken hård HANDOFF-klass det
 * träffar, om någon.
 * @returns {{commitment:boolean, legal:boolean}}
 */
export function classify(text) {
  return {
    commitment: COMMITMENT_RE.test(text),
    legal: LEGAL_RE.test(text),
  };
}

/** Ber motparten (senaste inkommande) om en bilaga? */
export function asksForAttachment(incomingText) {
  return ATTACHMENT_REQ_RE.test(incomingText || '');
}
