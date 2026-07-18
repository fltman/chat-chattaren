// boot-guard.js — klassiskt (icke-modul) script som laddas FÖRE panel.js.
// Extension-sidor blockerar inline-script (CSP), så felfångaren måste ligga i egen fil.
// Fångar modul-laddningsfel och körningsfel och visar dem synligt i panelen, så vi inte
// står med en tyst blank panel.
window.__ccErrors = [];
function ccShowError(text) {
  window.__ccErrors.push(text);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#ff5c6c;background:#1c1f26;padding:14px;margin:12px;border:1px solid #3a1d22;border-radius:8px;white-space:pre-wrap;word-break:break-word;font:12px ui-monospace,monospace;';
  pre.textContent = 'Fel vid start:\n' + text;
  (document.body || document.documentElement).appendChild(pre);
}
window.addEventListener('error', (e) => {
  const where = e.filename ? ` @ ${e.filename.split('/').pop()}:${e.lineno || '?'}` : '';
  ccShowError((e.message || 'okänt fel') + where);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  ccShowError('Promise: ' + (r && (r.stack || r.message) || String(r)));
});
