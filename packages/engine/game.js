'use strict';
const C = require('./cards');
const R = require('./rules');

const HAND_SIZE = 16;
const DISCARD_COUNT = 4;

// Faz sırası (her el):
//  exchange : (ilk el hariç) hedefi aşanlar, altında kalanlardan kart ister; en yüksek hedefliden en düşüğe.
//             Tüm kart alma-verme işlemleri koz belirlenmeden ÖNCE biter.
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
    this.discarded = [];
    this.trump = null;
    this.trumpRevealed = false;
    this.targets = [0, 1, 2].map((s) => R.targetFor(s, this.dealer));
    this.tricksWon = [0, 0, 0];
    this.trick = [];
    this.lastTrick = null;
    this.history = [];
    this.trickNo = 1;
    this.exchange = { steps: this.prevDiffs ? R.exchangePlan(this.prevDiffs, this.dealer) : [], idx: 0 };
    this.phase = this.exchange.steps.length ? 'exchange' : 'trump';
    this.turn = this.dealer;
    this._emit({ type: 'dealt', hand: this.handNo, total: this.totalHands, dealer: this.dealer, targets: this.targets.slice() });
    if (this.exchange.steps.length) {
      this._emit({ type: 'exchangeStart', steps: this.exchange.steps.map((s) => ({ asker: s.asker, giver: s.giver, count: s.count })) });
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
        return { kind: 'pass', giver: st.giver, remaining: st.count - st.done };
      }
      case 'play': {
        const led = this.trick.length ? C.suitOf(this.trick[0].card) : null;
        return { kind: 'play', cards: R.legalCards(this.hands[seat], led) };
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
    this.hands[seat] = C.sortHand(rest.concat(this.kitty));
    this.discarded = cards.slice();
    this.kitty = [];
    this._emit({ type: 'discarded', seat });
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

  _pass(seat, a) {
    if (this.phase !== 'exchange') return { ok: false, error: 'Şu an kart değişimi yok' };
    const ex = this.exchange;
    const st = ex.steps[ex.idx];
    const hand = this.hands[seat];
    if (!hand.includes(a.card)) return { ok: false, error: 'Kart elinde değil' };
    const giverHand = this.hands[st.giver];
    const ret = R.exchangeReturnCard(giverHand, a.card);
    if (ret !== a.card) {
      this.hands[seat] = C.sortHand(hand.filter((c) => c !== a.card).concat(ret));
      this.hands[st.giver] = C.sortHand(giverHand.filter((c) => c !== ret).concat(a.card));
    }
    st.done++;
    this._emit({ type: 'exchangePass', asker: seat, giver: st.giver, passed: a.card, returned: ret, n: st.done, count: st.count, private: [seat, st.giver] });
    if (st.done >= st.count) ex.idx++;
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
    const led = this.trick.length ? C.suitOf(this.trick[0].card) : null;
    if (!R.legalCards(hand, led).includes(a.card)) return { ok: false, error: 'Açılan renge uymak zorundasın' };
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
      exchange: {
        steps: ex.steps.map((s) => ({ asker: s.asker, giver: s.giver, count: s.count, done: s.done })),
        idx: ex.idx,
        current: cur ? { asker: cur.asker, giver: cur.giver, count: cur.count, remaining: cur.count - cur.done } : null,
      },
      totals: this.totals.slice(),
      results: this.results,
      winners: this.winners,
      legal: this.legal(seat),
    };
  }
}

module.exports = { Game, HAND_SIZE, DISCARD_COUNT };
