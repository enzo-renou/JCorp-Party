'use strict';
const fs = require('fs');
const path = require('path');
const topo = require('topojson-client');
const Game = require('./base');
const { shuffle, pick, isMatch, clamp } = require('../util');

// ---------------------------------------------------------------- données
const COUNTRIES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'geo.json'), 'utf8'));
const topology = JSON.parse(fs.readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
const SHAPES = new Map(); // ccn3 -> [polygone: [anneau: [[lon,lat]...]]]
for (const f of topo.feature(topology, topology.objects.countries).features) {
  const g = f.geometry;
  if (!g) continue;
  SHAPES.set(String(f.id).padStart(3, '0'), g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
}

// ---------------------------------------------------------------- géométrie
const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inCountry(ccn3, lat, lng) {
  const polys = SHAPES.get(ccn3) || [];
  return polys.some((poly) => inRing(lng, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lng, lat, h)));
}
function distToCountry(ccn3, lat, lng) {
  let best = Infinity;
  for (const poly of SHAPES.get(ccn3) || []) for (const [x, y] of poly[0]) best = Math.min(best, haversine(lat, lng, y, x));
  return best;
}

/** Tolérance (km) selon la difficulté : la carte est dézoomable mais pas au pixel près */
const TOL_CAPITAL = { 1: 450, 2: 300, 3: 200 };
const TOL_COUNTRY = { 1: 80, 2: 60, 3: 40 };

function checkLocation(q, lat, lng) {
  if (q.locKind === 'capital') {
    const d = haversine(lat, lng, q.target.lat, q.target.lng);
    return { ok: d <= TOL_CAPITAL[q.tier], dist: Math.round(d) };
  }
  if (inCountry(q.country.ccn3, lat, lng)) return { ok: true, dist: 0 };
  const d = distToCountry(q.country.ccn3, lat, lng);
  return { ok: d <= TOL_COUNTRY[q.tier], dist: Math.round(d) };
}

// ---------------------------------------------------------------- questions
const deName = (c) => ({ f: `de la ${c.name}`, m: `du ${c.name}`, p: `des ${c.name}`, e: `d’${c.name}`, n: `de ${c.name}` }[c.art] || `de ${c.name}`);
const SECTIONS = {
  loc: { label: 'Sur la carte', time: 35, emoji: '📍' },
  capital: { label: 'Capitales', time: 20, emoji: '🏛️' },
  flag: { label: 'Drapeaux', time: 15, emoji: '🚩' },
};
const TIER_LABEL = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile' };

function buildQuestions(memory) {
  const used = (memory.geoUsed ||= new Set());
  const inGame = new Set();
  const draw = (tier) => {
    let pool = COUNTRIES.filter((c) => c.tier === tier && !inGame.has(c.cca2) && !used.has(c.cca2));
    if (!pool.length) { COUNTRIES.filter((c) => c.tier === tier).forEach((c) => used.delete(c.cca2)); pool = COUNTRIES.filter((c) => c.tier === tier && !inGame.has(c.cca2)); }
    const c = pick(pool);
    inGame.add(c.cca2); used.add(c.cca2);
    return c;
  };
  const qs = [];
  const locKinds = shuffle(['country', 'capital', pick(['country', 'capital'])]);
  const capKinds = shuffle(['cap', 'country', pick(['cap', 'country'])]);
  for (let tier = 1; tier <= 3; tier++) {
    const c = draw(tier);
    const kind = locKinds[tier - 1];
    qs.push({
      section: 'loc', tier, country: c, locKind: kind, target: { lat: c.lat, lng: c.lng },
      prompt: kind === 'country' ? `Place sur la carte : ${c.name}` : `Place la capitale : ${c.capital} (${c.name})`,
      answerLabel: kind === 'country' ? c.name : `${c.capital} (${c.name})`,
    });
  }
  for (let tier = 1; tier <= 3; tier++) {
    const c = draw(tier);
    const kind = capKinds[tier - 1];
    qs.push(kind === 'cap'
      ? { section: 'capital', tier, country: c, prompt: `Quelle est la capitale ${deName(c)} ?`, accepted: c.capNames, answerLabel: c.capital }
      : { section: 'capital', tier, country: c, prompt: `${c.capital} est la capitale de quel pays ?`, accepted: c.names, answerLabel: c.name });
  }
  for (let tier = 1; tier <= 3; tier++) {
    const c = draw(tier);
    qs.push({ section: 'flag', tier, country: c, flag: c.cca2.toLowerCase(), prompt: 'À quel pays appartient ce drapeau ?', accepted: c.names, answerLabel: c.name });
  }
  return qs;
}

// ---------------------------------------------------------------- jeu
const REVEAL_TIME = 6_500;
const RESULTS_TIME = 10_000;

class Geo extends Game {
  constructor(ctx, options) {
    super(ctx, options);
    this.questions = buildQuestions(ctx.memory);
    this.idx = -1;
    this.phase = 'starting';
    this.answers = {};   // pid -> réponse de la question courante
    this.log = [];       // résultats par question
    this.raw = Object.fromEntries(this.ids.map((id) => [id, 0]));
    this.endsAt = null;
  }

  start() { this.next(); }

  next() {
    this.idx++;
    if (this.idx >= this.questions.length) return this.showResults();
    const q = this.questions[this.idx];
    this.phase = 'question';
    this.answers = {};
    this.endsAt = Date.now() + SECTIONS[q.section].time * 1000;
    const i = this.idx;
    this.cancel(this.timer);
    this.timer = this.after(SECTIONS[q.section].time * 1000, () => { if (this.idx === i) this.reveal(); });
    this.update();
  }

  allAnswered() {
    const present = this.connectedIds();
    return present.length > 0 && present.every((id) => this.answers[id]);
  }

  reveal() {
    if (this.phase !== 'question') return;
    this.cancel(this.timer);
    const q = this.questions[this.idx];
    const rows = this.ids.map((pid) => {
      const a = this.answers[pid];
      let ok = false, dist;
      if (a) {
        if (q.section === 'loc') ({ ok, dist } = checkLocation(q, a.lat, a.lng));
        else ok = isMatch(a.text, q.accepted);
      }
      if (ok) this.raw[pid] += 1;
      return { pid, answer: a ?? null, ok, dist };
    });
    this.log.push({ q: this.idx, rows });
    this.phase = 'reveal';
    this.endsAt = Date.now() + REVEAL_TIME;
    this.timer = this.after(REVEAL_TIME, () => this.next());
    this.update();
  }

  showResults() {
    this.phase = 'results';
    this.endsAt = Date.now() + RESULTS_TIME;
    this.update();
    this.after(RESULTS_TIME, () => this.ctx.finish({ scores: this.raw, notes: ['9 questions : 3 sur la carte, 3 capitales, 3 drapeaux.'] }));
  }

  onAction(pid, msg) {
    if (msg.type !== 'answer' || this.phase !== 'question' || this.answers[pid]) return;
    const q = this.questions[this.idx];
    if (q.section === 'loc') {
      const lat = Number(msg.lat), lng = Number(msg.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      this.answers[pid] = { lat: clamp(lat, -90, 90), lng: clamp(lng, -180, 180) };
    } else {
      const text = String(msg.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!text) return;
      this.answers[pid] = { text };
    }
    this.update();
    if (this.allAnswered()) { const i = this.idx; this.after(900, () => { if (this.idx === i) this.reveal(); }); }
  }

  onConnectionChange(_pid, connected) {
    if (!connected && this.phase === 'question' && this.allAnswered()) this.reveal();
    this.update();
  }

  qView(q, withAnswer) {
    const v = { section: q.section, tier: q.tier, tierLabel: TIER_LABEL[q.tier], prompt: q.prompt, flag: q.flag };
    if (q.section === 'loc') v.locKind = q.locKind;
    if (withAnswer) {
      v.answerLabel = q.answerLabel;
      v.target = q.section === 'loc' ? { lat: q.target.lat, lng: q.target.lng, cca2: q.country.cca2, kind: q.locKind } : undefined;
    }
    return v;
  }

  view(pid) {
    const v = { phase: this.phase, idx: this.idx, total: this.questions.length, endsAt: this.endsAt, raw: this.raw, sections: SECTIONS };
    if (this.phase === 'question') {
      v.q = this.qView(this.questions[this.idx], false);
      v.answered = Object.keys(this.answers);
      v.mine = this.answers[pid] ?? null;
    } else if (this.phase === 'reveal') {
      v.q = this.qView(this.questions[this.idx], true);
      v.rows = this.log[this.log.length - 1].rows;
    } else if (this.phase === 'results') {
      v.recap = this.log.map((e) => ({ ...this.qView(this.questions[e.q], true), rows: e.rows.map((r) => ({ pid: r.pid, ok: r.ok })) }));
    }
    return v;
  }
}

module.exports = Geo;
module.exports.checkLocation = checkLocation;
module.exports.COUNTRIES = COUNTRIES;
