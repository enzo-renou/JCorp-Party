'use strict';
// Photos du quiz (« Qui est ce joueur ? », tableaux, monuments…) : cherchées d'abord dans data/photos/,
// sinon sur Wikipédia (puis enregistrées dans data/photos/ si le dossier est inscriptible).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'photos');
const UA = 'JCorpPartyBot/1.0 (jeu entre amis; enzorenou1@gmail.com) node-fetch';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const TYPE = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));

const slug = (wiki) => String(wiki).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();

function findLocal(wiki) {
  const s = slug(wiki);
  try {
    const f = fs.readdirSync(DIR).find((n) => n.startsWith(s + '.'));
    if (f) return { type: TYPE[path.extname(f).slice(1)] || 'image/jpeg', buf: fs.readFileSync(path.join(DIR, f)), file: f };
  } catch { /* dossier absent */ }
  return null;
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** télécharge l'image principale de l'article Wikipédia (fr puis en) */
async function fetchWikiImage(wiki) {
  let lastErr = null;
  for (const lang of ['fr', 'en']) {
    try {
      const j = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wiki)}`);
      const src = j.thumbnail?.source || j.originalimage?.source;
      if (!src) throw new Error('pas d’image sur la page');
      const r = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`image HTTP ${r.status}`);
      const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      return { type, buf: Buffer.from(await r.arrayBuffer()) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('introuvable');
}

function saveLocal(wiki, img) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, `${slug(wiki)}.${EXT[img.type] || 'jpg'}`);
    fs.writeFileSync(file, img.buf);
    return file;
  } catch { return null; }
}

module.exports = { UA, slug, findLocal, fetchWikiImage, saveLocal, DIR };
