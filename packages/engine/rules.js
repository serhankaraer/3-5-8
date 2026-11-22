'use strict';
const { suitOf, rankOf } = require('./cards');

// Koltuklar saat yönünde 0,1,2. Dağıtıcı = 8'li el, solundaki (sıradaki) = 5'li el, sağındaki = 3'lü el.
function nextSeat(seat) { return (seat + 1) % 3; }

function targetFor(seat, dealer) {
  if (seat === dealer) return 8;
  if (seat === nextSeat(dealer)) return 5;
  return 3;
}

// Açılan renk varsa ve elde o renk varsa mecburen o renk; yoksa her kart.
function legalCards(hand, ledSuit) {
  if (!ledSuit) return hand.slice();
  const follow = hand.filter((c) => suitOf(c) === ledSuit);
  return follow.length ? follow : hand.slice();
}

// `card`, o an kazanan `best` kartını yener mi? (best ya koz ya da açılan renktir)
function cardBeats(card, best, trump) {
  const cs = suitOf(card);
  const bs = suitOf(best);
  if (cs === bs) return rankOf(card) > rankOf(best);
  return cs === trump; // farklı renkte yalnızca koz, kozsuz kazananı yener
}

function trickWinner(plays, trump) {
  let best = plays[0];
  for (let i = 1; i < plays.length; i++) {
    if (cardBeats(plays[i].card, best.card, trump)) best = plays[i];
  }
  return best.seat;
}

// Kart değişimi planı: her isteyen (hedefini aşan) için TEK adım.
// İsteyen, aştığı kadar kartı altında kalanlardan ister; kartların hepsini tek seferde, körlemesine iletir.
// İsteyenler yeni elin hedefine göre büyükten küçüğe sıralanır (8, 5, 3); bir isteyenin birden çok vereni varsa
// onlar da aynı sırada dizilir (iletilen kartların ilk grubu ilk vereene gider).
// Dönen: [{ asker, givers: [{ seat, count }], count }]
function exchangePlan(prevDiffs, newDealer) {
  const tgt = (s) => targetFor(s, newDealer);
  const ups = [0, 1, 2].filter((s) => prevDiffs[s] > 0).sort((a, b) => tgt(b) - tgt(a));
  const downs = [0, 1, 2].filter((s) => prevDiffs[s] < 0).sort((a, b) => tgt(b) - tgt(a));
  const need = {};
  for (const d of downs) need[d] = -prevDiffs[d];
  const steps = [];
  for (const u of ups) {
    let excess = prevDiffs[u];
    const givers = [];
    for (const d of downs) {
      if (excess <= 0) break;
      const n = Math.min(excess, need[d]);
      if (n > 0) {
        givers.push({ seat: d, count: n });
        excess -= n;
        need[d] -= n;
      }
    }
    if (givers.length) steps.push({ asker: u, givers, count: givers.reduce((a, g) => a + g.count, 0) });
  }
  return steps;
}

// Veren oyuncu, iletilen her kart için aynı renkteki en yüksek kartını geri verir (iletilen kartlar da elinde sayılır).
// Aynı renkten birden çok kart iletildiyse en yüksek iletilen karta önce bakılır; her kart bir kez iade edilir.
// O renkte daha yüksek kartı yoksa iletilen kartın kendisi iade edilir.
// Dönen dizi, iletilen kartlarla aynı sırada hizalıdır: returned[i], passed[i] karşılığıdır.
function exchangeReturns(giverHand, passed) {
  const pool = giverHand.concat(passed);
  const taken = new Set();
  const out = new Array(passed.length);
  const order = passed.map((_, i) => i).sort((a, b) => rankOf(passed[b]) - rankOf(passed[a]));
  for (const i of order) {
    const s = suitOf(passed[i]);
    let best = null;
    for (const c of pool) {
      if (taken.has(c) || suitOf(c) !== s) continue;
      if (best === null || rankOf(c) > rankOf(best)) best = c;
    }
    taken.add(best);
    out[i] = best;
  }
  return out;
}

module.exports = { nextSeat, targetFor, legalCards, cardBeats, trickWinner, exchangePlan, exchangeReturns };
