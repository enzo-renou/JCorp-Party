// Petits effets sonores générés avec WebAudio (aucun fichier à charger)
import { prefs } from './net.js';

let ctx = null;
let muted = prefs.get('muted', '0') === '1';
const listeners = new Set();

function ac() {
  if (muted) return null;
  try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch { return null; }
  return ctx;
}
function tone(freq, start, dur, { type = 'sine', vol = 0.12, slide = 0 } = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + start;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
}
const SOUNDS = {
  join: () => { tone(520, 0, .1, { type: 'triangle' }); tone(780, .09, .14, { type: 'triangle' }); },
  start: () => [392, 523, 659, 784].forEach((f, i) => tone(f, i * .09, .18, { type: 'square', vol: .07 })),
  turn: () => { tone(660, 0, .09, { type: 'triangle' }); tone(990, .09, .16, { type: 'triangle' }); },
  good: () => { tone(660, 0, .1, { type: 'triangle' }); tone(880, .1, .2, { type: 'triangle' }); },
  bad: () => tone(220, 0, .3, { type: 'sawtooth', vol: .08, slide: -90 }),
  tick: () => tone(1000, 0, .05, { type: 'square', vol: .05 }),
  round: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .1, .25, { type: 'triangle' })),
  win: () => [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i * .13, .22, { type: 'square', vol: .08 })),
  pop: () => tone(700, 0, .08, { type: 'sine', slide: 300 }),
};
export const sfx = (name) => { try { SOUNDS[name]?.(); } catch { /* son indisponible */ } };
export const isMuted = () => muted;
export const setMuted = (m) => { muted = m; prefs.set('muted', m ? '1' : '0'); listeners.forEach((f) => f(m)); };
export const onMute = (f) => { listeners.add(f); return () => listeners.delete(f); };
// les navigateurs exigent un geste de l'utilisateur avant de produire du son
addEventListener('pointerdown', () => { if (!muted) ac(); }, { once: true });
