'use strict';
function trSuffix(name, kind) {
  var lower = String(name).toLocaleLowerCase('tr');
  var vowels = 'aeıioöuü';
  var last = '';
  for (var i = lower.length - 1; i >= 0; i--) if (vowels.indexOf(lower.charAt(i)) >= 0) { last = lower.charAt(i); break; }
  var back = 'aıou'.indexOf(last) >= 0 && last !== '';
  var ch = lower.charAt(lower.length - 1);
  var endsVowel = vowels.indexOf(ch) >= 0;
  var voiceless = 'çfhkpsşt'.indexOf(ch) >= 0;
  if (kind === 'abl') return (voiceless ? 't' : 'd') + (back ? 'an' : 'en');
  if (kind === 'dat') return (endsVowel ? 'y' : '') + (back ? 'a' : 'e');
  var v = 'aı'.indexOf(last) >= 0 && last !== '' ? 'ı' : ('ou'.indexOf(last) >= 0 && last !== '' ? 'u' : ('öü'.indexOf(last) >= 0 && last !== '' ? 'ü' : 'i'));
  return endsVowel ? 'n' + v + 'n' : v + 'n';
}
// isme ünlü uyumuna göre ek: "Serhan'dan", "Kerem'den", "Ayşe'ye", "Ali'nin"
function ek(name, kind) { return name + '\'' + trSuffix(name, kind); }
const crypto = require('crypto');
const { Game } = require('../engine');
const { cardLabel, SUIT_NAMES, SUIT_SYMBOLS } = require('../engine/cards');
const { Bot, genTraits, pickName, randomAction } = require('../ai');

function readConfig() {
  return {
    takeoverMs: Number(process.env.TAKEOVER_MS || 30000), // bağlantı kopunca bot devralma süresi
    roomTtlMs: Number(process.env.ROOM_TTL_MS || 300000), // bağlı insan kalmayan oda ömrü (5 dk)
    trickEndMs: Number(process.env.TRICK_END_MS || 1600),
    handEndMs: Number(process.env.HAND_END_MS || 9000),
    botScale: Number(process.env.BOT_DELAY_SCALE || 1), // test için bot gecikmesini ölçekler
  };
}

function blankSeat() {
  return { kind: 'empty', name: '', token: null, conn: null, connected: false, traits: null, bot: null, takeover: null, pendingReclaim: false, offlineTimer: null };
}

function cleanName(raw) {
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return s || 'Oyuncu';
}

class Room {
  constructor(code, onExpire) {
    this.code = code;
    this.cfg = readConfig();
    this.onExpire = onExpire;
    this.seats = [blankSeat(), blankSeat(), blankSeat()];
    this.host = null;
    this.game = null;
    this.log = [];
    this.logId = 0;
    this.timer = null;
    this.expireTimer = null;
  }

  // ---------- yardımcılar ----------
  name(i) {
    const s = this.seats[i];
    return s.takeover ? `${s.name} (bot)` : s.name;
  }
  _say(text, to = null) {
    this.log.push({ id: ++this.logId, to, text });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }
  _logFor(i) {
    return this.log.filter((e) => !e.to || e.to.includes(i)).slice(-60).map((e) => ({ id: e.id, text: e.text }));
  }
  connectedHumans() {
    return this.seats.filter((s) => s.kind === 'human' && s.connected && !s.takeover).length;
  }
  _controller(i) {
    const s = this.seats[i];
    if (s.kind === 'bot') return s.bot;
    if (s.kind === 'human' && s.takeover) return s.takeover;
    return null;
  }
  _freeSeat() { return this.seats.findIndex((s) => s.kind === 'empty'); }
  _takenNames() { return this.seats.filter((s) => s.kind !== 'empty').map((s) => s.name); }

  // ---------- katılma / ayrılma ----------
  join(conn, { name, token }) {
    const nm = cleanName(name);
    // 1) belirteçle ya da (bağlantısı kopuk koltukta) aynı isimle geri dönüş
    let idx = -1;
    if (token) idx = this.seats.findIndex((s) => s.kind === 'human' && s.token === token);
    if (idx < 0) idx = this.seats.findIndex((s) => s.kind === 'human' && !s.connected && s.name.toLowerCase() === nm.toLowerCase());
    if (idx >= 0) {
      this._attach(idx, conn);
      const s = this.seats[idx];
      if (s.takeover) {
        if (this.game && this.game.phase !== 'gameEnd') {
          s.pendingReclaim = true;
          this._say(`${s.name} geri döndü; koltuğunu bir sonraki elin başında geri alacak.`);
        } else { s.takeover = null; s.pendingReclaim = false; }
      } else {
        this._say(`${s.name} yeniden bağlandı.`);
      }
      this._afterMembership();
      return { ok: true, seat: idx, token: s.token };
    }
    if (this.game && this.game.phase !== 'gameEnd') return { ok: false, error: 'Oyun başladı; boş koltuk yok' };
    const free = this._freeSeat();
    if (free < 0) return { ok: false, error: 'Oda dolu' };
    let finalName = nm;
    let n = 2;
    while (this._takenNames().some((x) => x.toLowerCase() === finalName.toLowerCase())) finalName = `${nm} ${n++}`;
    const s = this.seats[free];
    s.kind = 'human';
    s.name = finalName;
    s.token = crypto.randomBytes(16).toString('hex');
    if (this.host === null) this.host = free;
    this._attach(free, conn);
    this._say(`${finalName} odaya katıldı.`);
    this._afterMembership();
    return { ok: true, seat: free, token: s.token };
  }

  _attach(i, conn) {
    const s = this.seats[i];
    if (s.offlineTimer) { clearTimeout(s.offlineTimer); s.offlineTimer = null; }
    if (s.conn && s.conn !== conn) { try { s.conn.close(4000); } catch (e) { /* yoksay */ } }
    s.conn = conn;
    s.connected = true;
  }

  // Bağlantı koptu (ya da kullanıcı ayrıldı).
  onDisconnect(i, conn, immediate = false) {
    const s = this.seats[i];
    if (!s || s.conn !== conn) return;
    s.conn = null;
    s.connected = false;
    if (!this.game || this.game.phase === 'gameEnd') {
      this._removeHuman(i);
    } else if (!s.takeover) {
      if (immediate) {
        this._takeover(i);
      } else {
        this._say(`${s.name} bağlantısı koptu; ${Math.round(this.cfg.takeoverMs / 1000)} sn içinde dönmezse bot devralacak.`);
        s.offlineTimer = setTimeout(() => this._takeover(i), this.cfg.takeoverMs);
      }
    }
    this._afterMembership();
  }

  _removeHuman(i) {
    const s = this.seats[i];
    if (s.offlineTimer) clearTimeout(s.offlineTimer);
    if (s.kind === 'human') this._say(`${s.name} odadan ayrıldı.`);
    this.seats[i] = blankSeat();
    if (this.host === i) {
      const h = this.seats.findIndex((x) => x.kind === 'human');
      this.host = h >= 0 ? h : null;
    }
  }

  _takeover(i) {
    const s = this.seats[i];
    s.offlineTimer = null;
    if (!this.game || s.connected || s.takeover) return;
    s.takeover = new Bot({ seat: i, traits: genTraits(), rng: Math.random });
    this._say(`${s.name} yerine bot oynuyor.`);
    this._afterMembership();
  }

  _afterMembership() {
    // oda ömrü: bağlı insan kalmadıysa 5 dk sonra silinir
    if (this.connectedHumans() === 0) {
      if (!this.expireTimer) this.expireTimer = setTimeout(() => this.onExpire && this.onExpire(this), this.cfg.roomTtlMs);
    } else if (this.expireTimer) {
      clearTimeout(this.expireTimer);
      this.expireTimer = null;
    }
    this._broadcast();
    this._schedule();
  }

  destroy() {
    clearTimeout(this.timer);
    clearTimeout(this.expireTimer);
    this.timer = null;
    this.expireTimer = null;
    for (const s of this.seats) {
      if (s.offlineTimer) clearTimeout(s.offlineTimer);
      if (s.conn) { try { s.conn.close(4001); } catch (e) { /* yoksay */ } }
    }
  }

  // ---------- lobi işlemleri ----------
  handle(i, msg) {
    const s = this.seats[i];
    const err = (text) => s.conn && s.conn.send(JSON.stringify({ t: 'error', msg: text }));
    switch (msg.t) {
      case 'addBot': {
        if (this.host !== i) return err('Sadece oda sahibi bot ekleyebilir');
        if (this.game && this.game.phase !== 'gameEnd') return err('Oyun sürüyor');
        const free = this._freeSeat();
        if (free < 0) return err('Boş koltuk yok');
        const bs = this.seats[free];
        bs.kind = 'bot';
        bs.name = pickName(Math.random, this._takenNames());
        bs.traits = genTraits();
        bs.bot = new Bot({ seat: free, traits: bs.traits, rng: Math.random });
        this._broadcast();
        return undefined;
      }
      case 'removeBot': {
        if (this.host !== i) return err('Sadece oda sahibi bot çıkarabilir');
        if (this.game && this.game.phase !== 'gameEnd') return err('Oyun sürüyor');
        const k = Number(msg.seat);
        if (!(k >= 0 && k < 3) || this.seats[k].kind !== 'bot') return err('Geçersiz koltuk');
        this.seats[k] = blankSeat();
        this._broadcast();
        return undefined;
      }
      case 'start': return this._start(i, err);
      case 'newGame': {
        if (this.host !== i) return err('Sadece oda sahibi yeni oyun başlatabilir');
        if (!this.game || this.game.phase !== 'gameEnd') return err('Oyun henüz bitmedi');
        this.game = null;
        clearTimeout(this.timer);
        for (let k = 0; k < 3; k++) {
          const x = this.seats[k];
          if (x.kind === 'human') { x.takeover = null; x.pendingReclaim = false; if (!x.connected) this._removeHuman(k); }
        }
        this.log = [];
        this._broadcast();
        return undefined;
      }
      case 'act': return this._humanAct(i, msg.action, err);
      default: return err('Bilinmeyen komut');
    }
  }

  _start(i, err) {
    if (this.host !== i) return err('Sadece oda sahibi oyunu başlatabilir');
    if (this.game && this.game.phase !== 'gameEnd') return err('Oyun zaten başladı');
    if (this.seats.some((s) => s.kind === 'empty')) return err('3 koltuğun da dolu olması gerekir (bot ekleyebilirsin)');
    this.log = [];
    this.game = new Game({ rng: Math.random });
    for (let k = 0; k < 3; k++) {
      const s = this.seats[k];
      s.takeover = null;
      s.pendingReclaim = false;
      if (s.kind === 'bot') s.bot = new Bot({ seat: k, traits: s.traits, rng: Math.random });
    }
    this._after(this.game.drainEvents());
    return undefined;
  }

  _humanAct(i, action, err) {
    const g = this.game;
    const s = this.seats[i];
    if (!g || g.phase === 'gameEnd') return err('Oyun yok');
    if (s.takeover) return err('Bu el botun oynuyor; koltuğunu sonraki elde geri alacaksın');
    const res = g.act(i, action);
    if (!res.ok) return err(res.error);
    this._after(res.events);
    return undefined;
  }

  // ---------- oyun akışı ----------
  _after(events) {
    this._logEvents(events);
    if (events.some((e) => e.type === 'dealt')) {
      for (let k = 0; k < 3; k++) {
        const s = this.seats[k];
        if (s.kind === 'human' && s.takeover && s.pendingReclaim && s.connected) {
          s.takeover = null;
          s.pendingReclaim = false;
          this._say(`${s.name} koltuğunu geri aldı.`);
        }
      }
    }
    this._broadcast();
    this._schedule();
  }

  _later(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
  }

  _schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    const g = this.game;
    if (!g) return;
    const watched = this.connectedHumans() > 0;
    // izleyen insan yoksa botlar beklemeden oyunu bitirir
    if (g.phase === 'trickEnd') return this._later(watched ? this.cfg.trickEndMs : 1, () => this._advance());
    if (g.phase === 'handEnd') return this._later(watched ? this.cfg.handEndMs : 1, () => this._advance());
    if (g.phase === 'gameEnd') return undefined;
    const seat = g.actor();
    const ctl = seat === null ? null : this._controller(seat);
    if (ctl) {
      const delay = watched ? Math.round(ctl.thinkDelay() * this.cfg.botScale) : 1;
      this._later(delay, () => this._botMove(seat, ctl));
    }
    return undefined;
  }

  _advance() {
    const g = this.game;
    if (!g) return;
    const res = g.advance();
    if (res.ok) this._after(res.events);
  }

  _botMove(seat, ctl) {
    const g = this.game;
    if (!g || g.actor() !== seat || this._controller(seat) !== ctl) { this._schedule(); return; }
    const view = g.view(seat);
    let action = null;
    try { action = ctl.decide(view); } catch (e) { console.error('Bot hatası:', e); }
    let res = action ? g.act(seat, action) : { ok: false };
    if (!res.ok) {
      console.error('Bot geçersiz hamle verdi, rastgele hamleye düşülüyor:', action, res.error);
      res = g.act(seat, randomAction(view));
    }
    if (res.ok) this._after(res.events);
  }

  _logEvents(events) {
    const g = this.game;
    const n = (i) => this.name(i);
    for (const ev of events) {
      switch (ev.type) {
        case 'dealt':
          this._say(`El ${ev.hand}/${ev.total} dağıtıldı. 8: ${n(ev.dealer)}, 5: ${n((ev.dealer + 1) % 3)}, 3: ${n((ev.dealer + 2) % 3)}.`);
          if (ev.amnesty) this._say('Üç elde bir af: bu elde kart alma-verme yok.');
          break;
        case 'trumpChosen':
          this._say(`${n(ev.seat)} kozu belirledi: ${SUIT_SYMBOLS[ev.suit]} ${SUIT_NAMES[ev.suit]}.`);
          break;
        case 'discarded':
          this._say(`${n(ev.seat)} 4 kart gömdü ve masadan 4 kapalı kart aldı.`);
          break;
        case 'exchangeStart':
          for (const st of ev.steps) this._say(`${n(st.asker)}, ${st.givers.map((x) => `${ek(n(x.seat), 'abl')} ${x.count}`).join(' ve ')} kart istiyor (toplam ${st.count}).`);
          break;
        case 'exchangePass': {
          const lab = (arr) => arr.map(cardLabel).join(', ');
          this._say(`${ek(n(ev.giver), 'dat')} ${lab(ev.passed)} verdin, ${lab(ev.returned)} aldın.`, [ev.asker]);
          this._say(`${n(ev.asker)} sana ${lab(ev.passed)} verdi, ${lab(ev.returned)} kartlarını geri verdin.`, [ev.giver]);
          const third = [0, 1, 2].find((x) => x !== ev.asker && x !== ev.giver);
          this._say(`${n(ev.asker)} ile ${n(ev.giver)} ${ev.passed.length} kart değişti.`, [third]);
          break;
        }
        case 'floorShow':
          this._say(`Yerden ${cardLabel(ev.card)} geldi: ${ek(n(ev.seat), 'gen')} kendisinden istenen seride verdiği kartlardan büyük. Hile yok, kart ondan başkasına verilmez.`);
          break;
        case 'handEnd': {
          const parts = [0, 1, 2].map((s) => `${n(s)} ${ev.tricks[s]}/${ev.targets[s]} (${ev.diffs[s] > 0 ? '+' : ''}${ev.diffs[s]})`);
          this._say(`El ${ev.hand} bitti: ${parts.join(', ')}.`);
          break;
        }
        case 'gameEnd':
          this._say(`Oyun bitti! Kazanan: ${ev.winners.map(n).join(' & ')}.`);
          break;
        default: break;
      }
    }
    void g;
  }

  // ---------- istemcilere yayın ----------
  _roomInfo() {
    const started = !!this.game;
    return {
      code: this.code,
      host: this.host,
      started,
      seats: this.seats.map((s, i) => ({
        kind: s.kind,
        name: s.kind === 'empty' ? '' : this.name(i),
        connected: s.kind === 'human' ? s.connected : null,
        botControlled: s.kind === 'bot' || !!s.takeover,
        reclaiming: !!s.pendingReclaim,
        traits: !started && s.kind === 'bot' ? s.traits : null,
      })),
    };
  }

  _sendTo(i) {
    const s = this.seats[i];
    if (s.kind !== 'human' || !s.conn) return;
    let game = null;
    if (this.game) {
      game = this.game.view(i);
      if (s.takeover) { game.legal = null; game.botControlled = true; }
    }
    s.conn.send(JSON.stringify({ t: 'update', you: i, room: this._roomInfo(), game, log: this._logFor(i) }));
  }

  _broadcast() {
    for (let i = 0; i < 3; i++) this._sendTo(i);
  }
}

module.exports = { Room, cleanName };
