'use strict';
/**
 * L'Imposteur — port fidèle de ton projet « jeu-imposteur » :
 *  - les citoyens ont un mot, les imposteurs un mot proche (sans savoir qu'ils sont imposteurs), M. White n'a rien
 *  - tour d'indices dans un ordre aléatoire → phase de décision (voter / refaire un tour) → vote → élimination
 *  - bouton « forcer le vote » après le 1er tour, dernière chance de M. White, victoire par élimination ou majorité numérique
 *  - points : citoyens +2, imposteurs +3, M. White +4 (s'il trouve le mot)
 */
const Game = require('./base');
const { shuffle, pick, sanitize, isMatch, randInt } = require('../util');
const WORDS = require('../../data/imposteur/words');

const INTRO_TIME = 7_000;
const DECISION_TIME = 30_000;
const VOTE_RESULT_TIME = 8_000;
const WHITE_GUESS_TIME = 30_000;
const DISCONNECTED_TURN = 15_000;
const RESULTS_TIME = 14_000;

class Imposteur extends Game {
  constructor(ctx, options) {
    super(ctx, options);
    this.turnTime = [30, 45, 60, 90].includes(Number(options.turnTime)) ? Number(options.turnTime) : 45;
    this.voteTime = [60, 90, 120].includes(Number(options.voteTime)) ? Number(options.voteTime) : 90;
    const n = this.ids.length;

    // --- mots
    this.used = (ctx.memory.imposteurUsed ||= new Set());
    const entries = [];
    Object.entries(WORDS).forEach(([cat, c]) => c.pairs.forEach((p, i) => entries.push({ key: `${cat}:${i}`, a: p[0], b: p[1] })));
    let fresh = entries.filter((e) => !this.used.has(e.key));
    if (!fresh.length) { this.used.clear(); fresh = entries; }
    const e = pick(fresh);
    this.used.add(e.key);
    this.pair = randInt(2) === 0 ? { normal: e.a, imposteur: e.b } : { normal: e.b, imposteur: e.a };

    // --- rôles (les imposteurs tirés moins souvent s'ils l'ont déjà été dans ce salon)
    const times = (ctx.memory.imposteurTimes ||= {});
    const maxImp = Math.max(1, Math.floor((n - 1) / 2));
    const wanted = options.impostors === 'auto' || options.impostors == null ? (n >= 6 ? 2 : 1) : Number(options.impostors);
    const count = Math.min(wanted, maxImp);
    const pool = [...this.ids];
    this.impostorIds = [];
    for (let k = 0; k < count; k++) {
      const w = pool.map((id) => 1 / (1 + (times[id] || 0)) ** 2);
      let r = (randInt(1_000_000) / 1_000_000) * w.reduce((a, b) => a + b, 0);
      let i = 0;
      while (i < pool.length - 1 && r >= w[i]) { r -= w[i]; i++; }
      this.impostorIds.push(pool[i]);
      times[pool[i]] = (times[pool[i]] || 0) + 1;
      pool.splice(i, 1);
    }
    this.whiteId = null;
    if (options.mrWhite !== false && n >= 5 && pool.length) this.whiteId = pick(pool);

    this.order = shuffle(this.ids);
    this.alive = new Set(this.ids);
    this.log = [];
    this.clueRound = 1;
    this.roundCount = 0;
    this.phase = 'intro';
    this.decisionVotes = {};
    this.votes = {};
    this.emergency = new Set();
    this.banner = null;
    this.lastVote = null;
    this.result = null;
    this.endsAt = null;
    this.current = null;
    this.turnPos = -1;
  }

  roleOf(pid) {
    if (this.impostorIds.includes(pid)) return 'impostor';
    if (pid === this.whiteId) return 'white';
    return 'citizen';
  }
  wordFor(pid) {
    const r = this.roleOf(pid);
    return r === 'impostor' ? this.pair.imposteur : r === 'white' ? '???' : this.pair.normal;
  }
  alivePlayers() { return this.order.filter((id) => this.alive.has(id)); }
  threshold() { return Math.floor(this.alive.size / 2) + 1; }
  voters() { return this.alivePlayers().filter((id) => this.connected(id)); }

  start() {
    this.endsAt = Date.now() + INTRO_TIME;
    this.timer = this.after(INTRO_TIME, () => this.startClues());
    this.update();
  }

  // ---------------------------------------------------------------- indices
  startClues() {
    this.phase = 'clues';
    this.turnPos = -1;
    this.advanceTurn();
  }

  advanceTurn() {
    do { this.turnPos++; } while (this.turnPos < this.order.length && !this.alive.has(this.order[this.turnPos]));
    if (this.turnPos >= this.order.length) return this.startDecision();
    this.current = this.order[this.turnPos];
    this.armTurnTimer();
    this.update();
  }

  armTurnTimer() {
    this.cancel(this.turnTimer);
    const ms = this.connected(this.current) ? this.turnTime * 1000 : Math.min(this.turnTime * 1000, DISCONNECTED_TURN);
    this.endsAt = Date.now() + ms;
    const who = this.current;
    this.clueDraft = '';
    this.turnTimer = this.after(ms, () => { if (this.phase === 'clues' && this.current === who) this.submitClue(who, this.clueDraft || '...'); });
  }

  submitClue(pid, raw) {
    if (this.phase !== 'clues' || pid !== this.current) return;
    this.cancel(this.turnTimer);
    const word = sanitize(raw, 20) || '...';
    this.log.push({ round: this.clueRound, pid, word, timedOut: word === '...' });
    this.advanceTurn();
  }

  // ---------------------------------------------------------------- décision
  startDecision() {
    this.phase = 'decision';
    this.decisionVotes = {};
    this.roundCount++;
    this.current = null;
    this.endsAt = Date.now() + DECISION_TIME;
    this.cancel(this.timer);
    this.timer = this.after(DECISION_TIME, () => this.resolveDecision());
    this.update();
  }

  resolveDecision() {
    if (this.phase !== 'decision') return;
    this.cancel(this.timer);
    const vals = Object.values(this.decisionVotes);
    const kick = vals.filter((v) => v === 'vote').length;
    const cycle = vals.filter((v) => v === 'cycle').length;
    if (kick > cycle) this.startVoting();
    else this.newCycle("La majorité veut refaire un tour d'indices !");
  }

  newCycle(message) {
    this.cancel(this.timer); this.cancel(this.turnTimer);
    this.votes = {}; this.decisionVotes = {}; this.emergency = new Set();
    this.clueRound++;
    this.banner = message;
    this.startClues();
  }

  // ---------------------------------------------------------------- vote
  startVoting() {
    this.cancel(this.turnTimer); this.cancel(this.timer);
    this.phase = 'voting';
    this.votes = {};
    this.current = null;
    this.endsAt = Date.now() + this.voteTime * 1000;
    this.timer = this.after(this.voteTime * 1000, () => this.finishVote());
    this.update();
  }

  allVoted(map) {
    const v = this.voters();
    return v.length > 0 && v.every((id) => map[id] !== undefined);
  }

  finishVote() {
    if (this.phase !== 'voting') return;
    this.cancel(this.timer);
    const tally = {};
    for (const t of Object.values(this.votes)) tally[t] = (tally[t] || 0) + 1;
    const counts = Object.entries(tally).map(([pid, count]) => ({ pid, count })).sort((a, b) => b.count - a.count);
    const max = counts[0]?.count ?? 0;
    const top = counts.filter((c) => c.count === max);
    const tie = counts.length > 0 && top.length > 1;
    const eliminated = counts.length > 0 && !tie ? top[0].pid : null;
    this.lastVote = {
      votes: Object.entries(this.votes).map(([voter, target]) => ({ voter, target })),
      counts, tie, noVotes: counts.length === 0,
      eliminated: eliminated ? { pid: eliminated, role: this.roleOf(eliminated) } : null,
    };
    this.phase = 'voteResult';
    const dur = eliminated ? VOTE_RESULT_TIME : 5_000;
    this.endsAt = Date.now() + dur;
    this.timer = this.after(dur, () => this.afterVote(eliminated));
    this.update();
  }

  afterVote(target) {
    if (!target) return this.newCycle("Égalité ou aucun vote ! Personne n'est éliminé.");
    this.alive.delete(target);
    if (target === this.whiteId) {
      this.phase = 'whiteGuess';
      this.endsAt = Date.now() + WHITE_GUESS_TIME;
      this.whiteDraft = '';
      this.timer = this.after(WHITE_GUESS_TIME, () => this.whiteTimeout(target));
      this.update();
      return;
    }
    this.afterElimination(target);
  }

  whiteTimeout(pid) {
    if (this.phase !== 'whiteGuess') return;
    const guess = sanitize(this.whiteDraft || '', 40);
    if (guess && isMatch(guess, [this.pair.normal], { fuzzy: false })) { this.cancel(this.timer); return this.end('white', 'M. WHITE A TROUVÉ LE MOT ! 😱 Il vole la victoire !', pid); }
    this.whiteFailed(pid, guess);
  }

  whiteFailed(pid, guess) {
    if (this.phase !== 'whiteGuess') return;
    this.cancel(this.timer);
    this.banner = guess ? `M. White a proposé « ${guess} »… et c'est raté !` : "M. White n'a pas trouvé le mot (temps écoulé) !";
    this.afterElimination(pid);
  }

  checkWin() {
    const imps = this.impostorIds.filter((id) => this.alive.has(id)).length;
    const others = [...this.alive].filter((id) => !this.impostorIds.includes(id)).length;
    if (imps === 0) return 'citizens';
    if (imps >= others) return 'impostors';
    return null;
  }

  afterElimination(pid) {
    const name = this.name(pid);
    const winner = this.checkWin();
    if (winner === 'citizens') return this.end('citizens', 'VICTOIRE DES CITOYENS ! Tous les imposteurs sont éliminés.', pid);
    if (winner === 'impostors') return this.end('impostors', 'LES IMPOSTEURS ONT GAGNÉ ! (majorité numérique)', pid);
    if (this.impostorIds.includes(pid)) return this.newCycle(`🔥 BRAVO ! ${name} était un IMPOSTEUR ! Mais attention, il n'est pas seul…`);
    if (pid === this.whiteId) return this.newCycle(`⚠️ C'ÉTAIT M. WHITE ! (${name} éliminé). Les imposteurs sont toujours là…`);
    this.newCycle(`${name} a été éliminé… C'était un citoyen !`);
  }

  // ---------------------------------------------------------------- fin
  end(winner, message, lastPid) {
    this.cancel(this.timer); this.cancel(this.turnTimer);
    const delta = {};
    for (const id of this.ids) {
      const role = this.roleOf(id);
      delta[id] = (winner === 'citizens' && role === 'citizen') ? 2
        : (winner === 'impostors' && role === 'impostor') ? 3
          : (winner === 'white' && role === 'white') ? 4 : 0;
    }
    this.result = {
      winner, message, lastName: lastPid ? this.name(lastPid) : null, delta,
      roles: this.ids.map((id) => ({ pid: id, role: this.roleOf(id), word: this.wordFor(id), alive: this.alive.has(id) })),
      pair: this.pair,
    };
    this.phase = 'result';
    this.current = null;
    this.endsAt = Date.now() + RESULTS_TIME;
    this.update();
    this.after(RESULTS_TIME, () => this.ctx.finish({
      scores: delta,
      notes: [`Mots : « ${this.pair.normal} » (citoyens) / « ${this.pair.imposteur} » (imposteurs)`],
    }));
  }

  // ---------------------------------------------------------------- actions
  onAction(pid, msg) {
    const isAlive = this.alive.has(pid);
    switch (msg.type) {
      case 'clue':
        if (msg.draft) { if (this.phase === 'clues' && pid === this.current) this.clueDraft = sanitize(msg.text, 20); }
        else this.submitClue(pid, msg.text);
        break;
      case 'decision':
        if (this.phase !== 'decision' || !isAlive) return;
        if (msg.choice !== 'vote' && msg.choice !== 'cycle') return;
        this.decisionVotes[pid] = msg.choice;
        if (this.allVoted(this.decisionVotes)) this.resolveDecision(); else this.update();
        break;
      case 'emergency':
        if (this.phase !== 'clues' || this.roundCount < 1 || !isAlive) return;
        this.emergency.add(pid);
        if (this.emergency.size >= this.threshold()) this.startVoting(); else this.update();
        break;
      case 'vote': {
        if (this.phase !== 'voting' || !isAlive) return;
        const t = String(msg.target);
        if (t === pid || !this.alive.has(t)) return;
        this.votes[pid] = t;
        if (this.allVoted(this.votes)) this.finishVote(); else this.update();
        break;
      }
      case 'whiteGuess': {
        if (this.phase !== 'whiteGuess' || pid !== this.whiteId) return;
        const guess = sanitize(msg.text, 40);
        if (msg.draft) { this.whiteDraft = guess; return; }
        if (!guess) return;
        this.cancel(this.timer);
        if (isMatch(guess, [this.pair.normal], { fuzzy: false })) this.end('white', 'M. WHITE A TROUVÉ LE MOT ! 😱 Il vole la victoire !', pid);
        else this.whiteFailed(pid, guess);
        break;
      }
    }
  }

  onConnectionChange(pid, connected) {
    if (!connected) {
      if (this.phase === 'clues' && pid === this.current) {
        // un joueur absent n'a que 15 s pour son indice
        if (this.endsAt - Date.now() > DISCONNECTED_TURN) this.armTurnTimer();
      } else if (this.phase === 'decision' && this.allVoted(this.decisionVotes)) this.resolveDecision();
      else if (this.phase === 'voting' && this.allVoted(this.votes)) this.finishVote();
      else if (this.phase === 'whiteGuess' && pid === this.whiteId) this.whiteFailed(pid, '');
    }
    this.update();
  }

  // ---------------------------------------------------------------- vue
  view(pid) {
    const inGame = this.has(pid);
    const v = {
      phase: this.phase, endsAt: this.endsAt, clueRound: this.clueRound, order: this.order,
      alive: [...this.alive], log: this.log, banner: this.banner,
      turnTime: this.turnTime, voteTime: this.voteTime,
      me: inGame ? { alive: this.alive.has(pid), word: this.wordFor(pid), isWhite: pid === this.whiteId } : null,
    };
    if (this.phase === 'clues') {
      v.current = this.current;
      v.emergency = this.roundCount > 0 ? { count: this.emergency.size, required: this.threshold(), clicked: this.emergency.has(pid) } : null;
    }
    if (this.phase === 'decision') {
      v.answered = this.decisionVotes[pid] !== undefined;
      v.decisionCount = Object.keys(this.decisionVotes).length;
    }
    if (this.phase === 'voting') {
      v.voted = this.votes[pid] ?? null;
      v.progress = { done: this.voters().filter((id) => this.votes[id] !== undefined).length, total: this.voters().length };
    }
    if (this.phase === 'voteResult') v.vote = this.lastVote;
    if (this.phase === 'whiteGuess') v.whiteId = this.whiteId;
    if (this.phase === 'result') v.result = this.result;
    return v;
  }
}

module.exports = Imposteur;
