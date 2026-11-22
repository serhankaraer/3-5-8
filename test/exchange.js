'use strict';
// Kart değişimi kuralları: af (1., 4., 7. el), tek seferde ve körlemesine iletme, çoklu veren, kart korunumu.
const assert = require('assert');
const { Game } = require('../packages/engine');
const R = require('../packages/engine/rules');

function fresh(handNoBefore, prevDiffs, dealer = 0) {
  const g = new Game({ firstDealer: dealer });
  g.drainEvents();
  g.handNo = handNoBefore;
  g.dealer = (dealer + 2) % 3; // startHand dağıtıcıyı bir ilerletir
  g.prevDiffs = prevDiffs;
  g.startHand();
  return g;
}

// af: 4. ve 7. elde (ve 1. elde) değişim yok; 2., 3., 5., 6., 8., 9. elde var
for (const [no, expectEx] of [[1, false], [2, true], [3, true], [4, false], [5, true], [6, true], [7, false], [8, true], [9, true]]) {
  const g = fresh(no - 1, [3, -1, -2]);
  assert.strictEqual(g.handNo, no);
  assert.strictEqual(g.phase, expectEx ? 'exchange' : 'trump', `el ${no}: faz ${g.phase}`);
}

// +3 bitiren, -1 ve -2 olanlardan toplam 3 kart ister; hepsini tek seferde iletir
{
  const g = fresh(1, [3, -1, -2], 0);
  assert.strictEqual(g.phase, 'exchange');
  assert.strictEqual(g.exchange.steps.length, 1, 'tek isteyen, tek adım');
  const st = g.view(0).exchange.current;
  assert.strictEqual(st.asker, 0);
  assert.strictEqual(st.count, 3);
  assert.strictEqual(st.givers.reduce((a, x) => a + x.count, 0), 3);
  assert.deepStrictEqual(st.givers.map((x) => x.count).sort(), [1, 2]);
  const l = g.legal(0);
  assert.strictEqual(l.kind, 'pass');
  assert.strictEqual(l.count, 3);
  // eksik ya da fazla kart reddedilir (kademeli isteme yok)
  assert(!g.act(0, { type: 'pass', cards: g.hands[0].slice(0, 2) }).ok, '2 kart kabul edilmemeli');
  assert(!g.act(0, { type: 'pass', cards: g.hands[0].slice(0, 4) }).ok, '4 kart kabul edilmemeli');
  assert(!g.act(0, { type: 'pass', card: g.hands[0][0] }).ok, 'tek kart kabul edilmemeli');
  // başkası kart ileteme
  assert(!g.act(1, { type: 'pass', cards: g.hands[1].slice(0, 3) }).ok);
  const before = g.hands.map((h) => h.slice());
  const passed = before[0].slice(0, 3);
  const r = g.act(0, { type: 'pass', cards: passed });
  assert(r.ok, r.error);
  assert.strictEqual(g.phase, 'trump', 'tüm değişim tek hamlede bitti');
  assert.deepStrictEqual(g.hands.map((h) => h.length), [16, 16, 16]);
  const all = [].concat(...g.hands, g.kitty);
  assert.strictEqual(new Set(all).size, 52);
  const evs = r.events.filter((e) => e.type === 'exchangePass');
  assert.strictEqual(evs.length, st.givers.length, 'her veren için bir olay');
  // ilk gruptaki kartlar ilk vereene gitti
  let at = 0;
  evs.forEach((e, i) => {
    assert.strictEqual(e.giver, st.givers[i].seat);
    assert.deepStrictEqual(e.passed, passed.slice(at, at + st.givers[i].count));
    at += st.givers[i].count;
    // verenin kartları: önceki el + iletilenler - iade edilenler
    const exp = before[e.giver].concat(e.passed).filter((c) => !e.returned.includes(c)).sort();
    assert.deepStrictEqual(g.hands[e.giver].slice().sort(), exp);
  });
}

// iki isteyen, tek veren: sırayla (hedefi büyük olandan başlayarak) her biri kendi kartlarını tek seferde iletir
{
  const g = fresh(1, [-3, 1, 2], 0);
  assert.strictEqual(g.exchange.steps.length, 2);
  const [a, b] = g.exchange.steps;
  assert(R.targetFor(a.asker, g.dealer) >= R.targetFor(b.asker, g.dealer), 'önce yüksek hedefli');
  assert.strictEqual(a.count + b.count, 3);
  assert(g.act(a.asker, { type: 'pass', cards: g.hands[a.asker].slice(0, a.count) }).ok);
  assert.strictEqual(g.phase, 'exchange');
  assert.strictEqual(g.actor(), b.asker);
  assert(g.act(b.asker, { type: 'pass', cards: g.hands[b.asker].slice(0, b.count) }).ok);
  assert.strictEqual(g.phase, 'trump');
    // yer kartları kart değişimine karışmaz: eller 16'şar, yer 4 kart kalır
  assert.deepStrictEqual(g.hands.map((h) => h.length), [16, 16, 16]);
  assert.strictEqual(g.kitty.length, 4);
  assert.strictEqual(new Set([].concat(...g.hands, g.kitty)).size, 52);
}

// yerden gelen kart: 8'li yeri alınca, kendisinden istenen seride verdiğinden büyük kart varsa masada gösterilir; kimseye verilmez
{
  const C = require('../packages/engine/cards');
  const g = fresh(1, [-3, 1, 2], 0);
  assert.strictEqual(g.dealer, 0);
  const kitty = ['S14', 'H14', 'D2', 'C2'];
  const rest = C.makeDeck().filter((c) => !kitty.includes(c));
  const dealerHand = rest.filter((c) => !(['S', 'H'].includes(C.suitOf(c)) && C.rankOf(c) > 10)).slice(0, 16);
  const others = rest.filter((c) => !dealerHand.includes(c));
  const lead = ['S13', 'H13', 'S12', 'H12'];
  const ordered = lead.concat(others.filter((c) => !lead.includes(c)));
  g.hands = [C.sortHand(dealerHand), C.sortHand(ordered.slice(0, 16)), C.sortHand(ordered.slice(16, 32))];
  g.kitty = kitty.slice();
  assert.deepStrictEqual(g.exchange.steps.map((x) => [x.asker, x.count]), [[1, 1], [2, 2]]);
  // 1. isteyen S13 iletir: dağıtıcının elinde ondan büyük maça yok, S13 iade edilir; yer değişime karışmaz
  let r = g.act(1, { type: 'pass', cards: ['S13'] });
  assert(r.ok, r.error);
  assert.deepStrictEqual(r.events.find((e) => e.type === 'exchangePass').returned, ['S13']);
  assert.strictEqual(g.kitty.length, 4);
  assert.strictEqual(g.view(2).floor.count, 4);
  assert.deepStrictEqual(g.view(2).floor.reveals, [], 'yer alınmadan hiçbir şey gösterilmez');
  const passed2 = g.hands[2].slice(0, 2);
  r = g.act(2, { type: 'pass', cards: passed2 });
  assert(r.ok, r.error);
  assert.strictEqual(g.phase, 'trump');
  assert.deepStrictEqual(g.hands.map((h) => h.length), [16, 16, 16]);
  // beklenen: kendisinden istenen serilerde verdiği en yüksek kartlar
  assert(g.act(0, { type: 'trump', suit: 'S' }).ok);
  const dr = g.act(0, { type: 'discard', cards: g.hands[0].slice(0, 4) });
  assert(dr.ok, dr.error);
  const shown = dr.events.filter((e) => e.type === 'floorShow').map((e) => e.card);
  assert(shown.includes('S14'), 'S14: spade istendi (S13 verildi), yerde S14 var → gösterilir');
  assert(!shown.includes('H14') || g.dealerGave.H !== undefined, 'H14 yalnızca kupa istendiyse gösterilir');
  assert(!shown.includes('D2') && !shown.includes('C2'), 'küçük kartlar gösterilmez');
  for (const c of shown) {
    assert(g.hands[0].includes(c), 'gösterilen kart 8\'linin elinde kalır');
    assert(!g.hands[1].includes(c) && !g.hands[2].includes(c), 'kimseye verilmez');
    assert(C.rankOf(c) > g.dealerGave[C.suitOf(c)]);
  }
  assert.deepStrictEqual(g.view(1).floor.reveals.map((x) => x.card), shown, 'herkes görür');
  assert.deepStrictEqual(g.hands.map((h) => h.length), [16, 16, 16]);
}

// 8'li el isteyense (verense değil) hiçbir şey gösterilmez
{
  const g = fresh(1, [3, -1, -2], 0);
  assert.strictEqual(g.dealer, 0);
  assert(g.act(0, { type: 'pass', cards: g.hands[0].slice(0, 3) }).ok);
  assert.deepStrictEqual(g.dealerGave, {});
  assert(g.act(0, { type: 'trump', suit: 'S' }).ok);
  const r = g.act(0, { type: 'discard', cards: g.hands[0].slice(0, 4) });
  assert.strictEqual(r.events.filter((e) => e.type === 'floorShow').length, 0);
}


// görünüm: kim kimden ne istedi/verdi; taraflar kartları görür, üçüncü oyuncu yalnızca adedi
{
  const g = fresh(1, [3, -1, -2], 1);
  const st = g.view(0).exchange.current;
  const passed = g.hands[0].slice(0, st.count);
  assert(g.act(0, { type: 'pass', cards: passed }).ok);
  for (const seat of [0, 1, 2]) {
    const recs = g.view(seat).exchange.records;
    assert.strictEqual(recs.length, st.givers.length);
    recs.forEach((r, i) => {
      assert.strictEqual(r.asker, 0);
      assert.strictEqual(r.giver, st.givers[i].seat);
      assert.strictEqual(r.n, st.givers[i].count);
      if (seat === 0 || seat === r.giver) {
        assert.strictEqual(r.passed.length, r.n);
        assert.strictEqual(r.returned.length, r.n);
      } else {
        assert.strictEqual(r.passed, null, 'üçüncü oyuncu kartları görmez');
        assert.strictEqual(r.returned, null);
      }
    });
  }
  assert.deepStrictEqual(g.view(1).gotKitty, [], 'yer alınmadan boş');
  assert(g.act(1, { type: 'trump', suit: 'S' }).ok);
  assert(g.act(1, { type: 'discard', cards: g.hands[1].slice(0, 4) }).ok);
  assert.strictEqual(g.view(1).gotKitty.length, 4, 'dağıtıcı yerden 4 kart aldı');
  assert.strictEqual(g.view(0).gotKitty.length, 0, 'diğerleri görmez');
}
{
  const g = fresh(1, [-3, 1, 2], 0);
  const [a, b] = g.exchange.steps;
  assert(g.act(a.asker, { type: 'pass', cards: g.hands[a.asker].slice(0, a.count) }).ok);
  assert(g.act(b.asker, { type: 'pass', cards: g.hands[b.asker].slice(0, b.count) }).ok);
  assert(g.act(0, { type: 'trump', suit: 'H' }).ok);
  const kit = g.kitty.slice();
  assert(g.act(0, { type: 'discard', cards: g.hands[0].slice(0, 4) }).ok);
  assert.deepStrictEqual(g.view(0).gotKitty.slice().sort(), kit.sort(), 'dağıtıcı yerden aldığı kartları bilir');
  assert.deepStrictEqual(g.view(1).gotKitty, [], 'diğerleri yerden alınanları görmez');
}

console.log('Kart değişimi testleri OK');
