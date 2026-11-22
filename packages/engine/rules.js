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

// Önceki elin farkları (alınan - hedef) ve YENİ dağıtıcıya göre kart değişim planı.
// Hedefi aşan (isteyen), altında kalandan (veren) aştığı kadar kart ister.
// İsteyenler arasında yeni elin hedefi büyük olan önce (8, sonra 5, sonra 3).
// Bir isteyenin birden çok vereni varsa onlar da yeni elin hedefi büyük olandan küçüğe doğru sıralanır
// (işlem en yüksek hedeflide başlar, en düşük hedeflide biter).
function exchangePlan(prevDiffs, newDealer) {
  const tgt = (s) => targetFor(s, newDealer);
  const ups = [0, 1, 2].filter((s) => prevDiffs[s] > 0).sort((a, b) => tgt(b) - tgt(a));
  const downs = [0, 1, 2].filter((s) => prevDiffs[s] < 0).sort((a, b) => tgt(b) - tgt(a));
  const need = {};
  for (const d of downs) need[d] = -prevDiffs[d];
  const steps = [];
  for (const u of ups) {
    let excess = prevDiffs[u];
    for (const d of downs) {
      if (excess <= 0) break;
      const n = Math.min(excess, need[d]);
      if (n > 0) {
        steps.push({ asker: u, giver: d, count: n, done: 0 });
        excess -= n;
        need[d] -= n;
      }
    }
  }
  return steps;
}

// Veren oyuncu, iletilen kartla aynı renkteki en yüksek kartını geri verir.
// O renkte kartı yoksa ya da en yükseği iletilen karttan küçükse iletilen kart iade edilir.
function exchangeReturnCard(giverHand, passed) {
  const s = suitOf(passed);
  let best = passed;
  for (const c of giverHand) {
    if (suitOf(c) === s && rankOf(c) > rankOf(best)) best = c;
  }
  return best;
}

module.exports = { nextSeat, targetFor, legalCards, cardBeats, trickWinner, exchangePlan, exchangeReturnCard };
