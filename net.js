window.Net = (function () {
  "use strict";
  var enabled = !!window.SB;

  function clubId() { return (window.OMOK_CONFIG && window.OMOK_CONFIG.ROOM) || "main"; }
  function rosterOf(ch) {
    var st = ch.presenceState(), arr = [];
    Object.keys(st).forEach(function (k) { var m = st[k]; if (m && m.length) arr.push(m[m.length - 1]); });
    return arr;
  }

  // ── 로비 채널 (로그인하면 상시 접속, 방에 들어가도 유지) ──
  var lobbyCh = null, lobbyMeta = null, lobbyH = {};
  function initLobby(meta, hs) {
    lobbyH = hs || {};
    if (!enabled) { if (lobbyH.onStatus) lobbyH.onStatus("LOCAL"); return false; }
    lobbyMeta = meta;
    lobbyCh = window.SB.channel("lobby:" + clubId(), {
      config: { broadcast: { self: true }, presence: { key: meta.nick } }
    });
    lobbyCh.on("broadcast", { event: "m" }, function (p) { if (lobbyH.onMessage) lobbyH.onMessage(p.payload); });
    lobbyCh.on("presence", { event: "sync" }, lobbyEmit);
    lobbyCh.on("presence", { event: "join" }, lobbyEmit);
    lobbyCh.on("presence", { event: "leave" }, lobbyEmit);
    lobbyCh.subscribe(function (status) {
      if (lobbyH.onStatus) lobbyH.onStatus(status);
      if (status === "SUBSCRIBED") { lobbyCh.track(lobbyMeta); if (lobbyH.onReady) lobbyH.onReady(); }
    });
    return true;
  }
  function lobbyEmit() { if (lobbyCh && lobbyH.onPresence) lobbyH.onPresence(rosterOf(lobbyCh)); }
  function sendLobby(o) { if (enabled && lobbyCh) lobbyCh.send({ type: "broadcast", event: "m", payload: o }); }
  function trackLobby(m) { lobbyMeta = m; if (enabled && lobbyCh) lobbyCh.track(m); }

  // ── 방 채널 (방에 들어갈 때만, 나가면 떠남) ──
  var channel = null, myMeta = null, handlers = {}, curRoom = null;
  function init(roomId, meta, hs) {
    if (!enabled) { handlers = hs || {}; if (handlers.onStatus) handlers.onStatus("LOCAL"); return false; }
    leaveRoom();
    handlers = hs || {};
    myMeta = meta; curRoom = roomId;
    channel = window.SB.channel("room:" + roomId, {
      config: { broadcast: { self: true }, presence: { key: meta.nick } }
    });
    channel.on("broadcast", { event: "m" }, function (p) { if (handlers.onMessage) handlers.onMessage(p.payload); });
    channel.on("presence", { event: "sync" }, emit);
    channel.on("presence", { event: "join" }, emit);
    channel.on("presence", { event: "leave" }, emit);
    channel.subscribe(function (status) {
      if (handlers.onStatus) handlers.onStatus(status);
      if (status === "SUBSCRIBED") { channel.track(myMeta); if (handlers.onReady) handlers.onReady(); }
    });
    return true;
  }
  function emit() { if (channel && handlers.onPresence) handlers.onPresence(rosterOf(channel)); }
  function send(o) { if (enabled && channel) channel.send({ type: "broadcast", event: "m", payload: o }); }
  function track(m) { myMeta = m; if (enabled && channel) channel.track(m); }
  function leaveRoom() {
    if (channel) { try { window.SB.removeChannel(channel); } catch (e) {} }
    channel = null; curRoom = null; handlers = {};
  }

  return {
    get enabled() { return enabled; },
    get room() { return curRoom; },
    initLobby: initLobby, sendLobby: sendLobby, trackLobby: trackLobby,
    init: init, send: send, track: track, leaveRoom: leaveRoom
  };
})();
