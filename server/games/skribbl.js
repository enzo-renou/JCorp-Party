'use strict';
const Game = require('./base');
const { shuffle, compact, lev, clamp, sample } = require('../util');
const WORDS = require('../../data/skribbl-words.json');

const CANVAS_W = 800;
const CANVAS_H = 600;
const CHOOSE_TIME = 15_000;
const TURN_END_TIME = 5_500;
const RESULTS_TIME = 10_000;
const MAX_CHAT = 80;

class Skribbl extends Game {
  constructor(ctx, options) {
    super(ctx, options);
    this.drawTime = [60, 80, 100].includes(Number(options.drawTime)) ? Number(options.drawTime) : 80;
    const passes = [1, 2].includes(Number(options.passes)) ? Number(options.passes) : 1;
    this.raw = Object.fromEntries(this.ids.map((id) => [id, 0]));
    const base = shuffle(this.ids);
    this.queue = [];
    for (let i = 0; i < passes; i++) this.queue.push(...base);
    this.turn = -1;
    this.phase = 'starting';
    this.chat = [];
    this.msgId = 0;
    this.used = (ctx.memory.skribblUsed ||= new Set());
    this.strokes = [];
    this.strokeIdx = new Map();
    this.guessed = new Map();
    this.deltas = {};
    this.hintTimers = [];
    this.drawer = null;
    this.word = null;
    this.choices = [];
    this.revealed = new Set();
    this.endsAt = null;
  }

  start() { this.nextTurn(); }

  // ------------------------------------------------------------ déroulement
  guessers() { return this.ids.filter((id) => id !== this.drawer && this.connected(id)); }

  pickWords(n) {
    let pool = WORDS.filter((w) => !this.used.has(w));
    if (pool.length < n) { this.used.clear(); pool = [...WORDS]; }
    return sample(pool, n);
  }

  nextTurn() {
    this.turn++;
    while (this.turn < this.queue.length && !this.connected(this.queue[this.turn])) this.turn++;
    if (this.turn >= this.queue.length) return this.showResults();
    this.drawer = this.queue[this.turn];
    this.phase = 'choosing';
    this.strokes = [];
    this.strokeIdx.clear();
    this.word = null;
    this.guessed = new Map();
    this.deltas = {};
    this.revealed = new Set();
    this.choices = this.pickWords(3);
    this.endsAt = Date.now() + CHOOSE_TIME;
    this.timer = this.after(CHOOSE_TIME, () => this.chooseWord(0));
    this.ctx.fx('clear', { turn: this.turn });
    this.sys(`🎨 ${this.name(this.drawer)} va dessiner !`);
    this.update();
  }

  chooseWord(i) {
    if (this.phase !== 'choosing') return;
    this.cancel(this.timer);
    this.word = this.choices[clamp(i, 0, this.choices.length - 1)];
    this.used.add(this.word);
    this.phase = 'drawing';
    this.endsAt = Date.now() + this.drawTime * 1000;
    this.timer = this.after(this.drawTime * 1000, () => this.endTurn());
    // indices : une lettre dévoilée à 40 %, 60 % puis 80 % du temps (selon la longueur du mot)
    const letters = [...this.word].map((c, i) => (/[\p{L}\p{N}]/u.test(c) ? i : -1)).filter((i) => i >= 0);
    const nHints = clamp(Math.floor(letters.length / 3), 0, 3);
    this.hintTimers = [];
    for (let k = 0; k < nHints; k++) {
      const frac = 0.4 + 0.2 * k;
      this.hintTimers.push(this.after(this.drawTime * 1000 * frac, () => {
        const left = letters.filter((i) => !this.revealed.has(i));
        if (left.length > 1) { this.revealed.add(left[Math.floor(Math.random() * left.length)]); this.update(); }
      }));
    }
    this.update();
  }

  endTurn() {
    if (this.phase !== 'drawing' && this.phase !== 'choosing') return;
    this.cancel(this.timer);
    this.hintTimers.forEach((t) => this.cancel(t));
    const eligible = Math.max(1, this.ids.filter((id) => id !== this.drawer && this.connected(id)).length);
    if (this.phase === 'choosing') this.word = this.choices[0]; // le dessinateur est parti avant de choisir
    const sum = [...this.guessed.values()].reduce((a, b) => a + b, 0);
    const dp = Math.round(sum / eligible);
    if (dp > 0) { this.raw[this.drawer] += dp; this.deltas[this.drawer] = dp; }
    this.sys(`Le mot était « ${this.word} »`, 'info');
    this.phase = 'turnEnd';
    this.endsAt = Date.now() + TURN_END_TIME;
    this.timer = this.after(TURN_END_TIME, () => this.nextTurn());
    this.update();
  }

  showResults() {
    this.phase = 'results';
    this.endsAt = Date.now() + RESULTS_TIME;
    this.update();
    this.after(RESULTS_TIME, () => this.ctx.finish({
      scores: this.raw,
      notes: ['Points Skribbl convertis : 100 pts = 1 point de partie.'],
    }));
  }

  // ------------------------------------------------------------ chat
  push(m) {
    this.chat.push({ id: ++this.msgId, ...m });
    if (this.chat.length > MAX_CHAT) this.chat.shift();
  }
  sys(text, kind = 'info') { this.push({ kind, text, scope: 'all' }); }

  guess(pid, raw) {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!text) return;
    if (this.phase !== 'drawing') return this.push({ kind: 'chat', pid, text, scope: 'all' }), this.update();

    const isDrawer = pid === this.drawer;
    if (isDrawer || this.guessed.has(pid)) {
      // le dessinateur et ceux qui ont trouvé parlent entre eux (sans divulguer le mot)
      if (compact(text).includes(compact(this.word))) return;
      this.push({ kind: 'chat', pid, text, scope: 'found' });
      return this.update();
    }
    const target = compact(this.word);
    const attempt = compact(text);
    if (attempt === target) {
      const remaining = Math.max(0, (this.endsAt - Date.now()) / 1000);
      let pts = Math.round(100 + (400 * remaining) / this.drawTime) - 20 * this.guessed.size;
      pts = Math.max(50, pts);
      this.guessed.set(pid, pts);
      this.raw[pid] += pts;
      this.deltas[pid] = pts;
      this.sys(`✅ ${this.name(pid)} a trouvé le mot !`, 'good');
      if (this.guessers().every((id) => this.guessed.has(id))) this.after(1200, () => this.endTurn());
    } else {
      this.push({ kind: 'chat', pid, text, scope: 'all' });
      if (target.length >= 4 && lev(attempt, target) <= 1) this.push({ kind: 'close', text: 'Tu y es presque ! 🔥', scope: 'to', to: pid });
    }
    this.update();
  }

  // ------------------------------------------------------------ actions
  onAction(pid, msg) {
    switch (msg.type) {
      case 'choose':
        if (pid === this.drawer) this.chooseWord(Number(msg.index) || 0);
        break;
      case 'guess':
        this.guess(pid, msg.text);
        break;
      case 'sync':
        this.ctx.fx('strokes', { list: this.strokes, turn: this.turn }, { to: pid });
        break;
      case 'stroke': {
        if (pid !== this.drawer || this.phase !== 'drawing') return;
        const id = String(msg.id ?? '').slice(0, 24);
        if (!id) return;
        let s = this.strokeIdx.get(id);
        if (!s) {
          if (this.strokes.length >= 1500) return;
          s = { k: 's', id, c: /^#[0-9a-f]{6}$/i.test(msg.c) ? msg.c : '#000000', w: clamp(msg.w, 1, 60), pts: [] };
          this.strokes.push(s);
          this.strokeIdx.set(id, s);
        }
        const pts = (Array.isArray(msg.pts) ? msg.pts : []).slice(0, 200)
          .map((p) => [Math.round(clamp(p?.[0], 0, CANVAS_W)), Math.round(clamp(p?.[1], 0, CANVAS_H))]);
        if (s.pts.length + pts.length > 8000) return;
        s.pts.push(...pts);
        this.ctx.fx('stroke', { id, c: s.c, w: s.w, pts }, { except: pid });
        break;
      }
      case 'fill': {
        if (pid !== this.drawer || this.phase !== 'drawing' || this.strokes.length >= 1500) return;
        const f = { k: 'f', x: Math.round(clamp(msg.x, 0, CANVAS_W - 1)), y: Math.round(clamp(msg.y, 0, CANVAS_H - 1)), c: /^#[0-9a-f]{6}$/i.test(msg.c) ? msg.c : '#000000' };
        this.strokes.push(f);
        this.ctx.fx('fill', f, { except: pid });
        break;
      }
      case 'undo': {
        if (pid !== this.drawer || this.phase !== 'drawing') return;
        const last = this.strokes.pop();
        if (last?.id) this.strokeIdx.delete(last.id);
        this.ctx.fx('strokes', { list: this.strokes, turn: this.turn }, { except: pid });
        break;
      }
      case 'clear':
        if (pid !== this.drawer || this.phase !== 'drawing') return;
        this.strokes = [];
        this.strokeIdx.clear();
        this.ctx.fx('clear', { turn: this.turn }, { except: pid });
        break;
    }
  }

  onConnectionChange(pid, connected) {
    if (!connected && this.phase !== 'results') {
      if (pid === this.drawer && (this.phase === 'choosing' || this.phase === 'drawing')) return this.endTurn();
      if (this.phase === 'drawing' && this.guessers().length && this.guessers().every((id) => this.guessed.has(id))) return this.endTurn();
    }
    this.update();
  }

  // ------------------------------------------------------------ vue
  pattern() {
    return [...this.word].map((c, i) => (/[\p{L}\p{N}]/u.test(c) ? (this.revealed.has(i) ? c : '_') : c));
  }

  view(pid) {
    const v = {
      phase: this.phase, turn: this.turn, totalTurns: this.queue.length, drawerId: this.drawer,
      drawTime: this.drawTime, endsAt: this.endsAt, raw: this.raw, canvas: [CANVAS_W, CANVAS_H],
      guessed: [...this.guessed.keys()], deltas: this.deltas,
    };
    const isDrawer = pid === this.drawer;
    const knows = isDrawer || this.guessed.has(pid);
    if (this.phase === 'choosing' && isDrawer) v.choices = this.choices;
    if (this.phase === 'drawing') {
      if (knows) v.word = this.word; else v.pattern = this.pattern();
      v.wordLength = this.word.length;
    }
    if (this.phase === 'turnEnd') v.word = this.word;
    const open = this.phase !== 'drawing';
    v.chat = this.chat.filter((m) => m.scope === 'all'
      || (m.scope === 'found' && (knows || open))
      || (m.scope === 'to' && m.to === pid));
    return v;
  }
}

module.exports = Skribbl;
