// write.js — skriv in text i motpartens chattfält och skicka. Måste funka på
// React/Vue/Svelte-kontrollerade inputs OCH på contenteditable rich-text.
// Läser alltid tillbaka och verifierar före nästa steg.

// Native setter läst via elementets EGEN prototyp (aldrig hårdkodad
// HTMLInputElement.prototype — det kastar Illegal invocation på <textarea>).
// Kringgår Reacts egen value-descriptor så _valueTracker-cachen blir inaktuell och
// onChange fyrar. Funkar oförändrat på Vue/Svelte/vanilla.
function setNativeValue(el, text) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const last = el.value;

  if (setter) setter.call(el, text);
  else el.value = text;

  // Bälte och hängslen: om Reacts tracker cachat det nya värdet, förgifta den
  // tillbaka till FÖREGÅENDE värde så updateValueIfChanged() returnerar true.
  const t = el._valueTracker;
  if (t && t.getValue() === text) t.setValue(last);

  el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: text }));
  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: text }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  return el.value === text;
}

function selectAllIn(el) {
  const doc = el.ownerDocument;
  const r = doc.createRange();
  r.selectNodeContents(el);
  const s = doc.defaultView.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

const landed = (el, text) => (el.innerText || el.textContent || '').includes(text.slice(0, 20));

// contenteditable-stege: execCommand ger isTrusted:true beforeinput/input (det enda
// Slate/ProseMirror/Lexical litar på) → syntetisk paste → rå DOM + input.
function setContentEditable(el, text) {
  const doc = el.ownerDocument; // OBS: widgetens iframe-document, inte top
  el.focus({ preventScroll: true });
  selectAllIn(el);

  try {
    if (doc.execCommand('insertText', false, text) && landed(el, text)) return true;
  } catch { /* fall vidare */ }

  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    selectAllIn(el);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: dt }));
    if (landed(el, text)) return true;
  } catch { /* fall vidare */ }

  el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: text }));
  el.textContent = text; // ALDRIG innerHTML — det injicerar LLM-output som markup
  try { selectAllIn(el); doc.defaultView.getSelection().collapseToEnd(); } catch { /* ok */ }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: text }));
  return landed(el, text);
}

export function setText(el, text) {
  el.scrollIntoView?.({ block: 'nearest' });
  el.focus?.({ preventScroll: true });
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return setNativeValue(el, text);
  if (el.isContentEditable) return setContentEditable(el, text);
  return false;
}

function key(el, type) {
  return el.dispatchEvent(new KeyboardEvent(type, {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, // keyCode: äldre widgets läser det
    bubbles: true, cancelable: true, composed: true,
  }));
}

function clickEl(btn) {
  for (const [Ctor, t] of [[PointerEvent, 'pointerdown'], [MouseEvent, 'mousedown'], [PointerEvent, 'pointerup'], [MouseEvent, 'mouseup']]) {
    try { btn.dispatchEvent(new Ctor(t, { bubbles: true, composed: true })); } catch { /* PointerEvent kanske saknas */ }
  }
  btn.click();
}

// Skicka, rankad efter verklig tillförlitlighet: knappklick > syntetisk Enter > requestSubmit.
export function submit(el, sendButton) {
  const btn = sendButton;
  const disabled = btn && (btn.disabled || btn.getAttribute('aria-disabled') === 'true');
  if (btn && !disabled) { clickEl(btn); return 'button'; }

  el.focus({ preventScroll: true });
  key(el, 'keydown'); key(el, 'keypress'); key(el, 'keyup');

  const form = el.closest?.('form');
  if (form) {
    try { form.requestSubmit(); return 'requestSubmit'; }
    catch { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
  }
  return 'enter';
}

/**
 * Skriv och skicka. Returnerar hur det gick så panelen kan skilja lyckat från
 * disabled composer (knappdriven bot → clickReply istället).
 */
export function typeAndSend(inputEl, text, sendButton) {
  if (inputEl.disabled || inputEl.getAttribute('aria-disabled') === 'true') {
    return { ok: false, reason: 'composer-disabled' };
  }
  if (!setText(inputEl, text)) return { ok: false, reason: 'insert-failed' };
  const how = submit(inputEl, sendButton);
  return { ok: true, how };
}

/** Klicka en snabbknapp (quick-reply chip) i konversationsytan. Löser S1. */
export function clickReply(node) {
  if (!node) return { ok: false, reason: 'gone' };
  clickEl(node);
  return { ok: true };
}
