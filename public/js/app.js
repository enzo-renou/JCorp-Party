// JCorp Party — application (accueil, salon, choix du jeu, fin de manche, podium)
import { socket, store, onState, onFx, emit, action, session, prefs, serverNow } from './net.js';
import { sfx, isMuted, setMuted } from './sound.js';
import { h, fill, clear, avatar, avatarUrl, clock, toast, confetti, copy } from './ui.js';

const GAME_MODULES = {
  skribbl: () => import('./games/skribbl.js'),
  culture: () => import('./games/culture.js'),
  geo: () => import('./games/geo.js'),
  imposteur: () => import('./games/imposteur.js'),
  mastergoon: () => import('./games/mastergoon.js'),
};

const app = document.getElementById('app');

// ------------------------------------------------------------------ squelette
const topbar = h('header', { class: 'topbar hidden' });
const scorebar = h('div', { class: 'scorebar hidden' });
const main = h('main', { class: 'main' });
app.append(topbar, scorebar, main);

let current = { key: null, screen: null };
const byId = (state) => Object.fromEntries(state.players.map((p) => [p.id, p]));
const inviteLink = (code) => `${location.origin}/?code=${code}`;

function leave() {
  emit('room:leave').then(() => { session.clear(); store.state = null; route(null); });
}

// ------------------------------------------------------------------ routage
async function route(state) {
  const key = !state ? 'home' : state.phase === 'game' && state.game ? `game:${state.game.key}` : state.phase;
  if (key !== current.key) {
    current.screen?.unmount?.();
    current = { key, screen: null };
    clear(main);
    let screen;
    if (!state) screen = Home();
    else if (state.phase === 'lobby') screen = Lobby();
    else if (state.phase === 'pick') screen = Pick();
    else if (state.phase === 'roundEnd') screen = RoundEnd();
    else if (state.phase === 'final') screen = Final();
    else if (state.phase === 'game') screen = await GameScreen(state.game.key);
    // un autre changement d'écran a pu arriver pendant le chargement du module
    if (current.key !== key) return;
    current.screen = screen;
    main.append(screen.el);
    window.scrollTo({ top: 0 });
  }
  if (state) {
    renderChrome(state);
    current.screen?.update?.(state);
  } else {
    topbar.classList.add('hidden'); scorebar.classList.add('hidden');
  }
}

function renderChrome(state) {
  const players = byId(state);
  topbar.classList.remove('hidden');
  const inGame = state.phase !== 'lobby';
  fill(topbar,
    h('div', { class: 'logo' }, h('b', {}, 'JCorp'), ' ', h('i', {}, 'Party')),
    h('button', { class: 'codechip', title: 'Copier le lien d’invitation', onClick: () => copy(inviteLink(state.code)).then(() => toast('Lien d’invitation copié 📋', 'good')) }, state.code),
    inGame && state.phase !== 'final' ? h('span', { class: 'pill' }, `Manche ${state.round.index}/${state.round.total}`) : null,
    state.masterId && ['pick', 'game', 'roundEnd'].includes(state.phase) ? h('span', { class: 'pill yellow' }, `👑 ${players[state.masterId]?.name ?? '?'}`) : null,
    h('span', { class: 'grow' }),
    h('button', { class: 'sound-btn', title: 'Son', onClick: (e) => { setMuted(!isMuted()); e.currentTarget.textContent = isMuted() ? '🔇' : '🔊'; if (!isMuted()) sfx('pop'); } }, isMuted() ? '🔇' : '🔊'),
    h('button', { class: 'btn ghost sm', onClick: () => { if (confirm('Quitter la partie ?')) leave(); } }, '🚪 Quitter'));

  // classement cumulé
  const badges = current.screen?.badges?.(state) || {};
  const list = state.players.filter((p) => !p.spectator).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  scorebar.classList.toggle('hidden', state.phase === 'lobby');
  const specs = state.players.filter((p) => p.spectator);
  fill(scorebar, list.map((p) => h('div', { class: `sc ${p.id === state.me ? 'me' : ''} ${p.id === state.masterId && state.phase !== 'final' ? 'master' : ''} ${p.connected ? '' : 'off'}` },
    avatar(p.avatar, 'sm'), h('span', { class: 'nm' }, p.name), h('span', { class: 'pts' }, p.score),
    state.hostId === state.me && p.id !== state.me ? h('button', { class: 'kick-mini', title: `Exclure ${p.name}`, onClick: (e) => { e.stopPropagation(); if (confirm(`Exclure ${p.name} de la partie ?`)) socket.emit('room:kick', p.id); } }, '✖') : null,
    badges[p.id] ? h('span', { class: 'badge' }, badges[p.id]) : (p.id === state.masterId && ['pick', 'game', 'roundEnd'].includes(state.phase) ? h('span', { class: 'badge' }, '👑') : null))),
    specs.length ? h('div', { class: 'sc spec', title: specs.map((x) => x.name).join(', ') }, `👁 ${specs.length}`) : null);
}

// ------------------------------------------------------------------ accueil
function Home() {
  let seed = prefs.get('avatar', '') || window.Avatars.randomSeed();
  let choices = [seed, ...Array.from({ length: 5 }, () => window.Avatars.randomSeed())];
  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('code') || location.hash.replace('#', '') || '').toUpperCase().slice(0, 4);

  const nameIn = h('input', { class: 'input', placeholder: 'Ton pseudo', maxLength: 14, value: prefs.get('name', ''), autocomplete: 'off' });
  const codeIn = h('input', { class: 'input code', placeholder: 'CODE', maxLength: 4, value: urlCode, autocomplete: 'off', autocapitalize: 'characters' });
  const specIn = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'error hidden' });
  const avBox = h('div', { class: 'avatar-pick' });
  const showErr = (m) => { err.textContent = m; err.classList.toggle('hidden', !m); };

  function drawAvatars() {
    fill(avBox,
      h('img', { class: 'avatar xl', src: avatarUrl(seed), alt: 'ton avatar' }),
      h('div', { class: 'avatar-choices' }, choices.map((s) => h('button', { class: s === seed ? 'sel' : '', onClick: () => { seed = s; drawAvatars(); } }, h('img', { class: 'avatar', src: avatarUrl(s), alt: '' })))),
      h('button', { class: 'btn yellow sm', onClick: () => { choices = Array.from({ length: 6 }, () => window.Avatars.randomSeed()); seed = choices[0]; drawAvatars(); } }, '🎲 Avatar aléatoire'));
  }
  drawAvatars();

  async function go(kind) {
    const name = nameIn.value.trim();
    if (!name) { showErr('Choisis un pseudo !'); nameIn.focus(); return; }
    showErr('');
    prefs.set('name', name); prefs.set('avatar', seed);
    const code = codeIn.value.trim().toUpperCase();
    if (kind === 'join' && code.length !== 4) { showErr('Le code fait 4 lettres.'); codeIn.focus(); return; }
    const r = kind === 'create' ? await emit('room:create', { name, avatar: seed }) : await emit('room:join', { name, avatar: seed, code, spectator: specIn.checked });
    if (r.error) return showErr(r.error);
    session.set({ code: r.code, pid: r.pid, token: r.token });
    history.replaceState(null, '', location.pathname);
  }
  codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') go('join'); });
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(codeIn.value.length === 4 ? 'join' : 'create'); });

  const floaters = ['🎨', '🧠', '🌍', '🕵️', '🎤', '🎉', '🏆', '🎲'].map((e, i) => h('span', { class: 'floater', style: { left: `${6 + (i * 12.5) % 90}%`, animationDuration: `${14 + (i * 3) % 9}s`, animationDelay: `${-i * 2.3}s`, fontSize: `${1.6 + (i % 3) * 0.7}rem` } }, e));
  const el = h('div', { class: 'home' }, h('div', { class: 'aurora' }, h('i'), h('i'), h('i')), h('div', { class: 'floaters' }, floaters), h('div', { class: 'home-card' },
    h('div', { class: 'hero' }, h('h1', {}, h('b', {}, 'JCorp'), ' ', h('i', {}, 'Party')), h('p', {}, '5 mini-jeux · 1 maître du jeu par manche · 0 pitié 🎉'),
      h('div', { class: 'gchips' }, [['🎨', 'Skribbl'], ['🧠', 'Culture G'], ['🌍', 'Géo'], ['🕵️', 'Imposteur'], ['🎤', 'Mastergoon']].map(([e, n], i) => h('span', { style: { animationDelay: `${i * 90}ms` } }, e, ' ', n)))),
    h('div', { class: 'card col' },
      avBox,
      h('div', {}, h('label', { class: 'field' }, 'Pseudo'), nameIn),
      err,
      h('button', { class: 'btn big block', onClick: () => go('create') }, '🎉 Créer une partie'),
      h('div', { class: 'or' }, 'ou rejoindre'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, codeIn), h('button', { class: 'btn cyan big', onClick: () => go('join') }, 'Rejoindre')),
      h('label', { class: 'muted row', style: { gap: '8px', cursor: 'pointer' } }, specIn, '👁 Rejoindre en spectateur (je regarde, je ne joue pas)'))));
  if (urlCode) setTimeout(() => (nameIn.value ? codeIn : nameIn).focus(), 50);
  return { el };
}

// ------------------------------------------------------------------ lobby
function Lobby() {
  const el = h('div', { class: 'lobby' });
  function update(state) {
    const me = state.me;
    const isHost = state.hostId === me;
    const link = inviteLink(state.code);
    const connected = state.players.filter((p) => p.connected && !p.spectator).length;

    const left = h('div', { class: 'card col' },
      h('div', { class: 'center' }, h('div', { class: 'muted' }, 'Code de la partie'), h('div', { class: 'bigcode' }, state.code)),
      h('div', { class: 'row wrap', style: { justifyContent: 'center' } },
        h('button', { class: 'btn yellow sm', onClick: () => copy(link).then(() => toast('Lien copié 📋', 'good')) }, '📋 Copier le lien'),
        navigator.share ? h('button', { class: 'btn cyan sm', onClick: () => navigator.share({ title: 'JCorp Party', text: `Rejoins ma partie JCorp Party ! Code : ${state.code}`, url: link }).catch(() => {}) }, '📤 Partager') : null),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, h('img', { class: 'qr', alt: 'QR code', src: `/api/qr?text=${encodeURIComponent(link)}` })),
      h('div', { class: 'muted center' }, 'Scanne le QR code ou tape le code sur la page d’accueil'));

    const players = h('div', { class: 'players-grid' }, state.players.map((p) => h('div', { class: `pcard ${p.id === me ? 'me' : ''} ${p.connected ? '' : 'off'}` },
      p.id === state.hostId ? h('span', { class: 'crown', title: 'Hôte' }, '👑') : null,
      isHost && p.id !== me ? h('button', { class: 'kick', title: 'Exclure', onClick: () => { if (confirm(`Exclure ${p.name} ?`)) socket.emit('room:kick', p.id); } }, '✖') : null,
      avatar(p.avatar, 'lg'), h('div', { class: 'nm' }, p.name), h('div', { class: 'muted' }, p.spectator ? '👁 spectateur' : p.connected ? (p.id === me ? 'toi' : '') : 'déconnecté'))));

    const rounds = state.settings.rounds;
    const settings = h('div', { class: 'card col' },
      h('h3', {}, `Joueurs (${connected})`), players,
      h('div', { class: 'spacer' }),
      h('div', { class: 'optrow', style: { borderTop: 0 } },
        h('span', {}, 'Nombre de manches'),
        isHost
          ? h('span', { class: 'stepper' }, h('button', { class: 'icon-btn', disabled: rounds <= 1, onClick: () => socket.emit('room:rounds', rounds - 1) }, '−'), h('b', {}, rounds), h('button', { class: 'icon-btn', disabled: rounds >= 30, onClick: () => socket.emit('room:rounds', rounds + 1) }, '+'))
          : h('b', { class: 'pill yellow' }, rounds)),
      h('div', { class: 'muted', style: { fontSize: '.9rem' } }, 'À chaque manche, un joueur différent est le maître du jeu : il choisit le mini-jeu !'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', onClick: () => { const s = window.Avatars.randomSeed(); prefs.set('avatar', s); socket.emit('player:avatar', s); } }, '🎲 Changer d’avatar'),
        h('span', { class: 'grow' }),
        isHost
          ? h('button', { class: 'btn green big', disabled: connected < 2, onClick: async () => { const r = await emit('room:start'); if (r.error) toast(r.error, 'bad'); } }, connected < 2 ? 'Il faut 2 joueurs min.' : '🚀 Lancer la partie')
          : h('span', { class: 'muted' }, 'En attente de l’hôte…')));
    fill(el, left, settings);
  }
  return { el, update };
}

// ------------------------------------------------------------------ choix du jeu par le maître
function Pick() {
  const el = h('div');
  let sel = null;
  let opts = {};
  function update(state) {
    const players = byId(state);
    const isMaster = state.masterId === state.me;
    const master = players[state.masterId];
    const avail = new Set(state.available);

    const head = h('div', { class: 'gh' },
      master ? avatar(master.avatar, 'lg') : null,
      h('div', {}, h('h2', {}, isMaster ? '👑 Tu es le maître du jeu !' : `👑 ${master?.name ?? '…'} est le maître du jeu`),
        h('div', { class: 'muted' }, isMaster ? 'Choisis le mini-jeu de cette manche.' : 'Il choisit le mini-jeu de cette manche…')),
      h('span', { class: 'grow' }),
      state.deadline ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Choix auto dans'), clock(state.deadline)) : null);

    const cards = state.catalog.map((g) => {
      const ok = avail.has(g.key);
      return h('button', {
        class: `gcard ${sel === g.key ? 'sel' : ''} ${!ok ? 'disabled' : ''} ${!isMaster ? 'static' : ''}`, style: { '--gc': g.color }, disabled: !ok && isMaster,
        onClick: () => { if (!isMaster || !ok) return; sel = g.key; opts[g.key] ||= Object.fromEntries(g.options.map((o) => [o.key, o.default])); update(state); },
      }, h('img', { class: 'gimg', src: `/img/game-${g.key}.svg`, alt: '', loading: 'lazy' }), h('div', { class: 'emo' }, g.emoji), h('h3', {}, g.name), h('div', { class: 'tag' }, g.tagline), h('p', {}, g.desc),
      !ok ? h('p', { class: 'pill red', style: { marginTop: '8px' } }, `Min. ${g.minPlayers} joueurs`) : null);
    });

    const parts = [head, h('div', { class: 'games' }, cards)];
    if (isMaster && sel) {
      const g = state.catalog.find((x) => x.key === sel);
      const o = opts[sel];
      parts.push(h('div', { class: 'card col', style: { marginTop: '16px', borderColor: g.color } },
        h('h3', {}, `${g.emoji} ${g.name} — réglages`),
        g.options.length ? g.options.map((opt) => h('div', { class: `optrow ${opt.type === 'multi' ? 'stack' : ''}` }, h('span', {}, opt.label),
          opt.type === 'multi'
            ? h('div', { class: 'chips' }, h('button', { class: 'chip', onClick: () => { o[opt.key] = o[opt.key].length === opt.choices.length ? [opt.choices[0].v] : opt.choices.map((c) => c.v); update(state); } }, o[opt.key].length === opt.choices.length ? 'Tout décocher' : 'Tout cocher'),
              opt.choices.map((c) => h('button', { class: `chip ${o[opt.key].includes(c.v) ? 'on' : ''}`, onClick: () => { const cur = o[opt.key]; o[opt.key] = cur.includes(c.v) ? (cur.length > 1 ? cur.filter((x) => x !== c.v) : cur) : [...cur, c.v]; update(state); } }, c.label)))
          : opt.type === 'bool'
            ? h('div', { class: 'seg' }, [true, false].map((v) => h('button', { class: o[opt.key] === v ? 'on' : '', onClick: () => { o[opt.key] = v; update(state); } }, v ? 'Oui' : 'Non')))
            : h('div', { class: 'seg' }, opt.choices.map((c) => h('button', { class: o[opt.key] === c.v ? 'on' : '', onClick: () => { o[opt.key] = c.v; update(state); } }, c.label))))) : h('div', { class: 'muted' }, 'Aucun réglage pour ce jeu.'),
        h('button', { class: 'btn big block', style: { '--c': g.color }, onClick: async () => { const r = await emit('room:pick', { key: sel, options: o }); if (r.error) toast(r.error, 'bad'); } }, `C’est parti ! ${g.emoji}`)));
    }
    fill(el, ...parts);
  }
  return { el, update, unmount() { sel = null; } };
}

// ------------------------------------------------------------------ écran de jeu
async function GameScreen(key) {
  const mod = await GAME_MODULES[key]();
  const api = { action, me: () => store.state?.me, state: () => store.state, byId: () => byId(store.state), serverNow };
  const inst = mod.default(api);
  const unFx = onFx((e) => inst.onFx?.(e.event, e.data));
  const notice = h('div', { class: 'banner hidden' }, '👀 Tu regardes cette manche en spectateur : tu joueras dès la prochaine !');
  const el = h('div', {}, notice, inst.el);
  return {
    el,
    update(state) {
      const meP = state.players.find((x) => x.id === state.me);
      notice.textContent = meP?.spectator ? '👁 Mode spectateur : tu regardes la partie.' : '👀 Tu regardes cette manche en spectateur : tu joueras dès la prochaine !';
      notice.classList.toggle('hidden', !state.game.spectator);
      inst.update(state.game.view, state);
    },
    badges: (state) => inst.badges?.(state.game.view, state) || {},
    unmount() { unFx(); inst.unmount?.(); },
  };
}

// ------------------------------------------------------------------ fin de manche
function RoundEnd() {
  const el = h('div');
  function update(state) {
    const players = byId(state);
    const r = state.result;
    if (!r) return;
    const gains = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    const ranking = state.players.filter((p) => !p.spectator).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const isHost = state.hostId === state.me;
    const last = r.round >= state.round.total;
    fill(el, h('div', { class: 'card col', style: { maxWidth: '720px', margin: '0 auto' } },
      h('img', { class: 'gimg wide', src: `/img/game-${r.gameKey}.svg`, alt: '' }),
      h('div', { class: 'center' }, h('div', { class: 'muted' }, `Manche ${r.round}/${state.round.total}`), h('h2', {}, `${r.emoji} ${r.gameName} terminé !`)),
      r.notes.map((n) => h('div', { class: 'muted center' }, n)),
      h('div', { class: 'rank' }, ranking.map((p, i) => {
        const g = gains[p.id];
        return h('div', { class: `rrow ${p.id === state.me ? 'me' : ''} ${i === 0 ? 'first' : ''}`, style: { animationDelay: i * 70 + 'ms' } },
          h('span', { class: 'pos' }, i + 1), avatar(p.avatar), h('span', { class: 'nm' }, p.name, p.id === r.masterId ? ' 👑' : ''),
          g ? h('span', { class: 'gain', title: r.scaled ? `${g.raw} pts bruts` : '' }, g.points ? `+${g.points}` : '+0') : null,
          h('span', { class: 'tot' }, p.score));
      })),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        state.deadline ? [h('span', { class: 'muted' }, last ? 'Résultats finaux dans' : 'Manche suivante dans'), clock(state.deadline)] : null,
        isHost ? h('button', { class: 'btn big', onClick: () => socket.emit('room:next') }, last ? '🏆 Voir le podium' : 'Manche suivante ➜') : null)));
  }
  return { el, update };
}

// ------------------------------------------------------------------ podium
function Final() {
  const el = h('div');
  let celebrated = false;
  function update(state) {
    const ranking = state.players.filter((p) => !p.spectator).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const isHost = state.hostId === state.me;
    const top = ranking.slice(0, 3);
    const order = top.length >= 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
    const cls = (p) => `p${top.indexOf(p) + 1}`;
    const games = { skribbl: '🎨 Skribbl', culture: '🧠 Culture G', geo: '🌍 Quiz Géo', imposteur: '🕵️ L’Imposteur', mastergoon: '🎤 Mastergoon' };
    const players = byId(state);
    if (!celebrated) { celebrated = true; confetti(); }
    fill(el, h('div', { class: 'card col', style: { maxWidth: '760px', margin: '0 auto' } },
      h('div', { class: 'center' }, h('h2', { style: { fontSize: '2.4rem' } }, '🏆 Classement final')),
      h('div', { class: 'podium' }, order.map((p) => h('div', { class: `pod ${cls(p)}` }, avatar(p.avatar, 'lg'), h('div', { class: 'nm' }, p.name), h('div', { class: 'sc2' }, `${p.score} pts`), h('div', { class: 'blk' }, top.indexOf(p) + 1)))),
      h('div', { class: 'rank' }, ranking.map((p, i) => h('div', { class: `rrow ${p.id === state.me ? 'me' : ''} ${i === 0 ? 'first' : ''}` }, h('span', { class: 'pos' }, i + 1), avatar(p.avatar), h('span', { class: 'nm' }, p.name), h('span', { class: 'tot' }, p.score)))),
      state.history?.length ? h('div', { class: 'muted center', style: { fontSize: '.9rem' } }, state.history.map((x) => `M${x.round} ${games[x.gameKey] ?? x.gameKey} (👑 ${players[x.masterId]?.name ?? '?'})`).join(' · ')) : null,
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        isHost ? h('button', { class: 'btn green big', onClick: () => socket.emit('room:again') }, '🔁 Rejouer') : h('span', { class: 'muted' }, 'L’hôte peut relancer une partie'),
        h('button', { class: 'btn ghost', onClick: leave }, '🚪 Quitter'))));
  }
  return { el, update };
}

// ------------------------------------------------------------------ démarrage
let prev = null;
function sounds(s) {
  const p = prev; prev = { phase: s.phase, n: s.players.filter((x) => !x.spectator).length, sig: `${s.game?.key}|${s.game?.view?.phase}|${s.game?.view?.idx ?? s.game?.view?.qIndex ?? ''}`, master: s.masterId };
  if (!p) return;
  if (s.phase === 'lobby' && prev.n > p.n) sfx('join');
  if (s.phase !== p.phase) sfx({ pick: s.masterId === s.me ? 'turn' : 'pop', game: 'start', roundEnd: 'round', final: 'win' }[s.phase] || 'pop');
  else if (s.phase === 'game' && prev.sig !== p.sig) {
    const v = s.game.view;
    if (s.game.key === 'geo' && v.phase === 'reveal') { const row = v.rows?.find((r) => r.pid === s.me); sfx(row?.ok ? 'good' : row ? 'bad' : 'pop'); }
    else sfx('pop');
  }
}
onState((s) => { try { sounds(s); } catch { /* son facultatif */ } route(s); });

function tryRejoin() {
  const s = session.get();
  if (!s) { if (!store.state) route(null); return; }
  emit('room:rejoin', s).then((r) => {
    if (r.error) { session.clear(); store.state = null; route(null); if (r.error === 'expired') toast('Cette partie n’existe plus.', 'bad'); }
  });
}
socket.on('connect', () => { store.connected = true; tryRejoin(); });
socket.on('disconnect', () => { store.connected = false; toast('Connexion perdue… reconnexion 🔌'); });
['kicked', 'roomClosed', 'sessionReplaced'].forEach((ev) => socket.on(ev, () => {
  if (ev === 'sessionReplaced') { /* ouvert ailleurs */ }
  session.clear(); store.state = null; route(null);
  toast({ kicked: 'Tu as été exclu de la partie.', roomClosed: 'La partie a été fermée.', sessionReplaced: 'Partie ouverte dans un autre onglet.' }[ev], 'bad');
}));
route(null);
