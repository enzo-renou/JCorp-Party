// Qui est l'imposteur ? : indices, vote, M. White
import { h, fill, avatar, clock, timerBar, answerBox } from '../ui.js';

const ROLE = { citizen: '👤 Citoyen', impostor: '🕵️ Imposteur', white: '⬜ M. White' };

export default function create(api) {
  const el = h('div');
  let key = null;
  let clueInput = null;

  const P = () => api.byId();
  const who = (id) => { const p = P()[id]; return h('span', { class: 'row', style: { gap: '6px' } }, avatar(p?.avatar, 'sm'), h('b', {}, p?.name ?? '?')); };

  function myWord(v) {
    if (!v.me) return h('div', { class: 'muted center' }, '👀 Tu regardes la partie.');
    if (v.me.isWhite) return h('div', { class: 'wordcard white' }, h('div', { class: 'muted' }, 'Ton mot'), h('div', { class: 'w' }, '???'), h('div', { class: 'muted' }, 'Tu es M. White : devine le mot grâce aux indices !'));
    return h('div', { class: 'wordcard' }, h('div', { class: 'muted' }, 'Ton mot secret'), h('div', { class: 'w' }, v.me.word));
  }
  const miniWord = (v) => (v.me && !v.me.isWhite ? h('span', { class: 'mini-word' }, '🔑 ', v.me.word) : v.me?.isWhite ? h('span', { class: 'mini-word' }, '⬜ ???') : null);

  function clueLog(v) {
    const rounds = [...new Set(v.log.map((l) => l.round))];
    if (!rounds.length) return null;
    return h('div', { class: 'card flat' }, h('h3', {}, '💬 Indices'),
      rounds.map((r) => h('div', { style: { marginBottom: '8px' } }, h('div', { class: 'muted' }, `Tour ${r + 1}`),
        h('div', { class: 'clue-log' }, v.log.filter((l) => l.round === r).map((l) => h('div', { class: `clue ${l.timedOut ? 'skip' : ''}` }, avatar(P()[l.pid]?.avatar, 'sm'), h('b', {}, P()[l.pid]?.name), h('span', { class: 'w' }, l.timedOut ? '… (temps écoulé)' : l.word)))))));
  }
  const header = (title, v, bar) => [h('div', { class: 'gh' }, h('h2', {}, title), miniWord(v), h('span', { class: 'grow' }), v.endsAt ? clock(v.endsAt) : null), bar && v.endsAt ? timerBar(v.endsAt, bar) : null];

  function intro(v) {
    if (key === 'intro') return; key = 'intro';
    fill(el, h('div', { class: 'gh' }, h('h2', {}, '🕵️ Qui est l\'imposteur ?'), h('span', { class: 'grow' }), clock(v.endsAt)),
      h('div', { class: 'card col' }, myWord(v), h('div', { class: 'muted center' }, 'Mémorise ton mot. À tour de rôle, donnez UN indice sans dire le mot…')));
  }

  function clues(v) {
    const me = api.me();
    const myTurn = v.current === me && v.me?.alive;
    const k = `c${v.clueRound}-${v.current}`;
    const rebuild = key !== k;
    key = k;
    const players = P();
    const orderChips = h('div', { class: 'avs' }, v.order.map((id) => h('span', { class: `av-tag ${id === v.current ? 'done' : ''}`, style: { opacity: v.alive.includes(id) ? 1 : .35 } }, avatar(players[id]?.avatar, 'sm'), players[id]?.name, id === v.current ? ' ✍️' : '')));
    let em = null;
    if (v.emergency && v.me?.alive) {
      em = h('button', { class: `btn ${v.emergency.clicked ? '' : 'red'}`, onClick: () => api.action({ type: 'emergency' }) }, `🚨 Réunion d'urgence ${v.emergency.count}/${v.emergency.required}`);
    }
    if (rebuild) {
      clueInput = answerBox({ placeholder: 'Ton indice (1 mot)…', maxLength: 20, label: 'Envoyer', onSend: (text, draft) => api.action({ type: 'clue', text, draft }) });
      el.replaceChildren();
      fill(el, ...header(`Tour d'indices ${v.clueRound + 1}`, v, v.turnTime * 1000),
        v.banner ? h('div', { class: 'banner' }, v.banner) : null,
        h('div', { class: 'card col', style: { marginTop: '12px' } },
          h('div', { id: 'imp-turn' }), orderChips, myTurn ? clueInput.el : null,
          h('div', { id: 'imp-em', class: 'center' })),
        h('div', { class: 'spacer' }), clueLog(v));
      if (myTurn) clueInput.focus();
    }
    const t = el.querySelector('#imp-turn');
    if (t) fill(t, myTurn ? h('div', { class: 'qtext center' }, '✍️ À toi : donne un indice !') : h('div', { class: 'center' }, '⏳ C\'est le tour de ', who(v.current)));
    const emBox = el.querySelector('#imp-em');
    if (emBox) fill(emBox, em);
  }

  function decision(v) {
    const k = `d${v.clueRound}`;
    const rebuilt = key !== k; key = k;
    if (rebuilt) {
      fill(el, ...header('🤔 Et maintenant ?', v, v.voteTime * 1000),
        h('div', { class: 'card col', style: { marginTop: '12px' } },
          h('div', { class: 'center muted' }, 'Tout le monde a donné son indice. Que décidez-vous ?'),
          h('div', { class: 'decide' },
            h('button', { class: 'btn big pink', id: 'dc-vote', onClick: () => api.action({ type: 'decision', choice: 'vote' }) }, '🗳️ Passer au vote'),
            h('button', { class: 'btn big cyan', id: 'dc-cycle', onClick: () => api.action({ type: 'decision', choice: 'cycle' }) }, '🔁 Un autre tour d\'indices')),
          h('div', { class: 'muted center', id: 'imp-wait' })),
        h('div', { class: 'spacer' }), clueLog(v));
    }
    el.querySelectorAll('.decide button').forEach((b) => { b.disabled = !v.me?.alive; });
    const w = el.querySelector('#imp-wait');
    if (w) w.textContent = v.answered ? `✅ Choix enregistré (${v.decisionCount} réponse(s)) — tu peux encore en changer.` : 'La majorité l\'emporte.';
  }

  function voting(v) {
    const k = `v${v.clueRound}`;
    const rebuilt = key !== k; key = k;
    const players = P();
    const can = !!v.me?.alive;
    const targets = v.alive.filter((id) => id !== api.me());
    if (rebuilt || true) {
      fill(el, ...header('🗳️ Qui est l\'imposteur ?', v, v.voteTime * 1000),
        h('div', { class: 'card col', style: { marginTop: '12px' } },
          h('div', { class: 'muted center' }, v.voted ? `Vote enregistré (${v.progress.done}/${v.progress.total}) — tu peux encore changer d’avis.` : v.me?.alive ? 'Clique sur la personne que tu veux éliminer.' : 'Tu es éliminé : tu ne votes plus.'),
          h('div', { class: 'votegrid' }, targets.map((id) => {
            const lw = [...v.log].reverse().find((l) => l.pid === id && !l.timedOut);
            return h('button', { class: `vcard ${v.voted === id ? 'sel' : ''}`, disabled: !can, onClick: () => api.action({ type: 'vote', target: id }) }, avatar(players[id]?.avatar, 'lg'), h('div', {}, players[id]?.name), lw ? h('div', { class: 'lw' }, `« ${lw.word} »`) : null);
          }))),
        h('div', { class: 'spacer' }), clueLog(v));
    }
  }

  function voteResult(v) {
    if (key === `vr${v.clueRound}`) return; key = `vr${v.clueRound}`;
    const r = v.vote; const players = P();
    const max = Math.max(1, ...r.counts.map((c) => c.count));
    fill(el, ...header('📊 Résultat du vote', v),
      h('div', { class: 'card col', style: { marginTop: '12px' } },
        r.counts.length ? r.counts.map((c) => h('div', { class: 'row' }, h('div', { style: { width: '150px' } }, who(c.pid)), h('div', { class: 'bar', style: { width: `${(c.count / max) * 60}%` } }), h('b', {}, c.count),
          h('span', { class: 'muted' }, r.votes.filter((x) => x.target === c.pid).map((x) => players[x.voter]?.name).join(', ')))) : h('div', { class: 'center muted' }, 'Personne n\'a voté…'),
        r.eliminated ? h('div', { class: 'banner' }, '💀 ', players[r.eliminated.pid]?.name, ' est éliminé… c\'était ', h('b', {}, ROLE[r.eliminated.role])) : h('div', { class: 'banner' }, r.tie ? '⚖️ Égalité : personne n\'est éliminé.' : 'Aucun vote : personne n\'est éliminé.')));
  }

  function whiteGuess(v) {
    const me = api.me(); const isW = me === v.whiteId;
    const k = 'wg'; const rebuilt = key !== k; key = k;
    if (!rebuilt) return;
    const gb = answerBox({ placeholder: 'Le mot des citoyens…', maxLength: 30, label: 'Proposer', onSend: (text, draft) => api.action({ type: 'whiteGuess', text, draft }) });
    fill(el, ...header('⬜ Dernière chance de M. White !', v, 30000),
      h('div', { class: 'card col', style: { marginTop: '12px' } },
        h('div', { class: 'center' }, who(v.whiteId), ' a été démasqué·e ! Il/elle peut gagner en devinant le mot des citoyens.'),
        isW ? gb.el : h('div', { class: 'center muted' }, '🤞 On croise les doigts…')),
      h('div', { class: 'spacer' }), clueLog(v));
    if (isW) gb.focus();
  }

  function result(v) {
    if (key === 'res') return; key = 'res';
    const r = v.result; const players = P();
    const title = r.winner === 'citizens' ? '🎉 Les citoyens gagnent !' : r.winner === 'impostors' ? '😈 Les imposteurs gagnent !' : '⬜ M. White gagne !';
    fill(el, ...header(title, v),
      h('div', { class: 'card col', style: { marginTop: '12px' } },
        h('div', { class: 'banner' }, r.message),
        h('div', { class: 'center' }, 'Mots : ', h('span', { class: 'mini-word' }, '👤 ', r.pair.normal), ' ', h('span', { class: 'mini-word' }, '🕵️ ', r.pair.imposteur)),
        h('div', { class: 'rank' }, r.roles.map((x) => h('div', { class: `rrow ${r.delta[x.pid] ? 'first' : ''}`, style: x.alive ? {} : { opacity: .6 } },
          avatar(players[x.pid]?.avatar), h('span', { class: 'nm' }, players[x.pid]?.name), h('span', { class: 'pill' }, ROLE[x.role]), h('span', { class: 'muted' }, x.role === 'white' ? '???' : x.word),
          r.delta[x.pid] ? h('span', { class: 'gain' }, `+${r.delta[x.pid]}`) : null)))),
      h('div', { class: 'spacer' }), clueLog(v));
  }

  function update(v) {
    if (v.phase === 'intro') intro(v);
    else if (v.phase === 'clues') clues(v);
    else if (v.phase === 'decision') decision(v);
    else if (v.phase === 'voting') voting(v);
    else if (v.phase === 'voteResult') voteResult(v);
    else if (v.phase === 'whiteGuess') whiteGuess(v);
    else if (v.phase === 'result') result(v);
  }
  return { el, update };
}
