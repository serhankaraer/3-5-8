'use strict';

// Bot özellikleri: hepsi 1-100, ortalaması 50 olan normal dağılımdan (uç değerler seyrek).
const TRAITS = ['risk', 'memory', 'foresight', 'blocking', 'tempo'];
const TRAIT_LABELS = {
  risk: 'Risk alma',
  memory: 'Oyunu takip (kart sayma)',
  foresight: 'İleriye dönük hesap',
  blocking: 'Rakibi engelleme',
  tempo: 'Tempo (hızlı düşünme)',
};

function randn(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function rollTrait(rng = Math.random, mean = 50, sd = 17) {
  const v = Math.round(mean + sd * randn(rng));
  return Math.max(1, Math.min(100, v));
}

function genTraits(rng = Math.random) {
  const t = {};
  for (const k of TRAITS) t[k] = rollTrait(rng);
  return t;
}

// Tempo yüksekse hızlı: 1 sn (tempo=100) ile 3 sn (tempo=1) arası.
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 3000;
function thinkDelayMs(tempo, rng = Math.random) {
  const base = MIN_DELAY_MS + ((100 - tempo) / 99) * (MAX_DELAY_MS - MIN_DELAY_MS);
  const jitter = 0.9 + rng() * 0.2;
  return Math.round(Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, base * jitter)));
}

module.exports = { TRAITS, TRAIT_LABELS, randn, rollTrait, genTraits, thinkDelayMs, MIN_DELAY_MS, MAX_DELAY_MS };
