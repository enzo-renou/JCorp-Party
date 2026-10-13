'use strict';
const { byKey, cleanOptions, defaultOptions, publicCatalog, CATALOG } = require('./games');
const U = require('./util');

const MAX_PLAYERS = 12;
const PICK_TIME = 45_000;
const ROUND_END_TIME = 15_000;
const LOBBY_GRACE = 30_000;
const HOST_TRANSFER = 10_000;
const MAX_SPECTATORS = 12;

class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.players = new Map();   // id -> player
    this.order = [];            // ordre des maîtres du jeu (ids)
    this.hostId = null;
    this.phase = 'lobby';       // lobby | pick | game | roundEnd | final
    this.settings = { rounds: 5 };
    this.roundIndex = 0;
    this.masterId = null;
    this.game = null;
    this.gameKey = null;
    this.roundResult = null;
    this.history = [];          // [{round, gameKey, masterId}]
    this.memory = {};           // mémoire des jeux (questions déjà posées…)
    this.deadline = null;
    this.timer = null;
    this.lastActivity = Date.now();
    this.banned = new Set();    // pseudos exclus par l'hôte
    this.resume = false;        // salon restauré après un redémarrage du serveur
    this._u = null;
  }

  // ---------------------------------------------------------------- joueurs
  touch() { this.lastActivity = Date.now(); }
  get(id) { return this.players.get(id); }
  present() { return [...this.players.values()].filter((p) => !p.gone); }
  connectedIds() { return this.present().filter((p) => p.connected && !p.spectator).map((p) => p.id); }
  anyPlayerPresent() { return this.present().some((p) => !p.spectator); }
  anyConnected() { return this.present().some((p) => p.connected); }

  addPlayer(name, avatar, spectator = false) {
    const base = U.sanitize(name, 14) || 'Joueur';
    if (this.banned.has(base.toLowerCase())) return { error: 'Tu as été exclu de cette partie.' };
    if (spectator) {
      if (this.present().filter((p) => p.spectator).length >= MAX_SPECTATORS) return { error: 'Trop de spectateurs dans ce salon.' };
    } else if (this.present().filter((p) => !p.spectator).length >= MAX_PLAYERS) return { error: `La salle est pleine (${MAX_PLAYERS} joueurs max).` };
    let finalName = base;
    let n = 2;
    while (this.present().some((p) => p.name.toLowerCase() === finalName.toLowerCase())) finalName = `${base} ${n++}`;
    const p = {
      id: U.uid(4), token: U.uid(16), name: finalName, avatar: U.sanitizeAvatar(avatar),
      socketId: null, connected: false, gone: false, spectator: !!spectator, score: 0, graceTimer: null, hostTimer: null,
    };
    this.players.set(p.id, p);
    if (!spectator) this.order.push(p.id);
    if (!this.hostId && !spectator) this.hostId = p.id;
    this.touch();
    return { player: p };
  }

  attach(pid, socketId) {
    const p = this.get(pid);
    if (!p || p.gone) return;
    p.socketId = socketId;
    p.connected = true;
    clearTimeout(p.graceTimer);
    clearTimeout(p.hostTimer);
    this.touch();
    if (this.resume && !p.spectator) this.resumeAfterRestart();
    this.game?.onConnectionChange(pid, true);
    this.update();
  }

  detach(pid, socketId) {
    const p = this.get(pid);
    if (!p || p.socketId !== socketId) return;
    p.connected = false;
    p.socketId = null;
    this.touch();
    if (this.phase === 'lobby') {
      p.graceTimer = setTimeout(() => { if (!p.connected) this.remove(pid); }, U.ms(LOBBY_GRACE));
    }
    if (pid === this.hostId) {
      p.hostTimer = setTimeout(() => { if (!p.connected && this.hostId === pid) { this.ensureHost(true); this.update(); } }, U.ms(HOST_TRANSFER));
    }
    this.game?.onConnectionChange(pid, false);
    // maître absent pendant le choix : on ne fait pas attendre tout le monde
    if (this.phase === 'pick' && pid === this.masterId) this.setTimer(8_000, () => this.autoPick());
    this.update();
  }

  /** retire (lobby) ou marque comme parti (en cours de partie) */
  remove(pid) {
    const p = this.get(pid);
    if (!p) return;
    clearTimeout(p.graceTimer);
    clearTimeout(p.hostTimer);
    p.connected = false;
    p.socketId = null;
    if (this.phase === 'lobby') {
      this.players.delete(pid);
      this.order = this.order.filter((x) => x !== pid);
    } else {
      p.gone = true;
    }
    if (this.hostId === pid) { this.hostId = null; this.ensureHost(); }
    this.game?.onConnectionChange(pid, false);
    if (this.phase === 'pick' && pid === this.masterId) this.setTimer(3_000, () => this.autoPick());
    this.update();
  }

  ensureHost(forceOther = false) {
    const cur = this.get(this.hostId);
    if (cur && !cur.gone && (!forceOther || cur.connected)) return;
    const ok = this.present().filter((p) => !p.spectator);
    const next = ok.find((p) => p.connected && p.id !== this.hostId) || ok.find((p) => p.connected);
    if (next) this.hostId = next.id;
  }

  // ---------------------------------------------------------------- minuteur
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    ms = U.ms(ms);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => { this.timer = null; try { fn(); } catch (e) { console.error('[room timer]', e); } }, ms);
  }
  clearTimer() { clearTimeout(this.timer); this.timer = null; this.deadline = null; }

  // ---------------------------------------------------------------- partie
  setRounds(pid, n) {
    if (pid !== this.hostId || this.phase !== 'lobby') return;
    this.settings.rounds = U.clamp(Math.round(n), 1, 30);
    this.update();
  }

  start(pid) {
    if (pid !== this.hostId || this.phase !== 'lobby') return { error: 'Seul l’hôte peut lancer la partie.' };
    if (this.connectedIds().length < 2) return { error: 'Il faut au moins 2 joueurs connectés.' };
    for (const p of this.players.values()) p.score = 0;
    this.order = U.shuffle(this.present().filter((p) => !p.spectator).map((p) => p.id));
    this.roundIndex = 0;
    this.history = [];
    this.memory = {};
    this.beginRound();
    return {};
  }

  chooseMaster() {
    const n = this.order.length;
    for (let k = 0; k < n; k++) {
      const id = this.order[(this.roundIndex + k) % n];
      const p = this.get(id);
      if (p && !p.gone && p.connected) return id;
    }
    return null;
  }

  beginRound() {
    this.masterId = this.chooseMaster();
    this.roundResult = null;
    this.game = null;
    this.gameKey = null;
    this.phase = 'pick';
    this.setTimer(PICK_TIME, () => this.autoPick());
    this.touch();
    this.update();
  }

  availability() {
    const n = this.connectedIds().length;
    return CATALOG.filter((g) => n >= g.minPlayers).map((g) => g.key);
  }

  autoPick() {
    if (this.phase !== 'pick') return;
    const ok = this.availability();
    if (!ok.length) { this.setTimer(15_000, () => this.autoPick()); this.update(); return; }
    const key = U.pick(ok);
    this.launch(key, defaultOptions(key));
  }

  pickGame(pid, key, options) {
    if (this.phase !== 'pick' || pid !== this.masterId) return { error: "Ce n'est pas à toi de choisir." };
    if (!byKey[key]) return { error: 'Jeu inconnu.' };
    if (!this.availability().includes(key)) return { error: `Pas assez de joueurs pour ${byKey[key].name}.` };
    this.launch(key, cleanOptions(key, options));
    return {};
  }

  launch(key, options) {
    this.clearTimer();
    const meta = byKey[key];
    const Class = meta.Class();
    const room = this;
    const ctx = {
      participants: this.connectedIds(),
      masterId: this.masterId,
      memory: this.memory,
      info: (id) => { const p = room.get(id); return p ? { id: p.id, name: p.name, avatar: p.avatar } : null; },
      isConnected: (id) => !!room.get(id)?.connected,
      update: () => room.update(),
      fx: (event, data, opts) => room.fx(event, data, opts),
      finish: (result) => room.finishGame(result),
    };
    this.gameKey = key;
    this.game = new Class(ctx, options);
    this.phase = 'game';
    this.history.push({ round: this.roundIndex + 1, gameKey: key, masterId: this.masterId });
    this.touch();
    this.game.start();
    this.update();
  }

  finishGame(result = {}) {
    if (this.phase !== 'game' || !this.game) return;
    const meta = byKey[this.gameKey];
    this.game.destroy();
    this.game = null;
    const rows = [];
    for (const p of this.players.values()) {
      if (!result.scores || !(p.id in result.scores)) continue;
      const raw = Math.max(0, Number(result.scores[p.id]) || 0);
      const points = Math.round(raw * meta.scale);
      p.score += points;
      rows.push({ id: p.id, raw, points });
    }
    rows.sort((a, b) => b.raw - a.raw);
    this.roundResult = {
      round: this.roundIndex + 1, gameKey: this.gameKey, gameName: meta.name, emoji: meta.emoji,
      masterId: this.masterId, rows, notes: result.notes || [], scaled: meta.scale !== 1,
    };
    this.phase = 'roundEnd';
    this.setTimer(ROUND_END_TIME, () => this.nextRound());
    this.update();
  }

  nextRound(pid) {
    if (pid && pid !== this.hostId) return;
    if (this.phase !== 'roundEnd') return;
    this.roundIndex++;
    if (this.roundIndex >= this.settings.rounds) {
      this.clearTimer();
      this.phase = 'final';
      this.update();
    } else {
      this.beginRound();
    }
  }

  again(pid) {
    if (pid !== this.hostId || this.phase !== 'final') return;
    for (const p of this.players.values()) p.score = 0;
    for (const p of [...this.players.values()]) if (p.gone) { this.players.delete(p.id); this.order = this.order.filter((x) => x !== p.id); }
    this.phase = 'lobby';
    this.roundResult = null;
    this.update();
  }

  action(pid, msg) {
    if (this.phase !== 'game' || !this.game || !msg || typeof msg !== 'object') return;
    if (!this.game.has(pid)) return;
    this.touch();
    this.game.onAction(pid, msg);
  }

  // ---------------------------------------------------------------- sauvegarde (redémarrage du serveur)
  serialize() {
    return {
      code: this.code, hostId: this.hostId, phase: this.phase, settings: this.settings, roundIndex: this.roundIndex, masterId: this.masterId,
      order: this.order, history: this.history, roundResult: this.roundResult, banned: [...this.banned], savedAt: Date.now(), lastActivity: this.lastActivity,
      players: [...this.players.values()].map((p) => ({ id: p.id, token: p.token, name: p.name, avatar: p.avatar, score: p.score, gone: p.gone, spectator: !!p.spectator })),
    };
  }

  static restore(io, d) {
    const room = new Room(io, d.code);
    Object.assign(room, { hostId: d.hostId, settings: d.settings, roundIndex: d.roundIndex, masterId: d.masterId, order: d.order, history: d.history || [], roundResult: d.roundResult || null, lastActivity: Date.now() });
    room.banned = new Set(d.banned || []);
    for (const p of d.players) room.players.set(p.id, { ...p, socketId: null, connected: false, graceTimer: null, hostTimer: null });
    // une manche interrompue est rejouée depuis le choix du jeu ; le reste reprend où il en était
    room.phase = d.phase === 'game' ? 'pick' : d.phase;
    room.resume = !['lobby', 'final'].includes(room.phase);
    return room;
  }

  resumeAfterRestart() {
    this.resume = false;
    if (this.phase === 'pick') this.beginRound();
    else if (this.phase === 'roundEnd') this.setTimer(ROUND_END_TIME, () => this.nextRound());
  }

  // ---------------------------------------------------------------- diffusion
  update() {
    if (this._u) return;
    this._u = setImmediate(() => { this._u = null; this.flush(); });
  }

  flush() {
    for (const p of this.players.values()) {
      if (p.connected && p.socketId) this.io.to(p.socketId).emit('state', this.view(p.id));
    }
  }

  fx(event, data, { to, except } = {}) {
    for (const p of this.players.values()) {
      if (!p.connected || !p.socketId) continue;
      if (to && p.id !== to) continue;
      if (except && p.id === except) continue;
      this.io.to(p.socketId).emit('fx', { event, data });
    }
  }

  view(pid) {
    const connectedCount = this.connectedIds().length;
    return {
      code: this.code,
      now: Date.now(),
      me: pid,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      players: this.present().map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score, connected: p.connected, spectator: !!p.spectator })),
      masterId: this.masterId,
      round: { index: Math.min(this.roundIndex + 1, this.settings.rounds), total: this.settings.rounds },
      deadline: this.deadline,
      catalog: this.phase === 'pick' ? publicCatalog() : undefined,
      available: this.phase === 'pick' ? this.availability() : undefined,
      connectedCount,
      game: this.phase === 'game' && this.game
        ? { key: this.gameKey, spectator: !this.game.has(pid), view: this.game.view(pid) }
        : null,
      result: this.phase === 'roundEnd' || this.phase === 'final' ? this.roundResult : null,
      history: this.phase === 'final' ? this.history : undefined,
    };
  }
}

module.exports = { Room, MAX_PLAYERS };
