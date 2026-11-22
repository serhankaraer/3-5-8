'use strict';
// Uçtan uca test: gerçek sunucu + WebSocket istemcileri (Node 22 yerleşik WebSocket).
process.env.BOT_DELAY_SCALE = '0.001';
process.env.TAKEOVER_MS = '400';
process.env.TRICK_END_MS = '4';
process.env.HAND_END_MS = '15';
process.env.ROOM_TTL_MS = '6000';

const assert = require('assert');
const { createServer } = require('../packages/server');
const { Bot, genTraits } = require('../packages/ai');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 20000, what = 'koşul') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return;
    await sleep(10);
  }
  throw new Error('Zaman aşımı: ' + what);
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, last: null, seat: null, token: null, room: null, errors: [], auto: false, sent: null, bot: new Bot({ seat: 0, traits: genTraits(), rng: Math.random }) };
    ws.onopen = () => resolve(c);
    ws.onerror = (e) => reject(e);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'joined') { c.seat = m.seat; c.token = m.token; c.room = m.room; }
      if (m.t === 'error') c.errors.push(m.msg);
      if (m.t === 'update') {
        c.last = m;
        if (c.auto && m.game && m.game.legal) {
          const g = m.game;
          const key = JSON.stringify([g.phase, g.handNo, g.trickNo, g.trick.length, g.hand.length, g.exchange.idx, g.exchange.current && g.exchange.current.remaining]);
          if (key !== c.sent) {
            c.sent = key;
            c.bot.seat = m.you;
            const action = c.bot.decide(g);
            ws.send(JSON.stringify({ t: 'act', action }));
          }
        }
      }
    };
  });
}
const send = (c, o) => c.ws.send(JSON.stringify(o));

(async () => {
  const srv = await createServer({ port: 0, host: '127.0.0.1' });
  const port = srv.port;

  // --- statik dosya ---
  const html = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.status === 200 ? r.text() : Promise.reject(new Error('index.html yok')));
  assert(html.includes('3-5-8'), 'index.html 3-5-8 içermeli');
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/..%2f..%2fpackage.json`)).status === 200, false, 'yol geçişi engellenmeli');

  // --- Senaryo 1: 1 insan + 2 bot, oyun sonuna kadar ---
  const a = await connect(port);
  send(a, { t: 'create', name: 'Serhan' });
  await waitFor(() => a.last && a.room, 3000, 'oda kurma');
  send(a, { t: 'start' });
  await waitFor(() => a.errors.length === 1, 2000, 'dolu olmayan odada başlatma hatası');
  send(a, { t: 'addBot' }); send(a, { t: 'addBot' });
  await waitFor(() => a.last.room.seats.every((s) => s.kind !== 'empty'), 3000, 'botlar');
  assert(a.last.room.seats.filter((s) => s.kind === 'bot').every((s) => s.traits && s.traits.risk >= 1 && s.traits.tempo <= 100), 'lobide bot özellikleri görünmeli');
  a.auto = true;
  send(a, { t: 'start' });
  await waitFor(() => a.last.game && a.last.game.phase === 'gameEnd', 60000, 'senaryo 1 oyun sonu');
  assert.strictEqual(a.last.game.handNo, 9);
  assert.strictEqual(a.last.game.totals.reduce((x, y) => x + y, 0), 0);
  assert(a.last.room.seats.every((s) => !s.traits), 'oyunda bot özellikleri gizli olmalı');
  console.log('Senaryo 1 OK: 1 insan + 2 bot oyunu bitti, toplamlar', a.last.game.totals, 'kazanan', a.last.game.winners);
  assert.deepStrictEqual(a.errors.slice(1), [], 'insan oyuncu geçersiz hamle yapmamalı: ' + a.errors.slice(1));

  // yeni oyun (lobiye dön)
  send(a, { t: 'newGame' });
  await waitFor(() => a.last.game === null, 3000, 'lobiye dönüş');

  // --- Senaryo 2: 2 insan + 1 bot, bağlantı kopması, bot devralma, geri alma ---
  send(a, { t: 'removeBot', seat: a.last.room.seats.findIndex((s) => s.kind === 'bot') });
  await waitFor(() => a.last.room.seats.some((s) => s.kind === 'empty'), 3000, 'bot çıkarma');
  const b = await connect(port);
  send(b, { t: 'join', room: a.room, name: 'Misafir' });
  await waitFor(() => b.room, 3000, 'katılma');
  await waitFor(() => a.last.room.seats.every((s) => s.kind !== 'empty'), 3000, 'oda doldu');
  a.auto = true; b.auto = true; a.sent = null;
  send(a, { t: 'start' });
  await waitFor(() => a.last.game && a.last.game.handNo >= 1 && a.last.game.phase !== 'discard', 5000, 'oyun başladı');
  const bSeat = b.seat;
  const bToken = b.token;
  b.auto = false;
  b.ws.close();
  await waitFor(() => a.last.room.seats[bSeat].botControlled, 5000, 'bot devralma');
  console.log('Senaryo 2: bağlantı koptu, bot devraldı');
  const b2 = await connect(port);
  b2.auto = true;
  send(b2, { t: 'join', room: a.room, name: 'Misafir', token: bToken });
  await waitFor(() => b2.seat === bSeat, 3000, 'yeniden bağlanma');
  await waitFor(() => !a.last.room.seats[bSeat].botControlled || a.last.game.phase === 'gameEnd', 20000, 'koltuğu geri alma');
  const reclaimedMidGame = a.last.game.phase !== 'gameEnd';
  await waitFor(() => a.last.game.phase === 'gameEnd', 60000, 'senaryo 2 oyun sonu');
  console.log('Senaryo 2 OK: oyun bitti; koltuk oyun içinde geri alındı =', reclaimedMidGame);
  assert(reclaimedMidGame, 'koltuk bir sonraki elin başında geri alınmalıydı');

  // --- Senaryo 3: tüm insanlar gider, botlar oyunu bitirir, oda 5 dk (test: 1.2 sn) sonra silinir ---
  send(a, { t: 'newGame' });
  await waitFor(() => a.last.game === null, 3000, 'lobiye dönüş 2');
  a.auto = true; b2.auto = true; a.sent = null; b2.sent = null;
  send(a, { t: 'start' });
  await waitFor(() => a.last.game && a.last.game.phase !== 'discard', 5000, 'ikinci oyun');
  const room = srv.rooms.get(a.room);
  a.auto = false; b2.auto = false;
  a.ws.close(); b2.ws.close();
  await waitFor(() => room.game.phase === 'gameEnd', 30000, 'insansız oyunun botlarca bitirilmesi');
  console.log('Senaryo 3: insan kalmadan botlar oyunu bitirdi');
  await waitFor(() => !srv.rooms.has(room.code), 12000, 'oda silinmesi');
  console.log('Senaryo 3 OK: oda silindi');

  srv.close();
  console.log('E2E TAMAM');
  process.exit(0);
})().catch((e) => { console.error('E2E HATA:', e); process.exit(1); });
