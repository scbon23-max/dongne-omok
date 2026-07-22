window.Net = (function () {
  "use strict";
  var enabled = !!window.SB;

  function clubId() { return (window.OMOK_CONFIG && window.OMOK_CONFIG.ROOM) || "main"; }
  function rosterOf(ch) {
    var st = ch.presenceState(), byNick = {};
    Object.keys(st).forEach(function (key) {
      var metas = st[key];
      if (!metas || !metas.length) return;
      metas.forEach(function (meta) {
        if (!meta || !meta.nick) return;
        var row = byNick[meta.nick] || { count: 0, meta: null };
        row.count++;
        if (!row.meta || (Number(meta.joinTs) || 0) >= (Number(row.meta.joinTs) || 0)) row.meta = meta;
        byNick[meta.nick] = row;
      });
    });
    return Object.keys(byNick).map(function (nick) {
      var row = byNick[nick];
      return Object.assign({}, row.meta, { presenceCount: row.count });
    });
  }
  function backoff(tries) { return Math.min(1000 * Math.pow(2, tries), 15000); }
  function isDead(status) { return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"; }

  // ── 로비 채널 (로그인하면 상시 접속, 방에 들어가도 유지) ──
  var lobbyCh = null, lobbyMeta = null, lobbyH = {}, lobbyGen = 0, lobbyWant = false, lobbyTries = 0, lobbyReT = null, lobbyReady = false, lobbyPending = [];
  function initLobby(meta, hs) {
    lobbyH = hs || {};
    if (!enabled) { if (lobbyH.onStatus) lobbyH.onStatus("LOCAL"); return false; }
    lobbyMeta = meta; lobbyWant = true; lobbyTries = 0;
    openLobby();
    return true;
  }
  function openLobby() {
    var gen = ++lobbyGen;
    lobbyReady = false;
    if (lobbyCh) { try { window.SB.removeChannel(lobbyCh); } catch (e) {} lobbyCh = null; }
    lobbyCh = window.SB.channel("lobby:" + clubId(), {
      config: { broadcast: { self: true }, presence: { key: lobbyMeta.nick } }
    });
    lobbyCh.on("broadcast", { event: "m" }, function (p) { if (lobbyH.onMessage) lobbyH.onMessage(p.payload); });
    lobbyCh.on("presence", { event: "sync" }, lobbyEmit);
    lobbyCh.on("presence", { event: "join" }, lobbyEmit);
    lobbyCh.on("presence", { event: "leave" }, lobbyEmit);
    lobbyCh.subscribe(function (status) {
      if (gen !== lobbyGen) return;
      if (lobbyH.onStatus) lobbyH.onStatus(status);
      if (status === "SUBSCRIBED") { lobbyTries = 0; lobbyReady = true; lobbyCh.track(lobbyMeta); flushLobby(); if (lobbyH.onReady) lobbyH.onReady(); }
      else if (isDead(status)) { lobbyReady = false; reconnectLobby(); }
    });
  }
  function reconnectLobby() {
    if (!lobbyWant || lobbyReT) return;
    var d = backoff(lobbyTries++);
    lobbyReT = setTimeout(function () { lobbyReT = null; if (lobbyWant) openLobby(); }, d);
  }
  function lobbyEmit() { if (lobbyCh && lobbyH.onPresence) lobbyH.onPresence(rosterOf(lobbyCh)); }
  function flushLobby() { if (!lobbyCh) return; var q = lobbyPending; lobbyPending = []; for (var i = 0; i < q.length; i++) { try { lobbyCh.send({ type: "broadcast", event: "m", payload: q[i] }); } catch (e) {} } }
  function sendLobby(o) { if (!enabled) return; if (lobbyReady && lobbyCh) { lobbyCh.send({ type: "broadcast", event: "m", payload: o }); } else if (lobbyPending.length < 50) { lobbyPending.push(o); } }
  function trackLobby(m) { lobbyMeta = m; if (enabled && lobbyCh) lobbyCh.track(m); }

  // ── 방 채널 (방에 들어갈 때만, 나가면 떠남) ──
  var channel = null, myMeta = null, handlers = {}, curRoom = null, roomGen = 0, roomWant = false, roomTries = 0, roomReT = null, roomReady = false, roomPending = [], roomPresenceT = null;
  var directChannels = Object.create(null), directWanted = Object.create(null), directTries = Object.create(null);
  function init(roomId, meta, hs) {
    if (!enabled) { handlers = hs || {}; if (handlers.onStatus) handlers.onStatus("LOCAL"); return false; }
    leaveRoom();
    handlers = hs || {};
    myMeta = meta; curRoom = roomId; roomWant = true; roomTries = 0;
    openRoom();
    return true;
  }
  function openRoom() {
    var gen = ++roomGen;
    roomReady = false;
    stopRoomPresenceHeartbeat();
    if (channel) { try { window.SB.removeChannel(channel); } catch (e) {} channel = null; }
    channel = window.SB.channel("room:" + curRoom, {
      config: { broadcast: { self: true }, presence: { key: myMeta.nick } }
    });
    channel.on("broadcast", { event: "m" }, function (p) { if (handlers.onMessage) handlers.onMessage(p.payload); });
    channel.on("presence", { event: "sync" }, emit);
    channel.on("presence", { event: "join" }, emit);
    channel.on("presence", { event: "leave" }, emit);
    channel.subscribe(function (status) {
      if (gen !== roomGen) return;
      if (handlers.onStatus) handlers.onStatus(status);
      if (status === "SUBSCRIBED") { roomTries = 0; roomReady = true; channel.track(myMeta); startRoomPresenceHeartbeat(); flushRoom(); if (handlers.onReady) handlers.onReady(); }
      else if (isDead(status)) { roomReady = false; stopRoomPresenceHeartbeat(); reconnectRoom(); }
    });
  }
  function stopRoomPresenceHeartbeat() {
    if (roomPresenceT) { clearInterval(roomPresenceT); roomPresenceT = null; }
  }
  function startRoomPresenceHeartbeat() {
    stopRoomPresenceHeartbeat();
    roomPresenceT = setInterval(function () {
      if (!roomReady || !channel || !myMeta) return;
      try { channel.track(myMeta); } catch (e) {}
    }, 15000);
  }
  function reconnectRoom() {
    if (!roomWant || roomReT) return;
    var d = backoff(roomTries++);
    roomReT = setTimeout(function () { roomReT = null; if (roomWant) openRoom(); }, d);
  }
  function emit() { if (channel && handlers.onPresence) handlers.onPresence(rosterOf(channel)); }
  function flushRoom() { if (!channel) return; var q = roomPending; roomPending = []; for (var i = 0; i < q.length; i++) { try { channel.send({ type: "broadcast", event: "m", payload: q[i] }); } catch (e) {} } }
  function send(o) { if (!enabled) return; if (roomReady && channel) { channel.send({ type: "broadcast", event: "m", payload: o }); } else if (roomPending.length < 50) { roomPending.push(o); } }
  function track(m) { myMeta = m; if (enabled && channel) channel.track(m); }
  function directNick(value) { return String(value == null ? "" : value).trim().slice(0, 40); }
  function directTopic(nick) { return "room-input:" + curRoom + ":" + encodeURIComponent(nick); }
  function closeDirectInput(nick) {
    var entry = directChannels[nick];
    if (!entry) return;
    if (entry.retry) clearTimeout(entry.retry);
    if (entry.channel) { try { window.SB.removeChannel(entry.channel); } catch (e) {} }
    delete directChannels[nick];
  }
  function openDirectInput(nick) {
    nick = directNick(nick);
    if (!enabled || !roomWant || !curRoom || !nick) return null;
    if (directChannels[nick]) return directChannels[nick];
    var entry = { channel: null, ready: false, pending: [], retry: null };
    var ch = window.SB.channel(directTopic(nick), { config: { broadcast: { self: false } } });
    entry.channel = ch;
    directChannels[nick] = entry;
    ch.on("broadcast", { event: "m" }, function (packet) {
      if (handlers.onMessage) handlers.onMessage(packet.payload);
    });
    ch.subscribe(function (status) {
      if (directChannels[nick] !== entry) return;
      if (status === "SUBSCRIBED") {
        directTries[nick] = 0;
        entry.ready = true;
        var pending = entry.pending;
        entry.pending = [];
        pending.forEach(function (payload) {
          try { ch.send({ type: "broadcast", event: "m", payload: payload }); } catch (e) {}
        });
      } else if (isDead(status)) {
        entry.ready = false;
        if (entry.retry || !directWanted[nick]) return;
        var delay = backoff(directTries[nick] || 0);
        directTries[nick] = (directTries[nick] || 0) + 1;
        entry.retry = setTimeout(function () {
          entry.retry = null;
          if (directChannels[nick] !== entry || !directWanted[nick] || !roomWant) return;
          closeDirectInput(nick);
          openDirectInput(nick);
        }, delay);
      }
    });
    return entry;
  }
  function syncDirectInputs(nicks, selfNick, hostMode) {
    if (!enabled || !roomWant || !curRoom) return false;
    selfNick = directNick(selfNick || (myMeta && myMeta.nick));
    var allowed = Object.create(null);
    (Array.isArray(nicks) ? nicks : []).forEach(function (nick) {
      nick = directNick(nick);
      if (nick) allowed[nick] = true;
    });
    var wanted = Object.create(null);
    if (hostMode) {
      Object.keys(allowed).forEach(function (nick) { if (nick !== selfNick) wanted[nick] = true; });
    } else if (selfNick && allowed[selfNick]) {
      wanted[selfNick] = true;
    }
    directWanted = wanted;
    Object.keys(directChannels).forEach(function (nick) { if (!wanted[nick]) closeDirectInput(nick); });
    Object.keys(wanted).forEach(openDirectInput);
    return true;
  }
  function sendDirectInput(payload) {
    if (!enabled || !roomWant || !curRoom) return false;
    var nick = directNick(myMeta && myMeta.nick);
    if (!nick) return false;
    directWanted[nick] = true;
    var entry = openDirectInput(nick);
    if (!entry) return false;
    if (!entry.ready) {
      entry.pending = [payload];
      return true;
    }
    try {
      entry.channel.send({ type: "broadcast", event: "m", payload: payload });
      return true;
    } catch (e) {
      entry.pending = [payload];
      return true;
    }
  }
  function closeAllDirectInputs() {
    directWanted = Object.create(null);
    Object.keys(directChannels).forEach(closeDirectInput);
    directTries = Object.create(null);
  }
  function leaveRoom() {
    roomWant = false; roomGen++; roomReady = false; roomPending = [];
    stopRoomPresenceHeartbeat();
    closeAllDirectInputs();
    if (roomReT) { clearTimeout(roomReT); roomReT = null; }
    if (channel) { try { window.SB.removeChannel(channel); } catch (e) {} }
    channel = null; curRoom = null; handlers = {};
  }

  return {
    get enabled() { return enabled; },
    get room() { return curRoom; },
    initLobby: initLobby, sendLobby: sendLobby, trackLobby: trackLobby,
    resyncLobby: function () { if (enabled && lobbyWant) openLobby(); },
    init: init, send: send, track: track, leaveRoom: leaveRoom,
    syncDirectInputs: syncDirectInputs, sendDirectInput: sendDirectInput
  };
})();
