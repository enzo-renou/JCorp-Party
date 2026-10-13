'use strict';
/**
 * Télécharge les photos du quiz dans data/photos/ (à lancer une fois, avec internet) :
 *     npm run photos
 * Les fichiers sont ensuite commités avec le projet : le jeu n'a plus besoin de Wikipédia en cours de partie.
 * Affiche la liste des pages sans photo (titre Wikipédia à corriger dans data/culture/*.json).
 */
const { POOL } = require('../server/games/culture');
const photos = require('../server/photos');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const titles = [...new Set(POOL.filter((q) => q.wiki).map((q) => q.wiki))];
  let ok = 0, skipped = 0;
  const failed = [];
  let netFails = 0;
  for (const wiki of titles) {
    if (photos.findLocal(wiki)) { skipped++; continue; }
    try {
      let img;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { img = await photos.fetchWikiImage(wiki); break; } catch (e) { if (attempt === 2) throw e; await sleep(1500 * (attempt + 1)); }
      }
      photos.saveLocal(wiki, img);
      ok++; netFails = 0; console.log('  ✓', wiki, `(${Math.round(img.buf.length / 1024)} Ko)`);
    } catch (e) {
      failed.push(wiki); console.log('  ✗', wiki, '—', e.message);
      if (/fetch failed|timeout|aborted|ENOTFOUND|ECONN/i.test(e.message + (e.cause?.code || ''))) { if (++netFails >= 3) { console.log('\n⛔ Pas d’accès à Wikipédia depuis cette machine (internet coupé ou domaine bloqué). Arrêt.'); process.exit(2); } } else netFails = 0;
    }
    await sleep(400);
  }
  console.log(`\n${ok} téléchargée(s), ${skipped} déjà présente(s), ${failed.length} échec(s) sur ${titles.length}.`);
  if (failed.length) console.log('À corriger / vérifier :', failed.join(', '));
  process.exit(failed.length ? 1 : 0);
})();
