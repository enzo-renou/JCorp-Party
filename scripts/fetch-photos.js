'use strict';
/**
 * Télécharge les photos du quiz dans data/photos/ (à lancer une fois, avec internet) :
 *     npm run photos
 * Utilise l'API par lots de Wikipédia (50 pages par requête) : peu de requêtes, donc pas de blocage.
 * Les fichiers sont ensuite commités avec le projet : plus besoin de Wikipédia pendant la partie.
 */
const { POOL } = require('../server/games/culture');
const photos = require('../server/photos');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': photos.UA, Accept: '*/*' }, signal: AbortSignal.timeout(30_000) });
    if (r.status === 429 || r.status >= 500) { await sleep(Math.min(Number(r.headers.get('retry-after')) || 5 * (i + 1), 25) * 1000); continue; }
    return r;
  }
  throw new Error('trop de requêtes (429) — réessaie dans une minute');
}

async function thumbs(lang, titles) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=720&titles=${encodeURIComponent(titles.join('|'))}`;
  const j = await (await get(url)).json();
  const map = {}; // titre demandé -> url
  const norm = {}; for (const n of j.query?.normalized || []) norm[n.from] = n.to;
  const redir = {}; for (const n of j.query?.redirects || []) redir[n.from] = n.to;
  const byTitle = {}; for (const pg of Object.values(j.query?.pages || {})) if (pg.thumbnail?.source) byTitle[pg.title] = pg.thumbnail.source;
  for (const t of titles) { let x = norm[t] || t; x = redir[x] || x; if (byTitle[x]) map[t] = byTitle[x]; }
  return map;
}

(async () => {
  const titles = [...new Set(POOL.flatMap((q) => [q.wiki, ...(q.wikis || [])]).filter(Boolean))].filter((t) => !photos.findLocal(t));
  console.log(`${titles.length} photo(s) à télécharger…`);
  const urls = {};
  for (const lang of ['fr', 'en']) {
    const todo = titles.filter((t) => !urls[t]);
    for (let i = 0; i < todo.length; i += 40) Object.assign(urls, await thumbs(lang, todo.slice(i, i + 40)));
  }
  let ok = 0; const failed = [];
  for (const t of titles) {
    if (!urls[t]) { failed.push(t); console.log('  ✗', t, '— pas d’image sur la page'); continue; }
    try {
      const r = await get(urls[t]);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      photos.saveLocal(t, { type: (r.headers.get('content-type') || 'image/jpeg').split(';')[0], buf: Buffer.from(await r.arrayBuffer()) });
      ok++; console.log('  ✓', t);
    } catch (e) { failed.push(t); console.log('  ✗', t, '—', e.message); }
    await sleep(700);
  }
  console.log(`\n${ok} téléchargée(s), ${failed.length} échec(s).`);
  if (failed.length) console.log('À corriger :', failed.join(', '));
})().catch((e) => { console.error('⛔', e.message); process.exit(2); });
