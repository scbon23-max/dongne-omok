window.Db = (function () {
  "use strict";
  var sb = window.SB;
  var ADMIN = "구나";

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
    if (r && r.error && row.moves) { delete row.moves; return sb.from("games").insert(row); }
    return r;
  }
  async function recordAlkGame(black, white, winner, gameType) { if (sb) return sb.from("games").insert({ black: black, white: white, winner: winner, game: gameType || "alk" }); }
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
  async function addChatMsg(room, nick, text) {
    if (sb) return sb.from("chat").insert({ room: room, nick: nick, text: text });
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
    recordGame: recordGame, recordAlkGame: recordAlkGame, getGames: getGames, getGamesByType: getGamesByType,
    getGameMoves: getGameMoves, gamesWithMoves: gamesWithMoves,
    addChatMsg: addChatMsg, getChatHistory: getChatHistory, getChatHistoryBefore: getChatHistoryBefore,
    getAllowlist: getAllowlist, addAllowed: addAllowed, removeAllowed: removeAllowed
  };
})();
