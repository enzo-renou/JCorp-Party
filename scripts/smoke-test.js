'use strict';
/**
 * Test de bout en bout : 4 bots rejoignent un salon et jouent une manche de chacun des 5 mini-jeux.
 * Usage : npm test      (lance son propre serveur sur un port libre, délais accélérés)
 */
process.env.FAST_TEST = '1';
process.env.PORT = process.env.TEST_PORT || '3999';
const { io: connect } = require('socket.io-client');
const { server } = require('../server/index.js');
const { cultureById, POOL } = require('../server/games/culture');

const URL = `http://localhost:${process.env.PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failed++; console.log('  ✗ ÉCHEC :', msg); } };

class Bot {
  constructor(name) {
    this.name = name;
    this.state = null;
    this.fx = [];
    this.sock = connect(URL, { transports: ['websocket'] });
    this.sock.on('state', (s) => { this.state = s; this.react(s); });
    this.sock.on('fx', (e) => this.fx.push(e));
    this.sent = new Set();
    this.log = [];
  }
  emit(ev, data) { return new Promise((res) => this.sock.emit(ev, data, res)); }
  act(msg) { this.sock.emit('game:action', msg); }
  once(key, fn) { if (this.sent.has(key)) return; this.sent.add(key); fn(); }
  get g() { return this.state?.game?.view; }
  get me() { return this.state?.me; }

  // ------------------------------------------------ comportement automatique selon le jeu
  react(s) {
    if (s.phase === 'pick' && s.masterId === this.me && this.wantGame) {
      this.once(`pick-${s.round.index}`, async () => { const r = await this.emit('room:pick', { key: this.wantGame, options: this.wantOptions }); if (r.error) console.log('pick error', r.error); });
    }
    if (s.phase !== 'game' || !s.game) return;
    const g = s.game.view, k = s.game.key;
    const turn = (x) => `${k}-${s.round.index}-${x}`;
    if (k === 'skribbl') {
      if (g.phase === 'choosing' && g.drawerId === this.me) this.once(turn(`c${g.turn}`), () => this.act({ type: 'choose', index: 0 }));
      if (g.phase === 'drawing' && g.drawerId === this.me) {
        this.once(turn(`d${g.turn}`), () => {
          this.act({ type: 'stroke', id: 's1', c: '#ff0000', w: 5, pts: [[10, 10], [200, 120], [300, 300]] });
          this.act({ type: 'fill', x: 5, y: 5, c: '#00ff00' });
          this.act({ type: 'undo' });
          this.lastWord = g.word;
        });
        this.drawWord = g.word;
      }
      if (g.phase === 'drawing' && g.drawerId !== this.me && g.pattern) {
        this.once(turn(`g${g.turn}`), async () => {
          this.act({ type: 'guess', text: 'mauvaise-reponse' });
          await sleep(30);
          // le dessinateur révèle le mot via son bot : on le lit dans l'état du bot dessinateur (test uniquement)
          const w = Bot.all.find((b) => b.me === g.drawerId)?.drawWord;
          if (w) this.act({ type: 'guess', text: w });
        });
      }
    }
    if (k === 'culture') {
      if (g.phase === 'question') this.once(turn(`q${g.idx}`), () => {
        const q = POOL.find((p) => p.q === g.q.q && (p.emoji === g.q.emoji) && (!g.q.img || g.q.img.includes(p.id)));
        const ans = this.idx % 2 === 0 && q ? q.a[0] : 'zzz';
        this.act({ type: 'answer', text: ans });
      });
      if (g.phase === 'review' && g.masterId === this.me) this.once(turn('rev'), () => {
        this.act({ type: 'toggle', qi: 0, pid: g.items[0].rows.find((r) => r.pid !== this.me).pid });
        this.act({ type: 'validate' });
      });
    }
    if (k === 'geo' && g.phase === 'question') {
      this.once(turn(`q${g.idx}`), () => {
        if (g.q.section === 'loc') this.act({ type: 'answer', lat: 48.8, lng: 2.3 });
        else this.act({ type: 'answer', text: 'France' });
      });
    }
    if (k === 'imposteur') {
      if (g.phase === 'clues' && g.current === this.me && g.me?.alive) this.once(turn(`clue${g.log.length}`), () => this.act({ type: 'clue', text: `indice${g.log.length}` }));
      if (g.phase === 'decision' && g.me?.alive) this.once(turn(`dec${g.clueRound}`), () => this.act({ type: 'decision', choice: 'vote' }));
      if (g.phase === 'voting' && g.me?.alive) this.once(turn(`vote${g.clueRound}`), () => {
        const target = g.alive.find((id) => id !== this.me);
        this.act({ type: 'vote', target });
      });
      if (g.phase === 'whiteGuess' && g.me?.isWhite) this.once(turn('wg'), () => this.act({ type: 'whiteGuess', text: 'nimportequoi' }));
    }
    if (k === 'mastergoon') {
      if (g.phase === 'answering') this.once(turn(`a${g.qIndex}`), () => {
        if (g.masterId === this.me) this.act({ type: 'answer', text: 'rouge' });
        else if (g.alive[this.me]) this.act({ type: 'answer', text: this.me === Bot.all[1].me ? 'rouge' : 'bleu' });
        else if (g.canJoker) this.act({ type: 'jokerPass' });
      });
      if (g.phase === 'reveal' && g.masterId === this.me && !g.mgTimeout) this.once(turn(`next${g.qIndex}`), async () => {
        await sleep(40);
        const e = g.entries[0];
        if (e) this.act({ type: 'decide', pid: e.pid, verdict: 'invalid' });
        await sleep(40);
        this.act({ type: 'next' });
      });
    }
  }
}
Bot.all = [];

async function waitFor(pred, label, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (pred()) return true;
    await sleep(25);
  }
  console.log('  ✗ TIMEOUT :', label, '| état:', Bot.all[0]?.state?.phase, 'manche', Bot.all[0]?.state?.round?.index, Bot.all[0]?.state?.game?.key, JSON.stringify(Bot.all[0]?.state?.game?.view?.phase));
  failed++;
  return false;
}

(async () => {
  await new Promise((r) => server.listening ? r() : server.once('listening', r));
  console.log(`\nServeur de test sur ${URL}`);

  const names = ['Alice', 'Bob', 'Chloé', 'David'];
  const bots = names.map((n) => new Bot(n));
  if (process.env.TRACE) { let last=''; bots[0].sock.on('state', (st) => { const k = `${st.phase}|${st.round.index}|${st.game?.key}|${st.game?.view?.phase}`; if (k !== last) { last = k; console.log('    ~', Date.now() % 100000, k); } }); }
  Bot.all = bots;
  await Promise.all(bots.map((b) => new Promise((r) => b.sock.on('connect', r))));

  console.log('\n[Salon]');
  const created = await bots[0].emit('room:create', { name: 'Alice', avatar: 'abc123' });
  ok(created.ok && /^[A-Z]{4}$/.test(created.code), `salon créé avec le code ${created.code}`);
  bots[0].auth = created;
  for (let i = 1; i < 4; i++) {
    const r = await bots[i].emit('room:join', { name: names[i], code: created.code.toLowerCase(), avatar: 'x' + i });
    ok(r.ok, `${names[i]} rejoint avec le code`);
    bots[i].auth = r;
  }
  const stranger = new Bot('Z');
  const bad = await stranger.emit('room:join', { name: 'Z', code: 'ZZZZ' });
  ok(!!bad.error, 'un mauvais code est refusé');
  await waitFor(() => bots.every((b) => b.state?.players?.length === 4), 'tous les joueurs voient 4 joueurs');
  ok(bots[0].state.hostId === bots[0].me, 'le créateur est hôte');
  bots[0].sock.emit('room:rounds', 5);
  await sleep(80);
  ok(bots[0].state.settings.rounds === 5, 'nombre de manches réglé à 5');
  const noStart = await bots[1].emit('room:start', {});
  ok(!!noStart.error, 'un non-hôte ne peut pas lancer');

  // reconnexion (rafraîchir la page) : mauvais jeton refusé, bon jeton accepté
  const dav = bots[3];
  dav.sock.disconnect();
  await sleep(150);
  ok(bots[0].state.players.find((p) => p.name === 'David')?.connected === false, 'déconnexion détectée');
  dav.sock = connect(URL, { transports: ['websocket'] });
  dav.sock.on('state', (s) => { dav.state = s; dav.react(s); });
  dav.sock.on('fx', (e) => dav.fx.push(e));
  const bad2 = await dav.emit('room:rejoin', { code: created.code, pid: dav.auth.pid, token: 'faux' });
  ok(!!bad2.error, 'reconnexion avec un mauvais jeton refusée');
  const good = await dav.emit('room:rejoin', { code: created.code, pid: dav.auth.pid, token: dav.auth.token });
  ok(good.ok, 'reconnexion avec le bon jeton acceptée');
  await waitFor(() => bots[0].state.players.find((p) => p.name === 'David')?.connected === true, 'David de nouveau connecté');

  // un 5e joueur peut rejoindre puis partir
  const eve = new Bot('Eve');
  const ej = await eve.emit('room:join', { name: 'Eve', code: created.code });
  ok(ej.ok, '5e joueur accepté');
  await sleep(100);
  await eve.emit('room:leave');
  await sleep(100);
  ok(bots[0].state.players.length === 4, 'et son départ le retire du salon (lobby)');
  eve.sock.close(); stranger.sock.close();

  const start = await bots[0].emit('room:start', {});
  ok(!start.error, 'la partie démarre');
  await waitFor(() => bots[0].state.phase === 'pick', 'phase de choix du jeu');

  const plan = [
    ['skribbl', { drawTime: 60, passes: 1 }],
    ['culture', { count: 10, time: 20 }],
    ['geo', {}],
    ['imposteur', { turnTime: 30, voteTime: 60, impostors: 1, mrWhite: false }],
    ['mastergoon', { answerTime: 10, maxQuestions: 5, joker: true }],
  ];
  const connected = bots;
  for (let r = 0; r < plan.length; r++) {
    const [key, opts] = plan[r];
    console.log(`\n[Manche ${r + 1} — ${key}]`);
    await waitFor(() => connected[0].state.phase === 'pick' && connected[0].state.round.index === r + 1, `manche ${r + 1} en choix`);
    const masterId = connected[0].state.masterId;
    const master = connected.find((b) => b.me === masterId);
    ok(!!master, `le maître du jeu est ${connected[0].state.players.find((p) => p.id === masterId)?.name}`);
    const cat = connected[0].state.catalog;
    ok(cat.length === 5, 'catalogue de 5 jeux');
    // un non-maître ne peut pas choisir
    const other = connected.find((b) => b.me !== masterId);
    const rej = await other.emit('room:pick', { key });
    ok(!!rej.error, 'un joueur qui n’est pas maître ne peut pas choisir le jeu');
    connected.forEach((b) => { b.wantGame = null; });
    master.wantGame = key; master.wantOptions = opts;
    master.react(master.state);
    await waitFor(() => connected[0].state.phase === 'game' && connected[0].state.game?.key === key, `jeu ${key} lancé`);
    await waitFor(() => connected[0].state.phase === 'roundEnd', `${key} terminé`, 90000);
    const res = connected[0].state.result;
    ok(res && res.gameKey === key && res.rows.length >= 3, `résultat de manche reçu (${res?.rows.map((x) => `${connected[0].state.players.find((p) => p.id === x.id)?.name}:${x.raw}→${x.points}`).join(' ')})`);
    if (key === 'skribbl') ok(bots[0].fx.some((e) => e.event === 'stroke') || bots.some((b) => b.fx.some((e) => e.event === 'stroke')), 'les traits de dessin sont relayés aux autres');
    if (key === 'culture') ok(res.rows.some((x) => x.raw > 0), 'des points ont été attribués au quiz culture');
    if (key === 'mastergoon') ok(res.rows.some((x) => x.raw > 0), 'des survivants ont marqué des points');
    // on accélère : le prochain tour part tout seul (timer de fin de manche) ou l'hôte clique
    connected[0].sock.emit('room:next');
  }
  await waitFor(() => connected[0].state.phase === 'final', 'écran final');
  const total = connected[0].state.players.reduce((a, p) => a + p.score, 0);
  ok(total > 0, `scores cumulés : ${connected[0].state.players.map((p) => `${p.name} ${p.score}`).join(', ')}`);
  connected[0].sock.emit('room:again');
  await waitFor(() => connected[0].state.phase === 'lobby' && connected[0].state.players.every((p) => p.score === 0), 'rejouer remet le salon à zéro');

  console.log(failed ? `\n❌ ${failed} échec(s)` : '\n✅ Tout est OK');
  bots.forEach((b) => b.sock.close());
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
