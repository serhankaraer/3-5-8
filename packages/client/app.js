(function () {
  'use strict';

  // ---------- sabitler ----------
  var SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var SUIT_NAME = { S: 'Maça', H: 'Kupa', D: 'Karo', C: 'Sinek' };
  var SUIT_ORDER = ['S', 'H', 'C', 'D'];
  var TRAITS = [
    ['risk', 'Risk alma'], ['memory', 'Oyunu takip'], ['foresight', 'İleri hesap'],
    ['blocking', 'Engelleme'], ['tempo', 'Tempo'],
  ];
  var STORE_KEY = '358-oturum';

  function suitOf(c) { return c[0]; }
  function rankOf(c) { return Number(c.slice(1)); }
  function rankLabel(r) { return { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r); }
  function cardText(c) { return SYM[suitOf(c)] + rankLabel(rankOf(c)); }
  function isRed(s) { return s === 'H' || s === 'D'; }
  function signed(n) { return (n > 0 ? '+' : '') + n; }

  // ---------- durum ----------
  var S = {
    connected: false, joined: false, you: null, room: null, game: null, log: [],
    selected: [], sig: '', showScore: false, showLog: false, showRules: false,
    loginError: '', form: { name: '', room: '' },
  };
  var ws = null;
  var app = document.getElementById('app');

  function loadSaved() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } }
  function saveSession(o) { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { /* yoksay */ } }
  function clearSession() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* yoksay */ } }

  var sv0 = loadSaved();
  if (sv0) { S.form.name = sv0.name || ''; S.form.room = sv0.room || ''; }

  // ---------- küçük DOM yardımcıları ----------
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'onclick') el.onclick = v;
        else if (k === 'disabled') el.disabled = !!v;
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }

  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  // ---------- bağlantı ----------
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.onopen = function () {
      S.connected = true;
      var sv = loadSaved();
      if (sv && sv.room && sv.name && sv.token) send({ t: 'join', room: sv.room, name: sv.name, token: sv.token });
      render();
    };
    ws.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      onMessage(m);
    };
    ws.onclose = function () {
      S.connected = false;
      render();
      setTimeout(connect, 1500);
    };
    ws.onerror = function () { /* onclose halleder */ };
  }

  function onMessage(m) {
    if (m.t === 'joined') {
      S.you = m.seat;
      saveSession({ room: m.room, name: S.form.name || (loadSaved() || {}).name || 'Oyuncu', token: m.token });
    } else if (m.t === 'update') {
      S.joined = true;
      S.you = m.you;
      S.room = m.room;
      S.game = m.game;
      S.log = m.log || [];
      var sg = sigOf();
      if (sg !== S.sig) { S.selected = []; S.sig = sg; }
      render();
    } else if (m.t === 'error') {
      if (m.fatal) {
        clearSession();
        S.joined = false;
        S.loginError = m.msg;
        render();
      } else toast(m.msg);
    } else if (m.t === 'left') {
      clearSession();
      S.joined = false; S.room = null; S.game = null; S.log = [];
      render();
    }
  }

  function sigOf() {
    var g = S.game;
    if (!g) return 'lobby';
    return [g.phase, g.handNo, g.trickNo, g.trick.length, g.hand.length, g.legal ? g.legal.kind : '-'].join('|');
  }

  function act(action) { S.selected = []; send({ t: 'act', action: action }); }

  // ---------- yardımcılar ----------
  function nm(i) { return S.room && S.room.seats[i] ? S.room.seats[i].name : '?'; }
  function relPos(i) { return (i - S.you + 3) % 3; }

  function trickWinner(plays, trump) {
    var best = plays[0];
    for (var i = 1; i < plays.length; i++) {
      var c = plays[i].card, b = best.card;
      var beats = suitOf(c) === suitOf(b) ? rankOf(c) > rankOf(b) : suitOf(c) === trump;
      if (beats) best = plays[i];
    }
    return best.seat;
  }

  function cardEl(c, opts) {
    opts = opts || {};
    var s = suitOf(c);
    var cls = 'card' + (isRed(s) ? ' red' : '') + (opts.cls ? ' ' + opts.cls : '');
    return h('div', { class: cls, onclick: opts.onclick, title: SUIT_NAME[s] + ' ' + rankLabel(rankOf(c)) },
      h('span', { class: 'r' }, rankLabel(rankOf(c))),
      h('span', { class: 's' }, SYM[s]),
      h('span', { class: 'big' }, SYM[s]));
  }

  // ---------- ekranlar ----------
  function render() {
    app.textContent = '';
    var root;
    if (!S.joined) root = loginScreen();
    else if (!S.game) root = lobbyScreen();
    else root = gameScreen();
    app.appendChild(root);
    if (S.showRules) app.appendChild(rulesModal());
    if (S.joined && S.game && S.showScore) app.appendChild(scoreModal());
    if (S.joined && S.game) {
      var g = S.game;
      if (g.phase === 'handEnd') app.appendChild(handEndModal());
      if (g.phase === 'gameEnd') app.appendChild(gameEndModal());
    }
    if (!S.connected) app.appendChild(h('div', { class: 'overlay', style: 'background:rgba(0,0,0,.45)' }, h('div', { class: 'modal' }, 'Bağlantı koptu, yeniden bağlanılıyor…')));
  }

  function loginScreen() {
    var nameIn = h('input', { id: 'name', placeholder: 'Takma adın', maxlength: '16', value: S.form.name, autocomplete: 'nickname' });
    var roomIn = h('input', { id: 'room', placeholder: 'Oda kodu (4 harf)', maxlength: '4', value: S.form.room, autocapitalize: 'characters', style: 'text-transform:uppercase' });
    function vals() {
      S.form.name = nameIn.value.trim();
      S.form.room = roomIn.value.trim().toUpperCase();
      S.loginError = '';
      return S.form;
    }
    return h('div', { class: 'wrap' },
      h('div', { class: 'logo' }, '3 · 5 · 8'),
      h('div', { class: 'sub' }, '3 kişilik el alma oyunu'),
      h('div', { class: 'panel stack' },
        nameIn,
        S.loginError ? h('div', { class: 'banner' }, S.loginError) : null,
        h('button', { onclick: function () { var f = vals(); if (!f.name) return toast('Takma adını yaz'); send({ t: 'create', name: f.name }); } }, 'Yeni oda kur'),
        h('div', { class: 'muted', style: 'text-align:center' }, 'ya da'),
        roomIn,
        h('button', { class: 'ghost', onclick: function () { var f = vals(); if (!f.name) return toast('Takma adını yaz'); if (f.room.length !== 4) return toast('Oda kodu 4 harfli'); send({ t: 'join', room: f.room, name: f.name }); } }, 'Odaya katıl')),
      h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'ghost small', onclick: function () { S.showRules = true; render(); } }, 'Kurallar')));
  }

  function lobbyScreen() {
    var r = S.room;
    var isHost = r.host === S.you;
    var full = r.seats.every(function (s) { return s.kind !== 'empty'; });
    var seatCards = r.seats.map(function (s, i) {
      if (s.kind === 'empty') {
        return h('div', { class: 'seat-card empty' }, h('div', null, 'Boş koltuk'),
          isHost ? h('button', { class: 'small', onclick: function () { send({ t: 'addBot' }); } }, 'Bot ekle') : null);
      }
      var traits = s.kind === 'bot' && s.traits ? h('div', { class: 'traits' }, TRAITS.map(function (t) {
        return h('div', { class: 'trait' }, h('span', null, t[1]), h('span', { class: 'bar' }, h('i', { style: 'width:' + s.traits[t[0]] + '%' })), h('span', null, s.traits[t[0]]));
      })) : null;
      return h('div', { class: 'seat-card' },
        h('div', null,
          h('div', { class: 'nm' }, s.name,
            i === r.host ? h('span', { class: 'chip gold' }, 'oda sahibi') : null,
            i === S.you ? h('span', { class: 'chip' }, 'sen') : null,
            s.kind === 'bot' ? h('span', { class: 'chip' }, 'bot') : null,
            s.kind === 'human' && !s.connected ? h('span', { class: 'chip warn' }, 'bağlantı yok') : null),
          traits),
        isHost && s.kind === 'bot' ? h('button', { class: 'ghost small', onclick: function () { send({ t: 'removeBot', seat: i }); } }, 'Çıkar') : null);
    });
    return h('div', { class: 'wrap' },
      h('div', { class: 'panel' },
        h('div', { class: 'muted' }, 'Oda kodu — arkadaşlarınla paylaş'),
        h('div', { class: 'row spread' }, h('div', { class: 'code' }, r.code),
          h('button', { class: 'ghost small', onclick: function () { copy(r.code); } }, 'Kopyala'))),
      h('div', { class: 'panel stack' }, h('h3', null, 'Koltuklar (3)'), seatCards),
      h('div', { class: 'panel stack' },
        isHost
          ? h('button', { disabled: !full, onclick: function () { send({ t: 'start' }); } }, full ? 'Oyunu başlat' : '3 koltuk dolmalı')
          : h('div', { class: 'muted' }, 'Oyunu oda sahibi başlatacak…'),
        h('div', { class: 'row' },
          h('button', { class: 'ghost small', onclick: function () { S.showRules = true; render(); } }, 'Kurallar'),
          h('button', { class: 'ghost small', onclick: function () { send({ t: 'leave' }); } }, 'Odadan çık'))),
      logBlock());
  }

  function copy(text) {
    try { navigator.clipboard.writeText(text); toast('Kod kopyalandı'); } catch (e) { toast('Kod: ' + text); }
  }

  function logBlock() {
    if (!S.log.length) return null;
    return h('div', { class: 'logstrip' }, S.log.slice(-4).map(function (e) { return h('div', null, e.text); }));
  }

  function seatBox(i) {
    var g = S.game;
    var s = S.room.seats[i];
    var turnSeat = g.actor;
    var target = g.targets[i];
    var won = g.tricksWon[i];
    var pct = Math.min(100, Math.round((won / target) * 100));
    return h('div', { class: 'seatbox' + (turnSeat === i ? ' turn' : '') },
      h('div', { class: 'top' },
        h('div', { class: 'name' }, s.name,
          s.kind === 'bot' || s.botControlled ? h('span', { class: 'chip' }, 'bot') : null,
          s.kind === 'human' && s.connected === false ? h('span', { class: 'chip warn' }, 'koptu') : null,
          s.reclaiming ? h('span', { class: 'chip' }, 'geri alacak') : null),
        h('div', { class: 'target', title: 'Hedef' }, target)),
      h('div', { class: 'progress' + (won > target ? ' over' : '') }, h('i', { style: 'width:' + pct + '%' })),
      h('div', { class: 'meta' },
        h('span', null, 'Alınan ' + won + '/' + target),
        h('span', null, i === g.dealer ? 'dağıtıcı' : ''),
        h('span', null, 'Puan ' + signed(g.totals[i]))));
  }

  function backs(n) {
    var el = h('div', { class: 'backs' });
    for (var k = 0; k < n; k++) el.appendChild(h('i'));
    return el;
  }

  function statusText() {
    var g = S.game;
    var me = S.you;
    if (g.botControlled) return 'Bot senin yerine oynuyor. Koltuğunu bir sonraki elin başında geri alacaksın.';
    switch (g.phase) {
      case 'discard':
        return g.actor === me ? 'Gömülecek 4 kartı seç. Sonra masadan 4 kapalı kart alacaksın.' : nm(g.actor) + ' 4 kart gömüyor…';
      case 'trump':
        return g.actor === me ? 'Kozu belirle. Sonra 4 kart gömeceksin.' : nm(g.actor) + ' kozu belirliyor…';
      case 'exchange': {
        var c = g.exchange.current;
        if (!c) return '';
        if (c.asker === me) return nm(c.giver) + '\'den ' + c.remaining + ' kart iste: iletmek istediğin bir kartı seç. ' + nm(c.giver) + ' aynı renkteki en yüksek kartını geri verir.';
        if (c.giver === me) return nm(c.asker) + ' senden kart istiyor…';
        return nm(c.asker) + ', ' + nm(c.giver) + '\'den kart istiyor…';
      }
      case 'play':
        if (g.actor === me) {
          var led = g.trick.length ? ' Açılan renk: ' + SYM[suitOf(g.trick[0].card)] + '.' : ' Sen açıyorsun.';
          return 'Sıra sende.' + led;
        }
        return nm(g.actor) + ' oynuyor…';
      case 'trickEnd': {
        var w = trickWinner(g.trick, g.trump);
        return nm(w) + ' eli alıyor';
      }
      default: return '';
    }
  }

  function gameScreen() {
    var g = S.game;
    var me = S.you;
    var opp1 = (me + 1) % 3;
    var opp2 = (me + 2) % 3;

    var trumpPill;
    if (g.trump) trumpPill = 'Koz: ' + SYM[g.trump] + ' ' + SUIT_NAME[g.trump];
    else trumpPill = 'Koz: seçilmedi';

    var winner = g.phase === 'trickEnd' ? trickWinner(g.trick, g.trump) : -1;
    var slots = g.trick.map(function (p) {
      return h('div', { class: 'slot p' + relPos(p.seat) + (p.seat === winner ? ' win' : '') }, cardEl(p.card));
    });
    var last = g.lastTrick && g.trick.length === 0 && g.phase === 'play'
      ? h('div', { class: 'lastinfo' }, 'Son el: ' + g.lastTrick.plays.map(function (p) { return cardText(p.card); }).join(' ') + ' → ' + nm(g.lastTrick.winner))
      : null;

    var exInfo = null;
    if (g.phase === 'exchange') {
      exInfo = h('div', { class: 'exsteps' }, g.exchange.steps.map(function (st, k) {
        return h('div', null, (k === g.exchange.idx ? '▶ ' : '') + nm(st.asker) + ' ← ' + nm(st.giver) + ': ' + st.done + '/' + st.count);
      }));
    }

    return h('div', { class: 'game' },
      h('div', { class: 'topbar' },
        h('div', { class: 'info' },
          h('span', { class: 'pill' }, 'Oda ' + S.room.code),
          h('span', { class: 'pill' }, 'El ' + g.handNo + '/' + g.totalHands),
          h('span', { class: 'pill trump' }, trumpPill)),
        h('div', { class: 'row' },
          h('button', { class: 'ghost small', onclick: function () { S.showScore = true; render(); } }, 'Puanlar'),
          h('button', { class: 'ghost small', onclick: function () { S.showRules = true; render(); } }, 'Kurallar'))),
      h('div', { class: 'opps' },
        h('div', { class: 'seatbox-wrap', style: 'flex:1;min-width:0' }, seatBox(opp1), backs(g.counts[opp1])),
        h('div', { class: 'seatbox-wrap', style: 'flex:1;min-width:0' }, seatBox(opp2), backs(g.counts[opp2]))),
      h('div', { class: 'center' }, h('div', { class: 'status' }, statusText()), slots, last),
      exInfo,
      h('div', { class: 'mebox' },
        seatBox(me),
        g.botControlled ? h('div', { class: 'banner' }, 'Bot oynuyor — bir sonraki elin başında koltuğunu geri alırsın') : null,
        actionPanel(),
        handEl()),
      h('div', { class: 'logstrip' },
        S.showLog
          ? h('div', { class: 'logfull' }, S.log.slice().reverse().map(function (e) { return h('div', null, e.text); }))
          : S.log.slice(-3).map(function (e) { return h('div', null, e.text); }),
        h('button', { class: 'ghost small', style: 'margin-top:6px', onclick: function () { S.showLog = !S.showLog; render(); } }, S.showLog ? 'Günlüğü gizle' : 'Tüm günlük')));
  }

  function handEl() {
    var g = S.game;
    var legal = g.legal;
    var kind = legal ? legal.kind : null;
    var wrap = h('div', { class: 'hand' });
    g.hand.forEach(function (c) {
      var can = false;
      if (kind === 'discard' || kind === 'pass') can = true;
      else if (kind === 'play') can = legal.cards.indexOf(c) >= 0;
      var sel = S.selected.indexOf(c) >= 0;
      var cls = (can ? 'can ' : '') + (kind === 'play' && !can ? 'dim ' : '') + (sel ? 'sel' : '');
      wrap.appendChild(cardEl(c, {
        cls: cls.trim(),
        onclick: can ? function () { onHandClick(c); } : null,
      }));
    });
    return wrap;
  }

  function onHandClick(c) {
    var g = S.game;
    var kind = g.legal && g.legal.kind;
    var i = S.selected.indexOf(c);
    if (kind === 'discard') {
      if (i >= 0) S.selected.splice(i, 1);
      else if (S.selected.length < g.legal.count) S.selected.push(c);
    } else if (kind === 'pass') {
      S.selected = i >= 0 ? [] : [c];
    } else if (kind === 'play') {
      if (i >= 0) { act({ type: 'play', card: c }); return; }
      S.selected = [c];
    }
    render();
  }

  function actionPanel() {
    var g = S.game;
    var l = g.legal;
    var box = h('div', { class: 'actions' });
    if (!l) return box;
    if (l.kind === 'discard') {
      box.appendChild(h('button', {
        disabled: S.selected.length !== l.count,
        onclick: function () { act({ type: 'discard', cards: S.selected.slice() }); },
      }, 'Kartları göm (' + S.selected.length + '/' + l.count + ')'));
    } else if (l.kind === 'trump') {
      SUIT_ORDER.forEach(function (s) {
        var n = g.hand.filter(function (c) { return suitOf(c) === s; }).length;
        box.appendChild(h('button', { class: 'suitbtn' + (isRed(s) ? ' red' : ''), onclick: function () { act({ type: 'trump', suit: s }); } },
          SYM[s], h('small', null, SUIT_NAME[s] + ' · ' + n)));
      });
    } else if (l.kind === 'pass') {
      box.appendChild(h('button', {
        disabled: S.selected.length !== 1,
        onclick: function () { act({ type: 'pass', card: S.selected[0] }); },
      }, 'Kartı ilet'));
    } else if (l.kind === 'play') {
      box.appendChild(h('button', {
        disabled: S.selected.length !== 1,
        onclick: function () { act({ type: 'play', card: S.selected[0] }); },
      }, 'Oyna'));
    }
    return box;
  }

  // ---------- pencereler ----------
  function modal(children) {
    return h('div', { class: 'overlay' }, h('div', { class: 'modal' }, children));
  }

  function scoreTable(results, totals) {
    var rows = results.map(function (r) {
      return h('tr', null, h('td', null, 'El ' + r.hand),
        [0, 1, 2].map(function (s) {
          return h('td', null, r.tricks[s] + '/' + r.targets[s] + ' ', h('span', { class: r.diffs[s] > 0 ? 'pos' : (r.diffs[s] < 0 ? 'neg' : '') }, '(' + signed(r.diffs[s]) + ')'));
        }));
    });
    return h('table', null,
      h('tr', null, h('th', null, ''), [0, 1, 2].map(function (s) { return h('th', null, nm(s)); })),
      rows,
      h('tr', null, h('th', null, 'Toplam'), [0, 1, 2].map(function (s) { return h('th', { class: totals[s] > 0 ? 'pos' : (totals[s] < 0 ? 'neg' : '') }, signed(totals[s])); })));
  }

  function scoreModal() {
    var g = S.game;
    return modal([
      h('h3', null, 'Puan tablosu'),
      g.results.length ? scoreTable(g.results, g.totals) : h('div', { class: 'muted' }, 'Henüz biten el yok.'),
      h('div', { class: 'muted', style: 'margin-top:8px' }, 'Hücre: alınan/hedef (fark). El puanı = alınan − hedef.'),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' }, h('button', { onclick: function () { S.showScore = false; render(); } }, 'Kapat')),
    ]);
  }

  function handEndModal() {
    var g = S.game;
    var r = g.results[g.results.length - 1];
    var rows = [0, 1, 2].map(function (s) {
      return h('tr', null, h('td', null, nm(s)), h('td', null, r.targets[s]), h('td', null, r.tricks[s]),
        h('td', { class: r.diffs[s] > 0 ? 'pos' : (r.diffs[s] < 0 ? 'neg' : '') }, signed(r.diffs[s])),
        h('td', null, signed(g.totals[s])));
    });
    var asks = [];
    if (g.handNo < g.totalHands) {
      [0, 1, 2].forEach(function (s) {
        if (r.diffs[s] > 0) asks.push(nm(s) + ' hedefini ' + r.diffs[s] + ' aştı: ' + r.diffs[s] + ' kart isteyecek.');
      });
    }
    return modal([
      h('h3', null, 'El ' + g.handNo + ' bitti'),
      h('table', null, h('tr', null, h('th', null, ''), h('th', null, 'Hedef'), h('th', null, 'Alınan'), h('th', null, 'Fark'), h('th', null, 'Toplam')), rows),
      asks.length ? h('div', { class: 'muted', style: 'margin-top:8px' }, asks.map(function (t) { return h('div', null, t); })) : null,
      h('div', { class: 'muted', style: 'margin-top:8px' }, g.handNo < g.totalHands ? 'Sonraki el birazdan başlıyor…' : 'Sonuç birazdan açıklanacak…'),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' }, h('button', { class: 'ghost small', onclick: function () { S.showScore = true; render(); } }, 'Tüm puanlar')),
    ]);
  }

  function gameEndModal() {
    var g = S.game;
    var isHost = S.room.host === S.you;
    var won = g.winners.indexOf(S.you) >= 0;
    return modal([
      h('h3', null, won ? '🏆 Kazandın!' : 'Oyun bitti'),
      h('div', { style: 'margin-bottom:8px' }, 'Kazanan: ' + g.winners.map(nm).join(' & ')),
      scoreTable(g.results, g.totals),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' },
        h('button', { class: 'ghost', onclick: function () { send({ t: 'leave' }); } }, 'Odadan çık'),
        isHost ? h('button', { onclick: function () { send({ t: 'newGame' }); } }, 'Yeni oyun (lobiye dön)') : h('div', { class: 'muted' }, 'Oda sahibi yeni oyun başlatabilir')),
    ]);
  }

  function rulesModal() {
    var items = [
      '3 oyuncu, 52 kart (A en yüksek). Herkese 16 kart, 4 kart kitty. Toplam 16 el oynanır.',
      'Hedefler: dağıtıcı 8, solundaki 5, sağındaki 3 el. Her el sonunda dağıtıcı ve hedefler sola kayar (3→5→8→3).',
      'Her elin sırası: önce kart değişimi (ilk el hariç), sonra dağıtıcı (8) kozu belirler, 4 kartını gömer ve masadan 4 kapalı kart (kitty) alır. Tüm kart alma-verme işlemleri koz belirlenmeden önce biter.',
      '5\'li el ilk kartı açar. Açılan renge uymak zorunlusun, rengin yoksa istediğini atarsın. Koz en yüksek koz, kozsuzsa açılan renkteki en yüksek kart eli alır.',
      'El puanı = alınan el − hedef (toplamı hep 0). 9 el oynanır; her oyuncu her hedefi 3 kez oynar. En yüksek toplam kazanır, eşitlikte son el puanı yüksek olan.',
      'Kart değişimi (ilk el hariç): hedefini aşan, altında kalandan aştığı kadar kart ister. İşlem en yüksek hedeflide başlar, en düşük hedeflide biter (yeni elin hedefleri: 8, 5, 3). İsteyen istemediği bir kartı iletir; veren, o renkteki en yüksek kartını geri verir (rengi yoksa ya da daha yüksek kartı yoksa aynı kart iade edilir).',
    ];
    return modal([
      h('h3', null, 'Kurallar'),
      h('ul', { class: 'rules' }, items.map(function (t) { return h('li', null, t); })),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { onclick: function () { S.showRules = false; render(); } }, 'Kapat')),
    ]);
  }

  render();
  connect();
})();
