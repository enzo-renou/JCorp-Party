// Make It Meme : éditeur de légendes, votes 👍 / 😐 / 👎, Meme Buddy
import { h, fill, avatar, clock, timerBar } from '../ui.js';

const fmt = (n) => (n > 0 ? `+${n}` : String(n));

/** meme = { src, w, h, boxes:[{t,x,y,s,c,w}] } → élément affichable (taille du texte en % de la largeur du meme) */
export function memeEl(meme, { editable = false, onChange, onSelect, selected = -1, className = '' } = {}) {
  const el = h('div', { class: `meme ${className}`, style: { aspectRatio: `${meme.w} / ${meme.h}` } }, h('img', { src: meme.src, alt: 'meme', draggable: false }));
  (meme.boxes || []).forEach((b, i) => {
    const box = h('div', { class: `mbox ${b.c === 'b' ? 'dark' : ''} ${editable ? 'editable' : ''} ${i === selected ? 'sel' : ''} ${editable && !b.t ? 'empty' : ''}`, dataset: { i },
      style: { left: `${b.x}%`, top: `${b.y}%`, width: `${b.w ?? 60}%`, fontSize: `${b.s}cqw` } }, b.t || (editable ? 'Texte…' : ''));
    if (editable) {
      box.addEventListener('pointerdown', (e) => {
        e.preventDefault(); onSelect?.(i); box.setPointerCapture(e.pointerId);
        const r = el.getBoundingClientRect();
        const move = (ev) => { b.x = Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)); b.y = Math.min(100, Math.max(0, ((ev.clientY - r.top) / r.height) * 100)); box.style.left = `${b.x}%`; box.style.top = `${b.y}%`; };
        const up = () => { box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); onChange?.(); };
        box.addEventListener('pointermove', move); box.addEventListener('pointerup', up);
      });
    }
    el.append(box);
  });
  return el;
}

export default function create(api) {
  const el = h('div');
  let key = null;
  const P = () => api.byId();
  const who = (id) => h('span', { class: 'row', style: { gap: '6px' } }, avatar(P()[id]?.avatar, 'sm'), h('b', {}, P()[id]?.name ?? '?'));
  const head = (v, title) => h('div', { class: 'gh' }, h('h2', {}, title), h('span', { class: 'pill' }, `Tour ${v.round}/${v.rounds}`), v.topic ? h('span', { class: 'pill yellow' }, `🎯 ${v.topic}`) : null,
    v.mode === 'same' ? h('span', { class: 'pill cyan' }, 'Même meme') : null, v.mode === 'relaxed' ? h('span', { class: 'pill' }, '😌 Détente') : null,
    h('span', { class: 'grow' }), v.endsAt ? clock(v.endsAt) : null);

  // ------------------------------------------------------------ intro
  function intro(v) {
    if (key === `i${v.round}`) return; key = `i${v.round}`;
    fill(el, head(v, '😂 Make It Meme'), h('div', { class: 'card col center' },
      h('div', { class: 'qtext' }, 'Prépare-toi à légender !'),
      v.topic ? h('div', { class: 'banner' }, `🎯 Thème de la manche : ${v.topic}`) : null,
      h('div', { class: 'muted' }, v.mode === 'same' ? 'Tout le monde a la même image.' : 'Chacun reçoit une image différente.'),
      h('div', { class: 'muted' }, `Tu auras ${v.captionTime} secondes. Ajoute des textes, place-les où tu veux, puis valide.`)));
  }

  // ------------------------------------------------------------ éditeur
  let ed = null;
  function creating(v) {
    if (!v.myTpl) { key = 'wait'; fill(el, head(v, '😂 Légende en cours…'), h('div', { class: 'card center muted' }, 'Tu rejoins à la prochaine manche.')); return; }
    const k = `c${v.round}`;
    if (key !== k) {
      key = k;
      ed = { boxes: v.draft?.length ? v.draft.map((b) => ({ ...b })) : [{ t: '', x: 50, y: 10, s: 8, c: 'w', w: 90 }, { t: '', x: 50, y: 90, s: 8, c: 'w', w: 90 }], sel: 0, tpl: v.myTpl, timer: null, ready: false };
      build(v);
    }
    // l'image peut changer (« Autre image »)
    if (ed.tpl.src !== v.myTpl.src) { ed.tpl = v.myTpl; paint(); }
    ed.ready = v.ready;
    el.querySelector('#me-ready')?.replaceChildren(v.ready ? '✏️ Modifier' : '✅ Valider ma légende');
    el.querySelector('#me-ready')?.classList.toggle('green', !v.ready);
    el.querySelector('#me-lock')?.classList.toggle('hidden', !v.ready);
    el.querySelector('#me-reroll')?.toggleAttribute('disabled', !v.canReroll);
    const list = el.querySelector('#me-players');
    if (list) fill(list, Object.values(P()).filter((p) => !p.spectator).map((p) => h('span', { class: `av-tag ${v.readyIds.includes(p.id) ? 'done' : ''}` }, avatar(p.avatar, 'sm'), p.name, v.readyIds.includes(p.id) ? ' ✓' : '')));
  }
  const save = (type = 'draft') => api.action({ type, boxes: ed.boxes });
  const saveSoon = () => { clearTimeout(ed.timer); ed.timer = setTimeout(() => save('draft'), 500); };
  function paint() {
    const box = el.querySelector('#me-stage'); if (!box) return;
    box.replaceChildren(memeEl({ ...ed.tpl, boxes: ed.boxes }, { editable: !ed.ready, selected: ed.sel, onSelect: (i) => { ed.sel = i; tools(); highlight(); }, onChange: saveSoon }));
    tools();
  }
  function highlight() { el.querySelectorAll('.mbox').forEach((n) => n.classList.toggle('sel', Number(n.dataset.i) === ed.sel)); }
  function tools() {
    const t = el.querySelector('#me-tools'); if (!t) return;
    const b = ed.boxes[ed.sel];
    if (!b) { fill(t, h('div', { class: 'muted' }, 'Ajoute un texte avec le bouton ➕, puis fais-le glisser sur l’image.')); return; }
    const txt = h('input', { class: 'input', value: b.t, maxLength: 90, placeholder: 'Écris ta légende…', onInput: (e) => { b.t = e.target.value; const n = el.querySelector(`.mbox[data-i="${ed.sel}"]`); if (n) { n.textContent = b.t || 'Texte…'; n.classList.toggle('empty', !b.t); } saveSoon(); } });
    fill(t, txt,
      h('div', { class: 'row wrap', style: { gap: '14px' } },
        h('label', { class: 'muted' }, 'Taille ', h('input', { type: 'range', min: 3, max: 16, step: 0.5, value: b.s, onInput: (e) => { b.s = Number(e.target.value); const n = el.querySelector(`.mbox[data-i="${ed.sel}"]`); if (n) n.style.fontSize = `${b.s}cqw`; saveSoon(); } })),
        h('label', { class: 'muted' }, 'Largeur ', h('input', { type: 'range', min: 20, max: 100, step: 5, value: b.w ?? 60, onInput: (e) => { b.w = Number(e.target.value); const n = el.querySelector(`.mbox[data-i="${ed.sel}"]`); if (n) n.style.width = `${b.w}%`; saveSoon(); } })),
        h('button', { class: 'btn sm', onClick: () => { b.c = b.c === 'b' ? 'w' : 'b'; paint(); saveSoon(); } }, b.c === 'b' ? '⚫ Noir' : '⚪ Blanc'),
        h('button', { class: 'btn sm red', onClick: () => { ed.boxes.splice(ed.sel, 1); ed.sel = Math.min(ed.sel, ed.boxes.length - 1); paint(); saveSoon(); } }, '🗑️ Supprimer')));
    if (document.activeElement === document.body) txt.focus();
  }
  function build(v) {
    fill(el, head(v, '😂 Écris ta légende'), timerBar(v.endsAt, v.captionTime * 1000),
      h('div', { class: 'card col', style: { marginTop: '12px' } },
        h('div', { id: 'me-stage', class: 'me-stage' }),
        h('div', { id: 'me-lock', class: 'banner hidden' }, '✅ Légende validée ! Tu peux encore la modifier tant que les autres écrivent.'),
        h('div', { class: 'row wrap', style: { justifyContent: 'center', gap: '8px' } },
          h('button', { class: 'btn cyan sm', onClick: () => { if (ed.ready || ed.boxes.length >= 6) return; ed.boxes.push({ t: '', x: 50, y: 50, s: 8, c: 'w', w: 80 }); ed.sel = ed.boxes.length - 1; paint(); document.querySelector('#me-tools input')?.focus(); } }, '➕ Ajouter un texte'),
          h('button', { class: 'btn sm', id: 'me-reroll', disabled: !v.canReroll, onClick: () => api.action({ type: 'reroll' }) }, '🎲 Autre image (1×)'),
          h('button', { class: 'btn green', id: 'me-ready', onClick: () => { if (ed.ready) { api.action({ type: 'unsubmit' }); return; } if (!ed.boxes.some((b) => b.t.trim())) return; clearTimeout(ed.timer); save('submit'); } }, '✅ Valider ma légende')),
        h('div', { id: 'me-tools', class: 'col' })),
      h('div', { class: 'spacer' }), h('div', { class: 'avs', id: 'me-players' }));
    paint();
  }

  // ------------------------------------------------------------ vote
  function voting(v) {
    const k = `v${v.round}-${v.idx}`;
    const first = key !== k; key = k;
    if (first) {
      fill(el, head(v, `🗳️ Meme ${v.idx + 1}/${v.total}`), timerBar(v.endsAt),
        h('div', { class: 'vote-stage' }, h('div', { id: 'mv-meme' }), h('div', { id: 'mv-ctl', class: 'col' })), h('div', { class: 'spacer' }), h('div', { class: 'avs', id: 'mv-av' }));
      fill(el.querySelector('#mv-meme'), memeEl(v.meme, { className: 'big' }));
    }
    const vote = (x) => api.action({ type: 'vote', v: x });
    const btn = (x, label, cls) => h('button', { class: `vbtn ${cls} ${v.myVote === x ? 'on' : ''}`, disabled: v.mine, onClick: () => vote(x) }, label);
    fill(el.querySelector('#mv-ctl'),
      v.mine ? h('div', { class: 'banner' }, '😎 C’est ton meme ! Croise les doigts…') : h('div', { class: 'vbtns3' }, btn('up', '👍', 'up'), btn('meh', '😐', 'meh'), btn('down', '👎', 'down')),
      !v.mine ? h('button', { class: `btn ${v.buddyHere ? 'yellow' : ''}`, disabled: v.buddyUsed && !v.buddyHere, title: 'Une fois par manche : tu gagnes la moitié des points de ce meme', onClick: () => api.action({ type: 'buddy' }) }, v.buddyHere ? '🤝 Meme Buddy donné !' : v.buddyUsed ? '🤝 Buddy déjà utilisé' : '🤝 Donner mon Meme Buddy') : null,
      h('div', { class: 'muted center' }, `${v.voted.length}/${v.eligible} ont voté`));
    const players = Object.values(P()).filter((p) => !p.spectator);
    fill(el.querySelector('#mv-av'), players.map((p) => h('span', { class: `av-tag ${v.voted.includes(p.id) ? 'done' : ''}` }, avatar(p.avatar, 'sm'), p.name)));
  }

  function memeResult(v) {
    const k = `mr${v.round}-${v.idx}`; if (key === k) return; key = k;
    const r = v.result;
    fill(el, head(v, `Meme ${v.idx + 1}/${v.total}`),
      h('div', { class: 'vote-stage' }, memeEl(v.meme, { className: 'big' }),
        h('div', { class: 'col center' }, h('div', { class: 'muted' }, 'Légende de'), who(v.meme.author),
          h('div', { class: 'mscore' }, `${fmt(r.total)} pts`),
          h('div', { class: 'row', style: { justifyContent: 'center', gap: '14px', fontSize: '1.4rem' } }, h('span', {}, `👍 ${r.up}`), h('span', {}, `😐 ${r.meh}`), h('span', {}, `👎 ${r.down}`)),
          r.buddies.length ? h('div', { class: 'muted' }, `🤝 Meme Buddy : ${r.buddies.map((id) => P()[id]?.name).join(', ')} (+${r.bonus} pts)`) : null)));
  }

  function roundResults(v) {
    const k = `rr${v.round}`; if (key === k) return; key = k;
    const players = P();
    const ranking = Object.entries(v.raw).sort((a, b) => b[1] - a[1]);
    fill(el, head(v, '📊 Résultats de la manche'),
      v.memes.length ? h('div', { class: 'card col' }, h('h3', {}, '🏆 Les memes de la manche'),
        h('div', { class: 'gallery' }, v.memes.map((m, i) => h('div', { class: 'gitem' }, memeEl(m, { className: 'small' }),
          h('div', { class: 'row', style: { justifyContent: 'space-between' } }, who(m.author), h('b', { class: m.result.total < 0 ? 'neg' : 'gain' }, `${i === 0 ? '👑 ' : ''}${fmt(m.result.total)}`)))))) : h('div', { class: 'card center muted' }, 'Aucun meme cette manche…'),
      h('div', { class: 'card col', style: { marginTop: '12px' } }, h('h3', {}, v.mode === 'relaxed' ? 'Mode détente : pas de points' : 'Classement de la partie'),
        v.mode === 'relaxed' ? null : h('div', { class: 'rank' }, ranking.map(([id, pts], i) => h('div', { class: `rrow ${i === 0 ? 'first' : ''}` }, h('span', { class: 'pos' }, i + 1), avatar(players[id]?.avatar), h('span', { class: 'nm' }, players[id]?.name), h('span', { class: 'tot' }, pts))))),
      v.last && v.best.length ? h('div', { class: 'card col', style: { marginTop: '12px' } }, h('h3', {}, '⭐ Les meilleurs memes de la partie'),
        h('div', { class: 'gallery' }, v.best.map((m) => h('div', { class: 'gitem' }, memeEl(m, { className: 'small' }), h('div', { class: 'row', style: { justifyContent: 'space-between' } }, who(m.author), h('b', { class: 'gain' }, fmt(m.total))))))) : null);
  }

  function update(v) {
    if (v.phase === 'intro') intro(v);
    else if (v.phase === 'creating') creating(v);
    else if (v.phase === 'voting') voting(v);
    else if (v.phase === 'memeResult') memeResult(v);
    else if (v.phase === 'roundResults') roundResults(v);
  }
  return { el, update, unmount() { clearTimeout(ed?.timer); } };
}
