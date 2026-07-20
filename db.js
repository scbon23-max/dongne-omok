window.Db = (function () {
  "use strict";
  var sb = window.SB;
  var ADMIN = "구나";
  var ACTIVITY_ROOM = "__admin_activity_v1__";
  var ACTIVITY_PREFIX = "@activity:";
  var ACTIVITY_TYPES = { login: true, logout: true, room_create: true, room_leave: true };

  async function sha256(str) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  async function ensureAdmin() {
    if (!sb) return;
    var r = await sb.from("accounts").select("nickname").eq("nickname", ADMIN);
    if (!r.data || !r.data.length) {
      var h = await sha256("7778");
      await sb.from("accounts").upsert({ nickname: ADMIN, pw_hash: h, is_admin: true });
    }
  }

  async function login(nick, pw) {
    if (!sb) return { ok: true, account: { nickname: nick, is_admin: nick === ADMIN } };
    var hash = await sha256(pw);
    var r = await sb.from("accounts").select("*").eq("nickname", nick);
    if (r.error) return { ok: false, reason: "error", msg: r.error.message };
    if (!r.data || !r.data.length) {
      var isAdmin = (nick === ADMIN);
      if (!isAdmin) {
        var al = await sb.from("allowlist").select("nickname").eq("nickname", nick);
        if (al.error) return { ok: false, reason: "error", msg: al.error.message };
        if (!al.data || !al.data.length) return { ok: false, reason: "not_allowed" };
      }
      var e = await sb.from("accounts").insert({ nickname: nick, pw_hash: hash, is_admin: isAdmin });
      if (e.error) return { ok: false, reason: "error", msg: e.error.message };
      return { ok: true, created: true, account: { nickname: nick, is_admin: isAdmin } };
    }
    var acc = r.data[0];
    if (acc.pw_hash == null) {
      await sb.from("accounts").update({ pw_hash: hash }).eq("nickname", nick);
      return { ok: true, reset: true, account: { nickname: nick, is_admin: acc.is_admin } };
    }
    if (acc.pw_hash === hash) return { ok: true, account: { nickname: nick, is_admin: acc.is_admin } };
    return { ok: false, reason: "badpw" };
  }

  async function loginHash(nick, hash) {
    if (!sb) return { ok: true, account: { nickname: nick, is_admin: nick === ADMIN } };
    var r = await sb.from("accounts").select("*").eq("nickname", nick);
    if (r.error) return { ok: false, reason: "error", msg: r.error.message };
    if (!r.data || !r.data.length) return { ok: false, reason: "noaccount" };
    var acc = r.data[0];
    if (acc.pw_hash && acc.pw_hash === hash) return { ok: true, account: { nickname: nick, is_admin: acc.is_admin } };
    return { ok: false, reason: "badpw" };
  }

  async function listAccounts() {
    if (!sb) return [];
    var r = await sb.from("accounts").select("nickname,is_admin,pw_hash,created_at").order("created_at");
    return (r.data || []).map(function (a) {
      return { nickname: a.nickname, is_admin: a.is_admin, needsPw: a.pw_hash == null, created_at: a.created_at };
    });
  }
  async function deleteAccount(nick) { if (sb) return sb.from("accounts").delete().eq("nickname", nick); }
  async function clearPassword(nick) { if (sb) return sb.from("accounts").update({ pw_hash: null }).eq("nickname", nick); }
  // 게임 종류는 games.game 컬럼(text)으로 구분: omok / alk / alk_terr / …(미래 확장은 문자열만 추가)
  async function recordGame(black, white, winner, moves) {
    if (!sb) return;
    var row = { black: black, white: white, winner: winner, game: "omok" };
    if (moves && moves.length) row.moves = moves;
    var r = await sb.from("games").insert(row);
    if (r && r.error && row.moves) {
      var em = (r.error.message || "") + " " + (r.error.code || "");
      if (/moves|column|schema|PGRST|42703/i.test(em)) { delete row.moves; return sb.from("games").insert(row); }
    }
    return r;
  }
  async function recordAlkGame(black, white, winner, gameType) { if (sb) return sb.from("games").insert({ black: black, white: white, winner: winner, game: gameType || "alk" }); }
  async function recordCatchmindMatch(matchId, results) {
    if (!sb || !results || !results.length) return;
    var safeId = String(matchId || Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g, "") || Date.now().toString(36);
    var rows = results.map(function (r) {
      var points = Math.max(0, Math.round(Number(r.points) || 0));
      var maxPoints = Math.max(1, Math.round(Number(r.maxPoints) || 1));
      var correct = Math.max(0, Math.round(Number(r.correct) || 0));
      var drawCorrect = Math.max(0, Math.round(Number(r.drawCorrect) || 0));
      var rawScore = Number(r.score);
      var score = isFinite(rawScore) ? Math.max(0, Math.round(rawScore)) : points;
      return {
        black: String(r.nick || "").slice(0, 40),
        white: ["cm", safeId, points, maxPoints, correct, drawCorrect, score].join(":"),
        winner: "draw",
        game: "catchmind"
      };
    }).filter(function (row) { return !!row.black; });
    if (!rows.length) return;
    var prefix = "cm:" + safeId + ":";
    var existing = await sb.from("games").select("black,white").eq("game", "catchmind").like("white", prefix + "%");
    if (existing.error) return existing;
    if (!existing.error && existing.data && existing.data.length) {
      var saved = Object.create(null);
      existing.data.forEach(function (row) {
        if (row && String(row.white || "").indexOf(prefix) === 0) saved[row.black] = true;
      });
      rows = rows.filter(function (row) { return !saved[row.black]; });
    }
    if (!rows.length) return { data: [], error: null };
    return sb.from("games").insert(rows);
  }
  async function galleryInvoke(action, auth, payload) {
    if (!sb || !sb.functions || !sb.functions.invoke) return { ok: false, reason: "unavailable" };
    auth = auth || {};
    payload = payload || {};
    var body = Object.assign({}, payload, {
      action: action,
      auth: {
        nick: String(auth.nick || "").slice(0, 40),
        hash: String(auth.hash || "").slice(0, 128)
      }
    });
    if (!body.auth.nick || !body.auth.hash) return { ok: false, reason: "auth" };
    var response = await sb.functions.invoke("catchmind-gallery", { body: body });
    if (response.error) return { ok: false, reason: "network", msg: response.error.message || String(response.error) };
    return response.data && typeof response.data === "object"
      ? response.data
      : { ok: false, reason: "invalid_response" };
  }
  async function saveCatchmindDrawing(auth, drawing) {
    return galleryInvoke("save", auth, drawing);
  }
  async function getCatchmindGallery(auth, mode, offset, limit) {
    return galleryInvoke("list", auth, {
      mode: mode === "favorites" ? "favorites" : "recent",
      offset: Math.max(0, Math.floor(Number(offset) || 0)),
      limit: Math.max(1, Math.min(40, Math.floor(Number(limit) || 20)))
    });
  }
  async function toggleCatchmindFavorite(auth, drawingId, favorite) {
    return galleryInvoke("favorite", auth, {
      drawingId: Math.max(0, Math.floor(Number(drawingId) || 0)),
      favorite: !!favorite
    });
  }
  async function relayGalleryInvoke(action, auth, payload) {
    if (!sb || !sb.functions || !sb.functions.invoke) return { ok: false, reason: "unavailable" };
    auth = auth || {};
    payload = payload || {};
    var body = Object.assign({}, payload, {
      action: action,
      auth: {
        nick: String(auth.nick || "").slice(0, 40),
        hash: String(auth.hash || "").slice(0, 128)
      }
    });
    if (!body.auth.nick || !body.auth.hash) return { ok: false, reason: "auth" };
    var response = await sb.functions.invoke("relay-gallery", { body: body });
    if (response.error) return { ok: false, reason: "network", msg: response.error.message || String(response.error) };
    return response.data && typeof response.data === "object"
      ? response.data
      : { ok: false, reason: "invalid_response" };
  }
  async function saveRelayAlbum(auth, album) {
    return relayGalleryInvoke("save", auth, album);
  }
  async function getRelayAlbums(auth, offset, limit) {
    return relayGalleryInvoke("list", auth, {
      offset: Math.max(0, Math.floor(Number(offset) || 0)),
      limit: Math.max(1, Math.min(20, Math.floor(Number(limit) || 10)))
    });
  }
  async function getRelayAlbum(auth, albumId) {
    return relayGalleryInvoke("detail", auth, {
      albumId: Math.max(0, Math.floor(Number(albumId) || 0))
    });
  }
  async function roomLeaseInvoke(action, auth, lease) {
    if (!sb || !sb.functions || !sb.functions.invoke) return { ok: false, reason: "unavailable" };
    auth = auth || {};
    lease = lease || {};
    var body = {
      action: action,
      auth: {
        nick: String(auth.nick || "").slice(0, 40),
        hash: String(auth.hash || "").slice(0, 128)
      },
      roomId: String(lease.roomId || "").slice(0, 80),
      token: String(lease.token || "").slice(0, 100)
    };
    if (action === "claim") {
      body.roomName = String(lease.roomName || "").slice(0, 80);
      body.game = String(lease.game || "").slice(0, 30);
    }
    if (!body.auth.nick || !body.auth.hash || !body.roomId || !body.token) return { ok: false, reason: "auth" };
    var result = await sb.functions.invoke("room-lease", { body: body });
    if (result.error) return { ok: false, reason: "network", msg: result.error.message || String(result.error) };
    return result.data && typeof result.data === "object"
      ? result.data
      : { ok: false, reason: "invalid_response" };
  }
  async function claimRoomLease(auth, lease) { return roomLeaseInvoke("claim", auth, lease); }
  async function renewRoomLease(auth, lease) { return roomLeaseInvoke("renew", auth, lease); }
  async function releaseRoomLease(auth, lease) { return roomLeaseInvoke("release", auth, lease); }
  var GAME_COLS = "id,black,white,winner,game,created_at";
  async function getGames() {
    if (!sb) return [];
    var r = await sb.from("games").select(GAME_COLS).order("created_at", { ascending: false });
    return r.data || [];
  }
  async function getGamesByType(game) {
    if (!sb) return [];
    var r = await sb.from("games").select(GAME_COLS).eq("game", game).order("created_at", { ascending: false });
    if (r.error) {
      // game 컬럼이 아직 없으면(ALTER 전) 오목만 폴백으로 동작
      if (game === "omok") { var all = await sb.from("games").select(GAME_COLS).order("created_at", { ascending: false }); return all.data || []; }
      return [];
    }
    return r.data || [];
  }
  async function getGameMoves(id) {
    if (!sb || id == null) return null;
    var r = await sb.from("games").select("moves").eq("id", id).limit(1);
    if (r.error || !r.data || !r.data.length) return null;
    return r.data[0].moves || null;
  }
  async function gamesWithMoves(ids) {
    if (!sb || !ids || !ids.length) return [];
    var r = await sb.from("games").select("id").in("id", ids).not("moves", "is", null);
    if (r.error || !r.data) return [];
    return r.data.map(function (x) { return x.id; });
  }
  async function deleteGame(id) { if (sb && id != null) return sb.from("games").delete().eq("id", id); }
  async function addChatMsg(room, nick, text) {
    if (sb) return sb.from("chat").insert({ room: room, nick: nick, text: text });
  }
  function activityText(value, limit) {
    return String(value || "").trim().slice(0, limit);
  }
  async function recordActivity(nick, type, details) {
    if (!sb || !ACTIVITY_TYPES[type]) return;
    nick = activityText(nick, 40);
    if (!nick) return;
    details = details || {};
    var payload = { v: 1, type: type };
    if (type === "room_create" || type === "room_leave") {
      var roomId = activityText(details.roomId, 80);
      var roomName = activityText(details.roomName, 80);
      var game = activityText(details.game, 30);
      if (roomId) payload.roomId = roomId;
      if (roomName) payload.roomName = roomName;
      if (game) payload.game = game;
    }
    return sb.from("chat").insert({
      room: ACTIVITY_ROOM,
      nick: nick,
      text: ACTIVITY_PREFIX + JSON.stringify(payload)
    });
  }
  async function getActivityLogs(limit) {
    if (!sb) return [];
    limit = Math.max(1, Math.min(500, Number(limit) || 200));
    var r = await sb.from("chat").select("nick,text,created_at")
      .eq("room", ACTIVITY_ROOM)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (r.error || !r.data) return [];
    return r.data.map(function (row) {
      var text = String(row && row.text || "");
      if (text.indexOf(ACTIVITY_PREFIX) !== 0) return null;
      try {
        var payload = JSON.parse(text.slice(ACTIVITY_PREFIX.length));
        if (!payload || payload.v !== 1 || !ACTIVITY_TYPES[payload.type]) return null;
        return {
          nick: activityText(row.nick, 40),
          type: payload.type,
          roomId: activityText(payload.roomId, 80),
          roomName: activityText(payload.roomName, 80),
          game: activityText(payload.game, 30),
          createdAt: row.created_at || null
        };
      } catch (e) {
        return null;
      }
    }).filter(function (item) { return !!item && !!item.nick; });
  }
  async function getAllowlist() {
    if (!sb) return [];
    var r = await sb.from("allowlist").select("nickname").order("nickname");
    return (r.data || []).map(function (a) { return a.nickname; });
  }
  async function addAllowed(nick) { if (sb) return sb.from("allowlist").insert({ nickname: nick }); }
  async function removeAllowed(nick) { if (sb) return sb.from("allowlist").delete().eq("nickname", nick); }
  async function getChatHistory(room, limit) {
    if (!sb) return [];
    var r = await sb.from("chat").select("nick,text,created_at").eq("room", room).order("created_at", { ascending: false }).limit(limit || 50);
    return (r.data || []).reverse();
  }
  async function getChatHistoryBefore(room, beforeIso, limit) {
    if (!sb) return [];
    var r = await sb.from("chat").select("nick,text,created_at").eq("room", room).lt("created_at", beforeIso).order("created_at", { ascending: false }).limit(limit || 100);
    return (r.data || []).reverse();
  }

  return {
    ADMIN: ADMIN, ensureAdmin: ensureAdmin, login: login, loginHash: loginHash, hashPw: sha256,
    listAccounts: listAccounts, deleteAccount: deleteAccount, clearPassword: clearPassword,
    recordGame: recordGame, recordAlkGame: recordAlkGame, recordCatchmindMatch: recordCatchmindMatch,
    saveCatchmindDrawing: saveCatchmindDrawing, getCatchmindGallery: getCatchmindGallery, toggleCatchmindFavorite: toggleCatchmindFavorite,
    saveRelayAlbum: saveRelayAlbum, getRelayAlbums: getRelayAlbums, getRelayAlbum: getRelayAlbum,
    claimRoomLease: claimRoomLease, renewRoomLease: renewRoomLease, releaseRoomLease: releaseRoomLease,
    getGames: getGames, getGamesByType: getGamesByType,
    getGameMoves: getGameMoves, gamesWithMoves: gamesWithMoves, deleteGame: deleteGame,
    addChatMsg: addChatMsg, getChatHistory: getChatHistory, getChatHistoryBefore: getChatHistoryBefore,
    recordActivity: recordActivity, getActivityLogs: getActivityLogs,
    getAllowlist: getAllowlist, addAllowed: addAllowed, removeAllowed: removeAllowed
  };
})();
