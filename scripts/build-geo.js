'use strict';
/**
 * Génère à partir de data/geo-source.js :
 *   - data/geo.json        (pays, capitales, alias, code numérique pour retrouver les frontières)
 *   - public/world.json    (tracé SVG de la carte du monde, projection équirectangulaire 2000×1000)
 * Usage : npm run build:geo   (nécessite les devDependencies : world-countries)
 */
const fs = require('fs');
const path = require('path');
const topo = require('topojson-client');
const countries = require('world-countries');
const SRC = require('../data/geo-source');

const root = path.join(__dirname, '..');
const topology = JSON.parse(fs.readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
const features = topo.feature(topology, topology.objects.countries).features;

const byCca2 = Object.fromEntries(countries.map((c) => [c.cca2, c]));
const cca2ByCcn3 = Object.fromEntries(countries.filter((c) => c.ccn3).map((c) => [c.ccn3, c.cca2]));
const featureIds = new Set(features.map((f) => String(f.id).padStart(3, '0')));

// ---------- geo.json
const out = [];
const problems = [];
for (const [cca2, name, art, capital, lat, lng, tier, aliases, capAliases] of SRC) {
  const c = byCca2[cca2];
  if (!c) { problems.push(`${cca2}: absent de world-countries`); continue; }
  if (!featureIds.has(c.ccn3)) { problems.push(`${cca2} (${name}): pas de frontières dans la carte → ignoré`); continue; }
  const names = [name, ...aliases, c.translations?.fra?.common, c.translations?.fra?.official, c.name.common, ...(c.altSpellings || []).filter((s) => s.length > 3)].filter(Boolean);
  out.push({ cca2, ccn3: c.ccn3, name, art, capital, lat, lng, tier, names: [...new Set(names)], capNames: [...new Set([capital, ...capAliases])] });
}
fs.writeFileSync(path.join(root, 'data', 'geo.json'), JSON.stringify(out));
console.log(`geo.json : ${out.length} pays (${[1, 2, 3].map((t) => `${out.filter((c) => c.tier === t).length}×niv${t}`).join(', ')})`);
problems.forEach((p) => console.warn('  ⚠', p));

// ---------- world.json
const W = 2000, H = 1000;
const X = (lon) => ((lon + 180) / 360) * W;
const Y = (lat) => ((90 - lat) / 180) * H;
const t10 = (n) => Math.round(n * 10);       // dixièmes d'unité
const num = (n) => String(n / 10);
// tracé en coordonnées relatives, points quasi confondus supprimés (carte légère, ~300 Ko)
function ringPath(ring, dx = 0) {
  const pts = [];
  for (const [lon, lat] of ring) {
    const x = t10(X(lon) + dx), y = t10(Y(lat));
    const l = pts[pts.length - 1];
    if (!l || Math.abs(l[0] - x) + Math.abs(l[1] - y) >= 4) pts.push([x, y]);
  }
  if (pts.length < 3) return '';
  let d = `M${num(pts[0][0])} ${num(pts[0][1])}l`;
  for (let i = 1; i < pts.length; i++) d += `${i > 1 ? ' ' : ''}${num(pts[i][0] - pts[i - 1][0])} ${num(pts[i][1] - pts[i - 1][1])}`;
  return d + 'z';
}
// anneaux qui traversent l'antiméridien (Russie, Fidji…) : on « déroule » la longitude puis on dessine aussi la copie décalée
function ringPaths(ring) {
  const un = [];
  let off = 0;
  ring.forEach(([lon, lat], i) => {
    if (i > 0) { const prev = ring[i - 1][0]; if (lon - prev > 180) off -= 360; else if (lon - prev < -180) off += 360; }
    un.push([lon + off, lat]);
  });
  const lons = un.map((p) => p[0]);
  const min = Math.min(...lons), max = Math.max(...lons);
  let d = ringPath(un);
  if (max > 180) d += ringPath(un, -W);
  if (min < -180) d += ringPath(un, W);
  return d;
}
const shapes = [];
for (const f of features) {
  const id3 = String(f.id ?? '').padStart(3, '0');
  if (id3 === '010') continue; // Antarctique
  const g = f.geometry;
  if (!g) continue;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const d = polys.map((poly) => poly.map(ringPaths).join('')).join('');
  shapes.push({ id: cca2ByCcn3[id3] || '', d });
}
fs.writeFileSync(path.join(root, 'public', 'world.json'), JSON.stringify({ w: W, h: H, countries: shapes }));
console.log(`world.json : ${shapes.length} formes, ${(fs.statSync(path.join(root, 'public', 'world.json')).size / 1024).toFixed(0)} Ko`);
