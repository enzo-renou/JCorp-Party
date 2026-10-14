// Effets sonores générés avec WebAudio (aucun fichier à charger). Activation + volume mémorisés dans le navigateur.
import { prefs } from './net.js';

const num = (k, d) => { const v = parseFloat(prefs.get(k, d)); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d; };
const settings = { sfx: prefs.get('sfx', '1') === '1', sfxVol: num('sfxVol', 0.6) };
const listeners = new Set();
const save = () => {
  prefs.set('sfx', settings.sfx ? '1' : '0'); prefs.set('sfxVol', settings.sfxVol);
  listeners.forEach((f) => f({ ...settings }));
};

let ctx = null, master = null, sfxBus = null, verb = null;

function init() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0.9;
    // petite réverbération douce (écho filtré) pour arrondir les sons
    verb = ctx.createGain(); verb.gain.value = 0.35;
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.23;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    verb.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.connect(master); sfxBus.connect(verb);
    master.connect(comp); comp.connect(ctx.destination);
    applyVolumes();
  } catch { ctx = null; }
  return ctx;
}
function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(settings.sfx ? settings.sfxVol : 0, t, 0.05);
}

// ---------------------------------------------------------------- notes douces (sinus + léger harmonique, filtrées)
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
function note(bus, midi, start, dur, { vol = 0.2, type = 'sine', attack = 0.012, cutoff = 2200, bell = 0.25 } = {}) {
  const c = ctx; if (!c) return;
  const t = c.currentTime + start;
  const g = c.createGain(); const f = c.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(f); f.connect(bus);
  const o = c.createOscillator(); o.type = type; o.frequency.value = hz(midi); o.connect(g); o.start(t); o.stop(t + dur + 0.05);
  if (bell) { const o2 = c.createOscillator(); const g2 = c.createGain(); g2.gain.value = bell; o2.frequency.value = hz(midi) * 2; o2.connect(g2); g2.connect(g); o2.start(t); o2.stop(t + dur + 0.05); }
}
const S = (...a) => note(sfxBus, ...a);

const SOUNDS = {
  join: () => { S(76, 0, 0.35, { vol: .16 }); S(81, 0.1, 0.45, { vol: .16 }); },
  start: () => [69, 73, 76, 81].forEach((m, i) => S(m, i * 0.1, 0.6, { vol: .15, type: 'triangle' })),
  turn: () => { S(72, 0, 0.3, { vol: .15 }); S(79, 0.12, 0.5, { vol: .15 }); },
  good: () => { S(76, 0, 0.3, { vol: .17 }); S(83, 0.1, 0.55, { vol: .15 }); },
  bad: () => { S(60, 0, 0.5, { vol: .17, type: 'triangle', cutoff: 700, bell: 0 }); S(56, 0.13, 0.6, { vol: .15, type: 'triangle', cutoff: 600, bell: 0 }); },
  tick: () => S(84, 0, 0.09, { vol: .07, attack: 0.004, bell: 0, cutoff: 1500 }),
  round: () => [72, 76, 79, 84].forEach((m, i) => S(m, i * 0.11, 0.7, { vol: .13 })),
  win: () => [[72, 0], [76, .14], [79, .28], [84, .42], [79, .62], [84, .76], [88, .9]].forEach(([m, t]) => S(m, t, 0.9, { vol: .14, type: 'triangle' })),
  pop: () => S(88, 0, 0.12, { vol: .08, attack: 0.004, bell: 0.1 }),
};
export function sfx(name) { if (!settings.sfx || settings.sfxVol <= 0 || !init()) return; resume(); try { SOUNDS[name]?.(); } catch { /* son indisponible */ } }

function resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

// ---------------------------------------------------------------- réglages
export const getSettings = () => ({ ...settings });
export function setSettings(patch) {
  Object.assign(settings, patch);
  save();
  applyVolumes();
}
export const onSettings = (f) => { listeners.add(f); return () => listeners.delete(f); };
// les navigateurs exigent un geste de l'utilisateur avant tout son
addEventListener('pointerdown', () => init(), { once: true });
