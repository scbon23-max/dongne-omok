window.Net = (function () {
  "use strict";
  var enabled = !!window.SB;

  var CLIENT_SESSION_ID = makeClientSessionId();
  var transportSeq = { lobby: 0, room: 0, direct: 0 };

  function makeClientSessionId() {
    var cryptoApi = window.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
      try { return "c-" + cryptoApi.randomUUID(); } catch (e) {}
    }
    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      try {
        var values = new Uint32Array(4);
        cryptoApi.getRandomValues(values);
        return "c-" + Array.prototype.map.call(values, function (value) {
          return value.toString(16).padStart(8, "0");
        }).join("");
      } catch (e) {}
    }
    return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function sessionIdOf(value) {
    value = String(value == null ? "" : value).trim();
    return value.length > 96 ? value.slice(0, 96) : value;
  }
  function withClientSession(meta) {
    return Object.assign({}, meta || {}, { clientSessionId: CLIENT_SESSION_ID });
  }
  function presenceKey(meta) {
    return String((meta && meta.nick) || "guest").slice(0, 40) + "#" + CLIENT_SESSION_ID;
  }
  function nextTransportSeq(lane) {
    transportSeq[lane] = (transportSeq[lane] || 0) + 1;
    return transportSeq[lane];
  }
  function decoratePayload(payload, lane, roomId, meta) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    var copy = Object.assign({}, payload);
    copy._transport = {
      v: 1,
      sessionId: CLIENT_SESSION_ID,
      seq: nextTransportSeq(lane),
      sentAt: Date.now(),
      lane: lane,
      roomId: String(roomId == null ? "" : roomId).slice(0, 80),
      senderNick: String((meta && meta.nick) || "").slice(0, 40)
    };
    return copy;
  }
  function transportMetaOf(payload) {
    var meta = payload && typeof payload === "object" ? payload._transport : null;
    if (!meta || Number(meta.v) !== 1) return null;
    var sessionId = sessionIdOf(meta.sessionId);
    var seq = Number(meta.seq), sentAt = Number(meta.sentAt);
    var lane = meta.lane === "lobby" || meta.lane === "room" || meta.lane === "direct" ? meta.lane : "";
    if (!sessionId || !Number.isSafeInteger(seq) || seq < 1 || !Number.isFinite(sentAt) || sentAt < 0 || !lane) return null;
    return {
      v: 1,
      sessionId: sessionId,
      seq: seq,
      sentAt: sentAt,
      lane: lane,
      roomId: String(meta.roomId == null ? "" : meta.roomId).slice(0, 80),
      senderNick: String(meta.senderNick == null ? "" : meta.senderNick).slice(0, 40)
    };
  }
  function sendOutcome(status, error) {
    status = status == null ? "ok" : String(status);
    var result = { ok: status === "ok", status: status };
    if (error) result.error = String(error && error.message ? error.message : error).slice(0, 240);
    return result;
  }
  function sendPacket(ch, payload) {
    if (!ch) return Promise.resolve(sendOutcome("unavailable"));
    try {
      return Promise.resolve(ch.send({ type: "broadcast", event: "m", payload: payload })).then(function (status) {
        return sendOutcome(status);
      }, function (error) {
        return sendOutcome("error", error);
      });
    } catch (error) {
      return Promise.resolve(sendOutcome("error", error));
    }
  }
  function settlePending(entry, result) {
    if (entry && entry.resolve) entry.resolve(result);
  }
  function discardPending(queue, status) {
    var pending = queue.splice(0, queue.length);
    for (var i = 0; i < pending.length; i++) settlePending(pending[i], sendOutcome(status));
  }
  function queuePacket(queue, payload, resolve, replaceLatest) {
    if (replaceLatest && queue.length) {
      var replaced = queue.splice(0, queue.length);
      for (var i = 0; i < replaced.length; i++) settlePending(replaced[i], sendOutcome("superseded"));
    }
    if (queue.length >= 50) {
      if (resolve) resolve(sendOutcome("queue_full"));
      return false;
    }
    queue.push({ payload: payload, resolve: resolve || null });
    return true;
  }
  function flushPackets(ch, queue) {
    var pending = queue.splice(0, queue.length);
    for (var i = 0; i < pending.length; i++) {
      (function (entry) {
        sendPacket(ch, entry.payload).then(function (result) { settlePending(entry, result); });
      })(pending[i]);
    }
  }

  function clubId() { return (window.OMOK_CONFIG && window.OMOK_CONFIG.ROOM) || "main"; }
  function rosterOf(ch) {
    var st = ch.presenceState(), byNick = {};
    Object.keys(st).forEach(function (key) {
      var metas = st[key];
      if (!metas || !metas.length) return;
      metas.forEach(function (meta, metaIndex) {
        if (!meta || !meta.nick) return;
        var row = byNick[meta.nick] || { count: 0, meta: null, metaSessionId: "", sessionIds: [] };
        row.count++;
        var sessionId = sessionIdOf(meta.clientSessionId) || ("legacy:" + key + ":" + metaIndex).slice(0, 96);
        if (row.sessionIds.indexOf(sessionId) < 0) row.sessionIds.push(sessionId);
        var joinTs = Number(meta.joinTs) || 0;
        var selectedJoinTs = row.meta ? (Number(row.meta.joinTs) || 0) : Infinity;
        if (!row.meta || joinTs < selectedJoinTs || (joinTs === selectedJoinTs && sessionId < row.metaSessionId)) {
          row.meta = meta;
          row.metaSessionId = sessionId;
        }
        byNick[meta.nick] = row;
      });
    });
    return Object.keys(byNick).map(function (nick) {
      var row = byNick[nick];
      row.sessionIds.sort();
      return Object.assign({}, row.meta, {
        presenceCount: row.count,
        presenceSessionIds: row.sessionIds.slice(),
        hasCurrentSession: row.sessionIds.indexOf(CLIENT_SESSION_ID) >= 0
      });
    });
  }
  function backoff(tries) { return Math.min(1000 * Math.pow(2, tries), 15000); }
  function isDead(status) { return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"; }

  // ── 로비 채널 (로그인하면 상시 접속, 방에 들어가도 유지) ──
  var lobbyCh = null, lobbyMeta = null, lobbyH = {}, lobbyGen = 0, lobbyWant = false, lobbyTries = 0, lobbyReT = null, lobbyReady = false, lobbyPending = [];
  function initLobby(meta, hs) {
    lobbyH = hs || {};
    if (!enabled) { if (lobbyH.onStatus) lobbyH.onStatus("LOCAL"); return false; }
    lobbyMeta = withClientSession(meta); lobbyWant = true; lobbyTries = 0;
    openLobby();
    return true;
  }
  function openLobby() {
    var gen = ++lobbyGen;
    lobbyReady = false;
    if (lobbyCh) { try { window.SB.removeChannel(lobbyCh); } catch (e) {} lobbyCh = null; }
    lobbyCh = window.SB.channel("lobby:" + clubId(), {
      config: { broadcast: { self: true }, presence: { key: presenceKey(lobbyMeta) } }
    });
    lobbyCh.on("broadcast", { event: "m" }, function (p) { if (lobbyH.onMessage) lobbyH.onMessage(p.payload, transportMetaOf(p.payload)); });
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
  function flushLobby() { if (lobbyCh) flushPackets(lobbyCh, lobbyPending); }
  function sendLobby(o) {
    if (!enabled) return;
    var payload = decoratePayload(o, "lobby", clubId(), lobbyMeta);
    if (lobbyReady && lobbyCh) { sendPacket(lobbyCh, payload); }
    else queuePacket(lobbyPending, payload, null, false);
  }
  function sendLobbyWithResult(o) {
    if (!enabled) return Promise.resolve(sendOutcome("disabled"));
    var payload = decoratePayload(o, "lobby", clubId(), lobbyMeta);
    if (lobbyReady && lobbyCh) return sendPacket(lobbyCh, payload);
    return new Promise(function (resolve) { queuePacket(lobbyPending, payload, resolve, false); });
  }
  function trackLobby(m) { lobbyMeta = withClientSession(m); if (enabled && lobbyCh) lobbyCh.track(lobbyMeta); }

  // ── 방 채널 (방에 들어갈 때만, 나가면 떠남) ──
  var channel = null, myMeta = null, handlers = {}, curRoom = null, roomGen = 0, roomWant = false, roomTries = 0, roomReT = null, roomReady = false, roomPending = [], roomPresenceT = null;
  var directChannels = Object.create(null), directWanted = Object.create(null), directTries = Object.create(null);
  function init(roomId, meta, hs) {
    if (!enabled) { handlers = hs || {}; if (handlers.onStatus) handlers.onStatus("LOCAL"); return false; }
    leaveRoom();
    handlers = hs || {};
    myMeta = withClientSession(meta); curRoom = roomId; roomWant = true; roomTries = 0;
    openRoom();
    return true;
  }
  function openRoom() {
    var gen = ++roomGen;
    roomReady = false;
    stopRoomPresenceHeartbeat();
    if (channel) { try { window.SB.removeChannel(channel); } catch (e) {} channel = null; }
    channel = window.SB.channel("room:" + curRoom, {
      config: { broadcast: { self: true }, presence: { key: presenceKey(myMeta) } }
    });
    channel.on("broadcast", { event: "m" }, function (p) { if (handlers.onMessage) handlers.onMessage(p.payload, transportMetaOf(p.payload)); });
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
  function flushRoom() { if (channel) flushPackets(channel, roomPending); }
  function send(o) {
    if (!enabled) return;
    var payload = decoratePayload(o, "room", curRoom, myMeta);
    if (roomReady && channel) { sendPacket(channel, payload); }
    else queuePacket(roomPending, payload, null, false);
  }
  function sendWithResult(o) {
    if (!enabled) return Promise.resolve(sendOutcome("disabled"));
    var payload = decoratePayload(o, "room", curRoom, myMeta);
    if (roomReady && channel) return sendPacket(channel, payload);
    return new Promise(function (resolve) { queuePacket(roomPending, payload, resolve, false); });
  }
  function track(m) { myMeta = withClientSession(m); if (enabled && channel) channel.track(myMeta); }
  function directNick(value) { return String(value == null ? "" : value).trim().slice(0, 40); }
  function directTopic(nick) { return "room-input:" + curRoom + ":" + encodeURIComponent(nick); }
  function closeDirectInput(nick, status) {
    var entry = directChannels[nick];
    if (!entry) return;
    if (entry.retry) clearTimeout(entry.retry);
    discardPending(entry.pending, status || "cancelled");
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
      if (handlers.onMessage) handlers.onMessage(packet.payload, transportMetaOf(packet.payload));
    });
    ch.subscribe(function (status) {
      if (directChannels[nick] !== entry) return;
      if (status === "SUBSCRIBED") {
        directTries[nick] = 0;
        entry.ready = true;
        flushPackets(ch, entry.pending);
      } else if (isDead(status)) {
        entry.ready = false;
        if (entry.retry || !directWanted[nick]) return;
        var delay = backoff(directTries[nick] || 0);
        directTries[nick] = (directTries[nick] || 0) + 1;
        entry.retry = setTimeout(function () {
          entry.retry = null;
          if (directChannels[nick] !== entry || !directWanted[nick] || !roomWant) return;
          closeDirectInput(nick, "reconnecting");
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
    payload = decoratePayload(payload, "direct", curRoom, myMeta);
    if (!entry.ready) {
      queuePacket(entry.pending, payload, null, true);
      return true;
    }
    sendPacket(entry.channel, payload);
    return true;
  }
  function sendDirectInputWithResult(payload) {
    if (!enabled || !roomWant || !curRoom) return Promise.resolve(sendOutcome("unavailable"));
    var nick = directNick(myMeta && myMeta.nick);
    if (!nick) return Promise.resolve(sendOutcome("unavailable"));
    directWanted[nick] = true;
    var entry = openDirectInput(nick);
    if (!entry) return Promise.resolve(sendOutcome("unavailable"));
    payload = decoratePayload(payload, "direct", curRoom, myMeta);
    if (entry.ready) return sendPacket(entry.channel, payload);
    queuePacket(entry.pending, payload, null, true);
    return Promise.resolve(sendOutcome("queued"));
  }
  function closeAllDirectInputs() {
    directWanted = Object.create(null);
    Object.keys(directChannels).forEach(closeDirectInput);
    directTries = Object.create(null);
  }
  function leaveRoom() {
    roomWant = false; roomGen++; roomReady = false; discardPending(roomPending, "cancelled");
    stopRoomPresenceHeartbeat();
    closeAllDirectInputs();
    if (roomReT) { clearTimeout(roomReT); roomReT = null; }
    if (channel) { try { window.SB.removeChannel(channel); } catch (e) {} }
    channel = null; curRoom = null; handlers = {};
  }

  return {
    get enabled() { return enabled; },
    get room() { return curRoom; },
    get clientSessionId() { return CLIENT_SESSION_ID; },
    transportMetaOf: transportMetaOf,
    initLobby: initLobby, sendLobby: sendLobby, sendLobbyWithResult: sendLobbyWithResult, trackLobby: trackLobby,
    resyncLobby: function () { if (enabled && lobbyWant) openLobby(); },
    init: init, send: send, sendWithResult: sendWithResult, track: track, leaveRoom: leaveRoom,
    syncDirectInputs: syncDirectInputs, sendDirectInput: sendDirectInput, sendDirectInputWithResult: sendDirectInputWithResult
  };
})();
