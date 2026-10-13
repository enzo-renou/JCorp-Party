// Culture G : questionnaire, le maître du jeu corrige
import { h, fill, avatar, clock, timerBar } from '../ui.js';

const CAT = {
  foot: '⚽ Foot', cinema: '🎬 Ciné & séries', musique: '🎵 Musique', 'jeux-video': '🎮 Jeux vidéo', anime: '🍥 Anime & manga', histoire: '🏛️ Histoire & mythes',
  sciences: '🔬 Sciences', art: '🎨 Art & littérature', sport: '🏅 Sport', internet: '📱 Internet', rebus: '🧩 Rébus', langue: '🗣️ Langue', divers: '🌀 Divers',
};

export default function create(api) {
  const el = h('div');
  let shownIdx = -2;
  let input = null;
  let lastPhase = null;

  function qCard(q) {
    const img = q.img ? h('img', { class: 'qimg', src: q.img, alt: 'Qui est-ce ?', onerror: (e) => { e.target.replaceWith(h('div', { class: 'qhint' }, `📷 Photo indisponible — indice : ${q.hint ?? '…'}`)); } }) : null;
    const grid = q.imgs ? h('div', { class: 'pics4' }, q.imgs.map((src) => h('img', { class: 'qimg', src, alt: '', onerror: (e) => e.target.replaceWith(h('div', { class: 'qhint' }, '📷 ?')) }))) : null;
    return h('div', { class: 'qcard' },
      h('span', { class: 'pill cyan qcat' }, CAT[q.cat] ?? q.cat),
      h('div', { class: 'qtext' }, q.q), q.emoji ? h('div', { class: 'qemoji' }, q.emoji) : null, img, grid);
  }

  // ------------------------------------------------------------ questions
  function renderQuestion(v, state) {
    const players = api.byId();
    const me = api.me();
    const key = `q${v.idx}`;
    const answered = new Set(v.answered);
    if (shownIdx !== v.idx || lastPhase !== 'question') {
      shownIdx = v.idx;
      input = h('input', { class: 'input', placeholder: 'Ta réponse…', maxLength: 80, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, value: v.mine || '' });
      const status = h('div', { class: 'muted center', id: 'cq-status' });
      const send = () => { const t = input.value.trim(); if (t) api.action({ type: 'answer', text: t }); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      fill(el, h('div', { class: 'gh' }, h('h2', {}, `Question ${v.idx + 1}/${v.total}`), h('span', { class: 'grow' }), h('div', { class: 'row' }, clock(v.endsAt))),
        timerBar(v.endsAt, v.time * 1000),
        h('div', { class: 'card', style: { marginTop: '12px' } }, qCard(v.q),
          h('div', { class: 'answer-row' }, input, h('button', { class: 'btn cyan', onClick: send }, 'Valider')), status),
        h('div', { class: 'spacer' }), h('div', { class: 'avs', id: 'cq-avs' }));
      setTimeout(() => input.focus(), 50);
    }
    const status = el.querySelector('#cq-status');
    status.textContent = v.mine ? `✅ Réponse envoyée : « ${v.mine} » (tu peux la modifier)` : state.me === v.masterId ? '🧑‍⚖️ Tu es le maître : tu corrigeras les réponses à la fin. Tes réponses sont corrigées automatiquement.' : '';
    fill(el.querySelector('#cq-avs'), Object.values(players).map((p) => h('span', { class: `av-tag ${answered.has(p.id) ? 'done' : ''}` }, avatar(p.avatar, 'sm'), p.name, answered.has(p.id) ? ' ✓' : '')));
  }

  // ------------------------------------------------------------ correction
  function renderReview(v, state) {
    const players = api.byId();
    const isMaster = api.me() === v.masterId;
    const master = players[v.masterId];
    const results = v.phase === 'results';
    const totals = {};
    v.items.forEach((it) => it.rows.forEach((r) => { if (r.ok) totals[r.pid] = (totals[r.pid] || 0) + 1; }));
    const scrollY = window.scrollY;
    fill(el,
      h('div', { class: 'gh' }, master ? avatar(master.avatar, 'lg') : null,
        h('div', {}, h('h2', {}, results ? '📊 Résultats du quiz' : isMaster ? '🧑‍⚖️ À toi de corriger !' : `🧑‍⚖️ ${master?.name ?? '…'} corrige les réponses`),
          h('div', { class: 'muted' }, results ? 'Chaque bonne réponse = 1 point.' : isMaster ? 'Clique sur une réponse pour la valider ✅ ou la refuser ❌. Les bonnes réponses sont déjà pré-cochées.' : 'Regarde les corrections en direct…')),
        h('span', { class: 'grow' }), results && v.endsAt ? clock(v.endsAt) : null),
      h('div', { class: 'card flat', style: { marginBottom: '12px' } }, h('div', { class: 'avs' }, Object.values(players).map((p) => h('span', { class: 'av-tag' }, avatar(p.avatar, 'sm'), `${p.name} · ${totals[p.id] || 0}/${v.items.length}`)))),
      v.items.map((it, qi) => h('div', { class: 'card review-q' },
        h('div', { class: 'qh' }, h('span', { class: 'pill' }, qi + 1), h('span', {}, it.emoji ? `${it.emoji} ` : '', it.q), h('span', { class: 'good-ans' }, `→ ${it.a[0]}`)),
        h('div', {}, it.rows.map((r) => {
          const canClick = isMaster && !results && r.pid !== v.masterId;
          return h('span', { class: `achip ${r.ok ? 'ok' : 'ko'} ${canClick ? 'click' : ''}`, title: canClick ? 'Cliquer pour changer' : '', onClick: canClick ? () => api.action({ type: 'toggle', qi, pid: r.pid }) : null },
            avatar(players[r.pid]?.avatar, 'sm'), h('span', { class: 't' }, r.text || '—'), h('span', {}, r.ok ? '✅' : '❌'), r.pid === v.masterId ? h('span', { class: 'auto' }, 'auto') : null);
        })))),
      isMaster && !results ? h('div', { class: 'stickybar' }, h('button', { class: 'btn big green', onClick: () => api.action({ type: 'validate' }) }, '✅ Valider les corrections')) : null);
    window.scrollTo({ top: scrollY });
  }

  function update(v, state) {
    if (v.phase === 'question') renderQuestion(v, state);
    else if (v.phase === 'review' || v.phase === 'results') renderReview(v, state);
    lastPhase = v.phase;
  }
  return { el, update };
}
