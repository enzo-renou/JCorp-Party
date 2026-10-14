// Petits utilitaires d'interface
import { serverNow } from './net.js';
import { sfx } from './sound.js';
let lastTick = 0;

/** h('div', {class:'x', onClick: fn}, enfants…) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const fill = (el, ...kids) => { clear(el); append(el, kids); return el; };

export const avatarUrl = (seed) => window.Avatars.url(seed);
export const avatar = (seed, cls = '') => h('img', { class: `avatar ${cls}`, src: avatarUrl(seed), alt: '' });

// ---------- minuteurs (mis à jour par un seul intervalle global)
const live = new Set();
function register(item) { live.add(item); tick(); return item.el; }
function tick() {
  const now = serverNow();
  for (const it of live) {
    if (!it.el.isConnected && it.seen) { live.delete(it); continue; }
    if (it.el.isConnected) it.seen = true;
    const left = Math.max(0, it.endsAt - now);
    if (it.kind === 'bar') {
      it.el.style.setProperty('--p', Math.min(1, left / it.total).toFixed(3));
      it.el.classList.toggle('low', left < 6000);
    } else {
      const sec = Math.ceil(left / 1000);
      it.el.textContent = String(sec);
      if (left > 0 && sec <= 3 && it.sec !== sec && it.el.isConnected && Date.now() - lastTick > 600) { lastTick = Date.now(); sfx('tick'); }
      it.sec = sec;
      it.el.classList.toggle('low', left < 6000 && left > 0);
    }
  }
}
setInterval(tick, 200);

/** barre de progression */
export function timerBar(endsAt, totalMs) {
  const el = h('div', { class: 'timer' }, h('i'));
  return register({ el, endsAt, total: totalMs || Math.max(1000, endsAt - serverNow()), kind: 'bar' });
}
/** petite horloge en secondes */
export function clock(endsAt) {
  const el = h('div', { class: 'clock' }, '–');
  return register({ el, endsAt, kind: 'clock' });
}

// ---------- toasts
export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}` }, msg);
  box.append(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- confettis
export function confetti(n = 90) {
  const box = h('div', { class: 'confetti' });
  const colors = ['#ff4f9a', '#ffd23f', '#3ee6d1', '#a78bfa', '#4ade80', '#fff'];
  for (let i = 0; i < n; i++) {
    box.append(h('i', { style: { left: Math.random() * 100 + '%', background: colors[i % colors.length], animationDuration: 2.5 + Math.random() * 2.5 + 's', animationDelay: Math.random() * 1.2 + 's' } }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 7000);
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, a, b) => (n > 1 ? b : a);
export function copy(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
  const t = h('textarea', { value: text }); document.body.append(t); t.select();
  try { document.execCommand('copy'); } catch { /* rien */ }
  t.remove(); return Promise.resolve(true);
}

/**
 * Champ de réponse « sans bouton obligatoire » : ce qu'on tape est enregistré tout seul (brouillon) et reste
 * modifiable ; Entrée ou le bouton valident (et préviennent les autres que tu as fini).
 * onSend(texte, brouillon:boolean)
 */
export function answerBox({ placeholder = 'Ta réponse…', value = '', maxLength = 80, label = 'Valider', onSend }) {
  const input = h('input', { class: 'input', placeholder, maxLength, value, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const btn = h('button', { class: 'btn cyan' }, label);
  const note = h('div', { class: 'answer-note muted' });
  let timer = null, sent = value.trim(), isFinal = false;
  const paint = () => {
    btn.textContent = isFinal ? '✓ Validée' : label;
    btn.classList.toggle('done', isFinal);
    note.textContent = isFinal ? 'Réponse validée — tu peux encore la modifier.' : input.value.trim() ? 'Enregistré automatiquement : ta réponse sera prise en compte même sans valider.' : '';
  };
  const send = (draft) => {
    clearTimeout(timer); timer = null;
    const t = input.value.trim();
    if (draft && t === sent) return;
    if (!draft && !t) return;
    sent = t; isFinal = !draft; onSend(t, draft); paint();
  };
  input.addEventListener('input', () => { isFinal = false; paint(); clearTimeout(timer); timer = setTimeout(() => send(true), 350); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(false); });
  input.addEventListener('blur', () => { if (timer) send(true); });
  btn.addEventListener('click', () => send(false));
  const row = h('div', { class: 'answer-row' }, input, btn);
  return {
    el: h('div', { class: 'answer-box' }, row, note), input, row,
    /** synchronise avec l'état du serveur (sans écraser ce que le joueur est en train de taper) */
    sync({ text, final }) {
      if (timer) return;
      if (document.activeElement !== input && typeof text === 'string' && text !== input.value && !isFinal) input.value = text;
      isFinal = !!final && input.value.trim() === (text ?? input.value).trim();
      sent = input.value.trim(); paint();
    },
    disable(d) { input.disabled = d; btn.disabled = d; },
    focus() { setTimeout(() => input.focus(), 50); },
  };
}
