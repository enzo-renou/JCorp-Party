// Carte du monde interactive (SVG, projection équirectangulaire 2000×1000) : zoom molette / pincement, déplacement, pose d'un point
import { h } from './ui.js';

const W = 2000, H = 1000;
let worldPromise = null;
export const loadWorld = () => (worldPromise ||= fetch('/world.json').then((r) => r.json()));

const toXY = (lat, lng) => [((lng + 180) / 360) * W, ((90 - lat) / 180) * H];
const toLL = (x, y) => [Math.max(-90, Math.min(90, 90 - (y / H) * 180)), Math.max(-180, Math.min(180, (x / W) * 360 - 180))];
const NS = 'http://www.w3.org/2000/svg';
const PIN = 'M0 0 C-5 -9 -11 -13 -11 -21 a11 11 0 1 1 22 0 c0 8 -6 12 -11 21z';

export function createMap({ interactive = true, onPick = () => {} } = {}) {
  const box = h('div', { class: 'mapbox' }, h('div', { class: 'center muted', style: { padding: '40px' } }, 'Chargement de la carte…'));
  let svg = null, gMark = null, ready = false;
  let vb = { x: 0, y: 0, w: W, h: H / 1.9 };
  let pin = null, locked = false;
  const markers = [];
  const queue = [];

  const ar = () => (box.clientWidth && box.clientHeight ? box.clientWidth / box.clientHeight : 1.9);
  const k = () => (vb.w / W) * 2.4;
  function apply() {
    if (!svg) return;
    vb.w = Math.min(W * 1.15, Math.max(50, vb.w));
    vb.h = vb.w / ar();
    vb.x = Math.min(W - vb.w * 0.3, Math.max(-vb.w * 0.7, vb.x));
    vb.y = Math.min(H - vb.h * 0.3, Math.max(-vb.h * 0.7, vb.y));
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    for (const m of markers) m.g.setAttribute('transform', `translate(${m.x} ${m.y}) scale(${k()})`);
  }
  function home() {
    vb.w = W; vb.h = W / ar(); vb.x = 0; vb.y = 400 - vb.h / 2 + 30;
    apply();
  }
  function svgPoint(cx, cy) {
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }
  function zoomAt(cx, cy, f) {
    const [px, py] = svgPoint(cx, cy);
    const nw = Math.min(W * 1.15, Math.max(50, vb.w * f)); const real = nw / vb.w;
    vb.x = px - (px - vb.x) * real; vb.y = py - (py - vb.y) * real; vb.w = nw;
    apply();
  }
  function addMarker(lat, lng, build) {
    const [x, y] = toXY(lat, lng);
    const g = document.createElementNS(NS, 'g');
    build(g);
    gMark.append(g);
    const m = { g, x, y };
    markers.push(m);
    apply();
    return m;
  }
  const mk = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [a, v] of Object.entries(attrs || {})) e.setAttribute(a, v); if (text != null) e.textContent = text; return e; };

  loadWorld().then((world) => {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const land = mk('g', { class: 'land' });
    for (const c of world.countries) land.append(mk('path', { d: c.d, 'data-id': c.id }));
    gMark = mk('g');
    svg.append(land, gMark);
    box.replaceChildren(svg);
    const zoom = h('div', { class: 'mapzoom' },
      h('button', { title: 'Zoom +', onClick: () => zoomAt(box.getBoundingClientRect().left + box.clientWidth / 2, box.getBoundingClientRect().top + box.clientHeight / 2, 0.6) }, '+'),
      h('button', { title: 'Zoom −', onClick: () => zoomAt(box.getBoundingClientRect().left + box.clientWidth / 2, box.getBoundingClientRect().top + box.clientHeight / 2, 1.6) }, '−'),
      h('button', { title: 'Vue du monde', onClick: home }, '⌂'));
    box.append(zoom);
    wire();
    ready = true;
    requestAnimationFrame(() => { home(); queue.splice(0).forEach((f) => f()); });
  });

  function wire() {
    const ptrs = new Map();
    let moved = 0, lastDist = 0;
    const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 0.8 : 1.25); }, { passive: false });
    svg.addEventListener('pointerdown', (e) => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture(e.pointerId);
      moved = 0;
      if (ptrs.size === 2) lastDist = dist();
    });
    svg.addEventListener('pointermove', (e) => {
      const prev = ptrs.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      ptrs.set(e.pointerId, cur);
      if (ptrs.size === 1) {
        const r = svg.getBoundingClientRect();
        const s = vb.w / r.width;
        vb.x -= (cur.x - prev.x) * s; vb.y -= (cur.y - prev.y) * s;
        moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
        apply();
      } else if (ptrs.size === 2) {
        const d = dist(); const [a, b] = [...ptrs.values()];
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, lastDist / d);
        lastDist = d; moved = 999;
      }
    });
    const up = (e) => {
      if (ptrs.size === 1 && moved < 8 && interactive && !locked && e.type === 'pointerup') {
        const [x, y] = svgPoint(e.clientX, e.clientY);
        const [lat, lng] = toLL(x, y);
        setPin(lat, lng);
        onPick(lat, lng);
      }
      ptrs.delete(e.pointerId);
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  }

  function setPin(lat, lng) {
    const doIt = () => {
      if (pin) { markers.splice(markers.indexOf(pin), 1); pin.g.remove(); }
      pin = addMarker(lat, lng, (g) => {
        g.append(mk('path', { d: PIN, fill: '#ff4f9a', stroke: '#fff', 'stroke-width': 2 }), mk('circle', { cx: 0, cy: -21, r: 4.5, fill: '#fff' }));
      });
    };
    ready ? doIt() : queue.push(doIt);
  }

  function fit(points, minW = 260) {
    if (!points.length) return;
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let w = Math.max(minW, (x1 - x0) * 1.5, (y1 - y0) * 1.5 * ar());
    vb.w = Math.min(W, w); vb.h = vb.w / ar();
    vb.x = (x0 + x1) / 2 - vb.w / 2; vb.y = (y0 + y1) / 2 - vb.h / 2;
    apply();
  }

  /** corrige : montre la bonne réponse et les points de tous les joueurs */
  function reveal({ target, pins }) {
    const doIt = () => {
      locked = true;
      if (pin) { markers.splice(markers.indexOf(pin), 1); pin.g.remove(); pin = null; }
      const pts = [];
      if (target.kind === 'country') box.querySelector(`path[data-id="${target.cca2}"]`)?.classList.add('target');
      if (target.kind === 'capital') {
        pts.push(toXY(target.lat, target.lng));
        addMarker(target.lat, target.lng, (g) => {
          g.append(mk('circle', { r: 13, fill: 'none', stroke: '#4ade80', 'stroke-width': 4 }), mk('circle', { r: 4, fill: '#4ade80' }));
        });
      } else if (!pins.length) pts.push(toXY(target.lat, target.lng));
      for (const p of pins) {
        pts.push(toXY(p.lat, p.lng));
        addMarker(p.lat, p.lng, (g) => {
          const col = p.ok ? '#4ade80' : '#ff5d6c';
          g.append(mk('circle', { r: 9, fill: col, stroke: '#fff', 'stroke-width': 2.5 }),
            mk('text', { y: 22, 'text-anchor': 'middle', fill: '#fff', 'font-size': 14, 'font-weight': 800, stroke: '#000', 'stroke-width': 3, 'paint-order': 'stroke', style: 'font-family:Nunito,sans-serif' }, p.name));
        });
      }
      // pour un pays : on cadre sur les points + le pays visé
      if (target.kind === 'country') {
        const path = box.querySelector(`path[data-id="${target.cca2}"]`);
        if (path) { const b = path.getBBox(); if (b.width < 700) { pts.push([b.x, b.y], [b.x + b.width, b.y + b.height]); } else pts.push(toXY(target.lat, target.lng)); }
      }
      fit(pts);
    };
    ready ? doIt() : queue.push(doIt);
  }

  window.addEventListener('resize', apply);
  return {
    el: box,
    setPin, reveal,
    getPin: () => (pin ? toLL(pin.x, pin.y) : null),
    lock() { locked = true; },
    destroy() { window.removeEventListener('resize', apply); },
  };
}
