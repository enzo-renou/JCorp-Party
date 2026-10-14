'use strict';
const fs = require('fs');
const path = require('path');
const Game = require('./base');
const { shuffle, isMatch, clamp } = require('../util');

// ---------------------------------------------------------------- banque de questions
// data/culture/<categorie>.json : [{ t:'text'|'emoji'|'image', q, a:[réponses acceptées], emoji?, wiki?, hint? }]
const POOL = [];
const BY_ID = new Map();
const dir = path.join(__dirname, '..', '..', 'data', 'culture');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const cat = file.replace('.json', '');
  JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).forEach((q, i) => {
    const item = { id: `${cat}-${i}`, cat, d: q.d || 1, t: q.t || 'text', q: q.q, a: q.a, emoji: q.emoji, wiki: q.wiki, wikis: q.wikis, hint: q.hint };
    POOL.push(item);
    BY_ID.set(item.id, item);
  });
  // questions « difficiles » (d:3) ajoutées à la même catégorie
  const hf = path.join(dir, 'hard', file);
  if (fs.existsSync(hf)) JSON.parse(fs.readFileSync(hf, 'utf8')).forEach((q, i) => {
    const item = { id: `${cat}-h${i}`, cat, d: 3, t: q.t || 'text', q: q.q, a: q.a, emoji: q.emoji, wiki: q.wiki, wikis: q.wikis, hint: q.hint };
    POOL.push(item);
    BY_ID.set(item.id, item);
  });
}
const cultureById = (id) => BY_ID.get(id);

const REVIEW_MAX = 5 * 60_000;
const RESULTS_TIME = 10_000;

class Culture extends Game {
  constructor(ctx, options) {
    super(ctx, options);
    this.count = [10, 15, 20, 30].includes(Number(options.count)) ? Number(options.count) : 15;
    this.time = [20, 30, 45].includes(Number(options.time)) ? Number(options.time) : 25;
    this.level = ['easy', 'mixed', 'hard'].includes(options.level) ? options.level : 'hard';
    this.cats = Array.isArray(options.cats) && options.cats.length ? options.cats : null;
    this.used = (ctx.memory.cultureUsed ||= new Set());
    this.questions = this.select(this.count);
    this.answers = Object.fromEntries(this.ids.map((id) => [id, Array(this.questions.length).fill('')]));
    this.idx = -1;
    this.phase = 'starting';
    this.ok = [];          // ok[qi][pid] = bool
    this.endsAt = null;
    this.fin = new Set(); // joueurs qui ont validé leur réponse à la question courante
  }

  select(n) {
    let pool = this.cats ? POOL.filter((q) => this.cats.includes(q.cat)) : POOL;
    // difficulté : « facile » = questions classiques, « difficile » = surtout des questions d:3 (+ quelques visuelles)
    if (this.level === 'easy') pool = pool.filter((q) => q.d < 3);
    else if (this.level === 'hard') {
      const hard = pool.filter((q) => q.d >= 3 || q.t !== 'text');
      if (hard.filter((q) => q.d >= 3).length >= Math.min(n, 8)) pool = hard;
    }
    let fresh = pool.filter((q) => !this.used.has(q.id));
    if (fresh.length < n) { for (const q of pool) this.used.delete(q.id); fresh = [...pool]; }
    const perCatCap = this.cats && this.cats.length <= 2 ? n : null;
    // ~30 % de questions visuelles (rébus, 4 images 1 mot, qui est-ce ?) et pas plus de N par thème
    const special = shuffle(fresh.filter((q) => q.t !== 'text'));
    const texts = shuffle(fresh.filter((q) => q.t === 'text'));
    const nSpecial = Math.min(special.length, Math.round(n * (this.level === 'hard' ? 0.2 : 0.3)));
    const cap = perCatCap || Math.max(2, Math.ceil(n / 6));
    const perCat = {};
    const out = [];
    const take = (q) => {
      if ((perCat[q.cat] || 0) >= cap) return false;
      perCat[q.cat] = (perCat[q.cat] || 0) + 1; out.push(q); return true;
    };
    for (const q of special) { if (out.length >= nSpecial) break; take(q); }
    for (const q of texts) { if (out.length >= n) break; take(q); }
    for (const q of [...texts, ...special]) { if (out.length >= n) break; if (!out.includes(q)) { out.push(q); } }
    out.forEach((q) => this.used.add(q.id));
    return shuffle(out);
  }

  start() { this.next(); }

  next() {
    this.idx++;
    if (this.idx >= this.questions.length) return this.startReview();
    this.phase = 'question';
    this.fin = new Set();
    this.endsAt = Date.now() + this.time * 1000;
    const i = this.idx;
    this.cancel(this.timer);
    this.timer = this.after(this.time * 1000, () => { if (this.idx === i && this.phase === 'question') this.next(); });
    this.update();
  }

  checkAllAnswered() {
    const present = this.connectedIds();
    if (present.length && present.every((id) => this.fin.has(id))) {
      const i = this.idx;
      this.after(900, () => { if (this.idx === i && this.phase === 'question') { this.cancel(this.timer); this.next(); } });
    }
  }

  startReview() {
    this.phase = 'review';
    this.endsAt = null;
    this.ok = this.questions.map((q, qi) => Object.fromEntries(this.ids.map((id) => [id, isMatch(this.answers[id][qi], q.a)])));
    this.cancel(this.timer);
    this.timer = this.after(REVIEW_MAX, () => this.validate(this.masterId, true));
    if (!this.connected(this.masterId)) this.after(4000, () => this.validate(this.masterId, true));
    this.update();
  }

  validate(pid, auto = false) {
    if (this.phase !== 'review') return;
    if (!auto && pid !== this.masterId) return;
    this.cancel(this.timer);
    const scores = Object.fromEntries(this.ids.map((id) => [id, this.questions.reduce((n, _q, qi) => n + (this.ok[qi][id] ? 1 : 0), 0)]));
    this.final = scores;
    this.phase = 'results';
    this.endsAt = Date.now() + RESULTS_TIME;
    this.update();
    this.after(RESULTS_TIME, () => this.ctx.finish({
      scores,
      notes: [`${this.questions.length} questions · corrigées par ${this.name(this.masterId)}`],
    }));
  }

  onAction(pid, msg) {
    switch (msg.type) {
      case 'answer': {
        if (this.phase !== 'question') return;
        const text = String(msg.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!text && !msg.draft) return;
        // brouillon : enregistré mais modifiable ; réponse validée : compte pour « tout le monde a répondu »
        this.answers[pid][this.idx] = text;
        if (msg.draft) this.fin.delete(pid); else this.fin.add(pid);
        this.update();
        this.checkAllAnswered();
        break;
      }
      case 'toggle': {
        // le maître corrige les réponses des autres (la sienne est corrigée automatiquement)
        if (this.phase !== 'review' || pid !== this.masterId) return;
        const qi = Number(msg.qi);
        const target = String(msg.pid);
        if (!this.ok[qi] || !(target in this.ok[qi]) || target === this.masterId) return;
        this.ok[qi][target] = !this.ok[qi][target];
        this.update();
        break;
      }
      case 'validate':
        this.validate(pid);
        break;
    }
  }

  onConnectionChange(pid, connected) {
    if (this.phase === 'question' && !connected) this.checkAllAnswered();
    if (this.phase === 'review' && pid === this.masterId && !connected) this.after(15_000, () => { if (!this.connected(this.masterId)) this.validate(this.masterId, true); });
    this.update();
  }

  publicQ(q) {
    return {
      t: q.t, q: q.q, emoji: q.emoji, cat: q.cat,
      img: q.wiki ? `/api/wikiimg/${encodeURIComponent(q.id)}` : undefined,
      imgs: q.wikis ? q.wikis.map((_, n) => `/api/wikiimg/${encodeURIComponent(q.id)}/${n}`) : undefined,
      hint: q.wiki ? q.hint : undefined,
    };
  }

  view(pid) {
    const v = { phase: this.phase, idx: this.idx, total: this.questions.length, endsAt: this.endsAt, masterId: this.masterId, time: this.time };
    if (this.phase === 'question') {
      v.q = this.publicQ(this.questions[this.idx]);
      v.answered = this.ids.filter((id) => this.fin.has(id));
      v.mine = this.answers[pid]?.[this.idx] || '';
      v.mineFinal = this.fin.has(pid);
    } else if (this.phase === 'review' || this.phase === 'results') {
      v.items = this.questions.map((q, qi) => ({
        ...this.publicQ(q),
        a: q.a.slice(0, 3),
        rows: this.ids.map((id) => ({ pid: id, text: this.answers[id][qi], ok: !!this.ok[qi][id] })),
      }));
      if (this.phase === 'results') v.scores = this.final;
    }
    return v;
  }
}

module.exports = Culture;
module.exports.cultureById = cultureById;
module.exports.POOL = POOL;
