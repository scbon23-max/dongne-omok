(function () {
  "use strict";

  var SIZE = Renju.SIZE, BLACK = Renju.BLACK, WHITE = Renju.WHITE;
  var TERR_KOMI = 1.5;
  var APP_BUILD = "20260715-catchmind-v2";
  var APP_REFRESH_KEY = "dongne_games_app_refresh";

  var G = {
    board: Renju.emptyBoard(),
    turn: BLACK,
    lastMove: null,
    over: false,
    winner: 0,          // 0=미결/무승부, 1=흑, 2=백
    draw: false,
    seats: { black: null, white: null },   // 닉네임 저장
    timerSec: 30,
    moveDeadline: null,
    rev: 0,
    gameSeq: 0,
    history: [],
    recorded: false,
    started: false,
    lastPlayers: null,
    resultAt: null,
    manualPaused: false,
    paused: false,
    pausedRemainMs: null,
    resultInfo: null,
    winChatText: null,
    drawAsk: null,       // { gseq, black: null|true|false, white: null|true|false } — 80수 자동 제안
    drawAskDone: false    // 자동 제안을 이미 물어봤는지(이번 판 1회)
  };
  var ADMIN = "구나";
  var DRAW_ASK_MOVES = 80;
  var REQUEST_COOLDOWN_MS = 10000;

  var me = { nick: "", isAdmin: false };
  var roster = [];
  var hostNick = null, amHost = false, wasHost = false, netMode = false, connected = false;

  var canvas, ctx, MARGIN = 20, GAP, RADIUS;
  var hostTimerId = null, dispTimerId = null;
  var GRACE_MS = 60000;
  var graceTimers = { black: null, white: null };
  var winShownSeq = -1, liveSeq = -1, resultCalcSeq = -1, omokWinChatSeq = -1, alkWinChatSeq = -1;
  var voidReqFrom = null, voidReqGseq = 0, undoReqCtx = null;
  var beginReqCtx = null, swapReqCtx = null;
  var audioCtx = null, soundMuted = false, lastStoneCount = 0, stoneBuffer = null, stoneLoading = false, silenceEl = null;
  var inoutBuffer = null, inoutLoading = false, prevNicks = [], joinedAt = 0, firstPresenceAt = 0;
  var displayRoster = [], awayMembers = {}, awayTimers = {}, explicitLeaves = {};
  var winBuffer = null, winLoading = false;
  var warnBuffer = null, warnLoading = false, lastWarnSec = -1;
  var seatBuffer = null, seatLoading = false, lastRoomSoundAt = 0;
  var leaveBuffer = null, leaveLoading = false;
  var hitBuffer = null, hitLoading = false, lastHitAt = 0;
  var prevSeats = { black: null, white: null }, seatSoundArmed = false;
  var oldestChatTs = null, loadingOlder = false, noMoreChat = false;
  var sessionChat = [];
  var preview = null;

  function $(id) { return document.getElementById(id); }
  function colorName(c) { return c === BLACK ? "black" : "white"; }
  function gameDef(id) { return window.GameCatalog && GameCatalog.get(id); }
  function gameFamily(id) {
    if (window.GameCatalog) return GameCatalog.family(id);
    return id === "omok" ? "omok" : "alk";
  }
  function isOmokFamily(id) { return gameFamily(id) === "omok"; }
  function isAlkFamily(id) { return gameFamily(id) === "alk"; }
  function activeFamily() { return gameFamily(curRoomGame || curGame || "omok"); }
  function gameController(id) {
    var def = gameDef(id) || gameDef(gameFamily(id));
    return def && def.controller ? window[def.controller] : null;
  }
  function activeController() { return gameController(curRoomGame || curGame); }
  function rankableGames() {
    return window.GameCatalog ? GameCatalog.rankableIds() : ["omok", "alk", "alk_terr"];
  }
  function emptyScoreMap() {
    var out = {};
    rankableGames().forEach(function (id) { out[id] = {}; });
    return out;
  }
  function gameUi(id) {
    var def = gameDef(id) || gameDef(gameFamily(id));
    if (def) return def;
    if (window.GameCatalog) {
      return {
        screenId: null,
        roomStripId: null,
        chatLogId: null,
        chatInputId: null,
        chatOverlayId: null,
        onlineListId: null,
        onlineNumId: null
      };
    }
    return {
      screenId: id === "omok" ? "game" : "alkgame",
      roomStripId: id === "omok" ? "room-strip-omok" : "room-strip-alk",
      chatLogId: id === "omok" ? "chat-log" : "alk-chat-log",
      chatInputId: id === "omok" ? "chat-input" : "alk-chat-input",
      chatOverlayId: id === "omok" ? "chat-overlay" : "alk-chat-overlay",
      onlineListId: id === "omok" ? "online-list" : "alk-online-list",
      onlineNumId: id === "omok" ? "online-num" : "alk-online-num"
    };
  }
  function gameDefs() {
    return window.GameCatalog ? GameCatalog.all() : [gameUi("omok"), gameUi("alk")];
  }
  function hideGameScreens() {
    var seen = {};
    gameDefs().forEach(function (def) {
      if (!def || !def.screenId || seen[def.screenId]) return;
      seen[def.screenId] = true;
      var el = $(def.screenId); if (el) el.classList.add("hidden");
    });
  }
  function controllerApi() {
    return {
      me: function () { return { nick: me.nick, isAdmin: me.isAdmin }; },
      roster: function () {
        if (netMode && displayRoster.length) return displayRoster.slice();
        return [{ nick: me.nick, isAdmin: me.isAdmin, joinTs: myJoinTs || 0 }];
      },
      isHost: function () { return !netMode || amHost; },
      host: function () { return hostNick || me.nick; },
      isNet: function () { return netMode; },
      send: function (msg) {
        if (netMode) Net.send(msg);
        else {
          var ctrl = activeController();
          if (ctrl && ctrl.onMessage) ctrl.onMessage(msg);
        }
      },
      sendChat: function (text) { sendChatText(activeFamily(), text); },
      toast: toast,
      openRank: function () { openRank(curRoomGame || curGame); },
      openPlayers: function () { renderPlayersList(); openModal("players-modal"); },
      openMenu: openMenu,
      leaveRoom: requestLeaveRoom,
      roomChanged: broadcastRoomOpen,
      recordMatch: function (matchId, results) {
        if (!window.Db || !Db.recordCatchmindMatch) return Promise.resolve(null);
        return Promise.resolve(Db.recordCatchmindMatch(matchId, results));
      },
      scoresChanged: function () {
        scheduleScoresRefresh("catchmind");
        if (lobbyMode) Net.sendLobby({ t: "scores", game: "catchmind" });
      }
    };
  }

  function reasonText(r) {
    if (r === "overline") return "장목(6목 이상)은 흑 금수예요.";
    if (r === "double_four") return "사사(4·4)는 흑 금수예요.";
    if (r === "double_three") return "삼삼(3·3)은 흑 금수예요.";
    if (r === "occupied") return "이미 돌이 있어요.";
    return "여기엔 둘 수 없어요.";
  }

  // ---------- 로그인/입장 ----------
  async function enter() {
    initAudio();
    var nick = $("nick").value.trim();
    var pw = $("pw").value;
    if (!nick) { $("nick").focus(); return; }
    if (!pw) { setLoginMsg("비밀번호를 입력하세요."); $("pw").focus(); return; }
    $("enter-btn").disabled = true;
    setLoginMsg("접속 중…");
    try {
      if (window.Db) {
        await Db.ensureAdmin();
        var res = await Db.login(nick, pw);
        if (!res.ok) {
          setLoginMsg(
            res.reason === "badpw" ? "비밀번호가 틀렸어요." :
            res.reason === "not_allowed" ? "모임 명단에 없는 닉네임이에요. 철자를 확인하거나 관리자에게 요청하세요." :
            ("오류: " + (res.msg || res.reason))
          );
          $("enter-btn").disabled = false;
          return;
        }
        me.nick = nick;
        me.isAdmin = !!(res.account && res.account.is_admin);
        await saveAuth(nick, pw);
        setLoginMsg("");
        showLobby();
        if (res.created) toast("가입 완료! 다음부턴 같은 비번으로 로그인");
        else if (res.reset) toast("비번이 새로 설정됐어요");
      } else {
        me.nick = nick; me.isAdmin = (nick === "구나");
        showLobby();
      }
    } catch (e) {
      setLoginMsg("접속 오류: " + e.message);
      $("enter-btn").disabled = false;
    }
  }
  function setLoginMsg(m) { $("login-msg").textContent = m || ""; }

  var AUTH_KEY = "omok_auth";
  async function saveAuth(nick, pw) {
    try {
      var keep = $("remember-me") && $("remember-me").checked;
      if (keep && window.Db && Db.hashPw) {
        var h = await Db.hashPw(pw);
        localStorage.setItem(AUTH_KEY, JSON.stringify({ nick: nick, h: h }));
      } else {
        localStorage.removeItem(AUTH_KEY);
      }
    } catch (e) {}
  }
  function clearAuth() { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} }
  async function tryAutoLogin() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch (e) { clearAuth(); return; }
    if (!saved || !saved.nick || !saved.h || !window.Db || !Db.loginHash) return;
    if ($("nick")) $("nick").value = saved.nick;
    setLoginMsg("자동 로그인 중…");
    try {
      await Db.ensureAdmin();
      var res = await Db.loginHash(saved.nick, saved.h);
      if (res.ok) {
        me.nick = saved.nick;
        me.isAdmin = !!(res.account && res.account.is_admin);
        setLoginMsg("");
        showLobby();
      } else {
        clearAuth();
        setLoginMsg("");
      }
    } catch (e) { setLoginMsg(""); }
  }

  var myJoinTs = 0;
  function myMetaObj(v) { return { nick: me.nick, isAdmin: me.isAdmin, joinTs: myJoinTs, viewing: v }; }
  function appConnect() {
    joinedAt = Date.now();
    firstPresenceAt = 0;
    myJoinTs = Date.now();
    lobbyMode = Net.initLobby(
      myMetaObj(null),
      { onReady: onLobbyReady, onMessage: onLobbyMessage, onPresence: onLobbyPresence, onStatus: onLobbyStatus }
    );
    if (!lobbyMode) setLobbyConn("local");
  }
  var lobbyConnected = false;
  function showLobby() {
    $("entry").classList.add("hidden");
    hideGameScreens();
    $("lobby").classList.remove("hidden");
    document.body.classList.toggle("is-admin", me.isAdmin);
    if (!lobbyConnected) { lobbyConnected = true; appConnect(); startRoomKeeper(); }
    renderRoomList();
    updateOnlineCounts(); renderLobbyOnline();
  }
  var curGame = null, curRoomGame = null, omokStarted = false, alkStarted = false;
  var A = { seats: { black: null, white: null }, turn: "b", started: false, over: false, winner: null, seq: 0, gameSeq: 0, recorded: false, paused: false, winChatText: null };
  var alkInited = false;
  var alkGrace = { black: null, white: null };
  var scoreMap = emptyScoreMap();
  // ---------- 로비 ----------
  var lobbyMode = false, lobbyRoster = [], rooms = {}, roomFilter = "all";
  var curRoomId = null, curRoomTitle = "", roomCreatedTs = 0;

  function setLobbyConn(s) { var d = $("lobby-conn-dot"); if (d) d.className = "conn-dot " + s; }
  function onLobbyStatus(s) {
    if (s === "SUBSCRIBED") setLobbyConn("online");
    else if (s === "LOCAL") setLobbyConn("local");
    else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setLobbyConn("off");
    else setLobbyConn("connecting");
  }
  function onLobbyReady() { Net.sendLobby({ t: "lobby_hello", nick: me.nick }); loadLobbyChat(); refreshScores(); }
  function onLobbyPresence(list) {
    lobbyRoster = list || [];
    updateOnlineCounts();
    renderLobbyOnline();
  }
  function clubOnlineCount() { return lobbyMode ? lobbyRoster.length : 1; }
  function lobbyPeople() { return lobbyMode ? lobbyRoster.filter(function (m) { return !m.viewing; }) : [{ nick: me.nick, joinTs: 0 }]; }
  function updateOnlineCounts() {
    var total = clubOnlineCount();
    var ids = { "lobby-online-total": 1 };
    gameDefs().forEach(function (def) { if (def && def.onlineTotalId) ids[def.onlineTotalId] = 1; });
    Object.keys(ids).forEach(function (id) {
      var el = $(id); if (el) el.textContent = total;
    });
    var lc = $("lobby-online-count"); if (lc) lc.textContent = "온라인 " + total + "명";
    var ln = $("lobby-online-num"); if (ln) ln.textContent = lobbyPeople().length;
  }
  function renderLobbyOnline() {
    var box = $("lobby-online-list"); if (!box) return;
    var arr = (lobbyRoster && lobbyRoster.length) ? lobbyRoster.slice() : [{ nick: me.nick, joinTs: 0 }];
    arr.sort(function (a, b) { return (a.joinTs || 0) - (b.joinTs || 0); });
    box.innerHTML = arr.map(function (m) {
      var meMark = (m.nick === me.nick) ? " (나)" : "";
      return '<div class="online-item"><span style="color:' + nickColor(m.nick) + '">' + esc(m.nick) + esc(meMark) + '</span></div>';
    }).join("");
  }
  function onLobbyMessage(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === "chat") { if (msg.nick !== me.nick) addLobbyChat(msg.nick, msg.text); return; }
    if (msg.t === "scores") {
      scheduleScoresRefresh(msg.game);
      if (!$("rank-modal").classList.contains("hidden") && $("rank-detail").classList.contains("hidden")
          && rankSeasons.length && rankSeasonIdx === rankSeasons.length - 1) openRank(rankGame);
      return;
    }
    if (msg.t === "lobby_hello") { if (curRoomId && amHost) broadcastRoomOpen(); return; }
    if (msg.t === "room_open") { if (msg.room && msg.room.id) { msg.room.seen = Date.now(); rooms[msg.room.id] = msg.room; renderRoomList(); } return; }
    if (msg.t === "room_close") { if (rooms[msg.id]) { delete rooms[msg.id]; renderRoomList(); } return; }
  }
  function startRoomKeeper() {
    setInterval(function () {
      var now = Date.now(), changed = false;
      Object.keys(rooms).forEach(function (id) {
        if (id !== curRoomId && now - (rooms[id].seen || 0) > 15000) { delete rooms[id]; changed = true; }
      });
      if (changed) renderRoomList();
      if (curRoomId && amHost) broadcastRoomOpen();
    }, 5000);
  }
  function gameName(g) { return window.GameCatalog ? GameCatalog.name(g) : (g === "omok" ? "오목" : g === "alk_terr" ? "점령전" : "알까기"); }
  function roomSeatName(nick, room) {
    if (nick === AI_NICK) {
      var level = room && room.aiLevel;
      return level ? aiLevelName(level) : nick;
    }
    return nick;
  }
  function roomMetaObj() {
    var st, black, white, summary = null;
    if (isOmokFamily(curGame)) { st = G.over ? "끝" : G.started ? "게임중" : "대기중"; black = G.seats.black; white = G.seats.white; }
    else if (isAlkFamily(curGame)) { st = A.over ? "끝" : A.started ? "게임중" : "대기중"; black = A.seats.black; white = A.seats.white; }
    else {
      var ctrl = activeController(), meta = ctrl && ctrl.roomMeta ? ctrl.roomMeta() : null;
      st = meta && meta.status ? meta.status : "대기중";
      summary = meta && meta.summary ? meta.summary : null;
      black = null; white = null;
    }
    var aiLevel = (black === AI_NICK || white === AI_NICK) ? omokAI.level : null;
    var shownBlack = (black === AI_NICK && aiLevel) ? aiLevelName(aiLevel) : black;
    var shownWhite = (white === AI_NICK && aiLevel) ? aiLevelName(aiLevel) : white;
    return { id: curRoomId, game: curRoomGame, name: curRoomTitle, host: me.nick, status: st, summary: summary, black: shownBlack || null, white: shownWhite || null, aiLevel: aiLevel, count: (netMode ? Math.max(displayRoster.length, roster.length, 1) : 1), ts: roomCreatedTs };
  }
  function broadcastRoomOpen() { if (lobbyMode) Net.sendLobby({ t: "room_open", room: roomMetaObj() }); }
  function renderRoomList() {
    var box = $("room-list"); if (!box) return;
    var list = Object.keys(rooms).map(function (k) { return rooms[k]; })
      .filter(function (r) { return roomFilter === "all" || r.game === roomFilter; })
      .sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    if (!list.length) { box.innerHTML = '<div class="room-empty">아직 열린 방이 없어요. 방을 만들어 보세요!</div>'; return; }
    box.innerHTML = list.map(function (r) {
      var gname = gameName(r.game);
      var seats = [roomSeatName(r.black, r), roomSeatName(r.white, r)].filter(Boolean);
      var who = r.summary ? esc(r.summary) : (seats.length ? seats.map(esc).join(" vs ") : "빈 자리");
      var playing = r.status === "게임중";
      var act = playing ? "관전" : "입장";
      return '<div class="room-card" data-id="' + esc(r.id) + '">'
        + '<div class="room-info">'
        + '<div class="room-title"><span class="room-badge ' + r.game + '">' + gname + '</span>'
        + '<span class="room-name">' + esc(r.name || "방") + '</span></div>'
        + '<div class="room-meta"><span class="room-status ' + (playing ? "playing" : "waiting") + '">' + esc(r.status) + '</span>'
        + '<span class="room-dot">·</span><span class="room-who">' + who + '</span>'
        + '<span class="room-dot">·</span><span class="room-cnt">' + (r.count || 0) + '명</span></div>'
        + '</div>'
        + '<button class="room-enter">' + act + '</button></div>';
    }).join("");
    var cards = box.querySelectorAll(".room-card");
    for (var i = 0; i < cards.length; i++) cards[i].addEventListener("click", function () {
      var r = rooms[this.getAttribute("data-id")]; if (r) enterRoom(r.id, r.game, r.name);
    });
    renderRoomStrip();
  }
  function renderRoomStrip() {
    var strip = $(gameUi(activeFamily()).roomStripId);
    if (!strip || !curRoomId) return;
    var list = Object.keys(rooms).map(function (k) { return rooms[k]; });
    if (!list.some(function (r) { return r.id === curRoomId; })) {
      list.push({ id: curRoomId, game: curRoomGame, name: curRoomTitle, ts: roomCreatedTs });
    }
    list.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    strip.innerHTML = list.map(function (r) {
      var cur = r.id === curRoomId;
      var gname = gameName(r.game);
      return '<button class="room-chip' + (cur ? ' current' : '') + '" data-id="' + esc(r.id) + '"' + (cur ? ' disabled' : '') + '>'
        + '<span class="rc-badge ' + r.game + '">' + gname + '</span>' + esc(r.name || "방") + '</button>';
    }).join("");
    var chips = strip.querySelectorAll(".room-chip:not(.current)");
    for (var i = 0; i < chips.length; i++) chips[i].addEventListener("click", function () { switchRoom(this.getAttribute("data-id")); });
  }
  function inActiveGame() {
    var so = netMode && isOmokFamily(curGame) && G.started && !G.over && (G.seats.black === me.nick || G.seats.white === me.nick);
    var sa = netMode && isAlkFamily(curGame) && A.started && !A.over && (A.seats.black === me.nick || A.seats.white === me.nick);
    var ctrl = activeController();
    return so || sa || !!(ctrl && ctrl.isBusy && ctrl.isBusy());
  }
  function switchRoom(id) {
    if (!id || id === curRoomId) return;
    var r = rooms[id]; if (!r) return;
    if (inActiveGame()) { toast("게임 중엔 다른 방으로 이동할 수 없어요"); return; }
    var wasAlone = !netMode || roster.length <= 1, wasHostHere = amHost, leavingId = curRoomId;
    if (wasHostHere && wasAlone && lobbyMode && leavingId) Net.sendLobby({ t: "room_close", id: leavingId });
    enterRoom(r.id, r.game, r.name);
  }
  function vacateSeatIfActive() {
    var seatedOmok = netMode && isOmokFamily(curGame) && G.started && !G.over && (G.seats.black === me.nick || G.seats.white === me.nick);
    var seatedAlk = netMode && isAlkFamily(curGame) && A.started && !A.over && (A.seats.black === me.nick || A.seats.white === me.nick);
    if (seatedOmok) requestSeat(me.nick, "spec");
    if (seatedAlk) requestAlkSeat(me.nick, "spec");
    return seatedOmok || seatedAlk;
  }
  // ---------- 방 입장/나가기 ----------
  function resetRoomGameState() {
    G.board = Renju.emptyBoard(); G.turn = BLACK; G.lastMove = null; G.over = false; G.winner = 0; G.draw = false;
    G.seats = { black: null, white: null }; G.moveDeadline = null; G.rev = 0; G.gameSeq = 0; G.history = [];
    G.recorded = false; G.started = false; G.lastPlayers = null; G.resultAt = null; G.resultInfo = null; G.winChatText = null; G.manualPaused = false; G.paused = false; G.pausedRemainMs = null;
    A.seats = { black: null, white: null }; A.turn = "b"; A.started = false; A.over = false; A.winner = null;
    A.seq = 0; A.gameSeq = 0; A.recorded = false; A.paused = false; A.winChatText = null; alkSolo = false; omokSolo = false; omokAI.on = false; aiPending = false;
    A.mode = "knockout"; A.remain = null; A.score = null;
    if (window.Alkkagi) Alkkagi.setMode("knockout");
    winShownSeq = -1; liveSeq = -1; omokWinChatSeq = -1; alkWinChatSeq = -1; prevNicks = []; firstPresenceAt = 0; clearAwayRoster();
    seatSoundArmed = false; prevSeats = { black: null, white: null }; lastRoomSoundAt = 0;
    clearAllGrace(); clearAlkGrace();
    if (window.Alkkagi) Alkkagi.setStones(Alkkagi.layout());
  }

  function refreshAppShell() {
    var now = Date.now(), last = 0, alreadyRequested = false;
    try {
      alreadyRequested = new URL(window.location.href).searchParams.get("app") === APP_BUILD;
      last = Number(sessionStorage.getItem(APP_REFRESH_KEY)) || 0;
      if (now - last >= 15000) sessionStorage.setItem(APP_REFRESH_KEY, String(now));
    } catch (e) {}
    if (alreadyRequested || now - last < 15000) {
      toast("화면 업데이트를 불러오지 못했어요. 브라우저를 새로고침해 주세요.", 5000);
      return;
    }
    toast("최신 게임 화면을 불러오는 중이에요", 1600);
    setTimeout(function () {
      try {
        var url = new URL(window.location.href);
        url.searchParams.set("app", APP_BUILD);
        window.location.replace(url.toString());
      } catch (e) {
        window.location.reload();
      }
    }, 250);
  }

  function roomEntryTarget(game) {
    var shell = document.querySelector('meta[name="app-build"]');
    var def = gameDef(game), family = gameFamily(game);
    var ui = gameUi(family), ctrl = gameController(game);
    if (!shell || shell.content !== APP_BUILD || !def || !$("lobby") || !ui || !ui.screenId || !$(ui.screenId) || (def.controller && !ctrl)) {
      refreshAppShell();
      return null;
    }
    return { family: family, ui: ui, controller: ctrl };
  }

  function rollbackRoomEntry(controller, error) {
    if (window.console && console.error) console.error("Room entry failed", error);
    try { if (controller && controller.leave) controller.leave(); } catch (e) {}
    try { if (window.Net && Net.leaveRoom) Net.leaveRoom(); } catch (e) {}
    netMode = false; hostNick = null; amHost = false; wasHost = false; connected = false;
    curRoomId = null; curRoomGame = null; curGame = null; curRoomTitle = "";
    document.body.classList.remove("is-host"); document.body.classList.remove("is-player");
    try { stopHostTimer(); clearAllGrace(); clearAlkGrace(); clearAwayRoster(); } catch (e) {}
    try { hideGameScreens(); } catch (e) {}
    if ($("lobby")) $("lobby").classList.remove("hidden");
    try {
      if (lobbyMode) { Net.trackLobby(myMetaObj(null)); Net.resyncLobby(); }
    } catch (e) {}
    try { renderRoomList(); } catch (e) {}
    toast("방 화면을 여는 중 오류가 났어요. 다시 시도해 주세요.", 4500);
  }

  function enterRoom(roomId, game, title) {
    var target;
    try { target = roomEntryTarget(game); }
    catch (error) {
      if (window.console && console.error) console.error("Room entry preflight failed", error);
      refreshAppShell();
      return false;
    }
    if (!target) return false;
    try {
      var previousController = activeController();
      if (previousController && previousController.leave) previousController.leave();
      curRoomId = roomId; curRoomGame = game; curGame = target.family; curRoomTitle = title || roomId;
      if (rooms[roomId] && rooms[roomId].ts) roomCreatedTs = rooms[roomId].ts;
      hostNick = null; amHost = false; wasHost = false; document.body.classList.remove("is-host"); stopHostTimer();
      resetRoomGameState(); resetRoomChat();
      if (game === "alk_terr" && window.Alkkagi) { A.mode = "territory"; Alkkagi.setMode("territory"); Alkkagi.setStones([]); }
      myJoinTs = Date.now();
      netMode = Net.init(roomId, myMetaObj(null),
        { onReady: onNetReady, onMessage: onMessage, onPresence: onPresence, onStatus: onStatus });
      if (lobbyMode) Net.trackLobby(myMetaObj(roomId));
      $("lobby").classList.add("hidden");
      hideGameScreens();
      if (isOmokFamily(curGame)) {
        $("game").classList.remove("hidden");
        if (!omokStarted) { omokStarted = true; startGameUI(); }
      } else if (isAlkFamily(curGame)) {
        $("alkgame").classList.remove("hidden");
        if (!alkStarted) { alkStarted = true; alkStartView(); }
      } else {
        $(target.ui.screenId).classList.remove("hidden");
      }
      if (!netMode) { amHost = true; document.body.classList.add("is-host"); setConn("local"); }
      var ctrl = target.controller;
      if (ctrl && ctrl.enter) ctrl.enter(controllerApi());
      renderPresenceUI(); renderRoomStrip();
      if (isOmokFamily(curGame)) { updateTurnUI(); render(); }
      else if (isAlkFamily(curGame)) renderAlkUI();
      else if (ctrl && ctrl.render) ctrl.render();
      return true;
    } catch (error) {
      rollbackRoomEntry(target.controller, error);
      return false;
    }
  }
  function createRoom(game, name) {
    var id = "rm" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36);
    roomCreatedTs = Date.now();
    enterRoom(id, game, (name && name.trim()) || (me.nick + "님의 방"));
  }
  function requestLeaveRoom() {
    var ctrl = activeController();
    if (ctrl && ctrl.isBusy && ctrl.isBusy()) {
      if ($("leaveroom-text")) $("leaveroom-text").innerHTML = "캐치마인드가 진행 중이에요.<br>나가면 이번 게임 점수는 더 이상 얻지 못해요.";
      if ($("leaveroom-yes")) $("leaveroom-yes").textContent = "게임에서 나가기";
      openModal("leaveroom-modal");
      return;
    }
    var inGame = (isOmokFamily(curGame) && G.started && !G.over && (G.seats.black === me.nick || G.seats.white === me.nick))
      || (isAlkFamily(curGame) && A.started && !A.over && (A.seats.black === me.nick || A.seats.white === me.nick));
    if (inGame) {
      if ($("leaveroom-text")) $("leaveroom-text").innerHTML = '게임 중이에요.<br><b class="red">기권</b>하고 나가시겠어요?';
      if ($("leaveroom-yes")) $("leaveroom-yes").textContent = "기권하고 나가기";
      openModal("leaveroom-modal"); return;
    }
    leaveRoomToLobby();
  }
  function leaveRoomToLobby() {
    var leavingController = activeController();
    if (leavingController && leavingController.leave) leavingController.leave();
    var forfeited = vacateSeatIfActive();
    var wasAlone = !netMode || roster.length <= 1, wasHostHere = amHost, leavingId = curRoomId;
    var delay = forfeited ? 220 : 0;
    setTimeout(function () {
      if (netMode && leavingId) Net.send({ t: "room_leave", nick: me.nick });
      setTimeout(function () {
        if (wasHostHere && wasAlone && lobbyMode && leavingId) Net.sendLobby({ t: "room_close", id: leavingId });
        Net.leaveRoom(); netMode = false; hostNick = null; amHost = false; wasHost = false;
        document.body.classList.remove("is-host"); document.body.classList.remove("is-player");
        stopHostTimer(); clearAllGrace(); clearAlkGrace(); clearAwayRoster();
        curRoomId = null; curGame = null;
        if (lobbyMode) { Net.trackLobby(myMetaObj(null)); Net.resyncLobby(); }
        hideGameScreens();
        $("lobby").classList.remove("hidden");
        renderRoomList();
      }, netMode ? 120 : 0);
    }, delay);
  }

  // ---------- 알까기 대전 ----------
  function alkStartView() {
    if (!window.Alkkagi) return;
    if (!alkInited) { alkInited = true; Alkkagi.init({ onFlick: onAlkFlick, canFlick: alkCanFlick, onHit: playHit, onPlace: onAlkPlace }); }
    if (A.mode !== "territory" && !Alkkagi.getStones().length) Alkkagi.setStones(Alkkagi.layout());
    Alkkagi.setMeta(A.turn, A.seats, A.started, A.over, A.winner);
    renderAlkUI();
  }
  var alkSolo = false;
  var alkWinSeq = -1;
  function alkCanFlick() {
    if (!A.started || A.over || A.paused || Alkkagi.isMoving()) return { ok: false };
    if (alkSolo) return { ok: true, color: A.turn };
    var col = A.seats.black === me.nick ? "b" : A.seats.white === me.nick ? "w" : null;
    if (!col || col !== A.turn) return { ok: false };
    return { ok: true, color: col };
  }
  function startAlkSolo() {
    if (netMode && roster.length > 1) { toast("혼자 연습은 방에 나 혼자 있을 때만 돼요"); return; }
    alkSolo = true;
    A.mode = "knockout"; A.remain = null; A.score = null;
    A.seats = { black: me.nick, white: me.nick };
    if (window.Alkkagi) Alkkagi.setMode("knockout");
    Alkkagi.setStones(Alkkagi.layout());
    clearAlkGrace();
    A.turn = "b"; A.started = true; A.over = false; A.winner = null; A.recorded = true; A.paused = false; A.winChatText = null;
    A.gameSeq++; A.seq++;
    Alkkagi.setMeta("b", A.seats, true, false, null);
    broadcastAlk(); renderAlkUI();
    toast("혼자 연습 — 흑·백 번갈아 튕겨보세요");
  }
  function territoryScoreOf(stones) {
    var sc = { b: 0, w: 0 };
    stones.forEach(function (s) { if (s.alive) { var p = Alkkagi.ringPoints(s.x, s.y); if (s.c === "b") sc.b += p; else sc.w += p; } });
    return sc;
  }
  function startTerritorySolo() {
    if (netMode && roster.length > 1) { toast("점령전 연습은 방에 나 혼자 있을 때만 돼요"); return; }
    alkSolo = true;
    A.mode = "territory"; A.remain = { b: 6, w: 6 }; A.score = { b: 0, w: 0 };
    A.seats = { black: me.nick, white: me.nick };
    clearAlkGrace();
    A.turn = "b"; A.started = true; A.over = false; A.winner = null; A.recorded = true; A.paused = false; A.winChatText = null;
    A.gameSeq++; A.seq++;
    Alkkagi.setMode("territory"); Alkkagi.setStones([]); Alkkagi.spawnActive("b");
    Alkkagi.setMeta("b", A.seats, true, false, null);
    broadcastAlk(); renderAlkUI();
    toast("점령전 연습 — 과녁 중심에 가깝게! 흑·백 6개씩");
  }
  function alkSnapshot() { return { seats: A.seats, turn: A.turn, started: A.started, over: A.over, winner: A.winner, winChatText: A.winChatText, paused: A.paused, seq: A.seq, gameSeq: A.gameSeq, mode: A.mode, remain: A.remain, score: A.score, stones: Alkkagi.getStones() }; }
  function broadcastAlk() { if (netMode) Net.send({ t: "alk_state", state: alkSnapshot() }); }
  function applyAlkState(s) {
    if (!s || (typeof s.seq === "number" && s.seq < A.seq)) return;
    if (window.Alkkagi && Alkkagi.isMoving()) return;
    A.seats = s.seats || { black: null, white: null }; A.turn = s.turn || "b";
    A.started = !!s.started; A.over = !!s.over; A.winner = s.winner || null; A.winChatText = s.winChatText || null; A.paused = !!s.paused;
    A.seq = s.seq || 0; A.gameSeq = s.gameSeq || 0;
    A.mode = s.mode || "knockout"; A.remain = s.remain || null; A.score = s.score || null;
    if (window.Alkkagi) { Alkkagi.setMode(A.mode); Alkkagi.setStones(s.stones || []); Alkkagi.setMeta(A.turn, A.seats, A.started, A.over, A.winner); }
    renderAlkUI();
  }
  function requestAlkSeat(nick, seat) { if (!netMode) { hostAlkSeat(nick, nick, seat); return; } Net.send({ t: "alk_seat", by: me.nick, nick: nick, seat: seat }); }
  function hostAlkSeat(by, nick, seat) {
    if (netMode && !amHost) return;
    var isAdmin = (by === ADMIN), self = (by === nick);
    if (!isAdmin && !self) return;
    if (seat === "black" || seat === "white") { var occ = A.seats[seat]; if (occ && occ !== nick && !isAdmin) return; }
    var oldSeats = { black: A.seats.black, white: A.seats.white };
    if (A.seats.black === nick) A.seats.black = null;
    if (A.seats.white === nick) A.seats.white = null;
    if (seat === "black") A.seats.black = nick; else if (seat === "white") A.seats.white = nick;
    if (A.started && !A.over && (!A.seats.black || !A.seats.white)) {
      var wonColor = A.seats.black ? "b" : (A.seats.white ? "w" : null);
      if (self && wonColor && oldSeats.black && oldSeats.white && oldSeats.black !== oldSeats.white) {
        A.over = true; A.started = false; A.winner = wonColor; A.recorded = true;
        if (window.Db && !alkSolo) Db.recordAlkGame(oldSeats.black, oldSeats.white, wonColor === "b" ? "black" : "white", (A.mode === "territory") ? "alk_terr" : "alk");
        var wn = wonColor === "b" ? oldSeats.black : oldSeats.white, ln = wonColor === "b" ? oldSeats.white : oldSeats.black;
        Net.send({ t: "chat", nick: "__sys", text: ln + "님이 나가서 " + wn + "님 승리 (기권)" });
        setTimeout(refreshScores, 800);
      } else { A.started = false; A.over = false; A.winner = null; }
    }
    A.seq++;
    Alkkagi.setMeta(A.turn, A.seats, A.started, A.over, A.winner);
    broadcastAlk(); renderAlkUI();
  }
  function onAlkChipTap(seat) {
    var mine = (A.seats[seat] === me.nick);
    if (mine && A.started && !A.over && netMode) { if (!confirm("대국 중 자리에서 나가면 패배로 처리돼요. 나가시겠어요?")) return; }
    requestAlkSeat(me.nick, mine ? "spec" : seat);
  }
  function requestAlkBegin() {
    if (!netMode) { alkBegin(me.nick); return; }
    if (sendBeginRequest("alk")) return;
    Net.send({ t: "alk_begin", by: me.nick });
  }
  function alkBegin(by) {
    if (netMode && !amHost) return;
    if (!(A.seats.black && A.seats.white)) { if (by === me.nick) toast("흑·백 두 자리가 다 차야 시작해요"); return; }
    if (netMode && by !== A.seats.black && by !== A.seats.white && by !== ADMIN) return;
    var rematch = A.over;
    alkSolo = false;
    if (curRoomGame === "alk_terr" && rematch && A.seats.black !== A.seats.white) {
      var swap = A.seats.black; A.seats.black = A.seats.white; A.seats.white = swap;
    }
    if (curRoomGame === "alk_terr") {
      A.mode = "territory"; A.remain = { b: 6, w: 6 }; A.score = { b: 0, w: 0 };
      Alkkagi.setMode("territory"); Alkkagi.setStones([]); Alkkagi.spawnActive("b");
    } else {
      A.mode = "knockout"; A.remain = null; A.score = null;
      Alkkagi.setMode("knockout"); Alkkagi.setStones(Alkkagi.layout());
    }
    clearAlkGrace();
    A.turn = "b"; A.started = true; A.over = false; A.winner = null; A.winChatText = null; A.recorded = false; A.paused = false; A.gameSeq++; A.seq++;
    beginReqCtx = null; $("begin-modal").classList.add("hidden");
    Alkkagi.setMeta("b", A.seats, true, false, null);
    broadcastAlk(); renderAlkUI();
  }
  function onAlkPlace(x) {
    if (!netMode || A.mode !== "territory") return;
    Net.send({ t: "alk_place", nick: me.nick, x: x });
  }
  function onAlkFlick(idx, vx, vy) {
    if (!A.started || A.over) return;
    var px = null;
    if (A.mode === "territory") { var s0 = Alkkagi.getStones()[idx]; if (s0) px = s0.x; }
    if (!netMode) { hostAlkFlick(me.nick, idx, vx, vy, px); return; }
    Net.send({ t: "alk_flick", nick: me.nick, idx: idx, vx: vx, vy: vy, px: px });
  }
  function hostAlkFlick(nick, idx, vx, vy, px) {
    if (netMode && !amHost) return;
    if (!A.started || A.over || Alkkagi.isMoving()) return;
    var seatNick = A.turn === "b" ? A.seats.black : A.seats.white;
    if (seatNick !== nick) return;
    if (A.mode === "territory" && px != null) Alkkagi.placeActive(px);
    var st = Alkkagi.getStones()[idx];
    if (!st || !st.alive || st.c !== A.turn) return;
    var sim = Alkkagi.simulate(idx, vx, vy);
    var fin;
    if (A.mode === "territory") {
      if (st.active !== true) return;
      var played = sim.stones.map(function (s) { return { x: s.x, y: s.y, c: s.c, alive: s.alive, active: false }; });
      var newRemain = { b: A.remain.b, w: A.remain.w };
      newRemain[A.turn]--;
      var tover = (newRemain.b === 0 && newRemain.w === 0);
      var sc = territoryScoreOf(played);
      fin = {
        territory: true, stones: played,
        turn: tover ? A.turn : (A.turn === "b" ? "w" : "b"),
        over: tover, winner: tover ? (sc.b + TERR_KOMI > sc.w ? "b" : "w") : null,
        remain: newRemain, score: sc, seq: ++A.seq
      };
    } else {
      var over = (sim.bAlive === 0 || sim.wAlive === 0);
      fin = {
        stones: sim.stones,
        turn: over ? A.turn : (A.turn === "b" ? "w" : "b"),
        over: over, winner: over ? (sim.bAlive > 0 ? "b" : sim.wAlive > 0 ? "w" : "draw") : null,
        seq: ++A.seq
      };
    }
    if (fin.over && fin.winner && fin.winner !== "draw") fin.winChatText = alkWinChatText(fin.winner);
    if (netMode) Net.send({ t: "alk_move", idx: idx, vx: vx, vy: vy, fin: fin });
    else onAlkMove(idx, vx, vy, fin);
  }
  var alkMoveQueue = [];
  function onAlkMove(idx, vx, vy, fin) {
    if (window.Alkkagi && Alkkagi.isMoving()) { alkMoveQueue.push([idx, vx, vy, fin]); return; }
    Alkkagi.runFlick(idx, vx, vy, function () {
      if (fin) {
        A.turn = fin.turn; A.over = fin.over; A.winner = fin.winner; A.winChatText = fin.winChatText || null; A.started = !fin.over;
        if (fin.seq) A.seq = Math.max(A.seq, fin.seq);
        Alkkagi.setStones(fin.stones);
        if (fin.territory) {
          A.remain = fin.remain; A.score = fin.score;
          if (!fin.over) Alkkagi.spawnActive(fin.turn);
        }
        Alkkagi.setMeta(A.turn, A.seats, A.started, A.over, A.winner);
        if (fin.over && (amHost || !netMode) && !alkSolo) recordAlkResult();
        if (fin.over) setTimeout(refreshScores, 800);
      }
      renderAlkUI();
      if (alkMoveQueue.length) { var n = alkMoveQueue.shift(); onAlkMove(n[0], n[1], n[2], n[3]); }
    });
  }
  function recordAlkResult() {
    if (A.recorded) return;
    if (!netMode || !amHost) return;
    var b = A.seats.black, w = A.seats.white;
    if (!b || !w || b === w || !A.over || !A.winner) return;
    A.recorded = true;
    var winner = A.winner === "draw" ? "draw" : (A.winner === "b" ? "black" : "white");
    var gameType = (A.mode === "territory") ? "alk_terr" : "alk";
    if (window.Db) Db.recordAlkGame(b, w, winner, gameType).then(function () { Net.sendLobby({ t: "scores", game: gameType }); }).catch(function () {});
  }
  function clearAlkGrace() { ["black", "white"].forEach(function (c) { if (alkGrace[c]) { clearTimeout(alkGrace[c].id); alkGrace[c] = null; } }); }
  function hostReconcileAlkSeats() {
    if (!amHost) return;
    var active = A.started && !A.over;
    var changed = false;
    ["black", "white"].forEach(function (col) {
      var occ = A.seats[col];
      var missing = occ && !rosterHas(occ);
      if (missing && active) {
        if (!alkGrace[col]) alkGrace[col] = { nick: occ, id: setTimeout(function () { onAlkGraceExpire(col); }, GRACE_MS) };
      } else {
        if (alkGrace[col]) { clearTimeout(alkGrace[col].id); alkGrace[col] = null; }
        if (missing && !active) { A.seats[col] = null; changed = true; }
      }
    });
    var shouldPause = !!(alkGrace.black || alkGrace.white);
    if (shouldPause !== A.paused) { A.paused = shouldPause; changed = true; }
    if (changed) { A.seq++; if (window.Alkkagi) Alkkagi.setMeta(A.turn, A.seats, A.started, A.over, A.winner); broadcastAlk(); }
    renderAlkUI();
  }
  function onAlkGraceExpire(col) {
    if (!amHost) { alkGrace[col] = null; return; }
    alkGrace[col] = null;
    if (A.seats[col] && !rosterHas(A.seats[col])) { A.seats[col] = null; A.started = false; A.over = false; A.winner = null; }
    A.paused = !!(alkGrace.black || alkGrace.white);
    A.seq++;
    if (window.Alkkagi) Alkkagi.setMeta(A.turn, A.seats, A.started, A.over, A.winner);
    broadcastAlk(); renderAlkUI();
  }
  function renderAlkUI() {
    if (!$("alk-cntB")) return;
    var nb = $("alk-name-black"), nw = $("alk-name-white");
    var scKey = (curRoomGame === "alk_terr") ? "alk_terr" : "alk";
    if (nb) nb.innerHTML = chipNameHtml(A.seats.black, scKey);
    if (nw) nw.innerHTML = chipNameHtml(A.seats.white, scKey);
    var terr = (A.mode === "territory");
    if (window.Alkkagi) Alkkagi.setKomi(terr ? TERR_KOMI : 0);
    if (terr && A.remain) { $("alk-cntB").textContent = A.remain.b; $("alk-cntW").textContent = A.remain.w; }
    else { $("alk-cntB").textContent = window.Alkkagi ? Alkkagi.aliveCount("b") : 5; $("alk-cntW").textContent = window.Alkkagi ? Alkkagi.aliveCount("w") : 5; }
    $("alk-chipB").classList.toggle("active", A.turn === "b" && A.started && !A.over);
    $("alk-chipW").classList.toggle("active", A.turn === "w" && A.started && !A.over);
    var cb = $("alk-center-btn"), sb = $("alk-swap-btn");
    var alkSeatedMe = (!netMode || A.seats.black === me.nick || A.seats.white === me.nick || me.isAdmin);
    var alkISit = (A.seats.black === me.nick || A.seats.white === me.nick);
    var alkBoth = A.seats.black && A.seats.white;
    var alkCanSwap = !!(netMode && !A.started && !A.over && alkBoth && alkISit);
    if (cb) {
      if (!A.started && !A.over && alkBoth && alkSeatedMe) { cb.textContent = "대국 신청"; cb.dataset.act = "begin"; cb.classList.remove("hidden"); }
      else if (!A.started && !A.over && alkISit && !alkBoth) { cb.textContent = "연습하기"; cb.dataset.act = "solo"; cb.classList.remove("hidden"); }
      else cb.classList.add("hidden");
    }
    if (sb) sb.classList.toggle("hidden", !alkCanSwap);
    var sc = terr ? (A.score || { b: 0, w: 0 }) : null;
    var wf = $("alk-win");
    if (wf) {
      if (A.over) {
        var awn = A.winner === "b" ? A.seats.black : A.seats.white;
        $("alk-wintext").textContent = terr ? terrResultPlain(sc) : (A.winner === "draw" ? "무승부!" : (awn ? awn + "님 승리!" : (A.winner === "b" ? "흑" : "백") + " 승리!"));
        showWinChatOnce("alk", A.gameSeq, A.winChatText);
        wf.classList.remove("hidden");
        if (alkWinSeq !== A.gameSeq) { alkWinSeq = A.gameSeq; if (A.winner && A.winner !== "draw") playSample(winBuffer); }
      } else { wf.classList.add("hidden"); alkWinSeq = -1; alkWinChatSeq = -1; }
    }
  }
  function terrResultPlain(sc) {
    var wn = A.winner === "b" ? A.seats.black : A.seats.white;
    var head = wn ? (wn + "님 승리!") : ((A.winner === "b" ? "흑" : "백") + " 승리!");
    return head + " (흑 " + sc.b + "+" + TERR_KOMI + " : 백 " + sc.w + ")";
  }

  function startGameUI() {
    liveSeq = -1;
    seatSoundArmed = false; prevSeats = { black: null, white: null }; lastRoomSoundAt = 0;
    oldestChatTs = null; loadingOlder = false; noMoreChat = false;
    layoutBoard();
    if (!netMode) {
      amHost = true;
      document.body.classList.add("is-host");
      G.seats.black = me.nick; G.seats.white = me.nick;
      beginGame(me.nick);
    }
    startDisplayTimer();
    render();
    updateTurnUI();
  }

  function onStatus(s) {
    if (s === "SUBSCRIBED") { connected = true; setConn("online"); }
    else if (s === "LOCAL") setConn("local");
    else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") { connected = false; setConn("off"); }
    else setConn("connecting");
  }
  function setConn(s) {
    var d = $("conn-dot"); if (!d) return;
    d.className = "conn-dot " + s;
    d.title = s === "online" ? "실시간 연결됨" : s === "local" ? "혼자 연습" : s === "off" ? "연결 끊김" : "연결 중…";
  }
  function onNetReady() {
    var ctrl = activeController();
    if (ctrl && ctrl.onReady) ctrl.onReady();
    else Net.send({ t: "hello", nick: me.nick });
    loadChatHistory(); refreshScores();
  }
  function roomName() { return (window.OMOK_CONFIG && window.OMOK_CONFIG.ROOM) || "main"; }
  function loadChatHistory() {
    if (!window.Db || !curRoomId) return;
    var g = activeFamily();
    var panel = gameUi(g).chatLogId;
    Db.getChatHistory(chatRoomOf(curGame), 200).then(function (msgs) {
      if (msgs.length) oldestChatTs = msgs[0].created_at;
      if (msgs.length < 200) noMoreChat = true;
      var log = $(panel); if (!log) return;
      log.innerHTML = "";
      var histCount = {};
      msgs.forEach(function (m) {
        log.appendChild(makeChatLine(m.nick, m.text));
        var k = m.nick + "" + m.text; histCount[k] = (histCount[k] || 0) + 1;
      });
      sessionChat.forEach(function (sc) {
        if (sc.game !== g) return;
        var k = sc.who + "" + sc.text;
        if (histCount[k] > 0) { histCount[k]--; return; }
        log.appendChild(makeChatLine(sc.who, sc.text));
      });
      log.scrollTop = log.scrollHeight;
    });
  }
  function loadLobbyChat() {
    if (!window.Db) return;
    var log = $("lobby-chat-log"); if (!log) return;
    Db.getChatHistory(roomName(), 200).then(function (msgs) {
      log.innerHTML = "";
      msgs.forEach(function (m) { log.appendChild(makeChatLine(m.nick, m.text)); });
      log.scrollTop = log.scrollHeight;
    });
  }
  function addLobbyChat(who, text) {
    var log = $("lobby-chat-log"); if (!log) return;
    log.appendChild(makeChatLine(who, text)); log.scrollTop = log.scrollHeight;
  }
  function sendLobbyChat() {
    var inp = $("lobby-chat-input"); if (!inp) return;
    var v = inp.value.trim().slice(0, 80); if (!v) return;
    if (lobbyMode) { Net.sendLobby({ t: "chat", nick: me.nick, text: v }); if (window.Db) Db.addChatMsg(roomName(), me.nick, v); }
    addLobbyChat(me.nick, v);
    inp.value = "";
  }
  function resetRoomChat() {
    var seen = {};
    (window.GameCatalog ? GameCatalog.families() : ["omok", "alk"]).forEach(function (family) {
      var id = gameUi(family).chatLogId;
      if (!id || seen[id]) return;
      seen[id] = true;
      var log = $(id); if (log) log.innerHTML = "";
    });
    oldestChatTs = null; loadingOlder = false; noMoreChat = false;
    sessionChat = [];
  }
  function loadOlderChat() {
    if (loadingOlder || noMoreChat || !oldestChatTs || !window.Db) return;
    loadingOlder = true;
    var log = $(gameUi(activeFamily()).chatLogId); if (!log) { loadingOlder = false; return; }
    Db.getChatHistoryBefore(chatRoomOf(curGame), oldestChatTs, 100).then(function (older) {
      if (!older.length) { noMoreChat = true; loadingOlder = false; return; }
      if (older.length < 100) noMoreChat = true;
      var prevH = log.scrollHeight, prevTop = log.scrollTop;
      var frag = document.createDocumentFragment();
      older.forEach(function (m) { frag.appendChild(makeChatLine(m.nick, m.text)); });
      log.insertBefore(frag, log.firstChild);
      oldestChatTs = older[0].created_at;
      log.scrollTop = prevTop + (log.scrollHeight - prevH);
      loadingOlder = false;
    }).catch(function () { loadingOlder = false; });
  }

  // ---------- 방장 선출 ----------
  function electHost(list) {
    if (!list.length) return null;
    var pool = list.slice().sort(function (a, b) {
      if (a.joinTs !== b.joinTs) return a.joinTs - b.joinTs;
      return a.nick < b.nick ? -1 : 1;
    });
    return pool[0].nick;
  }

  function announceRoomLeave(nick) {
    if (!nick || !firstPresenceAt || Date.now() - firstPresenceAt <= 1500) return;
    playRoomLeave();
    addSysBoth(nick + "님이 나갔어요");
  }
  function findDisplayMember(nick) {
    for (var i = 0; i < displayRoster.length; i++) if (displayRoster[i].nick === nick) return displayRoster[i];
    for (var j = 0; j < roster.length; j++) if (roster[j].nick === nick) return roster[j];
    return null;
  }
  function pruneExplicitLeaves() {
    var now = Date.now();
    Object.keys(explicitLeaves).forEach(function (nick) {
      if (explicitLeaves[nick] <= now) delete explicitLeaves[nick];
    });
  }
  function buildDisplayRoster() {
    pruneExplicitLeaves();
    var seen = {}, out = [];
    roster.forEach(function (m) {
      if (!m || !m.nick || explicitLeaves[m.nick]) return;
      seen[m.nick] = true;
      out.push(m);
    });
    Object.keys(awayMembers).forEach(function (nick) {
      if (seen[nick] || explicitLeaves[nick]) return;
      out.push(awayMembers[nick]);
    });
    displayRoster = out;
  }
  function clearAwayRoster() {
    Object.keys(awayTimers).forEach(function (nick) { clearTimeout(awayTimers[nick]); });
    displayRoster = []; awayMembers = {}; awayTimers = {}; explicitLeaves = {};
  }
  function expireAway(nick) {
    if (!awayMembers[nick] || rosterHas(nick)) return;
    clearTimeout(awayTimers[nick]); delete awayTimers[nick]; delete awayMembers[nick];
    buildDisplayRoster();
    announceRoomLeave(nick);
    renderPresenceUI();
    renderPlayersList();
    if (amHost && curRoomId) broadcastRoomOpen();
  }
  function markAway(nick) {
    if (!nick || explicitLeaves[nick] || awayMembers[nick]) return;
    var meta = findDisplayMember(nick) || { nick: nick, joinTs: Date.now() };
    awayMembers[nick] = Object.assign({}, meta, { away: true, awayUntil: Date.now() + GRACE_MS });
    awayTimers[nick] = setTimeout(function () { expireAway(nick); }, GRACE_MS);
  }
  function completeExplicitLeave(nick) {
    if (!nick) return;
    var wasShown = !!findDisplayMember(nick);
    explicitLeaves[nick] = Date.now() + 5000;
    if (awayTimers[nick]) { clearTimeout(awayTimers[nick]); delete awayTimers[nick]; }
    delete awayMembers[nick];
    buildDisplayRoster();
    if (wasShown) announceRoomLeave(nick);
    renderPresenceUI();
    renderPlayersList();
    if (amHost && curRoomId) broadcastRoomOpen();
  }

  function onPresence(list) {
    pruneExplicitLeaves();
    var shownBefore = {};
    displayRoster.forEach(function (m) { if (m && m.nick) shownBefore[m.nick] = true; });
    Object.keys(awayMembers).forEach(function (nick) { shownBefore[nick] = true; });
    roster = (list || []).filter(function (m) { return m && m.nick && !explicitLeaves[m.nick]; });
    var nicks = roster.map(function (m) { return m.nick; });
    if (!firstPresenceAt) firstPresenceAt = Date.now();
    if (Date.now() - firstPresenceAt > 1500) {
      var joined = nicks.filter(function (n) { return !shownBefore[n]; });
      var left = prevNicks.filter(function (n) { return nicks.indexOf(n) < 0; });
      if (joined.length) playRoomEnter();
      joined.forEach(function (n) { addSysBoth(n + "님이 입장했어요"); });
      left.forEach(markAway);
    }
    nicks.forEach(function (n) {
      if (awayTimers[n]) { clearTimeout(awayTimers[n]); delete awayTimers[n]; }
      delete awayMembers[n];
    });
    buildDisplayRoster();
    prevNicks = nicks;
    hostNick = electHost(roster);
    amHost = (hostNick === me.nick);
    var becameHost = amHost && !wasHost;
    wasHost = amHost;
    document.body.classList.toggle("is-host", amHost);
    var ctrl = activeController();
    if (amHost) {
      if (isOmokFamily(curGame)) {
        if (becameHost && G.started && !G.over && !G.paused && G.timerSec &&
            (!G.moveDeadline || G.moveDeadline <= Date.now())) {
          G.moveDeadline = Date.now() + G.timerSec * 1000;
          G.rev++;
        }
        hostReconcileSeats();
        startHostTimer();
      } else if (isAlkFamily(curGame)) {
        hostReconcileAlkSeats();
        stopHostTimer();
      } else {
        stopHostTimer();
      }
    } else {
      clearAllGrace();
      clearAlkGrace();
      stopHostTimer();
    }
    if (ctrl && ctrl.onPresence) ctrl.onPresence(displayRoster.slice(), { becameHost: becameHost });
    renderPlayersList();
    if (isOmokFamily(curGame)) { updateTurnUI(); render(); updateCenterButton(); }
    else if (isAlkFamily(curGame)) renderAlkUI();
    else if (ctrl && ctrl.render) ctrl.render();
    if (amHost && curRoomId) broadcastRoomOpen();
  }
  function rosterHas(nick) { if (omokAI.on && nick === AI_NICK) return true; return roster.some(function (m) { return m.nick === nick; }); }

  function clearAllGrace() {
    ["black", "white"].forEach(function (col) {
      if (graceTimers[col]) { clearTimeout(graceTimers[col].id); graceTimers[col] = null; }
    });
  }
  function hostReconcileSeats() {
    if (!amHost) return;
    var activeGame = G.started && !G.over;
    ["black", "white"].forEach(function (col) {
      var occ = G.seats[col];
      var missing = occ && !rosterHas(occ);
      if (missing && activeGame) {
        if (!graceTimers[col]) {
          graceTimers[col] = { nick: occ, id: setTimeout(function () { onGraceExpire(col); }, GRACE_MS) };
          Net.send({ t: "chat", nick: "__sys", text: occ + "님 연결이 끊겼어요 — 재접속을 기다려요" });
        }
      } else if (graceTimers[col]) {
        var backNick = graceTimers[col].nick;
        clearTimeout(graceTimers[col].id); graceTimers[col] = null;
        if (!missing) Net.send({ t: "chat", nick: "__sys", text: backNick + "님이 재접속했어요 — 대국을 이어가요" });
      }
    });
    if (!activeGame) {
      var oldSeats = { black: G.seats.black, white: G.seats.white };
      if (G.seats.black && !rosterHas(G.seats.black)) G.seats.black = null;
      if (G.seats.white && !rosterHas(G.seats.white)) G.seats.white = null;
      if (G.seats.black !== oldSeats.black || G.seats.white !== oldSeats.white) {
        applyPause(); hostAfterSeatChange(oldSeats, "leave"); return;
      }
    }
    applyPause();
    broadcastState();
    renderPlayersList(); updateTurnUI(); render(); updateCenterButton();
  }
  function applyPause() {
    var shouldPause = (G.manualPaused || !!(graceTimers.black || graceTimers.white)) && G.started && !G.over;
    if (shouldPause && !G.paused) {
      G.pausedRemainMs = G.moveDeadline ? Math.max(0, G.moveDeadline - Date.now()) : null;
      G.moveDeadline = null;
      G.paused = true;
      G.rev++;
    } else if (!shouldPause && G.paused) {
      G.paused = false;
      G.moveDeadline = (G.pausedRemainMs != null) ? (Date.now() + G.pausedRemainMs)
                       : (G.timerSec ? Date.now() + G.timerSec * 1000 : null);
      G.pausedRemainMs = null;
      G.rev++;
    }
    syncPauseButton();
  }
  function onGraceExpire(col) {
    if (!amHost) { graceTimers[col] = null; return; }
    graceTimers[col] = null;
    if (!(G.started && !G.over)) { applyPause(); broadcastState(); return; }
    if (G.seats[col] && !rosterHas(G.seats[col])) {
      var other = col === "black" ? "white" : "black";
      var otherGone = G.seats[other] && !rosterHas(G.seats[other]);
      clearAllGrace();
      var oldSeats = { black: G.seats.black, white: G.seats.white };
      G.seats[col] = null;
      if (otherGone) G.seats[other] = null;
      G.manualPaused = false; G.paused = false; G.pausedRemainMs = null;
      hostAfterSeatChange(oldSeats, "leave");
    } else {
      applyPause(); broadcastState();
    }
  }

  // ---------- 메시지 ----------
  function onMessage(msg) {
    if (!msg || !msg.t) return;
    var ctrl = activeController();
    if (ctrl && ctrl.onMessage && ctrl.onMessage(msg)) return;
    switch (msg.t) {
      case "state": applyState(msg.state); break;
      case "hello":
        if (msg.nick !== me.nick) {
          if (amHost || G.rev > 0) broadcastState();
          if (amHost || A.seq > 0) broadcastAlk();
        }
        break;
      case "room_leave": if (msg.nick !== me.nick) completeExplicitLeave(msg.nick); break;
      case "resign": if (amHost) hostResign(msg.by || msg.nick, msg.nick); break;
      case "alk_state": applyAlkState(msg.state); break;
      case "alk_seat": if (amHost) hostAlkSeat(msg.by, msg.nick, msg.seat); break;
      case "alk_begin_req": if (msg.to === me.nick) showBeginModal("alk", msg.from, msg.gseq); break;
      case "alk_begin_res": onBeginResponse("alk", msg); break;
      case "alk_swap_req": if (msg.to === me.nick) showSwapModal("alk", msg.from, msg.gseq); break;
      case "alk_swap_res": onSwapResponse("alk", msg); break;
      case "alk_begin": if (amHost) alkBegin(msg.by); break;
      case "alk_place": if (msg.nick !== me.nick && window.Alkkagi && A.mode === "territory") { Alkkagi.placeActive(msg.x); renderAlkUI(); } break;
      case "alk_flick": if (amHost) hostAlkFlick(msg.nick, msg.idx, msg.vx, msg.vy, msg.px); break;
      case "alk_move": onAlkMove(msg.idx, msg.vx, msg.vy, msg.fin); break;
      case "move": if (amHost) hostApplyMove(msg.nick, msg.r, msg.c); break;
      case "begin_req": if (msg.to === me.nick) showBeginModal("omok", msg.from, msg.gseq); break;
      case "begin_res": onBeginResponse("omok", msg); break;
      case "swap_req": if (msg.to === me.nick) showSwapModal("omok", msg.from, msg.gseq); break;
      case "swap_res": onSwapResponse("omok", msg); break;
      case "begin": if (amHost && !G.started && (msg.gseq == null || msg.gseq === G.gameSeq)) beginGame(msg.by); break;
      case "seat": if (amHost) hostApplySeat(msg.by, msg.nick, msg.seat); break;
      case "set_timer": if (amHost && (msg.by === ADMIN || msg.by === hostNick)) setTimer(msg.sec); break;
      case "toggle_pause": if (amHost && (msg.by === ADMIN || msg.by === hostNick)) setManualPause(!!msg.paused); break;
      case "chat": if (msg.nick !== me.nick) addChatTo(gameFamily(msg.game || "omok"), msg.nick, msg.text, true); break;
      case "undo_req": if (msg.to === me.nick) showUndoModal(msg.from, msg.gseq, msg.hlen); break;
      case "undo_res":
        $("undo-modal").classList.add("hidden");
        if (msg.accept) {
          if (amHost) {
            if (!G.over && msg.gseq === G.gameSeq && G.history.length === msg.hlen) { performUndo(); }
            else { Net.send({ t: "chat", nick: "__sys", text: "상황이 바뀌어 무르기를 적용하지 못했어요" }); }
          }
          toast("한 수 되돌렸어요");
        } else { toast("무르기를 거절했어요"); }
        break;
      case "void_req": if (msg.to === me.nick) showVoidModal(msg.from, msg.gseq); break;
      case "void_res":
        $("void-modal").classList.add("hidden");
        if (msg.accept) { if (amHost && !G.over && msg.gseq === G.gameSeq) hostVoidGame(msg.from); toast("대국을 무효 처리했어요"); }
        else if (msg.from === me.nick) { toast("상대가 무효를 거절했어요"); $("leave-modal").classList.remove("hidden"); }
        break;
      case "drawask_res": if (amHost) hostDrawAskResponse(msg.nick, msg.accept, msg.gseq); break;
      case "draw_req": if (msg.to === me.nick) showDrawModal(msg.from, msg.gseq); break;
      case "draw_res":
        $("draw-modal").classList.add("hidden");
        if (msg.accept) { if (amHost && !G.over && msg.gseq === G.gameSeq) hostDrawGame(); toast("무승부로 대국을 마쳤어요"); }
        else if (msg.from === me.nick) toast("상대가 무승부를 거절했어요");
        break;
    }
  }

  function snapshot() {
    return {
      board: G.board, turn: G.turn, lastMove: G.lastMove, over: G.over, winner: G.winner, draw: G.draw,
      seats: G.seats, timerSec: G.timerSec, moveDeadline: G.moveDeadline,
      moveRemainMs: G.moveDeadline ? Math.max(0, G.moveDeadline - Date.now()) : null,
      rev: G.rev, gameSeq: G.gameSeq, history: G.history,
      started: G.started, lastPlayers: G.lastPlayers, resultAt: G.resultAt, resultInfo: G.resultInfo, winChatText: G.winChatText, manualPaused: G.manualPaused, paused: G.paused, pausedRemainMs: G.pausedRemainMs,
      drawAsk: G.drawAsk, drawAskDone: G.drawAskDone
    };
  }
  function broadcastState() { if (netMode) Net.send({ t: "state", state: snapshot() }); }
  function applyState(s) {
    if (!s || (typeof s.rev === "number" && s.rev < G.rev)) return;
    G.board = s.board; G.turn = s.turn; G.lastMove = s.lastMove;
    G.over = s.over; G.winner = s.winner; G.draw = !!s.draw; G.seats = s.seats;
    G.timerSec = s.timerSec;
    G.moveDeadline = (typeof s.moveRemainMs === "number") ? (Date.now() + s.moveRemainMs) : s.moveDeadline;
    G.rev = s.rev || 0; G.gameSeq = s.gameSeq || 0;
    G.history = s.history || [];
    G.started = !!s.started; G.lastPlayers = s.lastPlayers || null; G.resultAt = s.resultAt || null; G.resultInfo = s.resultInfo || null; G.winChatText = s.winChatText || null;
    G.manualPaused = !!s.manualPaused;
    G.paused = !!s.paused; G.pausedRemainMs = (typeof s.pausedRemainMs === "number") ? s.pausedRemainMs : null;
    G.drawAsk = s.drawAsk || null; G.drawAskDone = !!s.drawAskDone;
    maybeSeatSound();
    syncTimerChips(); syncPauseButton(); updateTurnUI(); renderPlayersList(); render(); updateCenterButton(); updateDrawAskUI();
    if (G.over) {
      if (liveSeq === G.gameSeq && winShownSeq !== G.gameSeq) showWin();
      else { renderWinResult(); showWinChatOnce("omok", G.gameSeq, G.winChatText); }
    } else {
      liveSeq = G.gameSeq;
      winShownSeq = -1; resultCalcSeq = -1; omokWinChatSeq = -1; $("omok-win").classList.add("hidden");
    }
  }

  // ---------- 착수 ----------
  function myMoveAllowed() {
    if (G.over) return false;
    return G.seats[colorName(G.turn)] === me.nick;
  }
  function submitMove(r, c) {
    if (G.over || !G.started) return;
    if (G.paused) { toast(G.manualPaused ? "일시정지 중이에요" : "상대 재접속을 기다리는 중이에요"); return; }
    if (netMode) {
      if (!myMoveAllowed()) {
        var mine = (G.seats.black === me.nick || G.seats.white === me.nick);
        toast(mine ? "지금은 상대 차례예요" : "관전 중이에요");
        return;
      }
      Net.send({ t: "move", nick: me.nick, r: r, c: c });
    } else {
      hostApplyMove(me.nick, r, c);
    }
  }

  function boardFull() {
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (G.board[r][c] === 0) return false;
    return true;
  }

  function hostApplyMove(nick, r, c) {
    if (G.over || !G.started || G.paused) return;
    if (netMode && G.seats[colorName(G.turn)] !== nick) return;
    var res = Renju.checkMove(G.board, r, c, G.turn);
    if (!res.legal) { if (nick === me.nick) toast(reasonText(res.reason)); return; }
    G.board[r][c] = G.turn;
    G.lastMove = { r: r, c: c };
    if (!G.history) G.history = [];
    G.history.push({ r: r, c: c, color: G.turn });
    if (res.win) { G.over = true; G.winner = G.turn; G.draw = false; announceOmokWinChat(); endGame(); return; }
    if (boardFull()) { G.over = true; G.winner = 0; G.draw = true; endGame(); return; }
    if (!G.drawAskDone && !G.drawAsk && isRealTwoPlayerGame() && G.history.length >= DRAW_ASK_MOVES) {
      G.drawAsk = { gseq: G.gameSeq, black: null, white: null };
    }
    G.turn = (G.turn === BLACK) ? WHITE : BLACK;
    G.moveDeadline = G.timerSec ? Date.now() + G.timerSec * 1000 : null;
    G.rev++;
    broadcastState(); updateTurnUI(); render();
    aiTick();
  }

  function endGame() {
    G.started = false;
    G.resultAt = new Date().toISOString();
    G.resultInfo = null;
    G.manualPaused = false; G.paused = false; G.pausedRemainMs = null; clearAllGrace();
    G.rev++;
    stopHostTimer();
    broadcastState();
    recordResult();
    updateTurnUI(); render(); showWin(); updateCenterButton();
  }

  function recordResult() {
    if (G.recorded) return;
    if (!netMode || !amHost) return;
    var b = G.seats.black, w = G.seats.white;
    if (!b || !w || b === w) return;
    if (b === AI_NICK || w === AI_NICK) return;
    G.recorded = true;
    var winner = G.draw ? "draw" : (G.winner === BLACK ? "black" : "white");
    if (window.Db) Db.recordGame(b, w, winner, G.history).then(function () { Net.sendLobby({ t: "scores", game: "omok" }); }).catch(function () {});
  }

  // ---------- 무르기 ----------
  var undoCooldownUntil = 0;
  function startUndoCooldown() {
    undoCooldownUntil = Date.now() + REQUEST_COOLDOWN_MS;
    var b = $("undo-btn"); if (!b) return;
    b.disabled = true; b.classList.add("cooldown");
    setTimeout(function () { b.disabled = false; b.classList.remove("cooldown"); }, REQUEST_COOLDOWN_MS);
  }
  function sendUndoRequest() {
    if (G.over) { toast("대국이 끝났어요"); return; }
    if (!G.history || !G.history.length) { toast("무를 수가 없어요"); return; }
    if (Date.now() < undoCooldownUntil) { toast("무르기는 10초 뒤에 다시 쓸 수 있어요"); return; }
    if (!netMode) { performUndo(); startUndoCooldown(); return; }
    if (G.seats.black === AI_NICK || G.seats.white === AI_NICK) {
      aiPending = false;
      if (G.history && G.history.length) performUndo();
      if (!G.over && colorName(G.turn) === "white" && G.history && G.history.length) performUndo();
      startUndoCooldown();
      return;
    }
    var lastColor = (G.turn === BLACK) ? WHITE : BLACK;
    var lastMover = G.seats[colorName(lastColor)];
    var opponent = G.seats[colorName(G.turn)];
    if (me.nick !== lastMover) { toast("내가 방금 둔 수만 무르기 요청할 수 있어요"); return; }
    if (!opponent) { toast("상대가 없어요"); return; }
    Net.send({ t: "undo_req", from: me.nick, to: opponent, gseq: G.gameSeq, hlen: G.history.length });
    startUndoCooldown();
    toast("무르기 요청을 보냈어요");
  }
  function showUndoModal(from, gseq, hlen) {
    undoReqCtx = { gseq: gseq, hlen: hlen };
    $("undo-text").textContent = from + "님이 한 수 무르기를 요청했어요.";
    $("undo-modal").classList.remove("hidden");
  }
  function performUndo() {
    if (netMode && !amHost) return;
    if (G.over || !G.history || !G.history.length) return;
    var last = G.history.pop();
    G.board[last.r][last.c] = 0;
    G.turn = last.color;
    var prev = G.history.length ? G.history[G.history.length - 1] : null;
    G.lastMove = prev ? { r: prev.r, c: prev.c } : null;
    G.moveDeadline = G.timerSec ? Date.now() + G.timerSec * 1000 : null;
    G.rev++;
    broadcastState();
    updateTurnUI(); render();
  }

  // ---------- 무승부 ----------
  function isRealTwoPlayerGame() {
    var b = G.seats.black, w = G.seats.white;
    return !!(b && w && b !== w && b !== AI_NICK && w !== AI_NICK);
  }
  function updateDrawAskUI() {
    var ov = $("draw-ask"); if (!ov) return;
    var da = G.drawAsk;
    if (!da || da.gseq !== G.gameSeq || G.over || !isOmokFamily(curGame)) { ov.classList.add("hidden"); return; }
    var mySeat = (G.seats.black === me.nick) ? "black" : (G.seats.white === me.nick) ? "white" : null;
    if (!mySeat || da[mySeat] != null) { ov.classList.add("hidden"); return; }
    ov.classList.remove("hidden");
  }
  function respondDrawAskAuto(accept) {
    var da = G.drawAsk; if (!da) return;
    $("draw-ask").classList.add("hidden");
    if (!netMode) { hostDrawAskResponse(me.nick, accept, da.gseq); return; }
    Net.send({ t: "drawask_res", nick: me.nick, gseq: da.gseq, accept: accept });
  }
  function hostDrawAskResponse(nick, accept, gseq) {
    if (netMode && !amHost) return;
    var da = G.drawAsk;
    if (!da || da.gseq !== gseq || da.gseq !== G.gameSeq || !G.started || G.over) return;
    var col = (G.seats.black === nick) ? "black" : (G.seats.white === nick) ? "white" : null;
    if (!col || da[col] != null) return;
    da[col] = accept;
    if (da.black === true && da.white === true) {
      G.drawAsk = null; G.drawAskDone = true;
      hostDrawGame();
      return;
    }
    if (da.black === false || da.white === false) { G.drawAsk = null; G.drawAskDone = true; }
    G.rev++;
    broadcastState();
  }
  function hostDrawGame() {
    if (netMode && !amHost) return;
    if (!G.started || G.over) return;
    G.drawAsk = null;
    G.winner = 0; G.over = true; G.draw = true;
    Net.send({ t: "chat", nick: "__sys", text: "무승부로 대국이 끝났어요" });
    endGame();
  }
  var drawReqFrom = null, drawReqGseq = 0, drawCooldownUntil = 0;
  function startDrawCooldown() {
    drawCooldownUntil = Date.now() + REQUEST_COOLDOWN_MS;
    var b = $("draw-btn"); if (!b) return;
    b.disabled = true; b.classList.add("cooldown");
    setTimeout(function () { b.disabled = false; b.classList.remove("cooldown"); }, REQUEST_COOLDOWN_MS);
  }
  function sendDrawRequest() {
    var mySeat = (G.seats.black === me.nick) ? "black" : (G.seats.white === me.nick) ? "white" : null;
    if (!mySeat) { toast("앉은 사람만 제안할 수 있어요"); return; }
    if (!G.started || G.over) { toast("대국 중에만 제안할 수 있어요"); return; }
    if (Date.now() < drawCooldownUntil) { toast("무승부 제안은 10초 뒤에 다시 쓸 수 있어요"); return; }
    var opp = mySeat === "black" ? G.seats.white : G.seats.black;
    if (!opp || opp === me.nick) { toast("상대가 없어요"); return; }
    if (!netMode) { hostDrawGame(); return; }
    Net.send({ t: "draw_req", from: me.nick, to: opp, gseq: G.gameSeq });
    startDrawCooldown();
    toast("무승부를 제안했어요");
  }
  function showDrawModal(from, gseq) {
    drawReqFrom = from; drawReqGseq = gseq || 0;
    $("draw-text").textContent = from + "님이 무승부를 제안했어요.\n동의하면 승패 없이 대국이 끝나요.";
    $("draw-modal").classList.remove("hidden");
  }

  function beginGameTitle(game) {
    return gameName(game === curGame ? (curRoomGame || game) : game);
  }
  function beginSeats(game) {
    return isAlkFamily(game) ? A.seats : G.seats;
  }
  function beginSeq(game) {
    return isAlkFamily(game) ? A.gameSeq : G.gameSeq;
  }
  function beginStarted(game) {
    return isAlkFamily(game) ? A.started : G.started;
  }
  function beginOpponent(game, nick) {
    var seats = beginSeats(game);
    if (!seats || !seats.black || !seats.white || seats.black === seats.white) return null;
    if (isOmokFamily(game) && (seats.black === AI_NICK || seats.white === AI_NICK)) return null;
    if (seats.black === nick) return seats.white;
    if (seats.white === nick) return seats.black;
    return null;
  }
  var beginCooldownUntil = 0;
  function startBeginCooldown() {
    beginCooldownUntil = Date.now() + REQUEST_COOLDOWN_MS;
    ["center-btn", "alk-center-btn", "omok-again", "alk-again"].forEach(function (id) {
      var b = $(id); if (!b) return;
      b.disabled = true; b.classList.add("cooldown");
      setTimeout(function () { b.disabled = false; b.classList.remove("cooldown"); }, REQUEST_COOLDOWN_MS);
    });
  }
  function sendBeginRequest(game) {
    if (!netMode || beginStarted(game)) return false;
    var opp = beginOpponent(game, me.nick);
    if (!opp) return false;
    if (Date.now() < beginCooldownUntil) { toast("대국 신청은 10초 뒤에 다시 보낼 수 있어요"); return true; }
    Net.send({ t: isAlkFamily(game) ? "alk_begin_req" : "begin_req", from: me.nick, to: opp, gseq: beginSeq(game) });
    startBeginCooldown();
    toast(opp + "님에게 대국 신청을 보냈어요. 상대가 수락하면 시작됩니다", 3200);
    return true;
  }
  function showBeginModal(game, from, gseq) {
    if (!from || from === me.nick || beginStarted(game)) return;
    if (gseq != null && gseq !== beginSeq(game)) return;
    if (beginOpponent(game, from) !== me.nick) return;
    beginReqCtx = { game: game, from: from, gseq: gseq == null ? beginSeq(game) : gseq };
    $("begin-text").textContent = from + "님이 " + beginGameTitle(game) + " 대국을 신청했어요.\n수락하면 바로 시작해요.";
    $("begin-modal").classList.remove("hidden");
  }
  function respondBeginRequest(accept) {
    var ctx = beginReqCtx;
    $("begin-modal").classList.add("hidden");
    beginReqCtx = null;
    if (!ctx) return;
    var t = isAlkFamily(ctx.game) ? "alk_begin_res" : "begin_res";
    Net.send({ t: t, accept: !!accept, from: me.nick, to: ctx.from, gseq: ctx.gseq });
    if (accept) toast("대국 신청을 수락했어요");
  }
  function onBeginResponse(game, msg) {
    var requester = msg.to || msg.by;
    if (!requester) return;
    if (msg.accept) {
      var samePair = beginOpponent(game, requester) === msg.from;
      var sameSeq = msg.gseq == null || msg.gseq === beginSeq(game);
      if (amHost && samePair && sameSeq && !beginStarted(game)) {
        if (isAlkFamily(game)) alkBegin(requester);
        else beginGame(requester);
      }
      if (requester === me.nick) toast("상대가 대국 신청을 수락했어요");
    } else if (requester === me.nick) {
      toast("상대가 대국 신청을 거절했어요");
    }
  }

  function swapOver(game) {
    return game === "alk" ? A.over : G.over;
  }
  function swapOpponent(game, nick) {
    if (beginStarted(game) || swapOver(game)) return null;
    return beginOpponent(game, nick);
  }
  var swapCooldownUntil = 0;
  function startSwapCooldown() {
    swapCooldownUntil = Date.now() + REQUEST_COOLDOWN_MS;
    ["swap-btn", "alk-swap-btn"].forEach(function (id) {
      var b = $(id); if (!b) return;
      b.disabled = true; b.classList.add("cooldown");
      setTimeout(function () { b.disabled = false; b.classList.remove("cooldown"); }, REQUEST_COOLDOWN_MS);
    });
  }
  function requestSeatSwap(game) {
    if (!netMode) return;
    var opp = swapOpponent(game, me.nick);
    if (!opp) { toast("두 사람이 앉아 있고 대국 전일 때만 자리 체인지할 수 있어요"); return; }
    if (Date.now() < swapCooldownUntil) { toast("자리 체인지는 10초 뒤에 다시 요청할 수 있어요"); return; }
    Net.send({ t: game === "alk" ? "alk_swap_req" : "swap_req", from: me.nick, to: opp, gseq: beginSeq(game) });
    startSwapCooldown();
    toast(opp + "님에게 자리 체인지를 요청했어요", 3200);
  }
  function showSwapModal(game, from, gseq) {
    if (!from || from === me.nick) return;
    if (gseq != null && gseq !== beginSeq(game)) return;
    if (swapOpponent(game, from) !== me.nick) return;
    swapReqCtx = { game: game, from: from, gseq: gseq == null ? beginSeq(game) : gseq };
    var swapText = $("swap-text"), swapModal = $("swap-modal");
    if (!swapText || !swapModal) { swapReqCtx = null; return; }
    swapText.textContent = from + "님이 " + beginGameTitle(game) + " 흑·백 자리를 바꾸자고 요청했어요.\n수락하면 바로 자리가 바뀝니다.";
    swapModal.classList.remove("hidden");
  }
  function respondSwapRequest(accept) {
    var ctx = swapReqCtx;
    var swapModal = $("swap-modal");
    if (swapModal) swapModal.classList.add("hidden");
    swapReqCtx = null;
    if (!ctx) return;
    Net.send({ t: ctx.game === "alk" ? "alk_swap_res" : "swap_res", accept: !!accept, from: me.nick, to: ctx.from, gseq: ctx.gseq });
    if (accept) toast("자리 체인지를 수락했어요");
  }
  function onSwapResponse(game, msg) {
    var requester = msg.to || msg.by;
    if (!requester) return;
    if (msg.accept) {
      var samePair = swapOpponent(game, requester) === msg.from;
      var sameSeq = msg.gseq == null || msg.gseq === beginSeq(game);
      if (amHost && samePair && sameSeq) hostSwapSeats(game);
      if (requester === me.nick) toast("상대가 자리 체인지를 수락했어요");
    } else if (requester === me.nick) {
      toast("상대가 자리 체인지를 거절했어요");
    }
  }
  function hostSwapSeats(game) {
    if (netMode && !amHost) return;
    if (!swapOpponent(game, beginSeats(game).black)) return;
    if (game === "alk") {
      var aw = A.seats.white;
      A.seats.white = A.seats.black;
      A.seats.black = aw;
      A.seq++;
      if (window.Alkkagi) Alkkagi.setMeta(A.turn, A.seats, A.started, A.over, A.winner);
      broadcastAlk(); renderAlkUI(); renderPlayersList(); renderPresenceUI();
      return;
    }
    var w = G.seats.white;
    G.seats.white = G.seats.black;
    G.seats.black = w;
    omokAI.on = false;
    G.rev++;
    broadcastState();
    renderPlayersList(); updateTurnUI(); render(); updateCenterButton();
  }

  function beginGame(by) {
    if (netMode && !amHost) return;
    if (!(G.seats.black && G.seats.white)) { if (by === me.nick) toast("흑·백 두 자리가 다 차야 시작해요"); return; }
    if (netMode && by !== G.seats.black && by !== G.seats.white && by !== ADMIN) return;
    omokAI.on = (G.seats.white === AI_NICK || G.seats.black === AI_NICK);
    G.board = Renju.emptyBoard();
    G.turn = BLACK; G.lastMove = null; G.history = [];
    G.over = false; G.winner = 0; G.draw = false; G.recorded = false;
    G.drawAsk = null; G.drawAskDone = false;
    G.resultAt = null; G.resultInfo = null; G.winChatText = null;
    G.started = true;
    G.manualPaused = false; G.paused = false; G.pausedRemainMs = null; clearAllGrace();
    G.lastPlayers = { black: G.seats.black, white: G.seats.white };
    G.moveDeadline = G.timerSec ? Date.now() + G.timerSec * 1000 : null;
    G.gameSeq = (G.gameSeq || 0) + 1;
    G.rev++;
    beginReqCtx = null; $("begin-modal").classList.add("hidden");
    $("omok-win").classList.add("hidden");
    broadcastState();
    startHostTimer(); updateTurnUI(); render(); updateCenterButton();
  }
  function resetToWaiting() {
    G.board = Renju.emptyBoard();
    G.turn = BLACK; G.lastMove = null; G.history = [];
    G.over = false; G.winner = 0; G.draw = false; G.recorded = false;
    G.drawAsk = null; G.drawAskDone = false;
    G.resultAt = null; G.resultInfo = null; G.winChatText = null;
    G.started = false;
    G.manualPaused = false; G.paused = false; G.pausedRemainMs = null; clearAllGrace();
    G.moveDeadline = null;
    G.gameSeq = (G.gameSeq || 0) + 1;
    G.rev++;
    $("omok-win").classList.add("hidden");
    broadcastState();
    stopHostTimer(); updateTurnUI(); render(); updateCenterButton();
  }
  function forfeitGame(pair, winnerColor) {
    if (!netMode || !amHost) return;
    if (window.Db && pair.black && pair.white && pair.black !== pair.white && pair.black !== AI_NICK && pair.white !== AI_NICK) {
      Db.recordGame(pair.black, pair.white, winnerColor === BLACK ? "black" : "white", G.history).then(function () { Net.sendLobby({ t: "scores", game: "omok" }); }).catch(function () {});
    }
    var winnerNick = winnerColor === BLACK ? pair.black : pair.white;
    var loserNick = winnerColor === BLACK ? pair.white : pair.black;
    Net.send({ t: "chat", nick: "__sys", text: loserNick + "님이 나가서 " + winnerNick + "님 승리 (기권)" });
  }

  // ---------- 기권(자리 유지, 이번 판만 짐) ----------
  function requestResign() {
    if (!(G.seats.black === me.nick || G.seats.white === me.nick)) { toast("앉은 사람만 기권할 수 있어요"); return; }
    if (!G.started || G.over) { toast("대국 중에만 기권할 수 있어요"); return; }
    if (!netMode) { hostResign(me.nick, me.nick); return; }
    Net.send({ t: "resign", by: me.nick, nick: me.nick });
  }
  function hostResign(by, nick) {
    if (netMode && !amHost) return;
    if (by !== nick && by !== ADMIN) return;
    if (!G.started || G.over) return;
    if (!G.seats.black || !G.seats.white) return;
    var col = (G.seats.black === nick) ? BLACK : (G.seats.white === nick) ? WHITE : 0;
    if (!col) return;
    var winnerColor = (col === BLACK) ? WHITE : BLACK;
    var winnerNick = (winnerColor === BLACK) ? G.seats.black : G.seats.white;
    G.winner = winnerColor; G.over = true; G.draw = false;
    Net.send({ t: "chat", nick: "__sys", text: nick + "님이 기권 — " + winnerNick + "님 승리" });
    endGame();
  }

  // ---------- 무효(상대 동의) ----------
  var voidCooldownUntil = 0;
  function startVoidCooldown() {
    voidCooldownUntil = Date.now() + REQUEST_COOLDOWN_MS;
    var b = $("leave-void"); if (!b) return;
    b.disabled = true; b.classList.add("cooldown");
    setTimeout(function () { b.disabled = false; b.classList.remove("cooldown"); }, REQUEST_COOLDOWN_MS);
  }
  function sendVoidRequest() {
    var mySeat = (G.seats.black === me.nick) ? "black" : (G.seats.white === me.nick) ? "white" : null;
    if (!mySeat) { $("leave-modal").classList.add("hidden"); requestSeat(me.nick, "spec"); return; }
    if (!G.started || G.over) { $("leave-modal").classList.add("hidden"); requestSeat(me.nick, "spec"); return; }
    var opp = mySeat === "black" ? G.seats.white : G.seats.black;
    if (!opp) { toast("상대가 없어요"); return; }
    if (netMode && Date.now() < voidCooldownUntil) { toast("무효 요청은 10초 뒤에 다시 보낼 수 있어요"); return; }
    $("leave-modal").classList.add("hidden");
    if (!netMode) { hostVoidGame(me.nick); return; }
    Net.send({ t: "void_req", from: me.nick, to: opp, gseq: G.gameSeq });
    startVoidCooldown();
    toast("무효 처리를 상대에게 부탁했어요");
  }
  function showVoidModal(from, gseq) {
    voidReqFrom = from; voidReqGseq = gseq || 0;
    $("void-text").textContent = from + "님이 사정이 있어 대국 무효를 부탁했어요.\n수락하면 승패 없이 대국이 끝나요.";
    $("void-modal").classList.remove("hidden");
  }
  function hostVoidGame(requesterNick) {
    if (netMode && !amHost) return;
    if (G.seats.black === requesterNick) G.seats.black = null;
    if (G.seats.white === requesterNick) G.seats.white = null;
    Net.send({ t: "chat", nick: "__sys", text: requesterNick + "님의 요청으로 대국을 무효 처리했어요" });
    resetToWaiting();
  }

  function showWin() {
    if (!isOmokFamily(curGame)) return;
    var t;
    if (G.draw) t = "무승부!";
    else {
      var nm = seatDisplay(seatName(colorName(G.winner)));
      t = nm ? (nm + "님 승리!") : ((G.winner === BLACK ? "흑" : "백") + " 승리!");
    }
    $("omok-wintext").textContent = t;
    renderWinResult();
    $("omok-win").classList.remove("hidden");
    winShownSeq = G.gameSeq;
    showWinChatOnce("omok", G.gameSeq, G.winChatText);
    if (!G.draw) playSample(winBuffer);
    setTimeout(refreshScores, 800);
    buildResultInfoAsync();
  }
  function renderWinResult() {
    var box = $("win-result-list"); if (!box) return;
    var info = G.resultInfo;
    if (!info || !info.players || !info.players.length) {
      box.innerHTML = "";
      box.classList.add("hidden");
      return;
    }
    box.innerHTML = info.players.map(function (p) {
      var delta = p.delta || 0;
      var dcls = delta > 0 ? "up" : delta < 0 ? "down" : "same";
      var dtext = (delta > 0 ? "+" : "") + delta;
      var rankHtml = "";
      if (p.rankText) {
        if (p.rankMove > 0) rankHtml = '<span class="rank-move up">▲ ' + esc(p.rankText) + '</span>';
        else if (p.rankMove < 0) rankHtml = '<span class="rank-move down">▼ ' + esc(p.rankText) + '</span>';
        else rankHtml = '<span class="rank-static">' + esc(p.rankText) + '</span>';
      }
      return '<div class="win-result-row">'
        + '<div class="win-result-name"><span class="nick">' + esc(p.nick) + '</span>' + rankHtml + '</div>'
        + '<div class="win-result-score">' + p.score + '점 <span class="score-delta ' + dcls + '">' + dtext + '</span></div>'
        + '</div>';
    }).join("");
    box.classList.remove("hidden");
  }
  function currentOmokResultRow() {
    var b = G.seats.black, w = G.seats.white;
    if ((!b || !w) && G.lastPlayers) { b = G.lastPlayers.black; w = G.lastPlayers.white; }
    if (!b || !w || b === w) return null;
    return {
      black: b,
      white: w,
      winner: G.draw ? "draw" : (G.winner === BLACK ? "black" : "white"),
      game: "omok",
      created_at: G.resultAt || new Date().toISOString()
    };
  }
  function rankLookup(stats) {
    var ranked = stats.filter(function (st) { return st.games >= RANK_MIN_GAMES; })
      .sort(function (a, b) { return b.score - a.score || b.rate - a.rate; });
    var map = {};
    ranked.forEach(function (st, i) { map[st.nick] = i + 1; });
    return map;
  }
  async function buildResultInfoAsync() {
    var thisGameSeq = G.gameSeq;
    resultCalcSeq = thisGameSeq;
    if (!isRealTwoPlayerGame() || !window.Db) return;
    var row = currentOmokResultRow();
    if (!row) return;
    try {
      var allGames = await Db.getGamesByType("omok");
      if (resultCalcSeq !== thisGameSeq || G.gameSeq !== thisGameSeq) return;
      var season = currentSeason();
      var resultTime = new Date(row.created_at).getTime();
      function sameCurrentGame(g) {
        if (!g || g.game && g.game !== "omok") return false;
        if (g.black !== row.black || g.white !== row.white || g.winner !== row.winner) return false;
        var gt = new Date(g.created_at).getTime();
        return isFinite(gt) && Math.abs(gt - resultTime) < 120000;
      }
      var seasonGames = (allGames || []).filter(function (g) { return gameInSeason(g, season) && !sameCurrentGame(g); });
      var priorGames = seasonGames.filter(function (g) { return new Date(g.created_at).getTime() < resultTime; });
      var afterGames = priorGames.concat([row]);
      var beforeStats = aggregate(priorGames);
      var afterStats = aggregate(afterGames);
      var beforeRank = rankLookup(beforeStats), afterRank = rankLookup(afterStats);
      function statOf(stats, nick) {
        for (var i = 0; i < stats.length; i++) if (stats[i].nick === nick) return stats[i];
        return { nick: nick, score: ELO_START, games: 0, rate: 0 };
      }
      function playerInfo(nick) {
        var before = statOf(beforeStats, nick), after = statOf(afterStats, nick);
        var br = beforeRank[nick] || null, ar = afterRank[nick] || null;
        return {
          nick: nick,
          score: after.score,
          delta: after.score - before.score,
          rankText: ar ? ar + "등" : "",
          rankMove: (br && ar && br !== ar) ? (br > ar ? 1 : -1) : 0
        };
      }
      var order = G.draw ? [row.black, row.white] : (row.winner === "black" ? [row.black, row.white] : [row.white, row.black]);
      G.resultInfo = { gameSeq: thisGameSeq, players: order.map(playerInfo) };
      renderWinResult();
      if (amHost || !netMode) { G.rev++; broadcastState(); }
    } catch (e) {}
  }

  // ---------- 타이머 ----------
  function startHostTimer() {
    stopHostTimer();
    if (!(amHost || !netMode)) return;
    hostTimerId = setInterval(function () {
      if (netMode && !amHost) return;
      if (!G.started || G.over || G.paused || !G.timerSec || !G.moveDeadline) return;
      if (Date.now() >= G.moveDeadline) {
        G.turn = (G.turn === BLACK) ? WHITE : BLACK;
        G.moveDeadline = Date.now() + G.timerSec * 1000;
        G.rev++;
        toast("시간 초과 — 차례가 넘어갑니다");
        broadcastState(); updateTurnUI(); render();
        aiTick();
      }
    }, 400);
  }
  function stopHostTimer() { if (hostTimerId) { clearInterval(hostTimerId); hostTimerId = null; } }
  function startDisplayTimer() {
    if (dispTimerId) clearInterval(dispTimerId);
    dispTimerId = setInterval(updateTimerUI, 250);
    updateTimerUI();
  }
  function updateTimerUI() {
    var box = $("timer-box"); if (!box) return;
    if (G.paused) { box.textContent = G.manualPaused ? "⏸ 일시정지" : "⏸ 대기"; box.classList.remove("urgent"); lastWarnSec = -1; return; }
    if (!G.timerSec || G.over || !G.moveDeadline) { box.textContent = "∞"; box.classList.remove("urgent"); lastWarnSec = -1; return; }
    var remain = Math.max(0, Math.ceil((G.moveDeadline - Date.now()) / 1000));
    var m = Math.floor(remain / 60), s = remain % 60;
    box.textContent = (m > 0 ? m + ":" + (s < 10 ? "0" + s : s) : s + "초");
    box.classList.toggle("urgent", remain <= 5);
    var onTurnNick = G.seats[colorName(G.turn)];
    var myTurn = !!onTurnNick && onTurnNick === me.nick;
    if (myTurn && remain >= 1 && remain <= 5) {
      if (remain !== lastWarnSec) { if (isOmokFamily(curGame)) playSample(warnBuffer); lastWarnSec = remain; }
    } else {
      lastWarnSec = -1;
    }
  }
  function setTimer(sec) {
    G.timerSec = sec;
    if (G.paused) {
      G.pausedRemainMs = sec ? sec * 1000 : null;
      G.moveDeadline = null;
    } else {
      G.moveDeadline = (sec && G.started && !G.over) ? Date.now() + sec * 1000 : null;
    }
    G.rev++;
    syncTimerChips();
    syncPauseButton();
    if (amHost || !netMode) broadcastState();
    updateTimerUI();
  }
  function syncTimerChips() {
    var chips = document.querySelectorAll("#timer-options .radio-chip");
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle("active", parseInt(chips[i].getAttribute("data-sec"), 10) === G.timerSec);
  }
  function syncPauseButton() {
    var btn = $("pause-toggle"); if (!btn) return;
    btn.textContent = G.manualPaused ? "재개" : "일시정지";
    btn.classList.toggle("active", !!G.manualPaused);
    btn.disabled = !G.started || G.over;
  }
  function canSetTimer() { return !netMode || amHost || me.isAdmin; }
  function requestSetTimer(sec) {
    if (!netMode || amHost) { setTimer(sec); return; }
    if (me.isAdmin) { G.timerSec = sec; syncTimerChips(); updateTimerUI(); Net.send({ t: "set_timer", by: me.nick, sec: sec }); return; }
    toast("방장이나 관리자만 시간을 바꿀 수 있어요");
  }
  function setManualPause(paused) {
    if (!G.started || G.over) { if (paused) toast("진행 중인 대국에서만 일시정지할 수 있어요"); syncPauseButton(); return; }
    if (G.manualPaused === !!paused) { syncPauseButton(); return; }
    G.manualPaused = !!paused;
    G.rev++;
    applyPause();
    if (amHost || !netMode) broadcastState();
    updateTimerUI();
  }
  function requestTogglePause() {
    if (!canSetTimer()) { toast("방장이나 관리자만 일시정지할 수 있어요"); return; }
    var next = !G.manualPaused;
    if (!netMode || amHost) { setManualPause(next); return; }
    if (me.isAdmin) { Net.send({ t: "toggle_pause", by: me.nick, paused: next }); return; }
  }

  // ---------- 이름/자리/차례 ----------
  function seatName(which) { return G.seats[which] || null; }
  var scoresRefreshT = null, scoresPend = {};
  function scheduleScoresRefresh(game) {
    if (game) scoresPend[game] = 1;
    else {
      scoresPend = {};
      rankableGames().forEach(function (id) { scoresPend[id] = 1; });
    }
    if (scoresRefreshT) return;
    scoresRefreshT = setTimeout(function () {
      scoresRefreshT = null;
      var types = Object.keys(scoresPend); scoresPend = {};
      types.forEach(function (t) { refreshScores(t); });
    }, 700);
  }
  function refreshScores(only) {
    if (!window.Db) return;
    var s = currentSeason();
    (only ? [only] : rankableGames()).forEach(function (game) {
      Db.getGamesByType(game).then(function (games) {
        var sg = games.filter(function (g) { return gameInSeason(g, s); });
        var m = {}; aggregateForGame(game, sg).forEach(function (st) { m[st.nick] = st.score; });
        scoreMap[game] = m;
        if (isOmokFamily(game)) updateTurnUI();
        else if (isAlkFamily(game)) renderAlkUI();
      }).catch(function () {});
    });
  }
  function chipNameHtml(nick, game) {
    if (!nick) return "탭해서 앉기";
    if (nick === AI_NICK) return esc(aiLevelName(omokAI.level));
    var sc = scoreMap[game] && scoreMap[game][nick];
    return esc(nick) + (sc != null ? ' <span class="chip-score">' + sc + '</span>' : '');
  }
  function updateTurnUI() {
    var isBlack = G.turn === BLACK;
    $("name-black").innerHTML = chipNameHtml(seatName("black"), "omok");
    $("name-white").innerHTML = chipNameHtml(seatName("white"), "omok");
    $("chip-black").classList.toggle("active", isBlack && !G.over && G.started);
    $("chip-white").classList.toggle("active", !isBlack && !G.over && G.started);
    var seatedMe = (G.seats.black === me.nick || G.seats.white === me.nick);
    document.body.classList.toggle("is-player", seatedMe);
    var rb = $("resign-btn"); if (rb) rb.style.display = (seatedMe && G.started && !G.over) ? "" : "none";
    var db = $("draw-btn"); if (db) db.style.display = (seatedMe && G.started && !G.over && G.drawAskDone && isRealTwoPlayerGame()) ? "" : "none";
    renderPresenceUI();
    updateCenterButton();
  }
  function updateCenterButton() {
    var btn = $("center-btn"); if (!btn) return;
    var area = $("center-area"), aiBtn = $("ai-btn"), swapBtn = $("swap-btn"), levels = $("ai-levels");
    var bothFilled = G.seats.black && G.seats.white;
    var seatedMe = (!netMode || G.seats.black === me.nick || G.seats.white === me.nick || me.isAdmin);
    var iSit = (G.seats.black === me.nick || G.seats.white === me.nick);
    var canSwap = !!(netMode && !G.started && !G.over && bothFilled && iSit && G.seats.black !== AI_NICK && G.seats.white !== AI_NICK);
    if (levels) levels.classList.add("hidden");
    if (!G.started && !G.over && bothFilled && seatedMe) {
      btn.textContent = "대국 신청"; btn.dataset.act = "begin"; btn.classList.remove("hidden");
      if (swapBtn) swapBtn.classList.toggle("hidden", !canSwap);
      if (aiBtn) aiBtn.classList.add("hidden");
      if (area) area.classList.remove("hidden");
    } else if (!G.started && !G.over && iSit && !bothFilled) {
      btn.textContent = "혼자 두기"; btn.dataset.act = "solo"; btn.classList.remove("hidden");
      if (swapBtn) swapBtn.classList.add("hidden");
      if (aiBtn) aiBtn.classList.remove("hidden");
      if (area) area.classList.remove("hidden");
    } else {
      if (swapBtn) swapBtn.classList.add("hidden");
      if (area) area.classList.add("hidden");
    }
  }
  function renderPresenceUI() {
    updateOnlineCounts();
    (window.GameCatalog ? GameCatalog.families() : ["omok", "alk"]).forEach(renderGameOnline);
  }
  function renderGameOnline(game) {
    var ui = gameUi(game);
    var box = $(ui.onlineListId);
    var num = $(ui.onlineNumId);
    var here = (game === activeFamily()) ? (netMode ? displayRoster.slice() : [{ nick: me.nick, joinTs: 0 }]) : [];
    here.sort(function (a, b) { return (a.joinTs || 0) - (b.joinTs || 0); });
    if (num) num.textContent = here.length;
    if (!box) return;
    box.innerHTML = here.map(function (m) {
      var tag;
      if (isOmokFamily(game)) {
        var role = m.nick === G.seats.black ? "흑" : m.nick === G.seats.white ? "백" : "";
        tag = role ? '<span class="ol-tag ' + (role === "흑" ? "b" : "w") + '">' + role + '</span>' : "";
      } else if (isAlkFamily(game)) {
        var arole = m.nick === A.seats.black ? "흑" : m.nick === A.seats.white ? "백" : "";
        tag = arole ? '<span class="ol-tag ' + (arole === "흑" ? "b" : "w") + '">' + arole + '</span>' : "";
      } else {
        tag = "";
      }
      var meMark = (m.nick === me.nick) ? " (나)" : "";
      var crown = (netMode && !m.away && m.nick === hostNick) ? '<span class="ol-crown" title="방장">👑</span>' : "";
      var away = m.away ? '<span class="away-tag">자리비움</span>' : "";
      return '<div class="online-item' + (m.away ? ' away' : '') + '">' + tag + '<span style="color:' + nickColor(m.nick) + '">' + esc(m.nick) + esc(meMark) + '</span>' + crown + away + '</div>';
    }).join("");
  }
  // ---------- 참가자 목록 ----------
  function renderPlayersList() {
    var box = $("players-list"); if (!box) return;
    var hint = $("players-hint");
    var ctrl = activeController();
    if (ctrl && ctrl.renderPlayers) { ctrl.renderPlayers(box, hint); return; }
    if (hint) {
      hint.className = "players-hint host-only";
      hint.textContent = "이름 옆 버튼으로 흑·백·관전을 지정합니다.";
    }
    if (!netMode) { box.innerHTML = '<p class="players-hint">혼자 연습 중입니다. 친구가 링크로 들어오면 여기에 표시됩니다.</p>'; return; }
    var pseats = isAlkFamily(curGame) ? A.seats : G.seats;
    var html = "";
    displayRoster.slice().sort(function (a, b) { return (a.joinTs || 0) - (b.joinTs || 0); }).forEach(function (m) {
      var role = m.nick === pseats.black ? "흑" : m.nick === pseats.white ? "백" : "관전";
      var roleCls = role === "흑" ? "role-black" : role === "백" ? "role-white" : "role-spec";
      var hostMark = (!m.away && m.nick === hostNick) ? ' <span class="mini-host">방장</span>' : "";
      var meMark = (m.nick === me.nick) ? ' <span class="mini-me">나</span>' : "";
      var awayMark = m.away ? ' <span class="mini-away">자리비움</span>' : "";
      html += '<div class="prow' + (m.away ? ' away' : '') + '"><span class="pname"><span class="rtag ' + roleCls + '">' + role + '</span>' + esc(m.nick) + hostMark + meMark + awayMark + '</span>';
      if (me.isAdmin && !m.away) {
        html += '<span class="passign">';
        html += '<button class="pbtn" data-seat="black" data-nick="' + esc(m.nick) + '">흑</button>';
        html += '<button class="pbtn" data-seat="white" data-nick="' + esc(m.nick) + '">백</button>';
        html += '<button class="pbtn" data-seat="spec" data-nick="' + esc(m.nick) + '">관전</button>';
        html += '</span>';
      }
      html += '</div>';
    });
    box.innerHTML = html;
    if (me.isAdmin) {
      var btns = box.querySelectorAll(".pbtn");
      for (var i = 0; i < btns.length; i++) btns[i].addEventListener("click", function () {
        var nk = this.getAttribute("data-nick"), st = this.getAttribute("data-seat");
        if (isAlkFamily(curGame)) requestAlkSeat(nk, st); else requestSeat(nk, st);
      });
    }
  }
  function requestSeat(nick, seat) {
    if (!netMode) return;
    Net.send({ t: "seat", by: me.nick, nick: nick, seat: seat });
  }
  function hostApplySeat(by, nick, seat) {
    if (netMode && !amHost) return;
    var isAdminReq = (by === ADMIN);
    var selfReq = (by === nick);
    if (!isAdminReq && !selfReq) return;
    if (seat === "black" || seat === "white") {
      var occ = G.seats[seat];
      var takingAi = (occ === AI_NICK && (!G.started || G.over));
      if (occ && occ !== nick && !isAdminReq && !takingAi) return;
    }
    var oldSeats = { black: G.seats.black, white: G.seats.white };
    if (G.seats.black === nick) G.seats.black = null;
    if (G.seats.white === nick) G.seats.white = null;
    if (seat === "black") G.seats.black = nick;
    else if (seat === "white") G.seats.white = nick;
    if (G.seats.black !== AI_NICK && G.seats.white !== AI_NICK) omokAI.on = false;
    hostAfterSeatChange(oldSeats, isAdminReq ? "admin" : "self");
  }
  function hostAfterSeatChange(oldSeats, cause) {
    function gone(n) { return n && G.seats.black !== n && G.seats.white !== n; }
    var blackGone = gone(oldSeats.black), whiteGone = gone(oldSeats.white);
    var someoneLeft = blackGone || whiteGone;
    if (someoneLeft && G.started && !G.over && cause !== "admin") {
      if (blackGone && !whiteGone && oldSeats.white) forfeitGame(oldSeats, WHITE);
      else if (whiteGone && !blackGone && oldSeats.black) forfeitGame(oldSeats, BLACK);
    }
    if (someoneLeft && (G.started || G.over)) { resetToWaiting(); return; }
    G.rev++;
    broadcastState();
    renderPlayersList(); updateTurnUI(); render(); updateCenterButton();
  }

  // ---------- 관리자 ----------
  async function openAdmin() {
    $("admin-modal").classList.remove("hidden");
    await renderAdminList();
    renderAllowlist();
  }
  async function renderAllowlist() {
    var box = $("allow-list"); if (!box) return;
    var names = await Db.getAllowlist();
    box.innerHTML = names.map(function (n) {
      return '<div class="prow"><span class="pname">' + esc(n) + '</span><span class="passign"><button class="pbtn danger" data-alrm="' + esc(n) + '">삭제</button></span></div>';
    }).join("") || '<p class="players-hint">명단이 비어 있어요.</p>';
    var btns = box.querySelectorAll("[data-alrm]");
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener("click", function () { allowlistRemove(this); });
  }
  var alArmed = null, alTimer = null;
  function allowlistRemove(btn) {
    var nick = btn.getAttribute("data-alrm");
    if (alArmed !== nick) {
      alArmed = nick; btn.textContent = "확인?"; btn.classList.add("armed");
      clearTimeout(alTimer); alTimer = setTimeout(function () { alArmed = null; btn.textContent = "삭제"; btn.classList.remove("armed"); }, 2500);
      return;
    }
    alArmed = null; clearTimeout(alTimer);
    Db.removeAllowed(nick).then(function () { toast(nick + " 명단에서 삭제"); renderAllowlist(); });
  }
  async function renderAdminList() {
    var box = $("admin-list");
    box.innerHTML = '<p class="players-hint">불러오는 중…</p>';
    var accts = await Db.listAccounts();
    var html = "";
    accts.forEach(function (a) {
      var tag = a.is_admin ? ' <span class="mini-host">관리자</span>' : "";
      var pw = a.needsPw ? ' <span class="mini-reset">비번대기</span>' : "";
      html += '<div class="prow"><span class="pname">' + esc(a.nickname) + tag + pw + '</span>';
      if (!a.is_admin) {
        html += '<span class="passign">';
        html += '<button class="pbtn" data-act="reset" data-nick="' + esc(a.nickname) + '">비번 초기화</button>';
        html += '<button class="pbtn danger" data-act="del" data-nick="' + esc(a.nickname) + '">삭제</button>';
        html += '</span>';
      }
      html += '</div>';
    });
    box.innerHTML = html || '<p class="players-hint">아직 계정이 없어요.</p>';
    var btns = box.querySelectorAll(".pbtn");
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener("click", function () { adminAction(this); });
  }
  var armed = null, armTimer = null;
  function adminAction(btn) {
    var nick = btn.getAttribute("data-nick"), act = btn.getAttribute("data-act");
    var key = act + ":" + nick;
    if (armed !== key) {
      armed = key; btn.classList.add("armed");
      var orig = btn.textContent; btn.textContent = "확인?";
      clearTimeout(armTimer);
      armTimer = setTimeout(function () { armed = null; btn.classList.remove("armed"); btn.textContent = orig; }, 2500);
      return;
    }
    armed = null; clearTimeout(armTimer);
    if (act === "reset") { Db.clearPassword(nick).then(function () { toast(nick + " 비번 초기화됨"); renderAdminList(); }); }
    else if (act === "del") { Db.deleteAccount(nick).then(function () { toast(nick + " 삭제됨"); renderAdminList(); }); }
  }

  // ---------- 랭킹 ----------
  // ---------- 시즌(분기제) ----------
  var SEASON_EPOCH_KEY = 2026 * 4 + 2; // 2026년 3분기 = 시즌1
  // 랭킹 초기화 기준선: 이 시각 이전 대국은 랭킹 집계에서 제외(삭제 아님·보존). 기존 64판 초기화.
  var RANK_EPOCH = new Date("2026-07-12T16:00:00Z").getTime();
  function makeSeason(y, qi) {
    var start = new Date(y, qi * 3, 1).getTime(), end = new Date(y, qi * 3 + 3, 1).getTime();
    var key = y * 4 + qi;
    return { key: key, year: y, q: qi + 1, snum: key - SEASON_EPOCH_KEY + 1, start: start, end: end, label: y + "년 " + (qi + 1) + "분기", months: (qi * 3 + 1) + "~" + (qi * 3 + 3) + "월" };
  }
  function seasonOf(d) { var t = (d instanceof Date) ? d : new Date(d); return makeSeason(t.getFullYear(), Math.floor(t.getMonth() / 3)); }
  function currentSeason() { return seasonOf(new Date()); }
  function gameInSeason(g, s) { var t = new Date(g.created_at).getTime(); return t >= RANK_EPOCH && t >= s.start && t < s.end; }
  function seasonsFrom(games) {
    var set = {};
    games.forEach(function (g) { if (g.created_at && new Date(g.created_at).getTime() >= RANK_EPOCH) { var s = seasonOf(g.created_at); set[s.key] = s; } });
    var cur = currentSeason(); set[cur.key] = cur;
    return Object.keys(set).map(function (k) { return set[k]; }).sort(function (a, b) { return a.key - b.key; });
  }

  var rankGame = "omok", rankTab = "omok", rankSeasons = [], rankSeasonIdx = 0;
  function shownRankGame() { return rankGame === "all" ? rankTab : rankGame; }
  function rankTitle() { return rankGame === "all" ? "전체 랭킹" : (window.GameCatalog ? GameCatalog.rankName(rankGame) : (rankGame === "alk" ? "알까기 랭킹" : rankGame === "alk_terr" ? "점령전 랭킹" : "오목 랭킹")); }
  function renderRankInfo() {
    var list = $("rank-info-list"); if (!list) return;
    if (shownRankGame() === "catchmind") {
      list.innerHTML = '<li>모두 <b>1000점</b>에서 시작해요.</li>'
        + '<li>게임 안에서는 정답을 맞히면 <b>+10점</b>, 내 그림을 한 사람이 맞힐 때마다 <b>+3점</b>을 받아요.</li>'
        + '<li>방 인원 차이를 줄이기 위해 <b>획득점수 ÷ 가능한 최대점수</b>인 활약도로 한 판의 성과를 계산해요.</li>'
        + '<li>같이 플레이한 사람들의 활약도를 서로 비교해 레이팅이 오르거나 내려가요. 높은 점수의 상대보다 잘하면 더 많이 올라요.</li>'
        + '<li>이번 시즌에 <b>5회 이상</b> 참여하면 정식 순위에 올라가요. 5회가 안 되면 "배치 중"으로 표시돼요.</li>'
        + '<li>시즌은 <b>3개월마다</b> 새로 시작되고, 레이팅도 다시 1000점부터 시작해요.</li>';
      return;
    }
    list.innerHTML = '<li>모두 <b>1000점</b>에서 시작해요.</li>'
      + '<li>이기면 오르고 지면 내려가요. 무승부는 아주 조금만 움직여요.</li>'
      + '<li><b>나보다 센 사람을 이기면 점수가 많이 올라요.</b> 나보다 약한 사람을 이기면 조금만 올라요.</li>'
      + '<li>반대로 <b>약한 사람에게 지면 많이 깎이고</b>, 센 사람에게 져도 조금만 깎여요.</li>'
      + '<li>이번 시즌에 <b>5판 이상</b> 두면 정식 순위에 올라가요. 5판이 안 되면 "배치 중"으로 표시돼요.</li>'
      + '<li>시즌은 <b>3개월마다</b> 새로 시작돼서, 그때 점수도 다시 1000점부터 시작해요.</li>';
  }
  async function openRank(game) {
    var ranks = rankableGames();
    rankGame = (game === "all" || ranks.indexOf(game) >= 0) ? game : "omok";
    $("rank-modal").classList.remove("hidden");
    $("rank-detail").classList.add("hidden");
    $("rank-list").classList.remove("hidden");
    if ($("rank-tabs")) $("rank-tabs").classList.add("hidden");
    if ($("rank-season")) { $("rank-season").style.display = ""; $("rank-season").innerHTML = ""; }
    $("rank-title").textContent = rankTitle();
    $("rank-list").innerHTML = '<p class="players-hint">불러오는 중…</p>';
    try {
      var accts = await withTimeout(Db.listAccounts(), 8000);
      var accSet = {};
      accts.forEach(function (a) { accSet[a.nickname] = 1; });
      window.__accSet = accSet;
      if (rankGame === "all") {
        rankTab = ranks[0] || "omok";
        var all = await withTimeout(Db.getGames(), 8000);
        var byType = {};
        ranks.forEach(function (id) { byType[id] = []; });
        all.forEach(function (g) { var t = g.game || "omok"; if (byType[t]) byType[t].push(g); });
        window.__gamesAll = byType;
        window.__games = all;
      } else {
        window.__games = await withTimeout(Db.getGamesByType(rankGame), 8000);
        window.__gamesAll = null;
      }
      rankSeasons = seasonsFrom(window.__games);
      rankSeasonIdx = rankSeasons.length - 1;
      renderSeason();
    } catch (e) {
      if (!$("rank-modal").classList.contains("hidden")) {
        $("rank-list").innerHTML = '<p class="players-hint">불러오지 못했어요. 잠시 후 다시 눌러 주세요.</p>';
      }
    }
  }
  function withTimeout(p, ms) {
    return Promise.race([
      Promise.resolve(p),
      new Promise(function (_res, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })
    ]);
  }
  function computeSeasonRank(game, games, s) {
    var sg = (games || []).filter(function (g) { return gameInSeason(g, s); });
    var stats = aggregateForGame(game, sg).filter(function (st) { return window.__accSet && window.__accSet[st.nick]; });
    var ranked = stats.filter(function (st) { return st.games >= RANK_MIN_GAMES; })
      .sort(function (a, b) { return b.score - a.score || b.rate - a.rate; });
    var provisional = stats.filter(function (st) { return st.games < RANK_MIN_GAMES; })
      .sort(function (a, b) { return b.score - a.score; });
    return { ranked: ranked, provisional: provisional };
  }
  function renderRankTabs() {
    var tabs = $("rank-tabs"); if (!tabs) return;
    tabs.innerHTML = rankableGames().map(function (id) {
      return '<button class="rtab" data-g="' + esc(id) + '">' + esc(gameName(id)) + '</button>';
    }).join("");
    var tbtns = tabs.querySelectorAll(".rtab");
    for (var i = 0; i < tbtns.length; i++) {
      tbtns[i].addEventListener("click", function () { rankTab = this.getAttribute("data-g"); renderSeason(); });
    }
  }
  function renderSeason() {
    var s = rankSeasons[rankSeasonIdx]; if (!s) return;
    var isCur = (s.key === currentSeason().key);
    $("rank-title").textContent = rankTitle();
    $("rank-detail").classList.add("hidden");
    $("rank-list").classList.remove("hidden");
    if ($("rank-season")) $("rank-season").style.display = "";
    renderSeasonBar(s, isCur);
    var tabs = $("rank-tabs");
    if (rankGame === "all") {
      if (tabs) {
        renderRankTabs();
        tabs.classList.remove("hidden");
        var tbtns = tabs.querySelectorAll(".rtab");
        for (var i = 0; i < tbtns.length; i++) tbtns[i].classList.toggle("active", tbtns[i].getAttribute("data-g") === rankTab);
      }
      var r = computeSeasonRank(rankTab, (window.__gamesAll || {})[rankTab], s);
      renderRank(rankTab, r.ranked, r.provisional);
    } else {
      if (tabs) tabs.classList.add("hidden");
      var r2 = computeSeasonRank(rankGame, window.__games, s);
      renderRank(rankGame, r2.ranked, r2.provisional);
    }
  }
  function renderSeasonBar(s, isCur) {
    var bar = $("rank-season"); if (!bar) return;
    var canPrev = rankSeasonIdx > 0, canNext = rankSeasonIdx < rankSeasons.length - 1;
    bar.innerHTML = '<button class="season-nav" id="season-prev"' + (canPrev ? '' : ' disabled') + '>◀</button>'
      + '<div class="season-label"><span class="season-num">시즌 ' + s.snum + '</span>'
      + '<span class="season-sub ' + (isCur ? 'cur' : '') + '">' + s.label + ' · ' + (isCur ? '이번 시즌' : '지난 시즌') + '</span></div>'
      + '<button class="season-nav" id="season-next"' + (canNext ? '' : ' disabled') + '>▶</button>';
    if (canPrev) $("season-prev").addEventListener("click", function () { rankSeasonIdx--; renderSeason(); });
    if (canNext) $("season-next").addEventListener("click", function () { rankSeasonIdx++; renderSeason(); });
  }
  var ELO_START = 1000, ELO_K = 32, RANK_MIN_GAMES = 5;
  function aggregate(games) {
    var chron = games.slice().sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    var map = {};
    function ent(n) { if (!map[n]) map[n] = { nick: n, w: 0, l: 0, d: 0, elo: ELO_START }; return map[n]; }
    chron.forEach(function (g) {
      if (!g.black || !g.white || g.black === g.white) return;
      var b = ent(g.black), w = ent(g.white);
      var eb = 1 / (1 + Math.pow(10, (w.elo - b.elo) / 400)), ew = 1 - eb;
      var sb = g.winner === "draw" ? 0.5 : (g.winner === "black" ? 1 : 0), sw = 1 - sb;
      if (g.winner === "draw") { b.d++; w.d++; }
      else if (g.winner === "black") { b.w++; w.l++; }
      else if (g.winner === "white") { w.w++; b.l++; }
      b.elo += ELO_K * (sb - eb); w.elo += ELO_K * (sw - ew);
    });
    return Object.keys(map).map(function (k) {
      var s = map[k]; s.games = s.w + s.l + s.d;
      s.rate = s.games ? Math.round(s.w / s.games * 100) : 0;
      s.score = Math.round(s.elo);
      return s;
    });
  }
  function parseCatchmindRecord(g) {
    if (!g || !g.black) return null;
    var parts = String(g.white || "").split(":");
    if (parts[0] !== "cm" || parts.length < 6) return null;
    var points = Number(parts[2]), maxPoints = Number(parts[3]);
    if (!isFinite(points) || !isFinite(maxPoints) || maxPoints <= 0) return null;
    return {
      id: g.id,
      nick: g.black,
      matchId: parts[1],
      points: Math.max(0, points),
      maxPoints: maxPoints,
      correct: Math.max(0, Number(parts[4]) || 0),
      drawCorrect: Math.max(0, Number(parts[5]) || 0),
      createdAt: g.created_at
    };
  }
  function aggregateCatchmind(games) {
    var grouped = {};
    (games || []).forEach(function (g) {
      var row = parseCatchmindRecord(g); if (!row || !row.matchId) return;
      if (!grouped[row.matchId]) grouped[row.matchId] = { at: row.createdAt, players: {} };
      grouped[row.matchId].players[row.nick] = row;
      if (new Date(row.createdAt) < new Date(grouped[row.matchId].at)) grouped[row.matchId].at = row.createdAt;
    });
    var matches = Object.keys(grouped).map(function (id) { return grouped[id]; })
      .sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    var map = {};
    function ent(nick) {
      if (!map[nick]) map[nick] = { nick: nick, w: 0, l: 0, d: 0, elo: ELO_START, games: 0, points: 0, maxPoints: 0, correct: 0, drawCorrect: 0 };
      return map[nick];
    }
    matches.forEach(function (match) {
      var rows = Object.keys(match.players).map(function (nick) { return match.players[nick]; });
      if (rows.length < 2) return;
      var before = rows.map(function (row) {
        var stat = ent(row.nick);
        return { row: row, elo: stat.elo, performance: Math.min(1, row.points / row.maxPoints) };
      });
      var deltas = {};
      before.forEach(function (player) {
        var actual = 0, expected = 0;
        before.forEach(function (opponent) {
          if (opponent === player) return;
          actual += player.performance === opponent.performance ? 0.5 : (player.performance > opponent.performance ? 1 : 0);
          expected += 1 / (1 + Math.pow(10, (opponent.elo - player.elo) / 400));
        });
        deltas[player.row.nick] = ELO_K * ((actual - expected) / (before.length - 1));
      });
      rows.forEach(function (row) {
        var stat = ent(row.nick);
        stat.elo += deltas[row.nick];
        stat.games++;
        stat.points += row.points;
        stat.maxPoints += row.maxPoints;
        stat.correct += row.correct;
        stat.drawCorrect += row.drawCorrect;
      });
    });
    return Object.keys(map).map(function (nick) {
      var stat = map[nick];
      stat.rate = stat.maxPoints ? Math.min(100, Math.round(stat.points / stat.maxPoints * 100)) : 0;
      stat.score = Math.round(stat.elo);
      return stat;
    });
  }
  function aggregateForGame(game, games) {
    return game === "catchmind" ? aggregateCatchmind(games) : aggregate(games);
  }
  function rankRowHtml(game, s, mark, prov) {
    var meMark = (s.nick === me.nick) ? '<span class="rk-me">나</span>' : '';
    var rec = game === "catchmind"
      ? s.games + '회 참여 · 활약도 ' + s.rate + '%'
      : s.w + '승 ' + s.l + '패' + (s.d ? ' ' + s.d + '무' : '') + ' · 승률 ' + s.rate + '%';
    return '<div class="rrow' + (prov ? ' prov' : '') + '" data-nick="' + esc(s.nick) + '">'
      + '<span class="rk-rank">' + mark + '</span>'
      + '<span class="rk-name"><span class="rk-nick">' + esc(s.nick) + meMark + '</span><span class="rk-rec">' + rec + '</span></span>'
      + '<span class="rk-score' + (prov ? ' prov' : '') + '">' + s.score + '</span>'
      + '</div>';
  }
  function rankListHtml(game, ranked, provisional) {
    if (!ranked.length && !provisional.length) return '<p class="players-hint">' + (game === "catchmind" ? '아직 완료된 캐치마인드 기록이 없어요.' : '아직 기록된 대국이 없어요. 한 판 두면 여기 올라옵니다!') + '</p>';
    var medals = ["gold", "silver", "bronze"];
    var unit = game === "catchmind" ? "회" : "판";
    var html = "";
    if (ranked.length) {
      ranked.forEach(function (s, i) {
        var mark = i < 3 ? '<span class="rk-medal ' + medals[i] + '">' + (i + 1) + '</span>' : '<span class="rk-num">' + (i + 1) + '</span>';
        html += rankRowHtml(game, s, mark, false);
      });
    } else {
      html += '<p class="players-hint">아직 ' + RANK_MIN_GAMES + unit + ' 이상 ' + (game === "catchmind" ? '참여한 사람이 없어요.' : '둔 사람이 없어요.') + ' ' + RANK_MIN_GAMES + unit + ' 채우면 순위에 올라옵니다!</p>';
    }
    if (provisional.length) {
      html += '<div class="prov-divider"><span class="prov-title">배치 중</span><span class="prov-note">' + RANK_MIN_GAMES + unit + ' 채우면 순위 등록</span></div>';
      provisional.forEach(function (s) {
        html += rankRowHtml(game, s, '<span class="rk-prov">' + s.games + '/' + RANK_MIN_GAMES + '</span>', true);
      });
    }
    return html;
  }
  function bindRankRows() {
    var rows = $("rank-list").querySelectorAll(".rrow");
    for (var i = 0; i < rows.length; i++) rows[i].addEventListener("click", function () { showPlayerDetail(this.getAttribute("data-nick")); });
  }
  function renderRank(game, ranked, provisional) {
    $("rank-list").innerHTML = rankListHtml(game, ranked, provisional);
    bindRankRows();
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    var hh = ("0" + d.getHours()).slice(-2);
    var mm = ("0" + d.getMinutes()).slice(-2);
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + hh + ":" + mm;
  }
  var detailToken = 0;
  async function movesetFor(games) {
    var set = {};
    if (!window.Db || !Db.gamesWithMoves) return set;
    var ids = games.filter(function (g) { return (g.game === "omok" || !g.game) && g.id != null; }).slice(0, 40).map(function (g) { return g.id; });
    if (!ids.length) return set;
    var have = await Db.gamesWithMoves(ids);
    have.forEach(function (id) { set[id] = 1; });
    return set;
  }
  function showCatchmindDetail(nick, src, season, tok) {
    var seasonGames = (src || []).filter(function (g) { return !season || gameInSeason(g, season); });
    var seen = {}, records = [];
    seasonGames.forEach(function (g) {
      var row = parseCatchmindRecord(g);
      if (!row || row.nick !== nick || seen[row.matchId]) return;
      seen[row.matchId] = 1;
      records.push(row);
    });
    records.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    var stat = aggregateCatchmind(seasonGames).filter(function (item) { return item.nick === nick; })[0];
    if (tok !== detailToken) return;
    $("rank-list").classList.add("hidden");
    if ($("rank-tabs")) $("rank-tabs").classList.add("hidden");
    if ($("rank-season")) $("rank-season").style.display = "none";
    var box = $("rank-detail");
    box.classList.remove("hidden");
    $("rank-title").textContent = nick + " 캐치마인드" + (season ? " · " + season.label : "");
    var html = '<button class="btn-flat rank-back">← 목록</button>';
    if (stat) html += '<p class="players-hint">레이팅 <b>' + stat.score + '</b> · ' + stat.games + '회 참여 · 평균 활약도 <b>' + stat.rate + '%</b></p>';
    if (!records.length) html += '<p class="players-hint">기록이 없어요.</p>';
    else {
      html += '<div class="detail-list">';
      records.forEach(function (row) {
        var performance = Math.min(100, Math.round(row.points / row.maxPoints * 100));
        html += '<div class="drow cm-detail-row"><span class="cm-rank-perf">활약도 ' + performance + '%</span>'
          + '<span class="cm-rank-detail">' + row.points + '점 · 정답 ' + row.correct + ' · 그림 성공 ' + row.drawCorrect + '</span>'
          + '<span class="d-date">' + fmtDate(row.createdAt) + '</span></div>';
      });
      html += '</div>';
    }
    box.innerHTML = html;
    box.querySelector(".rank-back").addEventListener("click", function () {
      box.classList.add("hidden");
      renderSeason();
    });
  }
  async function showPlayerDetail(nick) {
    var tok = ++detailToken;
    var s = rankSeasons[rankSeasonIdx];
    var src = (rankGame === "all") ? ((window.__gamesAll || {})[rankTab] || []) : (window.__games || []);
    if (shownRankGame() === "catchmind") { showCatchmindDetail(nick, src, s, tok); return; }
    var games = src.filter(function (g) { return (g.black === nick || g.white === nick) && (!s || gameInSeason(g, s)); });
    $("rank-list").classList.add("hidden");
    if ($("rank-tabs")) $("rank-tabs").classList.add("hidden");
    if ($("rank-season")) $("rank-season").style.display = "none";
    var box = $("rank-detail");
    box.classList.remove("hidden");
    $("rank-title").textContent = nick + " 전적" + (s ? " · " + s.label : "");
    var moveSet = await movesetFor(games);
    if (tok !== detailToken) return;
    var html = '<button class="btn-flat rank-back">← 목록</button>' + (me.isAdmin ? '<button class="rank-edit-btn">편집</button>' : '');
    if (!games.length) html += '<p class="players-hint">기록이 없어요.</p>';
    else {
      html += '<div class="detail-list">';
      var replayList = []; window.__replayGames = replayList;
      games.forEach(function (g) {
        var opp = g.black === nick ? g.white : g.black;
        var myColor = g.black === nick ? "black" : "white";
        var result = g.winner === "draw" ? "무" : (g.winner === myColor ? "승" : "패");
        var rcls = result === "승" ? "res-win" : result === "패" ? "res-lose" : "res-draw";
        var colorTag = myColor === "black" ? "흑" : "백";
        var rbtn = "";
        if (moveSet[g.id] && replayList.length < 20) {
          var ri = replayList.length; replayList.push(g);
          rbtn = '<button class="replay-btn" data-replay="' + ri + '">복기</button>';
        }
        var delbtn = me.isAdmin ? '<button class="del-game-btn" data-del="' + g.id + '">✕</button>' : "";
        html += '<div class="drow"><span class="' + rcls + '">' + result + '</span><span class="d-color">' + colorTag + '</span><span class="d-vs">vs</span><span class="d-opp" data-opp="' + esc(opp) + '">' + esc(opp) + '</span><span class="d-date">' + fmtDate(g.created_at) + '</span>' + rbtn + delbtn + '</div>';
      });
      html += '</div>';
    }
    box.innerHTML = html;
    box.querySelector(".rank-back").addEventListener("click", function () {
      box.classList.add("hidden");
      renderSeason();
    });
    bindReplayBtns(box);
    bindDelBtns(box);
    bindEditBtn(box);
    var opps = box.querySelectorAll(".d-opp");
    for (var j = 0; j < opps.length; j++) opps[j].addEventListener("click", (function (n) { return function () { showHeadToHead(n, this.getAttribute("data-opp")); }; })(nick));
  }
  function bindReplayBtns(box) {
    var rbtns = box.querySelectorAll(".replay-btn");
    for (var i = 0; i < rbtns.length; i++) rbtns[i].addEventListener("click", function () {
      openReplay(window.__replayGames[+this.getAttribute("data-replay")]);
    });
  }
  var delArmedId = null, delArmTimer = null;
  function bindDelBtns(box) {
    if (!me.isAdmin) return;
    var btns = box.querySelectorAll(".del-game-btn");
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener("click", function () { delGameArmed(this); });
  }
  function bindEditBtn(box) {
    if (!me.isAdmin) return;
    var eb = box.querySelector(".rank-edit-btn"); if (!eb) return;
    eb.addEventListener("click", function () {
      var on = box.classList.toggle("editing");
      eb.textContent = on ? "완료" : "편집";
      eb.classList.toggle("editing", on);
    });
  }
  function delGameArmed(btn) {
    if (!me.isAdmin) return;
    var id = btn.getAttribute("data-del");
    if (delArmedId !== id) {
      delArmedId = id; btn.classList.add("armed"); toast("한 번 더 누르면 삭제돼요");
      clearTimeout(delArmTimer); delArmTimer = setTimeout(function () { delArmedId = null; btn.classList.remove("armed"); }, 3000);
      return;
    }
    delArmedId = null; clearTimeout(delArmTimer);
    if (!(window.Db && Db.deleteGame)) return;
    btn.textContent = "…"; btn.disabled = true;
    Db.deleteGame(id).then(function (r) {
      if (r && r.error) { toast("삭제 실패: " + (r.error.message || "권한")); btn.textContent = "✕"; btn.disabled = false; btn.classList.remove("armed"); return; }
      toast("대국 기록을 삭제했어요");
      if (window.Net && Net.sendLobby) Net.sendLobby({ t: "scores", game: rankGame });
      refreshScores();
      openRank(rankGame);
    }).catch(function () { toast("삭제 오류"); btn.textContent = "✕"; btn.disabled = false; btn.classList.remove("armed"); });
  }
  async function showHeadToHead(nick, opp) {
    var tok = ++detailToken;
    var s = rankSeasons[rankSeasonIdx];
    var src = (rankGame === "all") ? ((window.__gamesAll || {})[rankTab] || []) : (window.__games || []);
    var games = src.filter(function (g) {
      return (((g.black === nick && g.white === opp) || (g.black === opp && g.white === nick))) && (!s || gameInSeason(g, s));
    });
    var win = 0, lose = 0, draw = 0;
    games.forEach(function (g) {
      var myColor = g.black === nick ? "black" : "white";
      if (g.winner === "draw") draw++; else if (g.winner === myColor) win++; else lose++;
    });
    var box = $("rank-detail");
    $("rank-title").textContent = "맞대결";
    var moveSet = await movesetFor(games);
    if (tok !== detailToken) return;
    var html = '<button class="btn-flat rank-back">← ' + esc(nick) + ' 전적</button>' + (me.isAdmin ? '<button class="rank-edit-btn">편집</button>' : '');
    html += '<div class="h2h-score"><span class="h2h-side">' + esc(nick) + '</span>'
      + '<span class="h2h-nums"><b class="h2h-w">' + win + '</b><span class="h2h-sep">:</span><b class="h2h-l">' + lose + '</b></span>'
      + '<span class="h2h-side">' + esc(opp) + '</span></div>';
    html += '<div class="h2h-sub">' + esc(nick) + ' 기준 · ' + win + '승 ' + lose + '패' + (draw ? ' ' + draw + '무' : '') + '</div>';
    if (!games.length) html += '<p class="players-hint">맞대결 기록이 없어요.</p>';
    else {
      html += '<div class="detail-list">';
      var replayList = []; window.__replayGames = replayList;
      games.forEach(function (g) {
        var myColor = g.black === nick ? "black" : "white";
        var result = g.winner === "draw" ? "무" : (g.winner === myColor ? "승" : "패");
        var rcls = result === "승" ? "res-win" : result === "패" ? "res-lose" : "res-draw";
        var colorTag = myColor === "black" ? "흑" : "백";
        var rbtn = "";
        if (moveSet[g.id] && replayList.length < 20) {
          var ri = replayList.length; replayList.push(g);
          rbtn = '<button class="replay-btn" data-replay="' + ri + '">복기</button>';
        }
        var delbtn = me.isAdmin ? '<button class="del-game-btn" data-del="' + g.id + '">✕</button>' : "";
        html += '<div class="drow"><span class="' + rcls + '">' + result + '</span><span class="d-color">' + colorTag + '으로</span><span class="d-date">' + fmtDate(g.created_at) + '</span>' + rbtn + delbtn + '</div>';
      });
      html += '</div>';
    }
    box.innerHTML = html;
    box.querySelector(".rank-back").addEventListener("click", function () { showPlayerDetail(nick); });
    bindReplayBtns(box);
    bindDelBtns(box);
    bindEditBtn(box);
  }
  var replayMoves = [], replayIdx = 0, replayCtx = null;
  async function openReplay(g) {
    if (!g) return;
    var moves = g.moves;
    if (!moves && window.Db && Db.getGameMoves) moves = await Db.getGameMoves(g.id);
    if (!moves || !moves.length) { toast("이 경기는 기보가 없어요"); return; }
    replayMoves = moves;
    replayIdx = replayMoves.length;
    var cv = $("replay-canvas"); if (cv) replayCtx = cv.getContext("2d");
    var wtxt = g.winner === "draw" ? "무승부" : ((g.winner === "black" ? g.black : g.white) + "님 승리");
    $("replay-title").textContent = "흑 " + g.black + " vs 백 " + g.white + " · " + wtxt;
    openModal("replay-modal");
    renderReplay();
  }
  function renderReplay() {
    var ctx = replayCtx; if (!ctx) return;
    var W = 360, N = SIZE, M = 18, GP = (W - 2 * M) / (N - 1);
    function P(i) { return M + i * GP; }
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = "#E8C88A"; ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = "#9A7B45"; ctx.lineWidth = 1.2; ctx.beginPath();
    for (var i = 0; i < N; i++) { ctx.moveTo(P(0), P(i)); ctx.lineTo(P(N - 1), P(i)); ctx.moveTo(P(i), P(0)); ctx.lineTo(P(i), P(N - 1)); }
    ctx.stroke();
    var last = null;
    for (var k = 0; k < replayIdx; k++) {
      var mv = replayMoves[k]; if (!mv) continue;
      var x = P(mv.c), y = P(mv.r), rad = GP * 0.44;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = (mv.color === BLACK) ? "#1b1b1b" : "#f6f6f6"; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.stroke();
      if (k === replayIdx - 1) last = { x: x, y: y, rad: rad };
    }
    if (last) { ctx.beginPath(); ctx.arc(last.x, last.y, last.rad * 0.5, 0, Math.PI * 2); ctx.strokeStyle = "#D23B3B"; ctx.lineWidth = 2.4; ctx.stroke(); }
    if ($("replay-move")) $("replay-move").textContent = replayIdx + " / " + replayMoves.length + "수";
  }

  // ---------- 보드 ----------
  function layoutBoard() {
    canvas = $("board"); ctx = canvas.getContext("2d");
    GAP = (canvas.width - 2 * MARGIN) / (SIZE - 1); RADIUS = GAP * 0.44;
  }
  function px(i) { return MARGIN + i * GAP; }
  function render() {
    if (!ctx) return;
    var W = canvas.width;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = "#E8C88A"; ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = "#9A7B45"; ctx.lineWidth = 1.4; ctx.beginPath();
    for (var i = 0; i < SIZE; i++) {
      ctx.moveTo(px(0), px(i)); ctx.lineTo(px(SIZE - 1), px(i));
      ctx.moveTo(px(i), px(0)); ctx.lineTo(px(i), px(SIZE - 1));
    }
    ctx.stroke();
    var stars = [3, 7, 11]; ctx.fillStyle = "#6E5327";
    for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) { ctx.beginPath(); ctx.arc(px(stars[a]), px(stars[b]), 3.2, 0, Math.PI * 2); ctx.fill(); }
    if (!G.over && G.turn === BLACK) {
      var pts = Renju.forbiddenPoints(G.board);
      ctx.strokeStyle = "#D23B3B"; ctx.lineWidth = 2.4;
      for (var p = 0; p < pts.length; p++) {
        var x = px(pts[p].c), y = px(pts[p].r), d = RADIUS * 0.55;
        ctx.beginPath(); ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d); ctx.stroke();
      }
    }
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (G.board[r][c]) drawStone(px(c), px(r), G.board[r][c]);
    if (preview) {
      var badPrev = G.over || G.board[preview.r][preview.c] !== 0 || (netMode && G.seats[colorName(G.turn)] !== me.nick);
      if (badPrev) { preview = null; if ($("confirm-bar")) $("confirm-bar").classList.add("hidden"); }
      else {
        ctx.globalAlpha = 0.42;
        drawStone(px(preview.c), px(preview.r), G.turn);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#2FB89E"; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(px(preview.c), px(preview.r), RADIUS + 3, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (G.lastMove) {
      ctx.strokeStyle = "#F3612A"; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.arc(px(G.lastMove.c), px(G.lastMove.r), RADIUS + 2, 0, Math.PI * 2); ctx.stroke();
    }
    var cnt = stoneCount();
    if (cnt === lastStoneCount + 1 && isOmokFamily(curGame)) playStone();
    lastStoneCount = cnt;
  }
  function drawStone(x, y, color) {
    ctx.beginPath(); ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
    if (color === BLACK) { ctx.fillStyle = "#1A1A1A"; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke(); }
    else { ctx.fillStyle = "#F7F7F2"; ctx.fill(); ctx.strokeStyle = "#B9B4A6"; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function onBoardTap(ev) {
    if (G.over) return;
    if (!G.started) { toast("‘대국 신청’ 버튼을 눌러 시작해요"); return; }
    var rect = canvas.getBoundingClientRect();
    var scale = canvas.width / rect.width;
    var pt = ev.touches ? ev.touches[0] : ev;
    var x = (pt.clientX - rect.left) * scale, y = (pt.clientY - rect.top) * scale;
    var c = Math.round((x - MARGIN) / GAP), r = Math.round((y - MARGIN) / GAP);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return;
    if (netMode && !myMoveAllowed()) {
      var mine = (G.seats.black === me.nick || G.seats.white === me.nick);
      toast(mine ? "지금은 상대 차례예요" : "관전 중이에요");
      return;
    }
    if (G.board[r][c] !== 0) { toast("이미 돌이 있어요"); return; }
    var chk = Renju.checkMove(G.board, r, c, G.turn);
    if (!chk.legal) { toast(reasonText(chk.reason)); return; }
    preview = { r: r, c: c };
    $("confirm-bar").classList.remove("hidden");
    render();
  }
  function confirmPlace() {
    if (!preview) return;
    var p = preview; preview = null;
    $("confirm-bar").classList.add("hidden");
    submitMove(p.r, p.c);
  }

  // ---------- 채팅 ----------
  var NICK_COLORS = (function () {
    var arr = [];
    for (var i = 0; i < 50; i++) {
      var h = Math.round((i * 137.508) % 360);
      arr.push("hsl(" + h + ",70%,68%)");
    }
    return arr;
  })();
  function nickColor(nick) {
    var h = 0;
    for (var i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) >>> 0;
    return NICK_COLORS[h % 50];
  }
  function makeChatLine(who, text) {
    var div = document.createElement("div");
    div.className = "chat-line " + (who === "__sys" ? "sys" : "");
    if (who === "__sys") div.textContent = text;
    else div.innerHTML = '<span class="chat-nick" style="color:' + nickColor(who) + '">' + esc(who) + '</span> ' + esc(text);
    return div;
  }
  function chatRoomOf(game) { return curRoomId ? ("r:" + curRoomId) : roomName(); }
  var unreadCount = {};
  (window.GameCatalog ? GameCatalog.families() : ["omok", "alk"]).forEach(function (family) { unreadCount[family] = 0; });
  function renderUnread(game) {
    if (unreadCount[game] == null) unreadCount[game] = 0;
    var n = unreadCount[game];
    var tabs = document.querySelectorAll(".game-tab." + (game === "omok" ? "omok-tab" : "alk-tab"));
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("has-unread", n > 0);
      var badge = tabs[i].querySelector(".gt-unread");
      if (badge) badge.textContent = n > 0 ? (n > 99 ? "99+" : String(n)) : "";
    }
  }
  function bumpUnread(game) { if (unreadCount[game] == null) unreadCount[game] = 0; unreadCount[game]++; renderUnread(game); }
  function clearUnread(game) { unreadCount[game] = 0; renderUnread(game); }
  function showWinChatOnce(game, seq, text) {
    if (!text) return;
    if (gameFamily(game) === "alk") {
      if (alkWinChatSeq === seq) return;
      alkWinChatSeq = seq;
    } else {
      if (omokWinChatSeq === seq) return;
      omokWinChatSeq = seq;
    }
    addChatTo(game, "__sys", text);
  }
  function announceOmokWinChat() {
    if (!G.winner || G.draw) return;
    var nick = seatDisplay(seatName(colorName(G.winner))) || (G.winner === BLACK ? "흑" : "백");
    G.winChatText = nick + "님 승리!";
  }
  function alkWinChatText(winner) {
    var nick = winner === "b" ? A.seats.black : A.seats.white;
    return (nick || (winner === "b" ? "흑" : "백")) + "님 승리!";
  }
  function addChatTo(game, who, text, live) {
    game = gameFamily(game);
    var log = $(gameUi(game).chatLogId);
    if (log) { log.appendChild(makeChatLine(who, text)); log.scrollTop = log.scrollHeight; }
    sessionChat.push({ game: game, who: who, text: text });
    if (sessionChat.length > 300) sessionChat.shift();
    if (live && who !== "__sys") {
      pushOverlay(game, who, text);
      if (game !== activeFamily()) bumpUnread(game);
    }
  }
  function addSysBoth(text) {
    (window.GameCatalog ? GameCatalog.families() : ["omok", "alk"]).forEach(function (family) {
      addChatTo(family, "__sys", text);
    });
  }
  function pushOverlay(game, nick, text) {
    var ov = $(gameUi(gameFamily(game)).chatOverlayId); if (!ov) return;
    var line = document.createElement("div");
    line.className = "ov-line";
    line.innerHTML = '<span class="ov-nick" style="color:' + nickColor(nick) + '">' + esc(nick) + '</span>' + esc(text);
    ov.appendChild(line);
    while (ov.children.length > 3) ov.removeChild(ov.children[0]);
    setTimeout(function () { line.classList.add("show"); }, 20);
    setTimeout(function () {
      line.classList.remove("show");
      setTimeout(function () { if (line.parentNode) line.parentNode.removeChild(line); }, 300);
    }, 4500);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m]; }); }
  function sendChatText(game, text) {
    game = gameFamily(game);
    var v = String(text || "").trim().slice(0, 80); if (!v) return false;
    if (netMode) {
      addChatTo(game, me.nick, v, true);
      Net.send({ t: "chat", game: game, nick: me.nick, text: v });
      if (window.Db) Db.addChatMsg(chatRoomOf(game), me.nick, v);
    } else addChatTo(game, me.nick, v, true);
    return true;
  }
  function sendChat(game) {
    game = gameFamily(game);
    var inp = $(gameUi(game).chatInputId);
    if (!inp) return;
    if (sendChatText(game, inp.value)) inp.value = "";
  }

  // ---------- 토스트 ----------
  var toastId = null;
  function toast(msg, ms) {
    var t = $("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastId); toastId = setTimeout(function () { t.classList.remove("show"); }, ms || 1800);
  }

  // ---------- 사운드 ----------
  function initAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      if (!stoneBuffer && !stoneLoading) loadStoneSound();
      if (!inoutBuffer && !inoutLoading) loadInOutSound();
      if (!winBuffer && !winLoading) loadWinSound();
      if (!warnBuffer && !warnLoading) loadWarnSound();
      if (!seatBuffer && !seatLoading) loadSeatSound();
      if (!leaveBuffer && !leaveLoading) loadLeaveSound();
      if (!hitBuffer && !hitLoading) loadHitSound();
      unlockSilentSwitch();
    } catch (e) {}
  }
  function loadInOutSound() {
    if (!audioCtx) return;
    inoutLoading = true;
    fetch("assets/inout.mp3").then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return audioCtx.decodeAudioData(ab); })
      .then(function (buf) { inoutBuffer = buf; })
      .catch(function () { inoutLoading = false; });
  }
  function loadWinSound() {
    if (!audioCtx) return;
    winLoading = true;
    fetch("assets/win.mp3").then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return audioCtx.decodeAudioData(ab); })
      .then(function (buf) { winBuffer = buf; })
      .catch(function () { winLoading = false; });
  }
  function loadWarnSound() {
    if (!audioCtx) return;
    warnLoading = true;
    fetch("assets/warn.mp3").then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return audioCtx.decodeAudioData(ab); })
      .then(function (buf) { warnBuffer = buf; })
      .catch(function () { warnLoading = false; });
  }
  function loadSeatSound() {
    if (!audioCtx) return;
    seatLoading = true;
    fetch("assets/seat.mp3").then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return audioCtx.decodeAudioData(ab); })
      .then(function (buf) { seatBuffer = buf; })
      .catch(function () { seatLoading = false; });
  }
  function loadLeaveSound() {
    if (!audioCtx) return;
    leaveLoading = true;
    fetch("assets/roomleave.mp3").then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return audioCtx.decodeAudioData(ab); })
      .then(function (buf) { leaveBuffer = buf; })
      .catch(function () { leaveLoading = false; });
  }
  function loadHitSound() {
    if (!audioCtx) return;
    hitLoading = true;
    fetch("assets/hit.mp3").then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return audioCtx.decodeAudioData(ab); })
      .then(function (buf) { hitBuffer = buf; })
      .catch(function () { hitLoading = false; });
  }
  function playHit(strength) {
    if (soundMuted || !audioCtx || !hitBuffer) return;
    if (!isAlkFamily(curGame)) return;
    if (strength < 1.2) return;
    var now = Date.now(); if (now - lastHitAt < 35) return; lastHitAt = now;
    var t = Math.min(1, strength / 18);
    var src = audioCtx.createBufferSource(); src.buffer = hitBuffer;
    var g = audioCtx.createGain(); g.gain.value = 0.35 + 0.65 * t;
    src.playbackRate.value = 0.92 + 0.28 * t;
    src.connect(g); g.connect(audioCtx.destination); src.start();
  }
  function playSample(buf) {
    if (soundMuted || !audioCtx || !buf) return;
    var src = audioCtx.createBufferSource();
    src.buffer = buf; src.connect(audioCtx.destination); src.start();
  }
  function playRoomEnter() { playSample(inoutBuffer); lastRoomSoundAt = Date.now(); }
  function playRoomLeave() { playSample(leaveBuffer); lastRoomSoundAt = Date.now(); }
  function maybeSeatSound() {
    var ns = G.seats || { black: null, white: null };
    var settled = joinedAt && Date.now() - joinedAt > 2000;
    if (settled && seatSoundArmed) {
      var sat = (ns.black && ns.black !== prevSeats.black) || (ns.white && ns.white !== prevSeats.white);
      if (sat && isOmokFamily(curGame) && Date.now() - lastRoomSoundAt > 400) playSample(seatBuffer);
    }
    prevSeats = { black: ns.black, white: ns.white };
    seatSoundArmed = true;
  }
  function silentWavUri(seconds) {
    var sr = 8000, n = Math.floor(sr * seconds), total = 44 + n * 2;
    var b = new ArrayBuffer(total), v = new DataView(b);
    function ws(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    ws(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, n * 2, true);
    var u = new Uint8Array(b), bin = "";
    for (var i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return "data:audio/wav;base64," + btoa(bin);
  }
  function unlockSilentSwitch() {
    try {
      if (!silenceEl) {
        silenceEl = document.createElement("audio");
        silenceEl.id = "silence-el";
        silenceEl.setAttribute("playsinline", "");
        silenceEl.setAttribute("webkit-playsinline", "");
        silenceEl.loop = true;
        silenceEl.style.display = "none";
        silenceEl.src = silentWavUri(1);
        document.body.appendChild(silenceEl);
      }
      var p = silenceEl.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }
  function loadStoneSound() {
    if (!audioCtx) return;
    stoneLoading = true;
    fetch("assets/stone.mp3").then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return audioCtx.decodeAudioData(ab); })
      .then(function (buf) { stoneBuffer = buf; })
      .catch(function () { stoneLoading = false; });
  }
  function playStone() {
    if (soundMuted || !audioCtx) return;
    if (stoneBuffer) {
      var src = audioCtx.createBufferSource();
      src.buffer = stoneBuffer;
      src.connect(audioCtx.destination);
      src.start();
      return;
    }
    var t = audioCtx.currentTime;
    var osc = audioCtx.createOscillator(), g = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1150, t);
    osc.frequency.exponentialRampToValueAtTime(380, t + 0.06);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.1);
    var len = Math.floor(audioCtx.sampleRate * 0.03);
    var buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    var noise = audioCtx.createBufferSource(); noise.buffer = buf;
    var hp = audioCtx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1600;
    var ng = audioCtx.createGain(); ng.gain.value = 0.18;
    noise.connect(hp); hp.connect(ng); ng.connect(audioCtx.destination);
    noise.start(t); noise.stop(t + 0.03);
  }
  function stoneCount() {
    var n = 0;
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (G.board[r][c]) n++;
    return n;
  }

  // ---------- 규칙 ----------
  function ruleDiagram(title, desc, cells, mark) {
    var n = 5, cell = 26, pad = 13, w = pad * 2 + cell * (n - 1);
    var s = '<div class="rule-item"><svg viewBox="0 0 ' + w + ' ' + w + '" class="rule-svg"><rect x="0" y="0" width="' + w + '" height="' + w + '" fill="#E8C88A" rx="6"/><g stroke="#9A7B45" stroke-width="1">';
    for (var i = 0; i < n; i++) { var q = pad + i * cell; s += '<line x1="' + pad + '" y1="' + q + '" x2="' + (w - pad) + '" y2="' + q + '"/><line x1="' + q + '" y1="' + pad + '" x2="' + q + '" y2="' + (w - pad) + '"/>'; }
    s += '</g>';
    for (var k = 0; k < cells.length; k++) {
      var cx = pad + cells[k][1] * cell, cy = pad + cells[k][0] * cell;
      var col = cells[k][2] === 1 ? "#1A1A1A" : "#F7F7F2", st = cells[k][2] === 1 ? "#000" : "#B9B4A6";
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="10" fill="' + col + '" stroke="' + st + '"/>';
    }
    if (mark) {
      var mx = pad + mark[1] * cell, my = pad + mark[0] * cell;
      s += '<line x1="' + (mx - 7) + '" y1="' + (my - 7) + '" x2="' + (mx + 7) + '" y2="' + (my + 7) + '" stroke="#D23B3B" stroke-width="3"/><line x1="' + (mx + 7) + '" y1="' + (my - 7) + '" x2="' + (mx - 7) + '" y2="' + (my + 7) + '" stroke="#D23B3B" stroke-width="3"/>';
    }
    s += '</svg><div class="rule-desc"><b>' + title + '</b><br>' + desc + '</div></div>';
    return s;
  }
  function buildRules() {
    var html = '<p class="rule-intro">기본은 <b>먼저 5개를 나란히</b> 놓으면 이깁니다. 흑(선공)에게만 아래 3가지 <b class="red">금수</b>(둘 수 없는 자리)가 있어요. 판에서 <span class="red">✕</span>로 표시됩니다.</p>';
    html += ruleDiagram("삼삼 (3·3) 금지", "열린 3을 두 방향으로 동시에 만드는 자리.", [[2, 1, 1], [2, 3, 1], [1, 2, 1], [3, 2, 1]], [2, 2]);
    html += ruleDiagram("사사 (4·4) 금지", "4를 두 방향으로 동시에 만드는 자리.", [[2, 0, 1], [2, 1, 1], [2, 3, 1], [0, 2, 1], [1, 2, 1], [3, 2, 1]], [2, 2]);
    html += ruleDiagram("장목 (6목 이상) 금지", "6개 넘게 이어지면 승리가 아니라 금수. 정확히 5개여야 승리.", [[2, 0, 1], [2, 1, 1], [2, 3, 1], [2, 4, 1]], [2, 2]);
    html += '<p class="rule-foot">백은 이런 제한이 없습니다.</p>';
    if ($("rules-title")) $("rules-title").textContent = "렌주 오목 규칙";
    $("rules-body").innerHTML = html;
  }
  function buildAlkRules() {
    if ($("rules-title")) $("rules-title").textContent = "알까기 규칙";
    var html = '<p class="rule-intro">바둑알을 손가락으로 <b>튕겨</b> 상대 알을 판 밖으로 쳐내는 게임입니다.</p>';
    html += '<p class="rule-foot" style="text-align:left;line-height:1.8">'
      + '· 내 차례에 <b>내 알 하나</b>를 당겼다 놓아 튕깁니다.<br>'
      + '· <b>상대 알</b>을 판 밖으로 쳐내면 그 알은 사라집니다.<br>'
      + '· <b>내 알</b>이 판 밖으로 나가도 사라집니다(손해).<br>'
      + '· 한 번에 두 개 이상 쳐낼 수도 있어요.<br>'
      + '· <b>상대 알이 다 나가면 승리</b>.</p>';
    $("rules-body").innerHTML = html;
  }
  function buildTerrRules() {
    if ($("rules-title")) $("rules-title").textContent = "점령전 규칙";
    var html = '<p class="rule-intro">가운데 <b>과녁</b> 중심에 가깝게 내 알을 튕겨 붙이는 게임입니다.</p>';
    html += '<p class="rule-foot" style="text-align:left;line-height:1.8">'
      + '· 내 차례에 바깥 선에서 알을 놓고, 과녁 쪽으로 당겼다 놓아 튕깁니다.<br>'
      + '· 과녁에 가까울수록 높은 점수 — <b>가운데 3점 · 중간 고리 2점 · 바깥 고리 1점</b>.<br>'
      + '· 컬링처럼 상대 알을 밀어내거나 밀고 들어가 자리를 차지할 수 있어요.<br>'
      + '· 흑·백이 알을 다 쓰면 <b>알들의 총점이 높은 쪽이 승리</b>.<br>'
      + '· 백이 마지막에 던져 유리하므로, 공정하게 <b>흑에게 덤 +' + TERR_KOMI + '점</b>을 더해 계산합니다.</p>';
    $("rules-body").innerHTML = html;
  }
  function showRules(game) {
    var ctrl = gameController(game);
    if (ctrl && ctrl.rules) {
      var content = ctrl.rules();
      if ($("rules-title")) $("rules-title").textContent = content.title || (gameName(game) + " 규칙");
      $("rules-body").innerHTML = content.html || "";
    } else if (game === "alk") buildAlkRules();
    else if (game === "terr") buildTerrRules();
    else buildRules();
    openModal("rules-modal");
  }

  // ---------- 이벤트 ----------
  function openModal(id) { $(id).classList.remove("hidden"); }
  function renderCreateGameOptions(selected) {
    var box = $("create-game"); if (!box) return selected || "omok";
    var ids = window.GameCatalog ? GameCatalog.order : ["omok", "alk", "alk_terr"];
    if (ids.indexOf(selected) < 0) selected = ids[0] || "omok";
    box.innerHTML = ids.map(function (id) {
      var label = id === "catchmind" ? gameName(id) + " 테스트중" : gameName(id);
      return '<button class="radio-chip' + (id === selected ? ' active' : '') + '" data-game="' + esc(id) + '">' + esc(label) + '</button>';
    }).join("");
    return selected;
  }
  function openMenu() {
    if ($("menu-main")) $("menu-main").classList.remove("hidden");
    if ($("menu-rules")) $("menu-rules").classList.add("hidden");
    if ($("menu-title")) $("menu-title").textContent = "메뉴";
    openModal("menu-modal");
  }
  function requestBegin() {
    if (!(G.seats.black && G.seats.white)) { toast("흑·백 두 자리가 다 차야 시작해요"); return; }
    if (netMode && sendBeginRequest("omok")) return;
    if (netMode && !amHost) { Net.send({ t: "begin", by: me.nick, gseq: G.gameSeq }); return; }
    beginGame(me.nick);
  }
  var omokSolo = false;
  var omokAI = { on: false, level: null, color: WHITE, human: "black" };
  var aiHumanColor = "black";
  var aiPending = false;
  var AI_NICK = "AI";
  var AI_THINK_DELAY_MS = 1000;
  var aiThinkSeq = 0;
  function aiLevelName(lv) { return lv === "easy" ? "초보" : lv === "medium" ? "중수" : lv === "master" ? "초고수" : "고수"; }
  function seatDisplay(nick) { return nick === AI_NICK ? aiLevelName(omokAI.level) : nick; }
  function startOmokSolo() {
    if (netMode && roster.length > 1) { toast("혼자 연습은 방에 나 혼자 있을 때만 돼요"); return; }
    omokSolo = true; omokAI.on = false;
    G.seats = { black: me.nick, white: me.nick };
    beginGame(me.nick);
    renderPresenceUI();
    toast("혼자 연습 — 흑·백 번갈아 둬보세요");
  }
  function startAiGame(level, humanColor) {
    if (!window.OmokAI) { toast("AI를 불러오지 못했어요"); return; }
    humanColor = (humanColor === "white") ? "white" : "black";
    omokSolo = false; omokAI.on = true; omokAI.level = level; aiPending = false;
    omokAI.human = humanColor;
    omokAI.color = (humanColor === "white") ? BLACK : WHITE;
    G.seats = (humanColor === "white") ? { black: AI_NICK, white: me.nick } : { black: me.nick, white: AI_NICK };
    beginGame(me.nick);
    renderPresenceUI();
    broadcastRoomOpen();
    aiTick();
    var nm = aiLevelName(level);
    toast(nm + "와 대국 — 당신은 " + (humanColor === "white" ? "백(후공)" : "흑(선공)"));
  }
  function aiTick() {
    if (!omokAI.on || G.over || !G.started || aiPending) return;
    if (G.turn !== omokAI.color) return;
    aiPending = true;
    var token = ++aiThinkSeq, startedAt = Date.now(), gameSeq = G.gameSeq;
    var hlen = G.history ? G.history.length : 0;
    setTimeout(function () {
      if (token !== aiThinkSeq || !omokAI.on || G.over || !G.started || G.turn !== omokAI.color) { aiPending = false; return; }
      var mv = window.OmokAI.bestMove(G.board, omokAI.color, omokAI.level);
      var wait = Math.max(0, AI_THINK_DELAY_MS - (Date.now() - startedAt));
      function applyAiMove() {
        aiPending = false;
        if (token !== aiThinkSeq || !omokAI.on || G.over || !G.started || G.turn !== omokAI.color) return;
        if (G.gameSeq !== gameSeq || (G.history ? G.history.length : 0) !== hlen) return;
        if (mv) hostApplyMove(AI_NICK, mv[0], mv[1]);
      }
      if (wait > 0) setTimeout(applyAiMove, wait);
      else applyAiMove();
    }, 0);
  }
  function onCenterBtn() {
    var b = $("center-btn");
    if (b && b.dataset.act === "solo") startOmokSolo(); else requestBegin();
  }
  function onSeatChipTap(color) {
    if (!netMode) return;
    var occ = G.seats[color];
    if (occ === me.nick) {
      if (G.started && !G.over) $("leave-modal").classList.remove("hidden");
      else requestSeat(me.nick, "spec");
    } else if (!occ) {
      requestSeat(me.nick, color);
    } else if (occ === AI_NICK && (!G.started || G.over)) {
      requestSeat(me.nick, color);
    }
  }

  function bind() {
    $("enter-btn").addEventListener("click", enter);
    $("pw").addEventListener("keydown", function (e) { if (e.key === "Enter") enter(); });
    $("nick").addEventListener("keydown", function (e) { if (e.key === "Enter") $("pw").focus(); });

    canvas = $("board");
    var tStart = null, lastTouch = 0;
    canvas.addEventListener("touchstart", function (e) {
      var t = e.touches[0];
      tStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: true });
    canvas.addEventListener("touchend", function (e) {
      lastTouch = Date.now();
      if (!tStart) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - tStart.x, dy = t.clientY - tStart.y;
      var moved = Math.sqrt(dx * dx + dy * dy);
      var dt = Date.now() - tStart.time;
      tStart = null;
      if (moved < 12 && dt < 600) onBoardTap({ clientX: t.clientX, clientY: t.clientY });
    }, { passive: true });
    canvas.addEventListener("click", function (e) {
      if (Date.now() - lastTouch < 700) return;
      onBoardTap(e);
    });

    $("online-head").addEventListener("click", function () { renderPlayersList(); openModal("players-modal"); });
    $("alk-online-head").addEventListener("click", function () { renderPlayersList(); openModal("players-modal"); });
    $("menu-btn").addEventListener("click", openMenu);
    $("menu-rules-btn").addEventListener("click", function () { $("menu-main").classList.add("hidden"); $("menu-rules").classList.remove("hidden"); if ($("menu-title")) $("menu-title").textContent = "규칙"; });
    $("menu-rules-back").addEventListener("click", function () { $("menu-rules").classList.add("hidden"); $("menu-main").classList.remove("hidden"); if ($("menu-title")) $("menu-title").textContent = "메뉴"; });
    var rbtns = document.querySelectorAll("#menu-rules [data-rules]");
    for (var rb = 0; rb < rbtns.length; rb++) rbtns[rb].addEventListener("click", function () { $("menu-modal").classList.add("hidden"); showRules(this.getAttribute("data-rules")); });
    $("rank-btn").addEventListener("click", function () { openRank("omok"); });
    $("rank-info-btn").addEventListener("click", function () { renderRankInfo(); openModal("rank-info-modal"); });
    $("alk-rank-btn").addEventListener("click", function () { openRank(curRoomGame === "alk_terr" ? "alk_terr" : "alk"); });
    var rtabs = document.querySelectorAll("#rank-tabs .rtab");
    for (var rt = 0; rt < rtabs.length; rt++) rtabs[rt].addEventListener("click", function () { rankTab = this.getAttribute("data-g"); renderSeason(); });
    $("confirm-place").addEventListener("click", confirmPlace);
    $("center-btn").addEventListener("click", onCenterBtn);
    var swapBtn = $("swap-btn");
    if (swapBtn) swapBtn.addEventListener("click", function () { requestSeatSwap("omok"); });
    $("ai-btn").addEventListener("click", function () { $("center-btn").classList.add("hidden"); $("ai-btn").classList.add("hidden"); $("ai-levels").classList.remove("hidden"); });
    $("ai-cancel").addEventListener("click", function () { $("ai-levels").classList.add("hidden"); updateCenterButton(); });
    var cbtns = document.querySelectorAll(".colorbtn[data-color]");
    for (var ci = 0; ci < cbtns.length; ci++) cbtns[ci].addEventListener("click", function () {
      aiHumanColor = this.getAttribute("data-color");
      for (var k = 0; k < cbtns.length; k++) cbtns[k].classList.toggle("active", cbtns[k] === this);
    });
    var lvb = document.querySelectorAll(".lvbtn[data-ai]");
    for (var li = 0; li < lvb.length; li++) lvb[li].addEventListener("click", function () { startAiGame(this.getAttribute("data-ai"), aiHumanColor); });
    $("omok-again").addEventListener("click", function () { if (omokSolo) startOmokSolo(); else if (omokAI.on) startAiGame(omokAI.level, omokAI.human); else requestBegin(); });
    $("omok-win-rank").addEventListener("click", function () { openRank("omok"); });
    $("timer-box").addEventListener("click", function () {
      if (canSetTimer()) { syncTimerChips(); syncPauseButton(); openModal("settings-modal"); }
      else toast("방장이나 관리자만 시간을 바꿀 수 있어요");
    });
    $("chip-black").addEventListener("click", function () { onSeatChipTap("black"); });
    $("chip-white").addEventListener("click", function () { onSeatChipTap("white"); });
    $("leave-yes").addEventListener("click", function () { $("leave-modal").classList.add("hidden"); requestSeat(me.nick, "spec"); });
    $("leave-no").addEventListener("click", function () { $("leave-modal").classList.add("hidden"); });
    $("leave-void").addEventListener("click", sendVoidRequest);
    $("void-accept").addEventListener("click", function () {
      $("void-modal").classList.add("hidden");
      if (netMode) { if (voidReqFrom) Net.send({ t: "void_res", accept: true, from: voidReqFrom, gseq: voidReqGseq }); }
      else hostVoidGame(voidReqFrom);
      voidReqFrom = null;
    });
    $("void-decline").addEventListener("click", function () {
      $("void-modal").classList.add("hidden");
      if (netMode && voidReqFrom) Net.send({ t: "void_res", accept: false, from: voidReqFrom });
      voidReqFrom = null;
    });
    $("allow-add-btn").addEventListener("click", function () {
      var v = $("allow-input").value.trim(); if (!v) return;
      Db.addAllowed(v).then(function (r) {
        if (r && r.error) { toast("추가 실패(이미 있거나 오류)"); return; }
        toast(v + " 명단 추가"); $("allow-input").value = ""; renderAllowlist();
      });
    });
    $("undo-btn").addEventListener("click", sendUndoRequest);
    $("resign-btn").addEventListener("click", function () { openModal("resign-modal"); });
    $("draw-btn").addEventListener("click", sendDrawRequest);
    $("draw-ask-yes").addEventListener("click", function () { respondDrawAskAuto(true); });
    $("draw-ask-no").addEventListener("click", function () { respondDrawAskAuto(false); });
    $("draw-accept").addEventListener("click", function () {
      $("draw-modal").classList.add("hidden");
      if (netMode) Net.send({ t: "draw_res", accept: true, from: drawReqFrom, gseq: drawReqGseq });
      else hostDrawGame();
      drawReqFrom = null;
    });
    $("draw-decline").addEventListener("click", function () {
      $("draw-modal").classList.add("hidden");
      if (netMode && drawReqFrom) Net.send({ t: "draw_res", accept: false, from: drawReqFrom });
      drawReqFrom = null;
    });
    $("begin-accept").addEventListener("click", function () { respondBeginRequest(true); });
    $("begin-decline").addEventListener("click", function () { respondBeginRequest(false); });
    var swapAccept = $("swap-accept"), swapDecline = $("swap-decline");
    if (swapAccept) swapAccept.addEventListener("click", function () { respondSwapRequest(true); });
    if (swapDecline) swapDecline.addEventListener("click", function () { respondSwapRequest(false); });
    $("resign-yes").addEventListener("click", function () { $("resign-modal").classList.add("hidden"); requestResign(); });
    $("resign-no").addEventListener("click", function () { $("resign-modal").classList.add("hidden"); });
    $("undo-accept").addEventListener("click", function () {
      $("undo-modal").classList.add("hidden");
      if (netMode) Net.send({ t: "undo_res", accept: true, from: me.nick, gseq: undoReqCtx ? undoReqCtx.gseq : G.gameSeq, hlen: undoReqCtx ? undoReqCtx.hlen : G.history.length });
      else performUndo();
    });
    $("undo-decline").addEventListener("click", function () {
      $("undo-modal").classList.add("hidden");
      if (netMode) Net.send({ t: "undo_res", accept: false, from: me.nick });
    });
    $("admin-btn").addEventListener("click", function () { $("menu-modal").classList.add("hidden"); openAdmin(); });
    $("logout-btn").addEventListener("click", function () { clearAuth(); location.reload(); });

    var closers = document.querySelectorAll("[data-close]");
    for (var i = 0; i < closers.length; i++) closers[i].addEventListener("click", function (e) { var m = e.target.closest(".modal-overlay"); if (m) { if (m.id === "begin-modal") beginReqCtx = null; if (m.id === "swap-modal") swapReqCtx = null; m.classList.add("hidden"); } });
    var overlays = document.querySelectorAll(".modal-overlay");
    for (var j = 0; j < overlays.length; j++) overlays[j].addEventListener("click", function (e) { if (e.target === this) { if (this.id === "begin-modal") beginReqCtx = null; if (this.id === "swap-modal") swapReqCtx = null; this.classList.add("hidden"); } });

    var chips = document.querySelectorAll("#timer-options .radio-chip");
    for (var k = 0; k < chips.length; k++) chips[k].addEventListener("click", function () {
      requestSetTimer(parseInt(this.getAttribute("data-sec"), 10));
    });
    $("pause-toggle").addEventListener("click", requestTogglePause);

    $("chat-input").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing) sendChat("omok"); });
    $("alk-chat-input").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing) sendChat("alk"); });
    $("chat-log").addEventListener("scroll", function () { if (this.scrollTop < 40) loadOlderChat(); });
    $("alk-menu-btn").addEventListener("click", openMenu);
    $("leave-room-btn").addEventListener("click", requestLeaveRoom);
    $("alk-leave-room-btn").addEventListener("click", requestLeaveRoom);
    $("leaveroom-yes").addEventListener("click", function () { $("leaveroom-modal").classList.add("hidden"); leaveRoomToLobby(); });
    $("leaveroom-no").addEventListener("click", function () { $("leaveroom-modal").classList.add("hidden"); });
    $("replay-first").addEventListener("click", function () { replayIdx = 0; renderReplay(); });
    $("replay-prev").addEventListener("click", function () { if (replayIdx > 0) { replayIdx--; renderReplay(); } });
    $("replay-next").addEventListener("click", function () { if (replayIdx < replayMoves.length) { replayIdx++; renderReplay(); } });
    $("replay-last").addEventListener("click", function () { replayIdx = replayMoves.length; renderReplay(); });
    $("replay-close").addEventListener("click", function () { $("replay-modal").classList.add("hidden"); });

    // 로비
    $("lobby-menu-btn").addEventListener("click", openMenu);
    $("lobby-rank-btn").addEventListener("click", function () { openRank("all"); });
    $("lobby-chat-input").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing) sendLobbyChat(); });
    $("create-room-btn").addEventListener("click", function () { openModal("create-modal"); });
    var createGame = renderCreateGameOptions("omok");
    var cchips = document.querySelectorAll("#create-game .radio-chip");
    for (var ci = 0; ci < cchips.length; ci++) cchips[ci].addEventListener("click", function () {
      createGame = this.getAttribute("data-game");
      var all = document.querySelectorAll("#create-game .radio-chip");
      for (var y = 0; y < all.length; y++) all[y].classList.toggle("active", all[y] === this);
    });
    $("create-confirm").addEventListener("click", function () {
      $("create-modal").classList.add("hidden");
      var nm = $("create-name").value; $("create-name").value = "";
      createRoom(createGame, nm);
    });
    $("alk-chipB").addEventListener("click", function () { onAlkChipTap("black"); });
    $("alk-chipW").addEventListener("click", function () { onAlkChipTap("white"); });
    $("alk-center-btn").addEventListener("click", function () {
      var b = $("alk-center-btn");
      if (b && b.dataset.act === "solo") { if (curRoomGame === "alk_terr") startTerritorySolo(); else startAlkSolo(); }
      else requestAlkBegin();
    });
    var alkSwapBtn = $("alk-swap-btn");
    if (alkSwapBtn) alkSwapBtn.addEventListener("click", function () { requestSeatSwap("alk"); });
    $("alk-again").addEventListener("click", function () { if (alkSolo) { if (A.mode === "territory") startTerritorySolo(); else startAlkSolo(); } else requestAlkBegin(); });

    soundMuted = localStorage.getItem("omok_mute") === "1";
    function syncMuteIcons() { var t = soundMuted ? "🔇 소리 꺼짐" : "🔊 소리 켜짐"; if ($("menu-sound-btn")) $("menu-sound-btn").textContent = t; }
    function toggleMute() {
      soundMuted = !soundMuted;
      localStorage.setItem("omok_mute", soundMuted ? "1" : "0");
      syncMuteIcons();
      if (!soundMuted) { initAudio(); playStone(); }
    }
    syncMuteIcons();
    $("menu-sound-btn").addEventListener("click", toggleMute);

    // 자동로그인 등으로 로그인 클릭이 없어도, 첫 사용자 상호작용에 소리 활성화(브라우저 자동재생 정책 해제)
    function unlockAudio() {
      initAudio();
      if (audioCtx && audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
      if (audioCtx && audioCtx.state === "running") {
        ["pointerdown", "touchend", "click"].forEach(function (ev) { document.removeEventListener(ev, unlockAudio, true); });
      }
    }
    ["pointerdown", "touchend", "click"].forEach(function (ev) { document.addEventListener(ev, unlockAudio, true); });

    tryAutoLogin();
  }

  window.__omok = {
    G: G, me: me, render: render, submitMove: submitMove, Renju: Renju,
    _applyState: applyState, _snapshot: snapshot, _overlay: pushOverlay, _replay: openReplay,
    get amHost() { return amHost; }, get roster() { return roster; }, get netMode() { return netMode; }
  };
  document.addEventListener("DOMContentLoaded", bind);
})();
