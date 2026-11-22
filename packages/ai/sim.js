'use strict';
// Bot hesapları için hafif el simülatörü (motordan bağımsız, sadece düz diziler).
const { suitOf, rankOf } = require('../engine/cards');
const R = require('../engine/rules');

function isMaster(card, hand, played) {
  const s = suitOf(card);
  const r = rankOf(card);
  for (let q = 14; q > r; q--) {
    const c = s + q;
    if (!played.has(c) && !hand.includes(c)) return false;
  }
  return true;
}

function strength(card, trump) {
  return rankOf(card) + (suitOf(card) === trump ? 20 : 0);
}

function minBy(arr, fn) {
  let best = arr[0];
  let bv = fn(best);
  for (let i = 1; i < arr.length; i++) {
    const v = fn(arr[i]);
    if (v < bv) { best = arr[i]; bv = v; }
  }
  return best;
}

function maxBy(arr, fn) { return minBy(arr, (c) => -fn(c)); }

// Basit ama makul oyun politikası (botlar düşük ileri-hesapta bunu doğrudan kullanır,
// örnekleme modunda ise herkesin "sonraki oyunu" bununla simüle edilir).
function leadChoice(hand, trump, played) {
  const nonTrump = hand.filter((c) => suitOf(c) !== trump);
  const masters = nonTrump.filter((c) => isMaster(c, hand, played));
  if (masters.length) {
    const len = (c) => hand.filter((x) => suitOf(x) === suitOf(c)).length;
    return maxBy(masters, (c) => len(c) * 20 + rankOf(c));
  }
  const trumps = hand.filter((c) => suitOf(c) === trump);
  if (trumps.length) {
    let playedTrumps = 0;
    for (const c of played) if (suitOf(c) === trump) playedTrumps++;
    const unseenTrumps = 13 - playedTrumps - trumps.length;
    const top = maxBy(trumps, rankOf);
    if (unseenTrumps > 0 && isMaster(top, hand, played)) return top;
  }
  if (nonTrump.length) {
    const len = (s) => nonTrump.filter((c) => suitOf(c) === s).length;
    // en kısa renkten en küçük kart (renk açmaya çalış)
    return minBy(nonTrump, (c) => len(suitOf(c)) * 100 + rankOf(c));
  }
  return minBy(hand, rankOf);
}

function policy(seat, st) {
  const hand = st.hands[seat];
  if (hand.length === 1) return hand[0];
  if (st.trick.length === 0) return leadChoice(hand, st.trump, st.played);
  const legal = R.legalCards(hand, st.trick, st.trump);
  if (legal.length === 1) return legal[0];
  let best = st.trick[0].card;
  for (let i = 1; i < st.trick.length; i++) {
    if (R.cardBeats(st.trick[i].card, best, st.trump)) best = st.trick[i].card;
  }
  const winners = legal.filter((c) => R.cardBeats(c, best, st.trump));
  if (winners.length) return minBy(winners, (c) => strength(c, st.trump));
  return minBy(legal, (c) => strength(c, st.trump));
}

// st = { hands:[h0,h1,h2], trump, trick:[{seat,card}], turn, tricks:[a,b,c], played:Set }
function rollout(st) {
  const hands = st.hands;
  for (;;) {
    if (st.trick.length === 3) {
      const w = R.trickWinner(st.trick, st.trump);
      st.tricks[w]++;
      for (const p of st.trick) st.played.add(p.card);
      st.trick = [];
      st.turn = w;
      if (!hands[0].length && !hands[1].length && !hands[2].length) break;
      continue;
    }
    const seat = st.turn;
    const hand = hands[seat];
    if (!hand.length) break;
    const card = policy(seat, st);
    hand.splice(hand.indexOf(card), 1);
    st.trick.push({ seat, card });
    st.turn = (seat + 1) % 3;
  }
  return st.tricks;
}

module.exports = { isMaster, strength, policy, rollout, leadChoice, minBy, maxBy };
