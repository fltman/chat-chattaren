// sw.js — service workern äger INGENTING. Ingen state, ingen fetch, ingen routing.
// Öppnar panelen på ikonklick och städar registrerade content scripts när en
// behörighet dras tillbaka. Dör den mitt i en session händer ingenting — panelen
// äger loopen och content-scriptet äger DOM:en.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Ny versionstoken vid varje (om)laddning → cs-loader cache-bustar content.js så
  // färsk kod laddas in på redan öppna sidor, utan att man måste ladda om fliken.
  chrome.storage.local.set({ ccVer: String(Date.now()) }).catch(() => {});
});

// När användaren återkallar host-behörighet: avregistrera content scripts vars
// matchmönster inte längre är beviljade, så inga föräldralösa registreringar blir kvar.
chrome.permissions.onRemoved.addListener(async () => {
  try {
    const regs = await chrome.scripting.getRegisteredContentScripts();
    const stale = [];
    for (const reg of regs) {
      const origins = reg.matches || [];
      const has = await chrome.permissions.contains({ origins });
      if (!has) stale.push(reg.id);
    }
    if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  } catch { /* inget att göra */ }
});
