'use strict';

const CULTURE_CATS = [
  ['foot', '⚽ Foot'], ['cinema', '🎬 Ciné & séries'], ['musique', '🎵 Musique'], ['jeux-video', '🎮 Jeux vidéo'], ['anime', '🍥 Anime & manga'],
  ['histoire', '🏛️ Histoire & mythes'], ['sciences', '🔬 Sciences'], ['art', '🎨 Art & littérature'], ['sport', '🏅 Sport'], ['internet', '📱 Internet'],
  ['rebus', '🧩 Rébus'], ['langue', '🗣️ Langue'], ['divers', '🌀 Divers'],
];

const num = (key, label, values, def, suffix = '') => ({
  key, label, type: 'choice', default: def,
  choices: values.map((v) => ({ v, label: `${v}${suffix}` })),
});

/**
 * Catalogue des mini-jeux. `scale` convertit les points bruts du jeu en points de partie
 * (Skribbl compte en centaines de points, les autres jeux en unités).
 */
const CATALOG = [
  {
    key: 'skribbl', name: 'Skribbl', emoji: '🎨', color: '#ff4f9a', minPlayers: 2, scale: 0.01,
    tagline: 'Dessine, devine, vite !',
    desc: 'Chacun son tour dessine un mot que les autres doivent deviner. Plus tu trouves vite, plus tu gagnes de points.',
    options: [num('drawTime', 'Temps pour dessiner', [60, 80, 100], 80, ' s'), num('passes', 'Passages par joueur', [1, 2], 1, '×')],
    Class: () => require('./skribbl'),
  },
  {
    key: 'culture', name: 'Culture G', emoji: '🧠', color: '#ffd23f', minPlayers: 2, scale: 1,
    tagline: 'Le quiz Gen Z',
    desc: 'Foot, rap, séries, rébus, « qui est ce joueur ? »… Tout le monde répond, le maître du jeu corrige. 1 point par bonne réponse.',
    options: [
      num('count', 'Nombre de questions', [10, 15, 20, 30], 15), num('time', 'Temps par question', [20, 30, 45], 25, ' s'),
      { key: 'cats', label: 'Catégories', type: 'multi', default: CULTURE_CATS.map((c) => c[0]), choices: CULTURE_CATS.map(([v, label]) => ({ v, label })) },
    ],
    Class: () => require('./culture'),
  },
  {
    key: 'geo', name: 'Quiz Géo', emoji: '🌍', color: '#3ee6d1', minPlayers: 2, scale: 1,
    tagline: 'Carte, capitales, drapeaux',
    desc: '9 questions : 3 à placer sur la carte, 3 capitales, 3 drapeaux, du facile (1 pt) au difficile (3 pts). Sur la carte, plus tu es proche, plus tu gagnes de points.',
    options: [],
    Class: () => require('./geo'),
  },
  {
    key: 'imposteur', name: "L'Imposteur", emoji: '🕵️', color: '#a78bfa', minPlayers: 3, scale: 1,
    tagline: 'Qui ment ?',
    desc: "Les citoyens ont un mot, les imposteurs un mot proche, M. White rien du tout. Donnez des indices, votez, démasquez-les.",
    options: [
      num('turnTime', "Temps par indice", [30, 45, 60, 90], 45, ' s'),
      num('voteTime', 'Temps de vote', [60, 90, 120], 90, ' s'),
      { key: 'impostors', label: "Nombre d'imposteurs", type: 'choice', default: 'auto', choices: [{ v: 'auto', label: 'Auto' }, { v: 1, label: '1' }, { v: 2, label: '2' }] },
      { key: 'mrWhite', label: 'M. White (5 joueurs min.)', type: 'bool', default: true },
    ],
    Class: () => require('./imposteur'),
  },
  {
    key: 'mastergoon', name: 'Mastergoon', emoji: '🎤', color: '#c8ff3e', minPlayers: 2, scale: 1,
    tagline: 'Ne dis pas la même chose que moi',
    desc: 'Le maître du jeu répond en secret. Ceux qui disent pareil sont éliminés. Le maître démarre à 10 points et en perd 1 à chaque question où personne n’est éliminé. +1 point par question survécue pour les autres.',
    options: [
      num('answerTime', 'Temps de réponse', [10, 15, 20, 30], 20, ' s'),
      num('maxQuestions', 'Questions max', [5, 8, 10, 15], 8),
      { key: 'joker', label: 'Joker des éliminés', type: 'bool', default: true },
    ],
    Class: () => require('./mastergoon'),
  },
  {
    key: 'memeit', name: 'Make It Meme', emoji: '😂', color: '#ff9f1c', minPlayers: 2, scale: 0.005,
    tagline: 'Légende les memes, vote pour les plus drôles',
    desc: 'Chacun reçoit une image de meme et écrit la légende la plus drôle. Puis tout le monde vote 👍 / 😐 / 👎 sur chaque meme. Un « Meme Buddy » par manche pour partager les points.',
    options: [
      num('rounds', 'Manches', [1, 2, 3, 5], 3),
      num('captionTime', 'Temps pour légender', [30, 60, 90, 120], 90, ' s'),
      { key: 'mode', label: 'Mode', type: 'choice', default: 'normal', choices: [{ v: 'normal', label: 'Normal' }, { v: 'topics', label: 'Thèmes' }, { v: 'same', label: 'Même meme' }, { v: 'relaxed', label: 'Détente' }] },
      { key: 'family', label: 'Mode famille (filtre les gros mots)', type: 'bool', default: false },
    ],
    Class: () => require('./memeit'),
  },
];

const byKey = Object.fromEntries(CATALOG.map((g) => [g.key, g]));

function defaultOptions(key) {
  const g = byKey[key];
  return Object.fromEntries(g.options.map((o) => [o.key, o.default]));
}

/** nettoie les options reçues du client (valeurs autorisées uniquement) */
function cleanOptions(key, input = {}) {
  const g = byKey[key];
  const out = defaultOptions(key);
  for (const o of g.options) {
    const v = input?.[o.key];
    if (o.type === 'bool') { if (typeof v === 'boolean') out[o.key] = v; }
    else if (o.type === 'multi') {
      if (Array.isArray(v)) { const ok = o.choices.map((c) => c.v).filter((x) => v.includes(x)); if (ok.length) out[o.key] = ok; }
    }
    else if (o.choices.some((c) => c.v === v)) out[o.key] = v;
  }
  return out;
}

const publicCatalog = () => CATALOG.map(({ Class, ...rest }) => rest);

module.exports = { CATALOG, byKey, defaultOptions, cleanOptions, publicCatalog };
