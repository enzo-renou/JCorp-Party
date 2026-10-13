// Quiz Géo : carte, capitales, drapeaux
import { h, fill, avatar, clock, timerBar } from '../ui.js';
import { createMap, loadWorld } from '../map.js';

const fmt = (n) => String(n).replace('.', ',');

export default function create(api) {
  const el = h('div');
  let shownKey = null;
  let map = null;
  loadWorld();

  const secBadge = (v) => h('span', { class: 'sec-tag' }, `${v.sections[v.q.section].emoji} ${v.sections[v.q.section].label}`);
  const tierBadge = (q) => h('span', { class: `tier t${q.tier}` }, q.tierLabel);

  function header(v) {
    return h('div', { class: 'gh' }, h('h2', {}, `Question ${v.idx + 1}/${v.total}`), secBadge(v), tierBadge(v.q), h('span', { class: 'grow' }), v.phase === 'question' ? clock(v.endsAt) : null);
  }

  // ------------------------------------------------------------ question
  function renderQuestion(v, state) {
    const key = `q${v.idx}`;
    const players = api.byId();
    const answered = new Set(v.answered);
    if (shownKey !== key) {
      shownKey = key;
      map?.destroy(); map = null;
      let body;
      if (v.q.section === 'loc') {
        const btn = h('button', { class: 'btn big green', disabled: true, onClick: () => { const p = map.getPin(); if (p) { api.action({ type: 'answer', lat: p[0], lng: p[1] }); map.lock(); btn.disabled = true; } } }, '📍 Valider ma position');
        map = createMap({ interactive: true, onPick: () => { btn.disabled = false; } });
        if (v.mine) { map.setPin(v.mine.lat, v.mine.lng); map.lock(); }
        body = [h('div', { class: 'qtext center', style: { marginBottom: '10px' } }, v.q.prompt), map.el,
          h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '12px' } }, btn, h('span', { class: 'muted', id: 'geo-status' }), h('span', { class: 'muted' }, 'Clique sur la carte (molette / pincement pour zoomer)'))];
        if (v.mine) btn.disabled = true;
      } else {
        const input = h('input', { class: 'input', placeholder: v.q.section === 'flag' ? 'Nom du pays…' : 'Ta réponse…', maxLength: 60, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
        const send = () => { const t = input.value.trim(); if (t) api.action({ type: 'answer', text: t }); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
        body = [h('div', { class: 'qcard' }, h('div', { class: 'qtext' }, v.q.prompt), v.q.flag ? h('img', { class: 'flag', src: `/flags/${v.q.flag}.svg`, alt: 'drapeau à deviner' }) : null,
          h('div', { class: 'answer-row' }, input, h('button', { class: 'btn cyan', id: 'geo-send', onClick: send }, 'Valider')), h('div', { class: 'muted', id: 'geo-status', style: { marginTop: '8px' } }))];
        setTimeout(() => input.focus(), 60);
      }
      fill(el, header(v), timerBar(v.endsAt, v.sections[v.q.section].time * 1000), h('div', { class: 'card', style: { marginTop: '12px' } }, body), h('div', { class: 'spacer' }), h('div', { class: 'avs', id: 'geo-avs' }));
    }
    const st = el.querySelector('#geo-status');
    if (st && v.mine) st.textContent = '✅ Réponse envoyée, on attend les autres…';
    if (v.mine && v.q.section !== 'loc') {
      el.querySelector('input')?.setAttribute('disabled', '');
      el.querySelector('#geo-send')?.setAttribute('disabled', '');
    }
    fill(el.querySelector('#geo-avs'), Object.values(players).map((p) => h('span', { class: `av-tag ${answered.has(p.id) ? 'done' : ''}` }, avatar(p.avatar, 'sm'), p.name, answered.has(p.id) ? ' ✓' : '')));
  }

  // ------------------------------------------------------------ correction
  function renderReveal(v) {
    const key = `r${v.idx}`;
    if (shownKey === key) return;
    shownKey = key;
    map?.destroy(); map = null;
    const players = api.byId();
    let mapBox = null;
    if (v.q.section === 'loc') {
      map = createMap({ interactive: false });
      map.reveal({ target: v.q.target, pins: v.rows.filter((r) => r.answer?.lat !== undefined).map((r) => ({ lat: r.answer.lat, lng: r.answer.lng, ok: r.ok, name: players[r.pid]?.name ?? '?' })) });
      mapBox = map.el;
    }
    fill(el,
      h('div', { class: 'gh' }, h('h2', {}, `Question ${v.idx + 1}/${v.total}`), secBadge(v), tierBadge(v.q), h('span', { class: 'grow' }), v.endsAt ? clock(v.endsAt) : null),
      h('div', { class: 'card col' },
        h('div', { class: 'center' }, h('div', { class: 'muted' }, v.q.prompt), h('div', { class: 'qtext', style: { color: 'var(--green)' } }, `✔ ${v.q.answerLabel}`), v.q.flag ? h('img', { class: 'flag', src: `/flags/${v.q.flag}.svg`, alt: '' }) : null),
        mapBox,
        h('div', { class: 'rank' }, v.rows.map((r) => h('div', { class: `rrow ${r.pid === api.me() ? 'me' : ''}` },
          avatar(players[r.pid]?.avatar), h('span', { class: 'nm' }, players[r.pid]?.name),
          h('span', { class: 'muted' }, r.answer == null ? '— pas de réponse' : r.answer.text ? `« ${r.answer.text} »` : r.dist === 0 ? 'en plein dedans !' : `à ${r.dist.toLocaleString('fr-FR')} km`),
          h('span', { class: r.pts > 0 ? 'gain' : '', style: r.pts > 0 ? {} : { color: 'var(--red)', fontFamily: 'var(--display)', fontWeight: 800 } }, r.pts > 0 ? `+${fmt(r.pts)}` : '✗'))))));
  }

  // ------------------------------------------------------------ résultats
  function renderResults(v) {
    if (shownKey === 'results') return;
    shownKey = 'results';
    map?.destroy(); map = null;
    const players = api.byId();
    const ranking = Object.entries(v.raw).sort((a, b) => b[1] - a[1]);
    fill(el, h('div', { class: 'gh' }, h('h2', {}, '🌍 Résultats du quiz géo'), h('span', { class: 'grow' }), v.endsAt ? clock(v.endsAt) : null),
      h('div', { class: 'card col' },
        h('div', { class: 'rank' }, ranking.map(([id, pts], i) => h('div', { class: `rrow ${i === 0 ? 'first' : ''}` }, h('span', { class: 'pos' }, i + 1), avatar(players[id]?.avatar), h('span', { class: 'nm' }, players[id]?.name), h('span', { class: 'tot' }, `${fmt(pts)}/${v.max}`)))),
        h('div', { class: 'recap' }, v.recap.map((q) => h('div', { class: 'it' }, h('div', {}, h('b', {}, `${v.sections[q.section].emoji} ${q.answerLabel}`), ' ', h('span', { class: `tier t${q.tier}` }, q.tierLabel)),
          h('div', { class: 'avs', style: { marginTop: '4px' } }, q.rows.map((r) => h('span', { title: players[r.pid]?.name }, r.pts > 0 ? (r.ok ? '✅' : '🟡') : '❌', r.pts > 0 ? h('small', {}, fmt(r.pts)) : null, avatar(players[r.pid]?.avatar, 'sm')))))))));
  }

  function update(v) {
    if (v.phase === 'question') renderQuestion(v);
    else if (v.phase === 'reveal') renderReveal(v);
    else if (v.phase === 'results') renderResults(v);
  }
  return { el, update, unmount() { map?.destroy(); } };
}
