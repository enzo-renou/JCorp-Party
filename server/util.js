'use strict';
const crypto = require('crypto');

// ---------- Texte ----------
const ARTICLES = /^(le|la|les|l|un|une|des|du|de|d|the) /;

/** minuscules, sans accents ni ponctuation */
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
/** forme "comparable" : sans article de tête, sans espaces */
function compact(s) {
  return norm(s).replace(ARTICLES, '').replace(/ /g, '');
}

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** la réponse saisie correspond-elle à l'une des réponses acceptées ? (tolère 1-2 fautes sur les mots longs) */
function isMatch(input, answers, { fuzzy = true } = {}) {
  const a = compact(input);
  if (!a) return false;
  for (const ans of answers) {
    const b = compact(ans);
    if (!b) continue;
    if (a === b) return true;
    if (fuzzy) {
      const tol = b.length >= 9 ? 2 : b.length >= 5 ? 1 : 0;
      if (tol && Math.abs(a.length - b.length) <= tol && lev(a, b) <= tol) return true;
    }
  }
  return false;
}

// FAST_TEST=1 raccourcit tous les délais (tests automatiques uniquement)
const FAST = process.env.FAST_TEST === '1';
const ms = (n) => (FAST ? Math.max(40, Math.round(n / 25)) : n);

// ---------- Aléatoire ----------
const randInt = (max) => crypto.randomInt(0, max);
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (arr) => arr[randInt(arr.length)];
const sample = (arr, n) => shuffle(arr).slice(0, n);
const uid = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

// ---------- Saisie ----------
function sanitize(str, maxLen) {
  return String(str ?? '')
    .replace(/[<>\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}
function sanitizeAvatar(a) {
  a = String(a ?? '');
  return /^[A-Za-z0-9]{1,16}$/.test(a) ? a : randomSeed();
}
function randomSeed() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[randInt(chars.length)];
  return out;
}

module.exports = { ms, norm, compact, lev, isMatch, randInt, shuffle, pick, sample, uid, clamp, sanitize, sanitizeAvatar, randomSeed };
