'use strict';
// Kart yardımcıları. Kart = "S14" (renk harfi + sayı). A=14, K=13, Q=12, J=11.

const SUITS = ['S', 'H', 'C', 'D']; // maça, kupa, sinek, karo (gösterimde siyah/kırmızı dönüşümlü)
const SUIT_NAMES = { S: 'Maça', H: 'Kupa', D: 'Karo', C: 'Sinek' };
const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function suitOf(card) { return card[0]; }
function rankOf(card) { return Number(card.slice(1)); }
function makeCard(suit, rank) { return suit + rank; }
function rankLabel(rank) { return RANK_LABELS[rank] || String(rank); }
function cardLabel(card) { return SUIT_SYMBOLS[suitOf(card)] + rankLabel(rankOf(card)); }

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push(makeCard(s, r));
  return deck;
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function compareCards(a, b) {
  const sa = SUITS.indexOf(suitOf(a));
  const sb = SUITS.indexOf(suitOf(b));
  if (sa !== sb) return sa - sb;
  return rankOf(b) - rankOf(a);
}
function sortHand(hand) { return hand.slice().sort(compareCards); }

module.exports = {
  SUITS, SUIT_NAMES, SUIT_SYMBOLS,
  suitOf, rankOf, makeCard, rankLabel, cardLabel,
  makeDeck, shuffle, compareCards, sortHand,
};
