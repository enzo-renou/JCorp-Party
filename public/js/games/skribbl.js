// Skribbl : dessine, devine
import { h, fill, avatar, clock, timerBar } from '../ui.js';

const W = 800, H = 600;
const COLORS = ['#000000', '#ffffff', '#7f7f7f', '#c3c3c3', '#880015', '#ed1c24', '#ff7f27', '#ffc90e', '#fff200', '#b5e61d', '#22b14c',
  '#00a2e8', '#3f48cc', '#a349a4', '#ffaec9', '#b97a57', '#99d9ea', '#7092be', '#c8bfe7', '#efe4b0', '#0b5345', '#5b2c6f'];
const SIZES = [3, 7, 14, 26];

const hexToRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export default function create(api) {
  const canvas = h('canvas', { width: W, height: H });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let tool = 'pen', color = '#000000', size = SIZES[1];
  let view = null, turn = null;
  let items = [];            // traits de la manche courante (pour annuler / rejouer)
  let remoteLast = {};       // dernier point reçu de chaque trait distant
  let cur = null;            // trait en cours (dessinateur)
  let flushTimer = null;

  // ------------------------------------------------------------ dessin
  const resetCanvas = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); };
  resetCanvas();

  function seg(c, w, a, b) {
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!b || (a[0] === b[0] && a[1] === b[1])) { ctx.beginPath(); ctx.arc(a[0], a[1], w / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  function drawPts(c, w, pts) {
    if (pts.length === 1) return seg(c, w, pts[0]);
    for (let i = 1; i < pts.length; i++) seg(c, w, pts[i - 1], pts[i]);
  }
  function floodFill(x, y, hex) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const [fr, fg, fb] = hexToRgb(hex);
    const i0 = (y * W + x) * 4;
    const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
    if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 8) return;
    const tol = 70, seen = new Uint8Array(W * H);
    const ok = (p) => Math.abs(d[p * 4] - tr) + Math.abs(d[p * 4 + 1] - tg) + Math.abs(d[p * 4 + 2] - tb) <= tol;
    const stack = [y * W + x];
    while (stack.length) {
      let p = stack.pop();
      let px = p % W; const py = (p / W) | 0;
      // on remonte vers la gauche puis on balaie la ligne
      while (px > 0 && !seen[p - 1] && ok(p - 1)) { px--; p--; }
      let up = false, down = false;
      while (px < W && !seen[p] && ok(p)) {
        seen[p] = 1; d[p * 4] = fr; d[p * 4 + 1] = fg; d[p * 4 + 2] = fb; d[p * 4 + 3] = 255;
        if (py > 0) { const u = p - W; if (!seen[u] && ok(u)) { if (!up) { stack.push(u); up = true; } } else up = false; }
        if (py < H - 1) { const dn = p + W; if (!seen[dn] && ok(dn)) { if (!down) { stack.push(dn); down = true; } } else down = false; }
        px++; p++;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function replay(list) {
    resetCanvas();
    for (const it of list) {
      if (it.k === 'f') floodFill(it.x, it.y, it.c);
      else drawPts(it.c, it.w, it.pts);
    }
  }

  // ------------------------------------------------------------ réseau (dessin des autres)
  function onFx(event, data) {
    if (event === 'stroke') {
      const last = remoteLast[data.id];
      let prev = last;
      data.pts.forEach((p, i) => {
        if (!prev) { seg(data.c, data.w, p); } else seg(data.c, data.w, prev, p);
        prev = p;
        if (i === data.pts.length - 1) remoteLast[data.id] = p;
      });
    } else if (event === 'fill') {
      floodFill(data.x, data.y, data.c);
    } else if (event === 'clear') {
      if (data.turn !== undefined && data.turn !== turn && turn !== null && view) { /* nouveau tour : géré par update */ }
      items = []; remoteLast = {}; resetCanvas();
    } else if (event === 'strokes') {
      if (data.turn !== turn) return;
      items = data.list; remoteLast = {}; replay(items);
    }
  }

  // ------------------------------------------------------------ dessin local (dessinateur)
  const canDraw = () => view && view.phase === 'drawing' && view.drawerId === api.me();
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.round(Math.min(W, Math.max(0, ((e.clientX - r.left) * W) / r.width))), Math.round(Math.min(H, Math.max(0, ((e.clientY - r.top) * H) / r.height)))];
  };
  const strokeColor = () => (tool === 'eraser' ? '#ffffff' : color);
  function flush(final) {
    if (!cur) return;
    if (cur.pts.length > cur.sent) {
      api.action({ type: 'stroke', id: cur.id, c: cur.c, w: cur.w, pts: cur.pts.slice(cur.sent, cur.sent + 200) });
      cur.sent = Math.min(cur.pts.length, cur.sent + 200);
      if (cur.sent < cur.pts.length) return flush(final);
    }
    if (final) { clearInterval(flushTimer); cur = null; }
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!canDraw()) return;
    e.preventDefault();
    const p = pos(e);
    if (tool === 'fill') {
      const it = { k: 'f', x: Math.min(W - 1, p[0]), y: Math.min(H - 1, p[1]), c: color };
      floodFill(it.x, it.y, it.c); items.push(it); api.action({ type: 'fill', x: it.x, y: it.y, c: it.c });
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    cur = { id: Math.random().toString(36).slice(2, 10), k: 's', c: strokeColor(), w: tool === 'eraser' ? size * 1.6 : size, pts: [p], sent: 0 };
    items.push(cur);
    seg(cur.c, cur.w, p);
    flushTimer = setInterval(() => flush(false), 60);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = pos(ev), l = cur.pts[cur.pts.length - 1];
      if (Math.abs(p[0] - l[0]) + Math.abs(p[1] - l[1]) < 2) continue;
      seg(cur.c, cur.w, l, p);
      cur.pts.push(p);
    }
  });
  const end = () => { if (cur) flush(true); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // ------------------------------------------------------------ interface
  const clockSlot = h('div'), wordSlot = h('div', { class: 'sk-word' }), turnSlot = h('div', { class: 'pill' });
  const barSlot = h('div');
  const overlay = h('div', { class: 'overlay hidden' });
  const wrap = h('div', { class: 'canvas-wrap' }, canvas, overlay);

  const swatches = COLORS.map((c) => h('button', { class: 'swatch', style: { background: c }, title: c, onClick: () => { color = c; if (tool === 'eraser') tool = 'pen'; paintTools(); } }));
  const toolBtns = {
    pen: h('button', { class: 'tbtn', title: 'Crayon', onClick: () => { tool = 'pen'; paintTools(); } }, '✏️'),
    eraser: h('button', { class: 'tbtn', title: 'Gomme', onClick: () => { tool = 'eraser'; paintTools(); } }, '🧽'),
    fill: h('button', { class: 'tbtn', title: 'Pot de peinture', onClick: () => { tool = 'fill'; paintTools(); } }, '🪣'),
  };
  const sizeBtns = SIZES.map((s) => h('button', { class: 'tbtn', title: `Taille ${s}`, onClick: () => { size = s; paintTools(); } }, h('i', { style: { width: Math.min(s, 22) + 'px', height: Math.min(s, 22) + 'px', background: '#fff' } })));
  const tools = h('div', { class: 'tools hidden' },
    h('div', { class: 'palette' }, swatches),
    h('div', { class: 'row' }, Object.values(toolBtns)),
    h('div', { class: 'sizes' }, sizeBtns),
    h('button', { class: 'tbtn', title: 'Annuler', onClick: () => { items.pop(); replay(items); api.action({ type: 'undo' }); } }, '↩️'),
    h('button', { class: 'tbtn', title: 'Tout effacer', onClick: () => { items = []; resetCanvas(); api.action({ type: 'clear' }); } }, '🗑️'));
  function paintTools() {
    swatches.forEach((s, i) => s.classList.toggle('sel', COLORS[i] === color && tool !== 'eraser'));
    Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('sel', tool === k));
    sizeBtns.forEach((b, i) => b.classList.toggle('sel', SIZES[i] === size));
  }
  paintTools();

  const scores = h('div', { class: 'sk-scores' });
  const msgs = h('div', { class: 'msgs' });
  const input = h('input', { class: 'input', placeholder: 'Écris ta réponse…', maxLength: 60, autocomplete: 'off' });
  const form = h('form', { onSubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) api.action({ type: 'guess', text: t }); input.value = ''; input.focus(); } }, input, h('button', { class: 'btn sm cyan', type: 'submit' }, '➤'));
  const chat = h('div', { class: 'chat' }, msgs, form);

  const el = h('div', { class: 'sk' },
    h('div', {}, h('div', { class: 'sk-top' }, clockSlot, wordSlot, turnSlot), barSlot, wrap, tools),
    h('div', {}, scores, chat));

  // ------------------------------------------------------------ rendu
  function renderOverlay(v, players) {
    overlay.classList.add('hidden');
    if (v.phase === 'choosing') {
      overlay.classList.remove('hidden');
      const d = players[v.drawerId];
      if (v.drawerId === api.me()) {
        fill(overlay, h('div', { class: 'col center' }, h('h2', {}, '🎨 À toi de dessiner !'), h('div', { class: 'muted' }, 'Choisis un mot'),
          h('div', { class: 'choose' }, v.choices.map((w, i) => h('button', { class: 'btn big yellow', onClick: () => api.action({ type: 'choose', index: i }) }, w))), clock(v.endsAt)));
      } else {
        fill(overlay, h('div', { class: 'col center' }, d ? avatar(d.avatar, 'xl') : null, h('h2', {}, `${d?.name ?? '…'} choisit un mot`), h('div', { class: 'muted' }, 'Prépare-toi à deviner !')));
      }
    } else if (v.phase === 'turnEnd') {
      overlay.classList.remove('hidden');
      const rows = Object.entries(v.deltas).sort((a, b) => b[1] - a[1]);
      fill(overlay, h('div', { class: 'col center' }, h('div', { class: 'muted' }, 'Le mot était'), h('div', { class: 'qtext', style: { color: 'var(--yellow)', fontSize: '2.4rem' } }, v.word),
        rows.length ? h('div', { class: 'rank' }, rows.map(([id, pts]) => h('div', { class: 'rrow' }, avatar(players[id]?.avatar, 'sm'), h('span', { class: 'nm' }, players[id]?.name), h('span', { class: 'gain' }, `+${pts}`)))) : h('div', { class: 'muted' }, 'Personne n’a trouvé 😬')));
    } else if (v.phase === 'results') {
      overlay.classList.remove('hidden');
      const ranking = Object.entries(v.raw).sort((a, b) => b[1] - a[1]);
      fill(overlay, h('div', { class: 'col center', style: { width: '100%', maxWidth: '420px' } }, h('h2', {}, '🏁 Fin de Skribbl !'),
        h('div', { class: 'rank' }, ranking.map(([id, pts], i) => h('div', { class: `rrow ${i === 0 ? 'first' : ''}` }, h('span', { class: 'pos' }, i + 1), avatar(players[id]?.avatar, 'sm'), h('span', { class: 'nm' }, players[id]?.name), h('span', { class: 'tot' }, pts)))),
        h('div', { class: 'muted' }, '100 points Skribbl = 1 point de partie')));
    }
  }

  function renderWord(v, players) {
    const d = players[v.drawerId];
    if (v.phase === 'drawing') {
      if (v.word) return fill(wordSlot, v.drawerId === api.me() ? h('small', {}, 'Tu dessines :') : h('small', {}, 'Tu as trouvé !'), v.word);
      return fill(wordSlot, h('small', {}, `${v.wordLength} lettres`), v.pattern.map((c) => h('span', { class: `l ${c === ' ' || c === '-' || c === '’' || c === '\'' ? 'gap' : ''}` }, c === '_' ? ' ' : c)));
    }
    if (v.phase === 'turnEnd') return fill(wordSlot, v.word);
    if (v.phase === 'choosing') return fill(wordSlot, h('small', {}, `${d?.name ?? ''} choisit…`), '…');
    fill(wordSlot, '🎨');
  }

  function renderChat(v, players) {
    const nearBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
    fill(msgs, v.chat.map((m) => {
      if (m.kind === 'chat') return h('div', { class: `msg ${m.scope === 'found' ? 'found' : ''}` }, m.scope === 'found' ? '🔒 ' : '', h('b', {}, players[m.pid]?.name ?? '?'), ' : ', m.text);
      return h('div', { class: `msg ${m.kind}` }, m.text);
    }));
    if (nearBottom) msgs.scrollTop = msgs.scrollHeight;
  }

  function update(v, state) {
    view = v;
    const players = api.byId();
    if (v.turn !== turn) {
      turn = v.turn; items = []; remoteLast = {}; cur = null; resetCanvas();
      api.action({ type: 'sync' });
    }
    // horloge + barre
    const total = v.phase === 'choosing' ? 15000 : v.phase === 'drawing' ? v.drawTime * 1000 : 5500;
    fill(clockSlot, v.endsAt && ['choosing', 'drawing', 'turnEnd'].includes(v.phase) ? clock(v.endsAt) : null);
    fill(barSlot, v.endsAt && v.phase === 'drawing' ? timerBar(v.endsAt, total) : null);
    fill(turnSlot, `Tour ${Math.min(v.turn + 1, v.totalTurns)}/${v.totalTurns}`);
    renderWord(v, players);
    renderOverlay(v, players);
    const drawer = v.drawerId === api.me() && v.phase === 'drawing';
    tools.classList.toggle('hidden', !drawer);
    wrap.classList.toggle('drawer', drawer);
    // scores
    const ranking = Object.entries(v.raw).sort((a, b) => b[1] - a[1]);
    fill(scores, ranking.map(([id, pts]) => h('div', { class: 'r' }, avatar(players[id]?.avatar, 'sm'), h('span', {}, players[id]?.name ?? '?', id === v.drawerId && v.phase !== 'results' ? ' ✏️' : '', v.guessed.includes(id) ? ' ✅' : ''), h('span', { class: 'v' }, pts))));
    renderChat(v, players);
    input.placeholder = drawer ? 'Parle aux joueurs qui ont trouvé…' : v.phase === 'drawing' ? 'Écris ta réponse…' : 'Discute…';
  }

  return {
    el, update, onFx,
    badges: (v) => Object.fromEntries([...(v.drawerId ? [[v.drawerId, '✏️']] : []), ...v.guessed.map((id) => [id, '✅'])]),
    unmount() { clearInterval(flushTimer); },
  };
}
