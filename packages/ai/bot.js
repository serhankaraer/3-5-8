'use strict';
const { SUITS, suitOf, rankOf, makeDeck, shuffle } = require('../engine/cards');
const S = require('./sim');
const { thinkDelayMs, randn } = require('./personality');

const ALL = makeDeck();
const HONOR = { 14: 5, 13: 4, 12: 3, 11: 2, 10: 1 };

// Bot sadece `Game.view(seat)` çıktısını görür (insan oyuncuyla aynı bilgi).
// Özellikler (1-100):
//  risk      : koz seçiminde kısa-güçlü renk sevme, kart gömerken renk boşaltma, ortalama + sapma tercihi
//  memory    : oynanmış kartların kaçını hatırladığı (kart sayma kalitesi)
//  foresight : örnekleme (olası dağılımları simüle etme) sayısı
//  blocking  : puan tablosunda öndeki rakibin elini almasını engelleme eğilimi
//  tempo     : düşünme süresi (1-3 sn)
class Bot {
  constructor({ seat, traits, rng = Math.random }) {
    this.seat = seat;
    this.traits = traits;
    this.rng = rng;
    this.handNo = null;
    this.seen = 0;
    this.remembered = new Set();
    this.voids = { 0: {}, 1: {}, 2: {} };
  }

  thinkDelay() { return thinkDelayMs(this.traits.tempo, this.rng); }

  // Oynanmış elleri (herkese açık bilgi) hafıza özelliğine göre içselleştirir.
  _sync(view) {
    if (this.handNo !== view.handNo) {
      this.handNo = view.handNo;
      this.seen = 0;
      this.remembered = new Set();
      this.voids = { 0: {}, 1: {}, 2: {} };
    }
    const pm = 0.4 + (0.6 * this.traits.memory) / 100;
    for (; this.seen < view.history.length; this.seen++) {
      const rec = view.history[this.seen];
      const led = suitOf(rec.plays[0].card);
      for (const p of rec.plays) {
        if (p.seat === view.you || this.rng() < pm) this.remembered.add(p.card);
        if (suitOf(p.card) !== led) this.voids[p.seat][led] = true; // renk bitirme herkesçe görülür
      }
    }
  }

  _voidsNow(view) {
    const v = { 0: { ...this.voids[0] }, 1: { ...this.voids[1] }, 2: { ...this.voids[2] } };
    if (view.trick.length) {
      const led = suitOf(view.trick[0].card);
      for (const p of view.trick) if (suitOf(p.card) !== led) v[p.seat][led] = true;
    }
    return v;
  }

  _pool(view) {
    const known = new Set(view.hand);
    for (const c of this.remembered) known.add(c);
    for (const p of view.trick) known.add(p.card);
    if (view.discarded) for (const c of view.discarded) known.add(c);
    return ALL.filter((c) => !known.has(c));
  }

  _dealOpp(view, pool, voids) {
    const me = view.you;
    const o = [(me + 1) % 3, (me + 2) % 3];
    const need = { [o[0]]: view.counts[o[0]], [o[1]]: view.counts[o[1]] };
    const hands = { [o[0]]: [], [o[1]]: [] };
    const leftovers = [];
    for (const c of shuffle(pool, this.rng)) {
      const s = suitOf(c);
      const cand = o.filter((x) => hands[x].length < need[x] && !(voids[x] && voids[x][s]));
      if (cand.length) hands[cand[Math.floor(this.rng() * cand.length)]].push(c);
      else leftovers.push(c);
    }
    for (const x of o) while (hands[x].length < need[x] && leftovers.length) hands[x].push(leftovers.pop());
    return hands;
  }

  decide(view) {
    this._sync(view);
    switch (view.legal && view.legal.kind) {
      case 'discard': return { type: 'discard', cards: this._discard(view) };
      case 'trump': return { type: 'trump', suit: this._trump(view) };
      case 'pass': return { type: 'pass', card: this._pass(view) };
      case 'play': return { type: 'play', card: this._play(view) };
      default: return null;
    }
  }

  // --- 4 kart gömme (koz belli, kitty henüz alınmadı) ---
  _discard(view) {
    const hand = view.hand;
    const trump = view.trump;
    const risk = this.traits.risk / 100;
    const noiseAmp = (1 - this.traits.foresight / 150) * 3;
    const bySuit = {};
    for (const s of SUITS) bySuit[s] = hand.filter((c) => suitOf(c) === s);
    const strengthOf = (s) => bySuit[s].reduce((a, c) => a + (HONOR[rankOf(c)] || 0), 0) + 1.5 * bySuit[s].length;
    const keep = (c) => {
      const s = suitOf(c);
      let v;
      if (s === trump) {
        v = 30 + rankOf(c); // kozlar en son gömülür
      } else {
        v = rankOf(c) + 0.8 * strengthOf(s);
        const cards = bySuit[s];
        // riskli oyuncular kısa ve zayıf yan rengi tamamen boşaltıp koz kesmeyi sever
        if (cards.length <= 4 && Math.max(...cards.map(rankOf)) <= 11) v -= risk * 6;
      }
      return v + (this.rng() - 0.5) * 2 * noiseAmp;
    };
    return hand.map((c) => ({ c, v: keep(c) })).sort((a, b) => a.v - b.v).slice(0, 4).map((x) => x.c);
  }

  // --- koz seçimi (kart değişimi bitti; elde 16 kart var, kitty henüz görülmedi) ---
  _trump(view) {
    const me = view.you;
    const hand = view.hand;
    const risk = this.traits.risk;
    const foresight = this.traits.foresight;
    const heur = {};
    for (const s of SUITS) {
      const cards = hand.filter((c) => suitOf(c) === s);
      const honors = cards.reduce((a, c) => a + (HONOR[rankOf(c)] || 0), 0);
      const wLen = 2.5 + (50 - risk) / 50; // temkinli oyuncu uzun renk, riskli oyuncu kısa-güçlü renk sever
      heur[s] = honors + wLen * cards.length;
    }
    const noiseAmp = (1 - foresight / 100) * 1.4 + 0.1;
    if (foresight < 10) {
      return SUITS.map((s) => ({ s, v: heur[s] + (this.rng() - 0.5) * 6 * noiseAmp })).sort((a, b) => b.v - a.v)[0].s;
    }
    const n = 3 + Math.round((foresight / 100) * 12);
    const pool = ALL.filter((c) => !hand.includes(c) && !(view.discarded || []).includes(c));
    const opp = [(me + 1) % 3, (me + 2) % 3];
    const sum = {};
    for (const s of SUITS) sum[s] = 0;
    for (let k = 0; k < n; k++) {
      const deal = shuffle(pool, this.rng);
      const h = [[], [], []];
      h[opp[0]] = deal.slice(0, 16);
      h[opp[1]] = deal.slice(16, 32);
      for (const s of SUITS) {
        const st = {
          hands: [h[0].slice(), h[1].slice(), h[2].slice()],
          trump: s, trick: [], turn: (me + 1) % 3, tricks: [0, 0, 0], played: new Set(),
        };
        st.hands[me] = hand.slice();
        sum[s] += S.rollout(st)[me];
      }
    }
    return SUITS.map((s) => ({ s, v: sum[s] / n + (this.rng() - 0.5) * 2 * noiseAmp + heur[s] * 0.02 }))
      .sort((a, b) => b.v - a.v)[0].s;
  }

  // --- kart değişimi: iletilecek kartı seç (veren aynı renkteki en yüksek kartını geri verir) ---
  _pass(view) {
    const hand = view.hand;
    const known = new Set(hand);
    if (view.discarded) for (const c of view.discarded) known.add(c);
    let best = null;
    for (const s of SUITS) {
      const mine = hand.filter((c) => suitOf(c) === s);
      if (!mine.length) continue;
      const low = mine.reduce((a, c) => (rankOf(c) < rankOf(a) ? c : a));
      const tops = [];
      for (let r = 14; r >= 2 && tops.length < 2; r--) if (!known.has(s + r)) tops.push(r);
      const expTop = tops.length ? 0.6 * tops[0] + 0.4 * (tops[1] != null ? tops[1] : tops[0]) : 0;
      let gain = Math.max(0, expTop - rankOf(low));
      gain += this.rng() * 0.5;
      if (!best || gain > best.gain) best = { gain, card: low };
    }
    return best ? best.card : hand[0];
  }

  // --- el oynama ---
  _play(view) {
    const me = view.you;
    const legal = view.legal.cards;
    if (legal.length === 1) return legal[0];
    const trump = view.trump;
    const played = new Set(this.remembered);
    for (const p of view.trick) played.add(p.card);
    const foresight = this.traits.foresight;
    if (foresight < 10) {
      const hands = [[], [], []];
      hands[me] = view.hand.slice();
      return S.policy(me, { hands, trump, trick: view.trick, played });
    }
    const n = 3 + Math.round((foresight / 100) * 20);
    const pool = this._pool(view);
    const voids = this._voidsNow(view);
    const opp = [(me + 1) % 3, (me + 2) % 3];
    // puan tablosunda önde olan rakip "tehdit" sayılır
    const threat = opp.slice().sort((a, b) => (view.totals[b] - view.totals[a]) || (view.tricksWon[b] - view.tricksWon[a]))[0];
    const b = (0.5 * this.traits.blocking) / 100;
    const riskF = ((this.traits.risk - 50) / 50) * 0.3;
    const vals = legal.map(() => []);
    for (let k = 0; k < n; k++) {
      const oh = this._dealOpp(view, pool, voids);
      legal.forEach((c, i) => {
        const hands = [[], [], []];
        hands[me] = view.hand.filter((x) => x !== c);
        hands[opp[0]] = oh[opp[0]].slice();
        hands[opp[1]] = oh[opp[1]].slice();
        const st = {
          hands, trump,
          trick: view.trick.map((p) => ({ seat: p.seat, card: p.card })).concat([{ seat: me, card: c }]),
          turn: (me + 1) % 3, tricks: view.tricksWon.slice(), played: new Set(played),
        };
        S.rollout(st);
        vals[i].push(st.tricks[me] - b * st.tricks[threat]);
      });
    }
    let bestI = 0;
    let bestV = -Infinity;
    vals.forEach((arr, i) => {
      const mean = arr.reduce((a, x) => a + x, 0) / arr.length;
      const sd = Math.sqrt(arr.reduce((a, x) => a + (x - mean) * (x - mean), 0) / arr.length);
      const v = mean + riskF * sd + (this.rng() - 0.5) * 0.02;
      if (v > bestV) { bestV = v; bestI = i; }
    });
    return legal[bestI];
  }
}

// Hata halinde oyunun kilitlenmemesi için rastgele geçerli hamle.
function randomAction(view, rng = Math.random) {
  const l = view.legal;
  if (!l) return null;
  const pick = (a) => a[Math.floor(rng() * a.length)];
  switch (l.kind) {
    case 'discard': return { type: 'discard', cards: shuffle(view.hand, rng).slice(0, l.count) };
    case 'trump': return { type: 'trump', suit: pick(SUITS) };
    case 'pass': return { type: 'pass', card: pick(view.hand) };
    case 'play': return { type: 'play', card: pick(l.cards) };
    default: return null;
  }
}

module.exports = { Bot, randomAction, randn };
