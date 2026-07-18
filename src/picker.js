// picker.js — "peka ut fältet"-läget.
// Overlay ligger i en egen shadow root så sidans CSS inte kan röra den,
// och har pointer-events:none så den aldrig blir event target.

import { createAnchor } from './anchor.js';

let active = null;

function makeOverlay() {
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const sr = host.attachShadow({ mode: 'open' });
  sr.innerHTML = `
    <style>
      :host { pointer-events: none; }
      .box {
        position: fixed; pointer-events: none;
        border: 2px solid #4f8cff;
        background: rgba(79,140,255,.14);
        border-radius: 3px;
        transition: all .05s linear;
      }
      .tag {
        position: fixed; pointer-events: none;
        font: 12px/1.4 system-ui, sans-serif;
        background: #4f8cff; color: #fff;
        padding: 2px 6px; border-radius: 3px;
        white-space: nowrap;
      }
      .hint {
        position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
        pointer-events: none;
        font: 14px/1.4 system-ui, sans-serif;
        background: #111; color: #fff;
        padding: 10px 16px; border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,.4);
      }
    </style>
    <div class="box" hidden></div>
    <div class="tag" hidden></div>
    <div class="hint"></div>`;
  document.documentElement.appendChild(host);
  return {
    host,
    box: sr.querySelector('.box'),
    tag: sr.querySelector('.tag'),
    hint: sr.querySelector('.hint'),
    destroy: () => host.remove(),
  };
}

/**
 * VIKTIGT: event.target är omriktad (retargeted) vid shadow-gräns.
 * composedPath()[0] ger det RIKTIGA elementet i öppna shadow roots.
 * Vid stängd shadow root börjar stigen vid värdelementet — då är
 * composedPath()[0] === värden, och vi kan upptäcka det.
 */
function realTarget(e) {
  const path = e.composedPath ? e.composedPath() : [];
  return path[0] instanceof Element ? path[0] : e.target;
}

function label(el) {
  const t = el.nodeName.toLowerCase();
  const id = el.id && !/^:.*:$/.test(el.id) ? '#' + el.id : '';
  const role = el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : '';
  return t + id + role;
}

/**
 * @param {'input'|'conversation'|'send'} kind
 * @param {(anchor:object|null, el:Element|null)=>void} done
 */
export function startPicker(kind, done) {
  if (active) active.cancel();

  const ui = makeOverlay();
  const texts = {
    input: 'Klicka på chattens skrivfält. Esc avbryter.',
    conversation: 'Klicka på meddelandelistan. Esc avbryter.',
    send: 'Klicka på skicka-knappen. Esc avbryter.',
  };
  ui.hint.textContent = texts[kind] || 'Välj element. Esc avbryter.';

  let hovered = null;

  const onMove = (e) => {
    const el = realTarget(e);
    // Markera aldrig ett iframe-element: det man vill peka ut ligger INUTI iframen och
    // fångas av iframens egen pekare. Att markera själva iframen är bara förvirrande.
    if (!el || el === hovered || ui.host.contains(el) || el.tagName === 'IFRAME') return;
    hovered = el;
    const r = el.getBoundingClientRect();
    ui.box.hidden = false;
    ui.box.style.cssText += `;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
    ui.tag.hidden = false;
    ui.tag.textContent = label(el);
    ui.tag.style.left = r.left + 'px';
    ui.tag.style.top = Math.max(0, r.top - 22) + 'px';
  };

  // Sidan får ALDRIG se den här klicken. Vi äter hela sekvensen.
  const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };

  const onClick = (e) => {
    swallow(e);
    const el = realTarget(e);
    if (!el || ui.host.contains(el) || el.tagName === 'IFRAME') return; // pekas ut inuti iframen
    cleanup();
    done(createAnchor(el, kind), el);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { swallow(e); cleanup(); done(null, null); }
  };

  const opts = { capture: true, passive: false };
  function cleanup() {
    removeEventListener('mousemove', onMove, opts);
    removeEventListener('click', onClick, opts);
    removeEventListener('mousedown', swallow, opts);
    removeEventListener('mouseup', swallow, opts);
    removeEventListener('pointerdown', swallow, opts);
    removeEventListener('pointerup', swallow, opts);
    removeEventListener('keydown', onKey, opts);
    ui.destroy();
    active = null;
  }

  addEventListener('mousemove', onMove, opts);
  addEventListener('click', onClick, opts);
  addEventListener('mousedown', swallow, opts);   // annars fokuserar/öppnar sidan
  addEventListener('mouseup', swallow, opts);
  addEventListener('pointerdown', swallow, opts);
  addEventListener('pointerup', swallow, opts);
  addEventListener('keydown', onKey, opts);

  active = { cancel: () => { cleanup(); done(null, null); } };
  return active;
}
