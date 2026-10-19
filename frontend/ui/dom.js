// Safe DOM construction. There is deliberately NO innerHTML anywhere in the UI: every string goes through
// textContent / setAttribute, so patient-entered text can never be interpreted as markup (XSS-safe by construction).
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Only absolute https URLs from the (validated) evidence records are ever rendered as links.
export function safeLink(url, label) {
  if (!/^https:\/\/[^\s]+$/.test(url || '')) return h('span', { text: label });
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: label });
}
export const ICON = { avoid: '✖', modify: '▲', conditional: '?', monitor: '●', needs_info: '…', informational: 'i', no_flag: '✓' };
export function badge(category, labels) { return h('span', { class: `badge cat-${category}` }, h('span', { 'aria-hidden': 'true', text: ICON[category] + ' ' }), labels[category]); }

// Accessible modal: role=dialog, labelled, focus moved in, Tab kept inside, Esc / overlay / close all dismiss, focus restored.
let lastFocus = null;
export function openModal(overlay, card, titleId) {
  lastFocus = document.activeElement;
  overlay.classList.add('open'); overlay.removeAttribute('hidden'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', titleId);
  const first = card.querySelector('.modal-close') || card; first.focus();
}
export function closeModal(overlay) { overlay.classList.remove('open'); overlay.setAttribute('hidden', ''); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
export function trapTab(overlay, e) {
  if (e.key !== 'Tab' || !overlay.classList.contains('open')) return;
  const f = $$('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])', overlay).filter(x => !x.hidden);
  if (!f.length) return; const a = f[0], z = f[f.length - 1];
  if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
}
