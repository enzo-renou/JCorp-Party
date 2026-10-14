// Culture G : questionnaire, le maître du jeu corrige
import { h, fill, avatar, clock, timerBar, answerBox } from '../ui.js';

const CAT = {
  foot: '⚽ Foot', cinema: '🎬 Ciné & séries', musique: '🎵 Musique', 'jeux-video': '🎮 Jeux vidéo', anime: '🍥 Anime & manga', histoire: '🏛️ Histoire & mythes',
  sciences: '🔬 Sciences', art: '🎨 Art & littérature', sport: '🏅 Sport', internet: '📱 Internet', rebus: '🧩 Rébus', langue: '🗣️ Langue', divers: '🌀 Divers',
};

export default function create(api) {
  const el = h('div');
  let shownIdx = -2;
  let box = null;
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
      box = answerBox({ value: v.mine || '', onSend: (text, draft) => api.action({ type: 'answer', text, draft }) });
      fill(el, h('div', { class: 'gh' }, h('h2', {}, `Question ${v.idx + 1}/${v.total}`), h('span', { class: 'grow' }), h('div', { class: 'row' }, clock(v.endsAt))),
        timerBar(v.endsAt, v.time * 1000),
        h('div', { class: 'card', style: { marginTop: '12px' } }, qCard(v.q), box.el, h('div', { class: 'muted center', id: 'cq-status' })),
        h('div', { class: 'spacer' }), h('div', { class: 'avs', id: 'cq-avs' }));
      box.focus();
    }
    box.sync({ text: v.mine, final: v.mineFinal });
    const status = el.querySelector('#cq-status');
    status.textContent = state.me === v.masterId ? '🧑‍⚖️ Tu corriges les réponses à la fin (les tiennes sont corrigées automatiquement).' : '';
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
