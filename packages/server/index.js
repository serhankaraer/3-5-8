'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room } = require('./room');

const CLIENT_DIR = path.join(__dirname, '..', 'client');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const CODE_CHARS = 'ABCDEFGHJKLMNPRSTUVYZ';

function createServer({ port = Number(process.env.PORT || 3358), host = process.env.HOST || '0.0.0.0' } = {}) {
  const rooms = new Map();

  function newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  }

  const httpServer = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.normalize(path.join(CLIENT_DIR, rel));
    if (!file.startsWith(CLIENT_DIR + path.sep)) { res.writeHead(403); res.end('Yasak'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bulunamadı'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 256 * 1024 });

  // Odalar `send`/`close` ve `ctx` taşıyan sade bir bağlantı nesnesiyle konuşur.
  wss.on('connection', (socket) => {
    const conn = {
      ctx: null, // { room, seat }
      send(text) { if (socket.readyState === 1) socket.send(text); },
      close(code = 1000) { try { socket.close(code); } catch (e) { /* yoksay */ } },
    };
    const send = (o) => conn.send(JSON.stringify(o));
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', () => { /* 'close' olayı temizler */ });

    function leave(immediate) {
      if (!conn.ctx) return;
      const { room, seat } = conn.ctx;
      conn.ctx = null;
      room.onDisconnect(seat, conn, immediate);
    }

    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(data.toString()); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'ping') { send({ t: 'pong' }); return; }
      if (m.t === 'create' || m.t === 'join') {
        if (conn.ctx) leave(true);
        let room;
        if (m.t === 'create') {
          const code = newCode();
          room = new Room(code, (r) => { r.destroy(); rooms.delete(r.code); });
          rooms.set(code, room);
        } else {
          room = rooms.get(String(m.room || '').toUpperCase().trim());
          if (!room) { send({ t: 'error', msg: 'Oda bulunamadı', fatal: true }); return; }
        }
        const r = room.join(conn, { name: m.name, token: m.token });
        if (!r.ok) {
          if (m.t === 'create') { room.destroy(); rooms.delete(room.code); }
          send({ t: 'error', msg: r.error, fatal: true });
          return;
        }
        conn.ctx = { room, seat: r.seat };
        send({ t: 'joined', room: room.code, seat: r.seat, token: r.token });
        room._broadcast();
        return;
      }
      if (m.t === 'leave') { leave(true); send({ t: 'left' }); return; }
      if (!conn.ctx) { send({ t: 'error', msg: 'Önce bir odaya katılmalısın' }); return; }
      conn.ctx.room.handle(conn.ctx.seat, m);
    });

    socket.on('close', () => leave(false));
  });

  // Yarım kalan (ölü) bağlantıları yakala: 25 sn'de bir ping, cevap vermeyen bağlantı kapatılır.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) { socket.terminate(); continue; }
      socket.isAlive = false;
      try { socket.ping(); } catch (e) { /* yoksay */ }
    }
  }, 25000);
  heartbeat.unref();

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      resolve({
        port: httpServer.address().port,
        rooms,
        close() {
          clearInterval(heartbeat);
          for (const r of rooms.values()) r.destroy();
          rooms.clear();
          wss.close();
          httpServer.close();
          httpServer.closeAllConnections && httpServer.closeAllConnections();
        },
      });
    });
  });
}

if (require.main === module) {
  createServer().then((s) => console.log(`3-5-8 sunucusu hazır: http://localhost:${s.port}`));
}

module.exports = { createServer };
