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
  function leaveRoom() {
    roomWant = false; roomGen++; roomReady = false; roomPending = [];
    stopRoomPresenceHeartbeat();
    if (roomReT) { clearTimeout(roomReT); roomReT = null; }
    if (channel) { try { window.SB.removeChannel(channel); } catch (e) {} }
    channel = null; curRoom = null; handlers = {};
  }

  return {
    get enabled() { return enabled; },
    get room() { return curRoom; },
    initLobby: initLobby, sendLobby: sendLobby, trackLobby: trackLobby,
    resyncLobby: function () { if (enabled && lobbyWant) openLobby(); },
    init: init, send: send, track: track, leaveRoom: leaveRoom
  };
})();
