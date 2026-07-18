// cs-loader.js — KLASSISK (icke-modul) laddare. Injiceras via executeScript vid pick
// och via registerContentScripts för beviljade domäner. MV3-content scripts kan inte
// vara type:module, men de kan dynamiskt import()a en modul — så vi laddar den riktiga
// ESM-roten (content.js).
//
// Cache-bust med ccVer (sätts av service workern vid varje omladdning av tillägget):
// utan den ligger content.js kvar i sidans modul-cache under samma URL, så gammal kod
// spökar tills fliken laddas om. Med ?v=<token> laddas färsk kod in efter en reload.
// Inom samma tilläggs-laddning är token stabil → modul-cachen ser till att content.js
// körs bara en gång per sida även om laddaren injiceras flera gånger.
(() => {
  try {
    chrome.storage.local.get('ccVer', ({ ccVer }) => {
      const url = chrome.runtime.getURL('src/content.js') + '?v=' + (ccVer || '0');
      import(url).catch((e) => console.error('[chat-chattaren] kunde inte ladda content.js:', e));
    });
  } catch (e) {
    // Kontext ogiltig (gammalt injicerat script efter en reload) — strunta i det.
  }
})();
