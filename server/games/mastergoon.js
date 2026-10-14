'use strict';
/**
 * Mastergoon — port fidèle de ton projet « Ne dis pas la même chose que moi » :
 *  - le maître du jeu (le « Mastergoon ») répond en secret, les autres répondent aussi mais ne doivent PAS dire la même chose
 *  - il juge en direct (Différent / Pareil / Invalide), les joueurs peuvent contester (majorité = décision renversée)
 *  - ceux qui disent pareil sont éliminés, les survivants gagnent +1 point par question
 *  - les questions se resserrent (niveau 1 → 5), jusqu'à ce que tout le monde soit éliminé ou que le max soit atteint
 *  - joker : un éliminé peut revenir en disant EXACTEMENT la même chose que le Mastergoon
 */
const Game = require('./base');
const { norm, clamp } = require('../util');
const { QUESTIONS } = require('../../data/mastergoon/questions');

const INTRO_TIME = 4_000;
const JUDGING_TIMEOUT = 120_000;
const TURN_END_TIME = 9_000;
const MAX_ANSWER = 40;

function normalize(s) {
  return norm(s).replace(/^(le|la|les|l|un|une|des|du|de|d) /, '').replace(/s$/, '');
}
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER);

const MASTER_START = 10; // le maître démarre à 10 pts, -1 à chaque question où personne n'est éliminé

class Mastergoon extends Game {
  constructor(ctx, options) {
    super(ctx, options);
    this.answerTime = [10, 15, 20, 30].includes(Number(options.answerTime)) ? Number(options.answerTime) : 20;
    this.maxQuestions = [5, 8, 10, 15].includes(Number(options.maxQuestions)) ? Number(options.maxQuestions) : 8;
    this.jokerEnabled = options.joker !== false;
    this.used = (ctx.memory.mastergoonUsed ||= new Set());
    this.players = this.ids.filter((id) => id !== this.masterId);
    this.alive = Object.fromEntries(this.players.map((id) => [id, true]));
    this.raw = Object.fromEntries(this.ids.map((id) => [id, id === this.masterId ? MASTER_START : 0]));
    this.qIndex = 0;
    this.phase = 'intro';
    this.turnLog = [];
    this.stats = { revives: {} };
    this.resetQuestion();
    this.endsAt = null;
  }

  resetQuestion() {
    this.question = null;
    this.mgAnswer = null;
    this.mgFinal = false;
    this.fin = new Set();
    this.mgTimeout = false;
    this.answers = {};
    this.jokerAnswers = {};
    this.jokerPass = new Set();
    this.decisions = {};
    this.contests = {};
  }

  start() {
    this.endsAt = Date.now() + INTRO_TIME;
    this.after(INTRO_TIME, () => this.nextQuestion());
    this.update();
  }

  participants() { return this.players.filter((id) => this.alive[id]); }
  jokerEligible() { return this.jokerEnabled ? this.players.filter((id) => !this.alive[id]) : []; }

  pickQuestion() {
    let fresh = QUESTIONS.filter((q) => !this.used.has(q.id));
    if (!fresh.length) { this.used.clear(); fresh = QUESTIONS; }
    const target = Math.min(5, 1 + Math.floor((this.qIndex * 5) / this.maxQuestions));
    for (let d = 0; d <= 4; d++) {
      const cands = fresh.filter((q) => Math.abs(q.level - target) === d);
      const up = cands.filter((q) => q.level >= target);
      const from = up.length ? up : cands;
      if (from.length) {
        const q = from[Math.floor(Math.random() * from.length)];
        this.used.add(q.id);
        return q;
      }
    }
    return null;
  }

  nextQuestion() {
    this.cancel(this.timer);
    if (!this.connected(this.masterId) || this.qIndex >= this.maxQuestions || !this.participants().length) return this.endTurn();
    const q = this.pickQuestion();
    if (!q) return this.endTurn();
    this.resetQuestion();
    this.question = q;
    this.phase = 'answering';
    this.endsAt = Date.now() + this.answerTime * 1000;
    this.timer = this.after(this.answerTime * 1000 + 400, () => this.closeAnswers());
    this.update();
  }

  // ---------------------------------------------------------------- réponses
  submit(pid, text, useJoker, draft = false) {
    if (this.phase !== 'answering') return;
    const t = clean(text);
    if (!t) return;
    if (pid === this.masterId) { this.mgAnswer = t; this.mgFinal = !draft; }
    else if (this.alive[pid]) { this.answers[pid] = t; if (draft) this.fin.delete(pid); else this.fin.add(pid); }
    else if (useJoker && (this.jokerEligible().includes(pid) || this.jokerAnswers[pid])) {
      this.jokerAnswers[pid] = t;
      if (draft) this.fin.delete(pid); else this.fin.add(pid);
      this.jokerPass.delete(pid);
    } else return;
    this.checkAllIn();
    this.update();
  }

  checkAllIn() {
    if (this.phase !== 'answering') return;
    if (!this.mgFinal && this.connected(this.masterId)) return;
    if (this.participants().some((id) => this.connected(id) && !this.fin.has(id))) return;
    if (this.jokerEligible().some((id) => this.connected(id) && !this.jokerPass.has(id) && !this.fin.has(id))) return;
    this.cancel(this.timer);
    this.timer = this.after(600, () => this.closeAnswers());
  }

  sameAsMg(text) { return normalize(text) === normalize(this.mgAnswer); }

  closeAnswers() {
    if (this.phase !== 'answering') return;
    this.cancel(this.timer);
    if (!this.mgAnswer) {
      // le Mastergoon n'a pas répondu : question annulée
      this.mgTimeout = true;
      this.phase = 'reveal';
      this.endsAt = Date.now() + 8_000;
      this.timer = this.after(8_000, () => this.advance(true));
      return this.update();
    }
    this.decisions = {};
    for (const id of this.participants()) {
      const a = this.answers[id];
      if (!a) this.decisions[id] = { verdict: 'out', reason: 'timeout', locked: true };
      else this.decisions[id] = this.sameAsMg(a) ? { verdict: 'out', reason: 'same' } : { verdict: 'survive', reason: null };
    }
    for (const [id, a] of Object.entries(this.jokerAnswers)) {
      this.decisions[id] = { verdict: this.sameAsMg(a) ? 'revive' : 'fail', reason: null, joker: true };
    }
    this.phase = 'reveal';
    this.endsAt = Date.now() + JUDGING_TIMEOUT;
    this.timer = this.after(JUDGING_TIMEOUT, () => this.advance(true));
    this.update();
  }

  // ---------------------------------------------------------------- jugement
  eligibleVoters(target) {
    return this.players.filter((id) => this.connected(id) && id !== target);
  }
  isFlipped(target) {
    const set = this.contests[target];
    if (!set || !set.size) return false;
    const n = this.eligibleVoters(target).length;
    return n > 0 && set.size > n / 2;
  }
  finalVerdict(pid) {
    const d = this.decisions[pid];
    if (!d) return null;
    return this.isFlipped(pid) ? { survive: 'out', out: 'survive', revive: 'fail', fail: 'revive' }[d.verdict] : d.verdict;
  }

  setDecision(by, pid, verdict) {
    if (this.phase !== 'reveal' || this.mgTimeout || by !== this.masterId) return;
    const d = this.decisions[pid];
    if (!d || d.locked) return;
    delete this.contests[pid]; // la décision change : les contestations repartent de zéro
    if (d.joker) {
      if (!['revive', 'fail'].includes(verdict)) return;
      this.decisions[pid] = { ...d, verdict };
    } else if (verdict === 'survive') this.decisions[pid] = { verdict: 'survive', reason: null };
    else if (verdict === 'invalid') this.decisions[pid] = { verdict: 'out', reason: 'invalid' };
    else if (verdict === 'out') this.decisions[pid] = { verdict: 'out', reason: 'same' };
    this.update();
  }

  toggleContest(voter, target) {
    if (this.phase !== 'reveal' || this.mgTimeout) return;
    const d = this.decisions[target];
    if (!d || d.locked || voter === this.masterId || !this.eligibleVoters(target).includes(voter)) return;
    const set = (this.contests[target] ||= new Set());
    set.has(voter) ? set.delete(voter) : set.add(voter);
    this.update();
  }

  advance(auto = false) {
    if (this.phase !== 'reveal') return;
    this.cancel(this.timer);
    this.applyResults();
    if (!this.participants().length) return this.endTurn();
    this.qIndex++;
    this.nextQuestion();
  }

  applyResults() {
    const entry = { text: this.question?.text ?? '', level: this.question?.level ?? 0, mgAnswer: this.mgAnswer, mgTimeout: this.mgTimeout, rows: [] };
    if (!this.mgTimeout) {
      for (const [id, d] of Object.entries(this.decisions)) {
        const v = this.finalVerdict(id);
        const row = { pid: id, text: d.joker ? this.jokerAnswers[id] : this.answers[id] ?? null, verdict: v, reason: d.reason, joker: !!d.joker, flipped: this.isFlipped(id), points: 0 };
        if (d.joker) {
          if (v === 'revive') { this.alive[id] = true; this.stats.revives[id] = (this.stats.revives[id] || 0) + 1; }
        } else if (v === 'survive') {
          this.raw[id] += 1; row.points = 1;
        } else this.alive[id] = false;
        entry.rows.push(row);
      }
      // le maître perd 1 point si personne n'a été éliminé à cette question
      const duel = entry.rows.filter((r) => !r.joker);
      const someoneOut = duel.some((r) => r.verdict === 'out');
      entry.mgDelta = 0;
      if (duel.length && !someoneOut && this.raw[this.masterId] > 0) { this.raw[this.masterId] -= 1; entry.mgDelta = -1; }
    }
    this.turnLog.push(entry);
  }

  endTurn() {
    this.cancel(this.timer);
    this.phase = 'turnEnd';
    this.resetQuestion();
    this.endsAt = Date.now() + TURN_END_TIME;
    this.update();
    this.after(TURN_END_TIME, () => this.ctx.finish({
      scores: this.raw,
      notes: [`${this.name(this.masterId)} était le Mastergoon : ${this.turnLog.filter((q) => !q.mgTimeout).length} question(s) posée(s).`],
    }));
  }

  // ---------------------------------------------------------------- actions
  onAction(pid, msg) {
    switch (msg.type) {
      case 'answer': this.submit(pid, msg.text, false, !!msg.draft); break;
      case 'joker': this.submit(pid, msg.text, true, !!msg.draft); break;
      case 'jokerPass':
        if (this.phase === 'answering' && this.jokerEligible().includes(pid)) { this.jokerPass.add(pid); this.checkAllIn(); this.update(); }
        break;
      case 'decide': this.setDecision(pid, String(msg.pid), String(msg.verdict)); break;
      case 'contest': this.toggleContest(pid, String(msg.pid)); break;
      case 'next': if (pid === this.masterId) this.advance(); break;
    }
  }

  onConnectionChange(pid, connected) {
    if (!connected) {
      if (pid === this.masterId && this.phase !== 'turnEnd') return this.endTurn();
      this.checkAllIn();
    }
    this.update();
  }

  // ---------------------------------------------------------------- vue
  view(pid) {
    const isMg = pid === this.masterId;
    const v = {
      phase: this.phase, endsAt: this.endsAt, masterId: this.masterId, qIndex: this.qIndex, maxQuestions: this.maxQuestions,
      raw: this.raw, alive: this.alive, jokerEnabled: this.jokerEnabled, players: this.players,
    };
    if (this.question && (this.phase === 'answering' || this.phase === 'reveal')) {
      v.question = { text: this.question.text, level: this.question.level, choices: this.question.choices };
    }
    if (this.phase === 'answering') {
      v.answered = [
        ...this.fin, ...(this.mgFinal ? [this.masterId] : []),
      ];
      v.mineFinal = isMg ? this.mgFinal : this.fin.has(pid);
      v.mine = isMg ? this.mgAnswer : (this.answers[pid] ?? this.jokerAnswers[pid] ?? null);
      v.canJoker = this.jokerEligible().includes(pid) || !!this.jokerAnswers[pid];
      v.jokerActive = !!this.jokerAnswers[pid];
      v.jokerPassed = this.jokerPass.has(pid);
    }
    if (this.phase === 'reveal') {
      v.mgAnswer = this.mgAnswer;
      v.mgTimeout = this.mgTimeout;
      v.entries = Object.entries(this.decisions).map(([id, d]) => {
        const set = this.contests[id];
        return {
          pid: id, text: d.joker ? this.jokerAnswers[id] : (this.answers[id] ?? null), verdict: d.verdict, finalVerdict: this.finalVerdict(id),
          reason: d.reason, joker: !!d.joker, locked: !!d.locked, contests: set ? set.size : 0, eligible: this.eligibleVoters(id).length,
          youContested: !!(set && set.has(pid)), canContest: !d.locked && !isMg && this.eligibleVoters(id).includes(pid), flipped: this.isFlipped(id),
        };
      });
    }
    if (this.phase === 'turnEnd') v.log = this.turnLog;
    return v;
  }
}

module.exports = Mastergoon;
