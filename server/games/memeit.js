'use strict';
// Make It Meme : chacun reçoit une image de meme et écrit la légende la plus drôle, puis tout le monde vote.
// Règles reprises de makeitmeme.com : 3 manches par défaut, 90 s pour légender, vote 👍 / meh / 👎 sur chaque meme,
// un meme vaut 1000 pts si tout le monde le plébiscite (les 👎 retirent des points, un meme peut être négatif),
// un « Meme Buddy » par manche (la moitié des points du meme choisi pour toi, +10 pts pour le meme).
const Game = require('./base');
const { shuffle, clamp, sample } = require('../util');
const TEMPLATES = require('../../data/memes.json');

const INTRO_TIME = 4_000;
const MEME_RESULT_TIME = 3_500;
const ROUND_RESULT_TIME = 12_000;
const MAX_BOXES = 6;
const FULL_SCORE = 1000;

const TOPICS = [
  'Le lundi matin', 'La rentrée', 'Les profs', 'Être fauché', 'Le groupe WhatsApp', 'Les jeux vidéo', 'Le foot', 'Les réseaux sociaux',
  'Noël en famille', 'Les devoirs', 'La cantine', 'Le sommeil', 'Les régimes', 'Les relations', 'TikTok', 'Les vacances', 'Le travail',
  'L’amour', 'Les soirées', 'Le téléphone à 1 %', 'Le Wi-Fi qui rame', 'Les notifications', 'Les examens', 'Le week-end', 'Les amis',
];
const BAD = ['merde', 'putain', 'connard', 'connasse', 'salope', 'pute', 'encul\\w*', 'bite', 'con', 'fdp', 'nique\\w*', 'ntm', 'pd', 'fuck\\w*', 'shit\\w*', 'bitch\\w*', 'dick', 'cunt', 'asshole', 'nazi', 'viol\\w*'];
const BAD_RE = new RegExp(`(^|[^\\p{L}])(${BAD.join('|')})(?=$|[^\\p{L}])`, 'giu');

function cleanBoxes(input, family) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_BOXES).map((b) => {
    let t = String(b?.t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 90);
    if (family) t = t.replace(BAD_RE, (m, a) => `${a}${'*'.repeat(m.length - a.length)}`);
    return {
      t, x: clamp(Number(b?.x) || 50, 0, 100), y: clamp(Number(b?.y) || 50, 0, 100),
      s: clamp(Number(b?.s) || 7, 3, 16), c: b?.c === 'b' ? 'b' : 'w', w: clamp(Number(b?.w) || 60, 15, 100),
    };
  }).filter((b) => b.t);
}

class MemeIt extends Game {
  constructor(ctx, options) {
    super(ctx, options);
    this.totalRounds = [1, 2, 3, 5].includes(Number(options.rounds)) ? Number(options.rounds) : 3;
    this.captionTime = [30, 60, 90, 120].includes(Number(options.captionTime)) ? Number(options.captionTime) : 90;
    this.mode = ['normal', 'topics', 'same', 'relaxed'].includes(options.mode) ? options.mode : 'normal';
    this.family = options.family === true;
    this.maxRerolls = [0, 3, 5, 10].includes(Number(options.rerolls)) ? Number(options.rerolls) : 5;
    this.used = (ctx.memory.memeUsed ||= new Set());
    this.raw = Object.fromEntries(this.ids.map((id) => [id, 0]));
    this.round = -1;
    this.phase = 'starting';
    this.endsAt = null;
    this.best = []; // meilleurs memes de la partie
  }

  scoring() { return this.mode !== 'relaxed'; }
  start() { this.nextRound(); }

  // ---------------------------------------------------------------- manche
  drawTemplate(exclude = new Set()) {
    let pool = TEMPLATES.filter((t) => !this.used.has(t.id) && !exclude.has(t.id));
    if (pool.length < 1) { this.used.clear(); pool = TEMPLATES.filter((t) => !exclude.has(t.id)); }
    const t = sample(pool, 1)[0];
    this.used.add(t.id);
    return t;
  }

  nextRound() {
    this.round++;
    if (this.round >= this.totalRounds || this.connectedIds().length < 2) return this.end();
    this.players = this.connectedIds();
    this.topic = this.mode === 'topics' ? sample(TOPICS, 1)[0] : null;
    this.tpl = {};
    this.rerolled = {};
    this.drafts = {};
    this.ready = new Set();
    if (this.mode === 'same') { const t = this.drawTemplate(); for (const id of this.players) this.tpl[id] = t; }
    else { const taken = new Set(); for (const id of this.players) { const t = this.drawTemplate(taken); taken.add(t.id); this.tpl[id] = t; } }
    this.buddyUsed = new Set();
    this.phase = 'intro';
    this.endsAt = Date.now() + INTRO_TIME;
    this.update();
    this.after(INTRO_TIME, () => this.startCreating());
  }

  startCreating() {
    this.phase = 'creating';
    this.endsAt = Date.now() + this.captionTime * 1000;
    this.timer = this.after(this.captionTime * 1000, () => this.startVoting());
    this.update();
  }

  checkAllReady() {
    const present = this.players.filter((id) => this.connected(id));
    if (this.phase === 'creating' && present.length && present.every((id) => this.ready.has(id))) {
      this.cancel(this.timer);
      this.after(700, () => this.phase === 'creating' && this.startVoting());
    }
  }

  // ---------------------------------------------------------------- vote
  voteTime() { return clamp(6 + this.players.length * 0.6, 8, 16) * 1000; }

  startVoting() {
    if (this.phase !== 'creating') return;
    this.cancel(this.timer);
    this.memes = shuffle(this.players
      .filter((id) => (this.drafts[id] || []).length)
      .map((id) => ({ author: id, tpl: this.tpl[id], boxes: this.drafts[id], votes: {}, buddies: new Set() })));
    this.idx = -1;
    if (this.memes.length < 1) return this.roundResults();
    this.nextMeme();
  }

  voters(m) { return this.players.filter((id) => id !== m.author); }

  nextMeme() {
    this.idx++;
    if (this.idx >= this.memes.length) return this.roundResults();
    this.phase = 'voting';
    const dur = this.voteTime();
    this.endsAt = Date.now() + dur;
    const i = this.idx;
    this.cancel(this.timer);
    this.timer = this.after(dur, () => { if (this.idx === i && this.phase === 'voting') this.memeResult(); });
    this.update();
  }

  checkAllVoted() {
    const m = this.memes[this.idx];
    const eligible = this.voters(m).filter((id) => this.connected(id));
    if (eligible.length && eligible.every((id) => m.votes[id])) {
      const i = this.idx;
      this.cancel(this.timer);
      this.timer = this.after(1200, () => { if (this.idx === i && this.phase === 'voting') this.memeResult(); });
    }
  }

  memeScore(m) {
    const n = Math.max(1, this.voters(m).length);
    const vals = Object.values(m.votes);
    const up = vals.filter((v) => v === 'up').length, down = vals.filter((v) => v === 'down').length;
    const base = Math.round((FULL_SCORE * (up - down)) / n);
    const bonus = m.buddies.size * 10;
    return { up, down, meh: vals.length - up - down, base, bonus, total: base + bonus };
  }

  memeResult() {
    if (this.phase !== 'voting') return;
    this.cancel(this.timer);
    const m = this.memes[this.idx];
    m.result = this.memeScore(m);
    if (this.scoring()) {
      this.raw[m.author] += m.result.total;
      for (const g of m.buddies) this.raw[g] += Math.round(m.result.base / 2);
    }
    this.phase = 'memeResult';
    this.endsAt = Date.now() + MEME_RESULT_TIME;
    this.update();
    this.after(MEME_RESULT_TIME, () => this.nextMeme());
  }

  roundResults() {
    this.cancel(this.timer);
    this.phase = 'roundResults';
    this.endsAt = Date.now() + ROUND_RESULT_TIME;
    for (const m of this.memes || []) if (m.result) this.best.push({ author: m.author, tpl: m.tpl, boxes: m.boxes, total: m.result.total });
    this.best.sort((a, b) => b.total - a.total).splice(5);
    this.update();
    this.after(ROUND_RESULT_TIME, () => this.nextRound());
  }

  end() {
    this.phase = 'ended';
    this.ctx.finish({
      scores: this.raw,
      notes: [this.scoring() ? 'Chaque meme vaut jusqu’à 1000 points (👍 +, 👎 −), le Meme Buddy partage les points.' : 'Mode détente : pas de points pour cette manche.'],
    });
  }

  // ---------------------------------------------------------------- actions
  onAction(pid, msg) {
    switch (msg.type) {
      case 'draft': case 'submit': {
        if (this.phase !== 'creating' || !this.players.includes(pid)) return;
        this.drafts[pid] = cleanBoxes(msg.boxes, this.family);
        if (msg.type === 'submit') {
          if (!this.drafts[pid].length) return;
          this.ready.add(pid); this.update(); this.checkAllReady();
        }
        break;
      }
      case 'unsubmit': if (this.phase === 'creating') { this.ready.delete(pid); this.update(); } break;
      case 'reroll': {
        if (this.phase !== 'creating' || !this.players.includes(pid) || this.mode === 'same' || (this.rerolled[pid] || 0) >= this.maxRerolls || this.ready.has(pid)) return;
        this.rerolled[pid] = (this.rerolled[pid] || 0) + 1;
        this.tpl[pid] = this.drawTemplate(new Set(Object.values(this.tpl).map((t) => t.id)));
        this.update();
        break;
      }
      case 'vote': {
        if (this.phase !== 'voting') return;
        const m = this.memes[this.idx];
        if (!this.players.includes(pid) || pid === m.author || !['up', 'meh', 'down'].includes(msg.v)) return;
        m.votes[pid] = msg.v; this.update(); this.checkAllVoted();
        break;
      }
      case 'buddy': {
        if (this.phase !== 'voting') return;
        const m = this.memes[this.idx];
        if (!this.players.includes(pid) || pid === m.author) return;
        if (m.buddies.has(pid)) { m.buddies.delete(pid); this.buddyUsed.delete(pid); }
        else if (!this.buddyUsed.has(pid)) { m.buddies.add(pid); this.buddyUsed.add(pid); }
        this.update();
        break;
      }
    }
  }

  onConnectionChange(pid, connected) {
    if (!connected) { this.checkAllReady(); if (this.phase === 'voting') this.checkAllVoted(); }
    if (this.phase === 'creating' || this.phase === 'voting') this.update();
  }

  // ---------------------------------------------------------------- vue
  memeView(m, withAuthor) {
    const v = { src: `/memes/${m.tpl.file}`, w: m.tpl.w, h: m.tpl.h, boxes: m.boxes };
    if (withAuthor) v.author = m.author;
    return v;
  }

  view(pid) {
    const v = {
      phase: this.phase, endsAt: this.endsAt, round: this.round + 1, rounds: this.totalRounds, topic: this.topic ?? null,
      mode: this.mode, family: this.family, raw: this.raw, captionTime: this.captionTime,
    };
    const inRound = this.players?.includes(pid);
    if (this.phase === 'intro' || this.phase === 'creating') {
      v.myTpl = inRound && this.tpl[pid] ? { src: `/memes/${this.tpl[pid].file}`, w: this.tpl[pid].w, h: this.tpl[pid].h } : null;
      v.draft = this.drafts[pid] || [];
      v.ready = this.ready.has(pid);
      v.readyIds = [...this.ready];
      v.rerollsLeft = this.mode === 'same' ? 0 : Math.max(0, this.maxRerolls - (this.rerolled[pid] || 0));
      v.canReroll = v.rerollsLeft > 0 && !this.ready.has(pid);
    }
    if (this.phase === 'voting' || this.phase === 'memeResult') {
      const m = this.memes[this.idx];
      v.idx = this.idx; v.total = this.memes.length;
      v.meme = this.memeView(m, this.phase === 'memeResult' || m.author === pid);
      v.mine = m.author === pid;
      v.myVote = m.votes[pid] ?? null;
      v.voted = Object.keys(m.votes);
      v.eligible = this.voters(m).length;
      v.buddyUsed = this.buddyUsed.has(pid);
      v.buddyHere = m.buddies.has(pid);
      if (this.phase === 'memeResult') v.result = { ...m.result, buddies: [...m.buddies] };
    }
    if (this.phase === 'roundResults') {
      v.memes = (this.memes || []).filter((m) => m.result).map((m) => ({ ...this.memeView(m, true), result: { ...m.result, buddies: [...m.buddies] } }))
        .sort((a, b) => b.result.total - a.result.total);
      v.best = this.best.map((b) => ({ src: `/memes/${b.tpl.file}`, w: b.tpl.w, h: b.tpl.h, boxes: b.boxes, author: b.author, total: b.total }));
      v.last = this.round + 1 >= this.totalRounds;
    }
    return v;
  }
}

module.exports = MemeIt;
