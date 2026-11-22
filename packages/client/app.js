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
    selected: [], assign: {}, active: null, sig: '', showScore: false, showLog: false,
    loginError: '', pending: false, form: { name: '', room: '' },
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
      S.pending = false;
      var sg = sigOf();
      if (sg !== S.sig) { S.selected = []; S.assign = {}; S.active = null; S.sig = sg; }
      render();
    } else if (m.t === 'error') {
      if (m.fatal) {
        clearSession();
        S.joined = false;
        S.loginError = m.msg;
        render();
      } else { S.pending = false; toast(m.msg); }
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

  function act(action) { S.selected = []; S.assign = {}; S.active = null; S.pending = true; send({ t: 'act', action: action }); }

  // ---------- kart iletme: her veren için ayrı seçim ----------
  function passGivers() { var l = S.game && S.game.legal; return l && l.kind === 'pass' ? l.givers : []; }
  function assignedTo(seat) { return S.assign[seat] || []; }
  function passOwner(c) {
    var gs = passGivers();
    for (var k = 0; k < gs.length; k++) if (assignedTo(gs[k].seat).indexOf(c) >= 0) return k;
    return -1;
  }
  // etkin veren: elle seçilmiş ya da kartı eksik olan ilk veren
  function activeGiverIdx() {
    var gs = passGivers();
    for (var k = 0; k < gs.length; k++) if (gs[k].seat === S.active) return k;
    for (var j = 0; j < gs.length; j++) if (assignedTo(gs[j].seat).length < gs[j].count) return j;
    return 0;
  }
  // iletilecek tüm kartlar, veren sırasıyla (sunucunun beklediği düzen)
  function passCards() {
    var out = [];
    passGivers().forEach(function (gv) { out = out.concat(assignedTo(gv.seat)); });
    return out;
  }

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
    if (S.joined && S.showLog) app.appendChild(logModal());
    if (S.joined && S.game && S.showScore) app.appendChild(scoreModal());
    if (S.joined && S.game) {
      var g = S.game;
      if (g.phase === 'handEnd') app.appendChild(handEndModal());
      if (g.phase === 'gameEnd' && !S.showScore) app.appendChild(gameEndModal());
    }
    if (!S.connected) app.appendChild(h('div', { class: 'overlay', style: 'background:rgba(0,0,0,.45)' }, h('div', { class: 'modal' }, 'Bağlantı koptu, yeniden bağlanılıyor…')));
  }

  function loginScreen() {
    var nameIn = h('input', { id: 'name', placeholder: 'Örn. Serhan', maxlength: '16', value: S.form.name, autocomplete: 'nickname' });
    var roomIn = h('input', { id: 'room', placeholder: 'ABCD', maxlength: '4', value: S.form.room, autocapitalize: 'characters', style: 'text-transform:uppercase' });
    function vals() {
      S.form.name = nameIn.value.trim();
      S.form.room = roomIn.value.trim().toUpperCase();
      S.loginError = '';
      return S.form;
    }
    return h('div', { class: 'wrap' },
      h('main', { class: 'center-card' },
        h('h1', null, '3-5-8'),
        h('p', { class: 'muted tc' }, '3 kişilik, 9 elli klasik 3-5-8'),
        h('label', { for: 'name' }, 'Takma adınız'), nameIn,
        S.loginError ? h('div', { class: 'banner', style: 'margin-top:12px' }, S.loginError) : null,
        h('button', { class: 'primary full', onclick: function () { var f = vals(); if (!f.name) return toast('Takma adını yaz'); send({ t: 'create', name: f.name }); } }, 'Oda kur'),
        h('div', { class: 'divider' }, 'ya da'),
        h('label', { for: 'room' }, 'Oda kodu'), roomIn,
        h('button', { class: 'full', onclick: function () { var f = vals(); if (!f.name) return toast('Takma adını yaz'); if (f.room.length !== 4) return toast('Oda kodu 4 harfli'); send({ t: 'join', room: f.room, name: f.name }); } }, 'Odaya katıl'),
        h('p', { class: 'muted small tc' }, 'Oda kurunca arkadaşlarınıza oda kodunu verin. Boş koltuklar bilgisayar oyuncularıyla dolar.')));
  }

  function lobbyScreen() {
    var r = S.room;
    var isHost = r.host === S.you;
    var full = r.seats.every(function (s) { return s.kind !== 'empty'; });
    var seatNo = function (i) { return h('span', { class: 'seat-no' }, 'Koltuk ' + (i + 1)); };
    var rows = r.seats.map(function (s, i) {
      if (s.kind === 'empty') {
        return h('li', { class: 'seat empty' }, seatNo(i), h('span', { class: 'muted' }, 'Boş koltuk — oyuncu bekleniyor ya da bot ekleyin'));
      }
      if (s.kind === 'human') {
        return h('li', { class: 'seat human' }, seatNo(i),
          h('span', { class: 'seat-name' }, s.name),
          i === S.you ? h('span', { class: 'chip' }, 'siz') : null,
          i === r.host ? h('span', { class: 'chip gold' }, '★ Oda sahibi') : null,
          !s.connected ? h('span', { class: 'chip warn' }, 'bağlantı yok') : null);
      }
      var traits = s.traits ? h('div', { class: 'traits' }, TRAITS.map(function (t) {
        return h('div', { class: 'trait' }, h('span', { class: 'trait-name' }, t[1]), h('span', { class: 'bar' }, h('i', { style: 'width:' + s.traits[t[0]] + '%' })), h('span', { class: 'trait-val' }, s.traits[t[0]]));
      })) : null;
      return h('li', { class: 'seat bot' },
        h('div', { class: 'seat-head' }, seatNo(i), h('span', { class: 'seat-name' }, s.name), h('span', { class: 'chip' }, '🤖 Bilgisayar'),
          isHost ? h('button', { class: 'small danger', onclick: function () { send({ t: 'removeBot', seat: i }); } }, 'Botu çıkar') : null),
        traits);
    });
    return h('main', { class: 'lobby' },
      h('header', { class: 'lobby-head' },
        h('div', null, h('div', { class: 'muted small' }, 'Oda kodu'), h('div', { class: 'code' }, r.code)),
        h('button', { onclick: function () { copy(r.code); } }, 'Kopyala')),
      h('ul', { class: 'seats' }, rows),
      h('p', { class: 'muted small' }, 'Rastgele belirlenen oyun özellikleri (1–100)'),
      h('div', { class: 'lactions' },
        isHost ? h('button', { disabled: full, onclick: function () { send({ t: 'addBot' }); } }, 'Bot ekle') : null,
        isHost ? h('button', { class: 'primary', disabled: !full, onclick: function () { send({ t: 'start' }); } }, 'Oyunu başlat') : null,
        h('button', { class: 'danger', onclick: function () { send({ t: 'leave' }); } }, 'Odadan ayrıl')),
      isHost ? h('p', { class: 'muted small' }, 'Oyunu başlatmak için 3 koltuğun dolu olması gerekir.') : h('p', { class: 'muted' }, 'Oda sahibinin oyunu başlatması bekleniyor…'));
  }

  function copy(text) {
    try { navigator.clipboard.writeText(text); toast('Kod kopyalandı'); } catch (e) { toast('Kod: ' + text); }
  }

  function logBlock() {
    if (!S.log.length) return null;
    return h('div', { class: 'logstrip' }, S.log.slice(-4).map(function (e) { return h('div', null, e.text); }));
  }

  function seatBox(i, withBacks) {
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
        h('span', null, 'Puan ' + signed(g.totals[i]))),
      withBacks ? backs(g.counts[i]) : null);
  }

  function backs(n) {
    var el = h('div', { class: 'backs' });
    for (var k = 0; k < n; k++) el.appendChild(h('i'));
    return el;
  }

  // üst çubukta tek satır: ne yapılacak / ne yapılıyor
  function statusText() {
    var g = S.game;
    var me = S.you;
    if (g.botControlled) return 'Bot senin yerine oynuyor';
    switch (g.phase) {
      case 'discard':
        return g.actor === me ? 'Gömülecek 4 kartı seç' : nm(g.actor) + ' 4 kart gömüyor…';
      case 'trump':
        return g.actor === me ? 'Kozu belirle' : nm(g.actor) + ' kozu belirliyor…';
      case 'exchange': {
        var c = g.exchange.current;
        if (!c) return '';
        if (c.asker === me) {
          if (passCards().length >= c.count) return 'Kartlar hazır: ilet';
          var gi = activeGiverIdx();
          var gv = c.givers[gi];
          if (c.givers.length === 1) return nm(gv.seat) + '\'den ' + gv.count + ' kart iste: ' + gv.count + ' kart seç (' + assignedTo(gv.seat).length + '/' + gv.count + ')';
          return nm(gv.seat) + '\'den ' + gv.count + ' kart iste: seç (' + assignedTo(gv.seat).length + '/' + gv.count + ')';
        }
        var mine = c.givers.filter(function (x) { return x.seat === me; })[0];
        if (mine) return nm(c.asker) + ' senden ' + mine.count + ' kart istiyor…';
        return nm(c.asker) + ' kart değişimi yapıyor…';
      }
      case 'play':
        return g.actor === me ? 'Sıra sende' : nm(g.actor) + ' oynuyor…';
      case 'trickEnd':
        return nm(trickWinner(g.trick, g.trump)) + ' eli alıyor';
      default: return '';
    }
  }

  function gameScreen() {
    var g = S.game;
    var me = S.you;
    var opp1 = (me + 1) % 3;
    var opp2 = (me + 2) % 3;

    var trumpPill = g.trump ? 'Koz: ' + SYM[g.trump] + ' ' + SUIT_NAME[g.trump] : 'Koz: seçilmedi';

    var winner = g.phase === 'trickEnd' ? trickWinner(g.trick, g.trump) : -1;
    var slots = g.trick.map(function (p) {
      return h('div', { class: 'slot p' + relPos(p.seat) + (p.seat === winner ? ' win' : '') }, cardEl(p.card));
    });

    var myTurn = g.actor === me && !g.botControlled;

    var note = statusText();
    return h('div', { class: 'game' },
      h('div', { class: 'topbar' },
        h('div', { class: 'info' },
          h('span', { class: 'handno' }, 'El ' + g.handNo + '/' + g.totalHands),
          h('span', { class: 'pill trump' }, trumpPill)),
        h('div', { class: 'row' },
          h('button', { class: 'ghost small', onclick: function () { S.showScore = true; render(); } }, 'Puan cetveli'),
          h('button', { class: 'ghost small', onclick: function () { S.showLog = true; render(); } }, 'Günlük')),
        h('div', { class: 'note' + (myTurn ? ' mine' : '') }, note || '\u00a0')),
      h('div', { class: 'board' },
        h('div', { class: 'pos-l' }, seatBox(opp1, true)),
        h('div', { class: 'pos-r' }, seatBox(opp2, true)),
        h('div', { class: 'center' }, centerEl(slots)),
        h('div', { class: 'pos-m' }, seatBox(me, false))),
      actionPanel(),
      handEl());
  }

  function pcard(c, cls, onclick) {
    return h('div', { class: 'pcard' + (cls ? ' ' + cls : '') }, cardEl(c, { onclick: onclick }));
  }

  // masanın ortası: oynarken el (ilk elde 8'linin yerden gösterdiği kartlar da), el öncesinde yer ve istenecek kartlar
  function centerEl(slots) {
    var g = S.game;
    var fl = g.floor || { count: 0, reveals: [] };
    if (g.phase === 'play' || g.phase === 'trickEnd' || g.phase === 'handEnd') {
      var trick = h('div', { class: 'trick' }, slots);
      if (g.trickNo === 1 && fl.reveals.length) {
        var shown = h('div', { class: 'floor shown' });
        fl.reveals.forEach(function (r) {
          shown.appendChild(h('div', { class: 'fgroup' }, pcard(r.card, 'fromfloor'),
            h('small', { class: 'gold' }, 'Yerden geldi · ' + nm(r.seat))));
        });
        return h('div', { class: 'prep' }, shown, trick);
      }
      return trick;
    }
    var wrap = h('div', { class: 'prep' });
    if (fl.count) {
      var row = h('div', { class: 'floor' });
      var stack = h('div', { class: 'fstack', title: 'Yerdeki kapalı kartlar' });
      for (var k = 0; k < fl.count; k++) stack.appendChild(h('i'));
      row.appendChild(h('div', { class: 'fgroup' }, stack, h('small', null, 'Yer · ' + fl.count)));
      wrap.appendChild(row);
    }
    var l = g.legal;
    if (l && l.kind === 'pass') {
      var gi = activeGiverIdx();
      var gv = l.givers[gi];
      var mine = assignedTo(gv.seat);
      var slotsEl = h('div', { class: 'gslots' });
      for (var q = 0; q < gv.count; q++) {
        var c = mine[q];
        slotsEl.appendChild(c ? pcard(c, 'g' + gi, (function (cc) { return function () { onHandClick(cc); }; })(c)) : h('div', { class: 'pcard empty' }, '?'));
      }
      wrap.appendChild(h('div', { class: 'giverpanel g' + gi },
        h('div', { class: 'gtitle' }, nm(gv.seat) + '\'den ' + gv.count + ' kart iste'),
        slotsEl,
        h('small', null, 'Kartları körlemesine ver; karşılığını hepsi iletildikten sonra alırsın')));
    }
    return wrap;
  }

  // Rıfkı gibi: renk grupları, grup içinde büyükten küçüğe; siyah ve kırmızı gruplar dönüşümlü
  function groupHand(cards) {
    var by = { S: [], H: [], C: [], D: [] };
    cards.forEach(function (c) { by[suitOf(c)].push(c); });
    Object.keys(by).forEach(function (s) { by[s].sort(function (x, y) { return rankOf(y) - rankOf(x); }); });
    function present(list) { return list.filter(function (s) { return by[s].length > 0; }); }
    var blacks = present(['S', 'C']);
    var reds = present(['H', 'D']);
    var blackFirst = blacks.length >= reds.length;
    var first = (blackFirst ? blacks : reds).slice();
    var second = (blackFirst ? reds : blacks).slice();
    var order = [];
    while (first.length || second.length) {
      if (first.length) order.push(first.shift());
      if (second.length) order.push(second.shift());
    }
    return order.map(function (s) { return by[s]; });
  }

  function handEl() {
    var g = S.game;
    var legal = g.legal;
    var kind = legal ? legal.kind : null;
    var wrap = h('div', { class: 'hand' + (kind === 'play' ? ' act-play' : '') });
    groupHand(g.hand).forEach(function (cards) {
      var grp = h('div', { class: 'suit-group', style: 'min-width: calc(var(--cw) + ' + (cards.length - 1) + ' * var(--cw) * 0.36)' });
      cards.forEach(function (c) {
        var can = false;
        if (kind === 'discard' || kind === 'pass') can = true;
        else if (kind === 'play') can = legal.cards.indexOf(c) >= 0;
        var owner = kind === 'pass' ? passOwner(c) : -1;
        var sel = kind === 'pass' ? owner >= 0 : S.selected.indexOf(c) >= 0;
        var cls = (can ? 'can ' : '') + (kind === 'play' && !can ? 'dim ' : '') + (sel ? 'sel' : '') + (owner >= 0 ? ' g' + owner : '');
        var el = cardEl(c, { cls: cls.trim(), onclick: can ? function () { onHandClick(c); } : null });
        if (owner >= 0 && legal.givers.length > 1) el.setAttribute('data-to', nm(legal.givers[owner].seat).charAt(0).toUpperCase());
        grp.appendChild(el);
      });
      wrap.appendChild(grp);
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
      var own = passOwner(c);
      if (own >= 0) {
        // seçili karta tekrar dokunmak seçimi geri alır ve o verenin ekranına döner
        var gs = g.legal.givers;
        S.assign[gs[own].seat] = assignedTo(gs[own].seat).filter(function (x) { return x !== c; });
        S.active = gs[own].seat;
      } else {
        var gi = activeGiverIdx();
        var gv = g.legal.givers[gi];
        var list = assignedTo(gv.seat);
        if (list.length >= gv.count) { toast(nm(gv.seat) + ' için kartlar tamam; başka veren sekmesine geç'); return; }
        S.assign[gv.seat] = list.concat([c]);
        S.active = null; // dolunca sıradaki eksik vereni otomatik açar
        if (S.assign[gv.seat].length < gv.count) S.active = gv.seat;
      }
    } else if (kind === 'play') {
      if (S.pending) return; // sunucu cevabı gelene kadar ikinci dokunuşu yoksay
      act({ type: 'play', card: c }); // karta dokunmak yeterli
      return;
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
        class: 'primary',
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
      var cur = activeGiverIdx();
      if (l.givers.length > 1) {
        box.classList.add('multi');
        l.givers.forEach(function (gv, k) {
          var n = assignedTo(gv.seat).length;
          box.appendChild(h('button', {
            class: 'gtab g' + k + (k === cur ? ' active' : '') + (n === gv.count ? ' done' : ''),
            onclick: function () { S.active = gv.seat; render(); },
          }, nm(gv.seat), h('small', null, n + '/' + gv.count)));
        });
      }
      var total = passCards().length;
      box.appendChild(h('button', {
        class: 'primary',
        disabled: total !== l.count,
        onclick: function () { act({ type: 'pass', cards: passCards() }); },
      }, (l.givers.length > 1 ? 'İlet' : 'Kartları ilet') + ' (' + total + '/' + l.count + ')'));
    }
    return box;
  }

  // ---------- pencereler ----------
  function modal(children, extra) {
    return h('div', { class: 'overlay' }, h('div', { class: 'modal' + (extra ? ' ' + extra : '') }, children));
  }

  // Puan cetveli: Rıfkı'nın kâğıt cetveli gibi; 9 el, 3'erli bloklar, hücre = fark + alınan/hedef, 8'li oyuncunun hücresi altın zeminli
  function scoreTable(results, totals) {
    var cls = function (v) { return v > 0 ? 'pos' : (v < 0 ? 'neg' : 'zero'); };
    var rows = [];
    for (var i = 0; i < 9; i++) {
      var r = results[i];
      if (i > 0 && i % 3 === 0) rows.push(h('tr', { class: 'gap' }, h('td', { colspan: 4 })));
      rows.push(h('tr', null, h('th', { class: 'label' }, 'El ' + (i + 1)),
        [0, 1, 2].map(function (s) {
          if (!r) return h('td', { class: 'cell empty' });
          return h('td', { class: 'cell ' + cls(r.diffs[s]) + (r.targets[s] === 8 ? ' dealer' : '') },
            h('b', null, signed(r.diffs[s])), h('small', null, r.tricks[s] + ' / ' + r.targets[s]));
        })));
    }
    return h('table', { class: 'sheet' },
      h('thead', null, h('tr', null, h('th', { class: 'label' }, '3-5-8'), [0, 1, 2].map(function (s) { return h('th', { class: 'player' + (s === S.you ? ' me' : '') }, nm(s)); }))),
      h('tbody', null, rows),
      h('tfoot', null, h('tr', { class: 'grand' }, h('th', { class: 'label' }, 'Toplam'),
        [0, 1, 2].map(function (s) { return h('td', { class: 'cell ' + cls(totals[s]) }, signed(totals[s])); }))));
  }

  function scoreModal() {
    var g = S.game;
    return modal([
      scoreTable(g.results, g.totals),
      h('div', { class: 'legend' }, 'Altın zemin: o elin 8\'lisi · Hücre: fark, altında alınan / hedef'),
      h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' }, h('button', { onclick: function () { S.showScore = false; render(); } }, 'Kapat')),
    ], 'sheet-modal');
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
    var order = [0, 1, 2].sort(function (x, y) { return g.totals[y] - g.totals[x] || x - y; });
    var rows = order.map(function (s) {
      var t = g.totals[s];
      var won = t > 0;
      return h('li', { class: won ? 'win' : (t < 0 ? 'lose' : '') },
        h('span', { class: 'ico-result' }, won ? '🏆' : (t < 0 ? '😞' : '😐')),
        h('span', { class: 'who' }, nm(s)),
        h('span', { class: t > 0 ? 'pos' : (t < 0 ? 'neg' : '') }, signed(t)));
    });
    return modal([
      h('h3', null, 'Oyun bitti'),
      h('ol', { class: 'standings' }, rows),
      h('div', { class: 'row', style: 'justify-content:center;margin-top:10px' },
        h('button', { onclick: function () { S.showScore = true; render(); } }, 'Puan cetveli'),
        h('button', { class: 'ghost', onclick: function () { send({ t: 'leave' }); } }, 'Odadan çık'),
        isHost ? h('button', { class: 'primary', onclick: function () { send({ t: 'newGame' }); } }, 'Yeni oyun') : null),
      isHost ? null : h('div', { class: 'muted', style: 'text-align:center;margin-top:8px' }, 'Oda sahibi yeni oyun başlatabilir'),
    ]);
  }

  function logModal() {
    return modal([
      h('h3', null, 'Günlük'),
      h('div', { class: 'logfull' }, S.log.slice().reverse().map(function (e) { return h('div', null, e.text); })),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' }, h('button', { onclick: function () { S.showLog = false; render(); } }, 'Kapat')),
    ]);
  }

  render();
  connect();
})();
