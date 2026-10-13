'use strict';
// Vérifie les banques de questions : node scripts/check-data.js
const { POOL } = require('../server/games/culture');
let bad = 0;
const seen = new Set();
for (const q of POOL) {
  if (!q.q || !Array.isArray(q.a) || !q.a.length) { console.log('✗ incomplète :', q.id); bad++; }
  if (q.t === 'text' && seen.has(q.q)) { console.log('✗ doublon :', q.q); bad++; }
  seen.add(q.q);
}
const cats = {};
POOL.forEach((q) => { cats[q.cat] = (cats[q.cat] || 0) + 1; });
console.log(`${POOL.length} questions Culture G`, cats);
process.exit(bad ? 1 : 0);
