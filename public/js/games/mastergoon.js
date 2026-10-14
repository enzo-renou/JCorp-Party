// Mastergoon : "Ne dis pas la même chose que moi"
import { h, fill, avatar, clock, timerBar, answerBox } from '../ui.js';

const REASON = { same: 'même réponse que le maître', invalid: 'réponse invalide', timeout: 'pas de réponse' };
const VERD = { survive: ['✅', 'Survit'], out: ['💀', 'Éliminé'], revive: ['✨', 'Ressuscité'], fail: ['❌', 'Raté'] };

export default function create(api) {
  const el = h('div');
  let key = null;
  const P = () => api.byId();
  const who = (id) => h('span', { class: 'row', style: { gap: '6px' } }, avatar(P()[id]?.avatar, 'sm'), h('b', {}, P()[id]?.name ?? '?'));

  function status(v) {
    const players = P();
    return h('div', { class: 'avs' }, Object.keys(v.raw).map((id) => h('span', { class: 'av-tag', style: { opacity: v.alive[id] || id === v.masterId ? 1 : .35 } }, avatar(players[id]?.avatar, 'sm'), players[id]?.name, id === v.masterId ? ' 👑' : v.alive[id] ? '' : ' 💀', v.raw[id] || id === v.masterId ? ` · ${v.raw[id]} pt` : '')));
  }
  const head = (v, title) => h('div', { class: 'gh' }, h('h2', {}, title), h('span', { class: 'pill' }, `Q ${v.qIndex + 1}/${v.maxQuestions}`), h('span', { class: 'grow' }), v.endsAt ? clock(v.endsAt) : null);
  const qcard = (v) => h('div', { class: 'qcard mg-q' }, h('div', { class: 'lvl' }, '★'.repeat(v.question.level || 1)), h('div', { class: 'qtext' }, v.question.text),
    v.question.choices?.length ? h('div', { class: 'choices' }, v.question.choices.map((c) => h('span', {}, c))) : null);

  function intro(v) {
    if (key === 'intro') return; key = 'intro';
    const m = P()[v.masterId];
    fill(el, head(v, '🧠 Mastergoon'), h('div', { class: 'card col center' }, h('div', { class: 'qtext' }, `${m?.name ?? 'Le maître'} 👑 répond en secret.`),
      h('div', { class: 'muted' }, 'Ne donne PAS la même réponse que lui, sinon tu es éliminé ! Les survivants marquent 1 point par question.'), status(v)));
  }

  let box = null;
  function answering(v) {
    const isMg = api.me() === v.masterId;
    const k = `a${v.qIndex}`;
    const rebuild = key !== k; key = k;
    const answered = new Set(v.answered);
    const players = P();
    const dead = !isMg && v.alive[api.me()] === false;
    if (rebuild) {
      box = answerBox({ placeholder: isMg ? 'Ta réponse secrète…' : dead ? 'Joker : trouve la réponse du maître…' : 'Ta réponse…', maxLength: 60, value: v.mine || '',
        onSend: (text, draft) => api.action({ type: dead ? 'joker' : 'answer', text, draft }) });
      fill(el, head(v, isMg ? '👑 Tu es le maître' : '🧠 Mastergoon'), timerBar(v.endsAt),
        h('div', { class: 'card col', style: { marginTop: '12px' } }, qcard(v),
          dead ? h('div', { class: 'banner' }, v.canJoker ? '💀 Tu es éliminé : tente le joker en devinant la même réponse que le maître !' : '💀 Tu es éliminé.') : null,
          (!dead || v.canJoker) ? box.el : null,
          dead && v.canJoker ? h('div', { class: 'center' }, h('button', { class: 'btn sm', id: 'mg-pass', onClick: () => api.action({ type: 'jokerPass' }) }, 'Passer mon joker')) : null),
        h('div', { class: 'spacer' }), h('div', { class: 'avs', id: 'mg-av' }), status(v));
      if (!dead || v.canJoker) box.focus();
    }
    box.sync({ text: v.mine, final: v.mineFinal });
    el.querySelector('#mg-pass')?.toggleAttribute('disabled', !!v.jokerPassed);
    const av = el.querySelector('#mg-av');
    if (av) fill(av, Object.keys(v.alive).map((id) => h('span', { class: `av-tag ${answered.has(id) ? 'done' : ''}` }, avatar(players[id]?.avatar, 'sm'), players[id]?.name, answered.has(id) ? ' ✓' : '')));
  }

  function reveal(v) {
    const isMg = api.me() === v.masterId;
    const scrollY = window.scrollY;
    key = 'reveal';
    const players = P();
    fill(el, head(v, '🔎 Révélation'),
      h('div', { class: 'card col', style: { marginTop: '12px' } }, qcard(v),
        h('div', { class: 'center' }, h('div', { class: 'muted' }, `Réponse de ${players[v.masterId]?.name} 👑`), h('div', { class: 'mg-answer' }, v.mgAnswer ?? '—')),
        v.mgTimeout ? h('div', { class: 'banner' }, '⏱️ Le maître n\'a pas répondu à temps : question annulée.') : null,
        h('div', { class: 'col' }, (v.entries || []).map((e) => {
          const fin = e.finalVerdict; const [ico, lab] = VERD[fin] || ['', ''];
          const canDecide = isMg && !e.locked && !v.mgTimeout;
          const btns = e.joker ? [['revive', '✨'], ['fail', '❌']] : [['survive', '✅'], ['out', '💀'], ['invalid', '🚫']];
          const cur = e.verdict === 'out' ? (e.reason === 'invalid' ? 'invalid' : 'out') : e.verdict;
          return h('div', { class: `entry ${fin} ${e.flipped ? 'flipped' : ''}` }, who(e.pid), h('span', { class: 't' }, e.text ?? '—'),
            h('span', { class: 'pill' }, `${ico} ${lab}`, e.joker ? ' (joker)' : ''), e.reason && fin === 'out' ? h('span', { class: 'muted' }, REASON[e.reason]) : null,
            canDecide ? h('div', { class: 'vbtns' }, btns.map(([vk, em]) => h('button', { class: `vb ${cur === vk ? `on-${vk}` : ''}`, onClick: () => api.action({ type: 'decide', pid: e.pid, verdict: vk }) }, em))) : null,
            e.canContest ? h('button', { class: `btn small ${e.youContested ? 'yellow' : ''}`, onClick: () => api.action({ type: 'contest', pid: e.pid }) }, `⚖️ Contester ${e.contests}/${e.eligible}`) : (e.contests ? h('span', { class: 'muted' }, `⚖️ ${e.contests}/${e.eligible}`) : null),
            e.flipped ? h('span', { class: 'pill yellow' }, 'inversé par vote') : null);
        })),
        isMg ? h('div', { class: 'stickybar' }, h('button', { class: 'btn big green', onClick: () => api.action({ type: 'next' }) }, '➡️ Question suivante')) : h('div', { class: 'muted center' }, 'Le maître valide les réponses. Tu peux contester une décision ⚖️.')),
      h('div', { class: 'spacer' }), status(v));
    window.scrollTo({ top: scrollY });
  }

  function turnEnd(v) {
    if (key === 'end') return; key = 'end';
    const players = P();
    fill(el, h('div', { class: 'gh' }, h('h2', {}, '🏁 Fin de la partie Mastergoon'), h('span', { class: 'grow' }), v.endsAt ? clock(v.endsAt) : null),
      h('div', { class: 'card col' }, h('div', { class: 'rank' }, Object.entries(v.raw).sort((a, b) => b[1] - a[1]).map(([id, pts], i) => h('div', { class: `rrow ${i === 0 ? 'first' : ''}` }, h('span', { class: 'pos' }, i + 1), avatar(players[id]?.avatar), h('span', { class: 'nm' }, players[id]?.name), h('span', { class: 'tot' }, `${pts} pt${pts > 1 ? 's' : ''}`)))),
        h('div', { class: 'recap' }, (v.log || []).map((q, i) => h('div', { class: 'it' }, h('div', {}, h('b', {}, `${i + 1}. ${q.text}`), ' → ', h('span', { class: 'mg-answer', style: { fontSize: '1.1rem' } }, q.mgTimeout ? '⏱️' : q.mgAnswer), q.mgDelta ? h('span', { class: 'pill red', style: { marginLeft: '8px' } }, `👑 ${q.mgDelta}`) : null),
          h('div', { class: 'avs', style: { marginTop: '4px' } }, q.rows.map((r) => h('span', { title: r.text ?? '' }, (VERD[r.verdict] || [''])[0], avatar(players[r.pid]?.avatar, 'sm')))))))));
  }

  function update(v) {
    if (v.phase === 'intro') intro(v);
    else if (v.phase === 'answering') answering(v);
    else if (v.phase === 'reveal') reveal(v);
    else if (v.phase === 'turnEnd') turnEnd(v);
  }
  return { el, update };
}
