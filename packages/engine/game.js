'use strict';
const C = require('./cards');
const R = require('./rules');

const HAND_SIZE = 16;
const DISCARD_COUNT = 4;

// Faz sırası (her el):
//  exchange : hedefi aşanlar, altında kalanlardan aştığı kadar kart ister; en yüksek hedefliden en düşüğe.
//             Bir isteyen tüm kartlarını tek seferde, körlemesine iletir; sonra tüm verenler karşılığını verir.
//             İlk el ve her 3 elde bir (4. ve 7. el) af: kart değişimi yoktur.
//             Tüm kart alma-verme işlemleri koz belirlenmeden ÖNCE biter; 8'li el yerdeki 4 kartı henüz almamıştır.
//             8'li el yerdeki 4 kartı alınca, kendisinden istenen bir seride diğerlerine verdiğinden büyük kart varsa
//             onu masada herkese "yerden geldi" diye gösterir (floorShow olayı); kart kimseye verilmez, onda kalır.
//  trump    : 8'li el (dağıtıcı) kozu belirler (herkese açık)
//  discard  : 8'li el 4 kartı gömer, ardından masadaki 4 kapalı kartı (kitty) otomatik alır
//  play     : 16 el oynanır; her el sonrası trickEnd
//  trickEnd : 3 kart atıldı, advance() ile el sahibi belirlenir
//  handEnd  : el bitti, advance() ile sonraki el ya da oyun sonu
//  gameEnd  : oyun bitti
class Game {
  constructor(opts = {}) {
    this.rng = opts.rng || Math.random;
    this.totalHands = opts.totalHands || 9;
    this.handNo = 0;
    this.dealer = opts.firstDealer != null ? opts.firstDealer : Math.floor(this.rng() * 3);
    this.results = [];
    this.totals = [0, 0, 0];
    this.prevDiffs = null;
    this.winners = null;
    this._ev = [];
    this.startHand();
  }

  _emit(ev) { this._ev.push(ev); }
  drainEvents() { const e = this._ev; this._ev = []; return e; }

  startHand() {
    if (this.handNo > 0) this.dealer = R.nextSeat(this.dealer);
    this.handNo++;
    const deck = C.shuffle(C.makeDeck(), this.rng);
    this.hands = [0, 1, 2].map((i) => C.sortHand(deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE)));
    this.kitty = deck.slice(3 * HAND_SIZE);
    this.floorReveals = []; // 8'li yeri alınca masada herkese gösterilen kartlar (hile yok kanıtı)
    this.exchangeRecs = []; // tamamlanan kart değişimleri (görünüm kişiye göre süzülür)
    this.kittyTaken = []; // 8'linin yerden aldığı kartlar
    this.dealerGave = {}; // 8'linin kart değişiminde diğerlerine verdiği en yüksek kart (renk -> değer)
    this.discarded = [];
    this.trump = null;
    this.trumpRevealed = false;
    this.targets = [0, 1, 2].map((s) => R.targetFor(s, this.dealer));
    this.tricksWon = [0, 0, 0];
    this.trick = [];
    this.lastTrick = null;
    this.history = [];
    this.trickNo = 1;
    // af: 1., 4. ve 7. elde kimse kart alıp vermez (hedef döngüsünün ilk eli)
    const amnesty = this.handNo % 3 === 1;
    this.exchange = { steps: this.prevDiffs && !amnesty ? R.exchangePlan(this.prevDiffs, this.dealer) : [], idx: 0 };
    this.phase = this.exchange.steps.length ? 'exchange' : 'trump';
    this.turn = this.dealer;
    this._emit({ type: 'dealt', hand: this.handNo, total: this.totalHands, dealer: this.dealer, targets: this.targets.slice(), amnesty: amnesty && this.handNo > 1 });
    if (this.exchange.steps.length) {
      this._emit({ type: 'exchangeStart', steps: this.exchange.steps.map((s) => ({ asker: s.asker, givers: s.givers.map((x) => ({ seat: x.seat, count: x.count })), count: s.count })) });
    }
  }

  actor() {
    switch (this.phase) {
      case 'discard':
      case 'trump': return this.dealer;
      case 'exchange': return this.exchange.steps[this.exchange.idx].asker;
      case 'play': return this.turn;
      default: return null;
    }
  }

  legal(seat) {
    if (this.actor() !== seat) return null;
    switch (this.phase) {
      case 'discard': return { kind: 'discard', count: DISCARD_COUNT };
      case 'trump': return { kind: 'trump', suits: C.SUITS.slice() };
      case 'exchange': {
        const st = this.exchange.steps[this.exchange.idx];
        return { kind: 'pass', count: st.count, givers: st.givers.map((x) => ({ seat: x.seat, count: x.count })) };
      }
      case 'play': {
        return { kind: 'play', cards: R.legalCards(this.hands[seat], this.trick, this.trump) };
      }
      default: return null;
    }
  }

  act(seat, action) {
    if (!action || typeof action !== 'object') return { ok: false, error: 'Geçersiz hamle' };
    if (this.actor() !== seat) return { ok: false, error: 'Sıra sende değil' };
    let r;
    switch (action.type) {
      case 'discard': r = this._discard(seat, action); break;
      case 'trump': r = this._trump(seat, action); break;
      case 'pass': r = this._pass(seat, action); break;
      case 'play': r = this._play(seat, action); break;
      default: r = { ok: false, error: 'Bilinmeyen hamle' };
    }
    if (!r.ok) return r;
    return { ok: true, events: this.drainEvents() };
  }

  _discard(seat, a) {
    if (this.phase !== 'discard') return { ok: false, error: 'Şu an kart atılamaz' };
    const cards = a.cards;
    if (!Array.isArray(cards) || cards.length !== DISCARD_COUNT) return { ok: false, error: '4 kart seçmelisin' };
    if (new Set(cards).size !== DISCARD_COUNT) return { ok: false, error: 'Aynı kart iki kez seçilemez' };
    const hand = this.hands[seat];
    if (!cards.every((c) => hand.includes(c))) return { ok: false, error: 'Kart elinde değil' };
    const rest = hand.filter((c) => !cards.includes(c));
    // kendisinden istenen bir seride, verdiği kartlardan büyük kart yerden geldiyse masada herkese gösterilir
    // (hile yapmadığının kanıtı); kart diğer oyunculara verilmez, 8'linin elinde kalır
    this.floorReveals = this.kitty.filter((c) => this.dealerGave[C.suitOf(c)] !== undefined && C.rankOf(c) > this.dealerGave[C.suitOf(c)])
      .map((c) => ({ seat, card: c }));
    this.kittyTaken = this.kitty.slice();
    this.hands[seat] = C.sortHand(rest.concat(this.kitty));
    this.discarded = cards.slice();
    this.kitty = [];
    this._emit({ type: 'discarded', seat });
    for (const r of this.floorReveals) this._emit({ type: 'floorShow', seat, card: r.card });
    this._beginPlay();
    return { ok: true };
  }

  _trump(seat, a) {
    if (this.phase !== 'trump') return { ok: false, error: 'Şu an koz seçilemez' };
    if (!C.SUITS.includes(a.suit)) return { ok: false, error: 'Geçersiz koz' };
    this.trump = a.suit;
    this.trumpRevealed = true;
    this.phase = 'discard';
    this._emit({ type: 'trumpChosen', seat, suit: a.suit });
    return { ok: true };
  }

  // İsteyen, kartlarının hepsini tek seferde iletir (cards dizisi: ilk gruptaki kartlar ilk vereene, sonrakiler sıradaki vereene).
  // Veren oyuncular, kartları görmeden önce hiçbir şey almamış olur; iadeler hepsi bittikten sonra uygulanır.
  _pass(seat, a) {
    if (this.phase !== 'exchange') return { ok: false, error: 'Şu an kart değişimi yok' };
    const ex = this.exchange;
    const st = ex.steps[ex.idx];
    const cards = a.cards;
    if (!Array.isArray(cards) || cards.length !== st.count) return { ok: false, error: st.count + ' kart seçmelisin' };
    if (new Set(cards).size !== cards.length) return { ok: false, error: 'Aynı kart iki kez seçilemez' };
    const hand = this.hands[seat];
    if (!cards.every((c) => hand.includes(c))) return { ok: false, error: 'Kart elinde değil' };
    let askerHand = hand.filter((c) => !cards.includes(c));
    let at = 0;
    const evs = [];
    for (const gv of st.givers) {
      const passed = cards.slice(at, at + gv.count);
      at += gv.count;
      const giverHand = this.hands[gv.seat];
      const returned = R.exchangeReturns(giverHand, passed);
      this.hands[gv.seat] = C.sortHand(giverHand.filter((c) => !returned.includes(c)).concat(passed.filter((c) => !returned.includes(c))));
      askerHand = askerHand.concat(returned);
      // 8'li elin (dağıtıcı) kendisinden istenen serilerde verdiği en yüksek kart: yer kartlarıyla kıyaslamak için tutulur
      if (gv.seat === this.dealer) {
        for (const c of returned) {
          const s = C.suitOf(c);
          if (this.dealerGave[s] === undefined || C.rankOf(c) > this.dealerGave[s]) this.dealerGave[s] = C.rankOf(c);
        }
      }
      this.exchangeRecs.push({ asker: seat, giver: gv.seat, passed: passed.slice(), returned: returned.slice() });
      evs.push({ type: 'exchangePass', asker: seat, giver: gv.seat, passed, returned, private: [seat, gv.seat] });
    }
    this.hands[seat] = C.sortHand(askerHand);
    for (const e of evs) this._emit(e);
    ex.idx++;
    if (ex.idx >= ex.steps.length) this.phase = 'trump';
    return { ok: true };
  }

  _beginPlay() {
    this.phase = 'play';
    this.turn = R.nextSeat(this.dealer);
  }

  _play(seat, a) {
    if (this.phase !== 'play') return { ok: false, error: 'Şu an kart oynanamaz' };
    const hand = this.hands[seat];
    if (!hand.includes(a.card)) return { ok: false, error: 'Kart elinde değil' };
    if (!R.legalCards(hand, this.trick, this.trump).includes(a.card)) return { ok: false, error: 'Bu kartı atamazsın: renge uy, rengin yoksa koz at, büyük kartın varsa büyüt' };
    this.hands[seat] = hand.filter((c) => c !== a.card);
    this.trick.push({ seat, card: a.card });
    this._emit({ type: 'play', seat, card: a.card });
    if (this.trick.length === 3) {
      this.phase = 'trickEnd';
      this.turn = null;
    } else {
      this.turn = R.nextSeat(seat);
    }
    return { ok: true };
  }

  // trickEnd ve handEnd fazlarını ilerletir (sunucu bekleme süresinden sonra çağırır).
  advance() {
    if (this.phase === 'trickEnd') {
      const winner = R.trickWinner(this.trick, this.trump);
      this.tricksWon[winner]++;
      const rec = { no: this.trickNo, leader: this.trick[0].seat, plays: this.trick.map((p) => ({ seat: p.seat, card: p.card })), winner };
      this.history.push(rec);
      this.lastTrick = rec;
      this.trick = [];
      this._emit({ type: 'trickWon', seat: winner, no: this.trickNo });
      if (this.trickNo >= HAND_SIZE) this._endHand();
      else { this.trickNo++; this.phase = 'play'; this.turn = winner; }
    } else if (this.phase === 'handEnd') {
      if (this.handNo >= this.totalHands) this._endGame();
      else this.startHand();
    } else {
      return { ok: false, error: 'İlerletilecek bir şey yok' };
    }
    return { ok: true, events: this.drainEvents() };
  }

  _endHand() {
    const diffs = this.tricksWon.map((t, s) => t - this.targets[s]);
    this.results.push({ hand: this.handNo, dealer: this.dealer, targets: this.targets.slice(), tricks: this.tricksWon.slice(), diffs });
    this.totals = this.totals.map((t, s) => t + diffs[s]);
    this.prevDiffs = diffs;
    this.phase = 'handEnd';
    this.turn = null;
    this._emit({ type: 'handEnd', hand: this.handNo, targets: this.targets.slice(), tricks: this.tricksWon.slice(), diffs, totals: this.totals.slice() });
  }

  _endGame() {
    const max = Math.max(...this.totals);
    let w = [0, 1, 2].filter((s) => this.totals[s] === max);
    if (w.length > 1) {
      const last = this.results[this.results.length - 1].diffs;
      const lm = Math.max(...w.map((s) => last[s]));
      w = w.filter((s) => last[s] === lm); // eşitlikte son elin puanı yüksek olan; yine eşitse ortak galip
    }
    this.winners = w;
    this.phase = 'gameEnd';
    this.turn = null;
    this._emit({ type: 'gameEnd', winners: w.slice(), totals: this.totals.slice() });
  }

  // Koltuğun görebildiği (gizli bilgisi süzülmüş) durum.
  view(seat) {
    const isDealer = seat === this.dealer;
    const ex = this.exchange;
    const cur = this.phase === 'exchange' ? ex.steps[ex.idx] : null;
    return {
      you: seat,
      phase: this.phase,
      handNo: this.handNo,
      totalHands: this.totalHands,
      dealer: this.dealer,
      targets: this.targets.slice(),
      actor: this.actor(),
      hand: this.hands[seat].slice(),
      counts: this.hands.map((h) => h.length),
      trick: this.trick.map((p) => ({ seat: p.seat, card: p.card })),
      lastTrick: this.lastTrick,
      history: this.history,
      trickNo: this.trickNo,
      tricksWon: this.tricksWon.slice(),
      trump: this.trump,
      discarded: isDealer ? this.discarded.slice() : null,
      gotKitty: isDealer ? this.kittyTaken.slice() : [],
      floor: { count: this.kitty.length, reveals: this.floorReveals.map((r) => ({ seat: r.seat, card: r.card })) },
      exchange: {
        steps: ex.steps.map((s) => ({ asker: s.asker, givers: s.givers.map((x) => ({ seat: x.seat, count: x.count })), count: s.count })),
        idx: ex.idx,
        // kim kimden ne istedi, ne verdi: yalnızca taraflar kartları görür, üçüncü oyuncu sadece adedi bilir
        records: this.exchangeRecs.map((r) => (r.asker === seat || r.giver === seat
          ? { asker: r.asker, giver: r.giver, passed: r.passed.slice(), returned: r.returned.slice(), n: r.passed.length }
          : { asker: r.asker, giver: r.giver, passed: null, returned: null, n: r.passed.length })),
        current: cur ? { asker: cur.asker, givers: cur.givers.map((x) => ({ seat: x.seat, count: x.count })), count: cur.count } : null,
      },
      totals: this.totals.slice(),
      results: this.results,
      winners: this.winners,
      legal: this.legal(seat),
    };
  }
}

module.exports = { Game, HAND_SIZE, DISCARD_COUNT };
