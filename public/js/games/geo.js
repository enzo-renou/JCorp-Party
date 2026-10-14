// Quiz Géo : carte, capitales, drapeaux
import { h, fill, avatar, clock, timerBar, answerBox } from '../ui.js';
import { createMap, loadWorld } from '../map.js';

const fmt = (n) => String(n).replace('.', ',');

export default function create(api) {
  const el = h('div');
  let shownKey = null;
  let map = null, box = null, btn = null;
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
      map?.destroy(); map = null; box = null; btn = null;
      let body;
      if (v.q.section === 'loc') {
        // un clic pose (ou déplace) le point : enregistré tout seul ; « Valider » prévient les autres que tu as fini
        const sendPin = (draft) => { const p = map.getPin(); if (p) api.action({ type: 'answer', lat: p[0], lng: p[1], draft }); };
        btn = h('button', { class: 'btn big green', disabled: true, onClick: () => { sendPin(false); btn.textContent = '✓ Position validée'; btn.classList.add('done'); } }, '📍 Valider ma position');
        map = createMap({ interactive: true, onPick: () => { btn.disabled = false; btn.textContent = '📍 Valider ma position'; btn.classList.remove('done'); sendPin(true); } });
        if (v.mine) { map.setPin(v.mine.lat, v.mine.lng); btn.disabled = false; }
        body = [h('div', { class: 'qtext center', style: { marginBottom: '10px' } }, v.q.prompt), map.el,
          h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '12px' } }, btn, h('span', { class: 'muted', id: 'geo-status' }), h('span', { class: 'muted' }, 'Clique sur la carte, tu peux déplacer ton point jusqu’à la fin du temps'))];
      } else {
        box = answerBox({ placeholder: v.q.section === 'flag' ? 'Nom du pays…' : 'Ta réponse…', maxLength: 60, value: v.mine?.text || '', onSend: (text, draft) => api.action({ type: 'answer', text, draft }) });
        body = [h('div', { class: 'qcard' }, h('div', { class: 'qtext' }, v.q.prompt), v.q.flag ? h('img', { class: 'flag', src: `/flags/${v.q.flag}.svg`, alt: 'drapeau à deviner' }) : null, box.el)];
        box.focus();
      }
    fill(el, header(v), timerBar(v.endsAt, v.sections[v.q.section].time * 1000), h('div', { class: 'card', style: { marginTop: '12px' } }, body), h('div', { class: 'spacer' }), h('div', { class: 'avs', id: 'geo-avs' }));
    }
    if (box) box.sync({ text: v.mine?.text, final: v.mineFinal });
    else if (btn && v.mineFinal && !btn.classList.contains('done')) { btn.textContent = '✓ Position validée'; btn.classList.add('done'); }
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
