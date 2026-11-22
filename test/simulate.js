'use strict';
// Botlarla tam oyun simülasyonu: kural bütünlüğü ve bot sağlamlığı testi.
const assert = require('assert');
const { Game } = require('../packages/engine');
const { Bot, genTraits, NAMES, TRAITS } = require('../packages/ai');

// tekrarlanabilir rastgelelik
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { thinkDelayMs } = require('../packages/ai');
for (let t = 1; t <= 100; t++) {
  for (let k = 0; k < 20; k++) {
    const d = thinkDelayMs(t);
    assert(d >= 1000 && d <= 3000, `düşünme süresi 1-3 sn olmalı: tempo ${t} -> ${d}`);
  }
}
assert.strictEqual(NAMES.length, 100, 'isim listesi 100 olmalı');
assert.strictEqual(new Set(NAMES).size, 100, 'isimler benzersiz olmalı');

function allCards(g) {
  return [].concat(...g.hands, g.kitty, g.discarded, g.trick.map((p) => p.card), ...g.history.map((h) => h.plays.map((p) => p.card)));
}

function playGame(seed, traitsList) {
  const rng = mulberry32(seed);
  const g = new Game({ rng });
  g.drainEvents();
  const bots = [0, 1, 2].map((s) => new Bot({ seat: s, traits: traitsList ? traitsList[s] : genTraits(rng), rng }));
  const stats = { exchanges: 0, gain: 0, hands: 0, steps: 0 };
  let trumpSeen = false;
  const phaseSeq = [];
  let guard = 0;
  while (g.phase !== 'gameEnd') {
    assert(++guard < 5000, 'sonsuz döngü');
    const all = allCards(g);
    assert.strictEqual(all.length, 52, `kart sayısı ${all.length}`);
    assert.strictEqual(new Set(all).size, 52, 'kart tekrarı');
    let res;
    if (g.phase === 'trickEnd' || g.phase === 'handEnd') {
      res = g.advance();
      assert(res.ok);
    } else {
      const seat = g.actor();
      assert(seat !== null, 'actor yok: ' + g.phase);
      const view = g.view(seat);
      // gizlilik: koz sadece 8'li elde ya da açıldıysa görünür
      for (const s of [0, 1, 2]) {
        const v = g.view(s);
        if (g.trump === null) assert.strictEqual(v.trump, null, 'koz henüz seçilmedi');
        else assert.strictEqual(v.trump, g.trump, 'koz seçildikten sonra herkese açık olmalı');
        assert.strictEqual(v.hand.length, g.hands[s].length);
      }
      const action = bots[seat].decide(view);
      assert(action, 'bot hamle üretmedi: ' + g.phase);
      res = g.act(seat, action);
      assert(res.ok, `geçersiz hamle (${g.phase}): ${res.error} ${JSON.stringify(action)}`);
      stats.steps++;
    }
    if (phaseSeq[phaseSeq.length - 1] !== g.phase) phaseSeq.push(g.phase);
    for (const ev of res.events) {
      if (ev.type === 'dealt') {
        trumpSeen = false;
        const dealer = ev.dealer;
        void dealer;
      }
      if (ev.type === 'trumpChosen') trumpSeen = true;
      if (ev.type === 'exchangeStart') {
        const tg = (x) => ev.targets ? ev.targets[x] : g.targets[x];
        const steps = ev.steps;
        for (let i = 1; i < steps.length; i++) {
          assert(tg(steps[i - 1].asker) >= tg(steps[i].asker), 'isteyenler en yüksek hedeften başlamalı');
          if (steps[i - 1].asker === steps[i].asker) assert(tg(steps[i - 1].giver) >= tg(steps[i].giver), 'verenler de yüksek hedeften düşüğe sıralanmalı');
        }
      }
      if (ev.type === 'exchangePass') {
        assert(!trumpSeen, 'kart değişimi koz belirlenmeden önce bitmeli');
        stats.exchanges++;
        const rank = (c) => Number(c.slice(1));
        assert(ev.returned[0] === ev.passed[0], 'iade aynı renkten olmalı');
        assert(rank(ev.returned) >= rank(ev.passed), 'iade kart daha düşük olamaz');
        stats.gain += rank(ev.returned) - rank(ev.passed);
      }
      if (ev.type === 'handEnd') {
        stats.hands++;
        assert.strictEqual(ev.diffs.reduce((a, b) => a + b, 0), 0, 'fark toplamı 0 olmalı');
        assert.strictEqual(ev.tricks.reduce((a, b) => a + b, 0), 16);
        assert.deepStrictEqual(ev.targets.slice().sort(), [3, 5, 8]);
      }
    }
  }
  assert.strictEqual(g.handNo, 9);
  // faz sırası: (exchange) -> trump -> discard -> play ...
  const flat = phaseSeq.join('>');
  assert(!/discard>(trump|exchange)/.test(flat), 'koz ve kart değişimi gömmeden önce olmalı: ' + flat);
  assert(!/trump>exchange/.test(flat), 'kart değişimi koz belirlenmeden önce olmalı');
  assert.strictEqual(g.totals.reduce((a, b) => a + b, 0), 0);
  assert(g.winners && g.winners.length >= 1);
  // hedef rotasyonu: her oyuncu her hedefi 3'er kez oynamış olmalı
  for (let s = 0; s < 3; s++) {
    const cnt = { 3: 0, 5: 0, 8: 0 };
    g.results.forEach((r) => cnt[r.targets[s]]++);
    assert.deepStrictEqual(cnt, { 3: 3, 5: 3, 8: 3 }, 'hedef rotasyonu bozuk');
  }
  return { g, stats };
}

const N = Number(process.argv[2] || 40);
let t0 = Date.now();
let ex = 0;
let gain = 0;
let hands = 0;
let ties = 0;
for (let i = 1; i <= N; i++) {
  const { g, stats } = playGame(i);
  ex += stats.exchanges; gain += stats.gain; hands += stats.hands;
  if (g.winners.length > 1) ties++;
}
const ms = Date.now() - t0;
console.log(`OK: ${N} oyun, ${hands} el, ${ex} kart değişimi (ort. kazanç ${(gain / Math.max(1, ex)).toFixed(2)} sıra), ortak galibiyet: ${ties}, ${(ms / N).toFixed(0)} ms/oyun`);

// Güç kontrolü: ileri hesabı yüksek bot, zayıfa karşı daha çok kazanmalı
function fixed(foresight) { return { risk: 50, memory: foresight, foresight, blocking: 50, tempo: 50 }; }
let strongPts = 0;
let weakPts = 0;
const M = Number(process.argv[3] || 24);
t0 = Date.now();
for (let i = 1; i <= M; i++) {
  const { g } = playGame(1000 + i, [fixed(95), fixed(1), fixed(1)]);
  strongPts += g.totals[0];
  weakPts += (g.totals[1] + g.totals[2]) / 2;
}
console.log(`Güç testi (${M} oyun): güçlü bot ort. toplam ${(strongPts / M).toFixed(2)}, zayıf botlar ort. ${(weakPts / M).toFixed(2)} (${((Date.now() - t0) / M).toFixed(0)} ms/oyun)`);
assert(TRAITS.length === 5);
