window.CatchMind = (function () {
  "use strict";

  var ROUND_MS = 90000;
  var ROUND_COUNTDOWN_MS = 5000;
  var DRAWER_GRACE_MS = 15000;
  var GUESS_SCORE_MAX = 10;
  var GUESS_SCORE_MIN = 5;
  var GUESS_SCORE_STEP_MS = 15000;
  var GUESS_RANK_POINTS = 10;
  var DRAWER_RANK_POINTS = 3;
  var SECRET_RECOVERY_MS = 3000;
  var REVEAL_MS = 3000;
  var DRAW_SEND_MS = 60;
  var CANVAS_BG = "#ffffff";
  var PEN_COLORS = ["#17252f", "#d23b3b"];
  var PEN_WIDTHS = [8, 24];
  var ERASER_WIDTH = 90;
  var MAX_STROKE_WIDTH = 96;
  var PALETTE_COLORS = [
    "#17252f", "#4b5563", "#9ca3af", "#ffffff", "#7c4a2d", "#d23b3b",
    "#be123c", "#f97316", "#facc15", "#84cc16", "#22c55e", "#14b8a6",
    "#06b6d4", "#38bdf8", "#2474b5", "#4338ca", "#8b5cf6", "#ec4899"
  ];
  var COLOR_STORAGE_KEY = "catchmind.quickColors.v1";
  var MAX_STROKES = 100;
  var MAX_POINTS_PER_STROKE = 600;
  var MAX_CANVAS_POINTS = 3200;
  var MAX_PLAYERS = 40;
  var MAX_SCORE = 1000000;
  var MAX_FEED_LINES = 5;
  var FEED_KINDS = ["guess", "correct", "answer", "system"];
  var REACTION_EMOJIS = ["🤣", "😲", "🫣", "😜", "😭", "🤯", "❓", "🙏", "👍", "⏳", "❤️", "😈"];
  var MAX_ACTIVE_REACTIONS = 6;
  var REACTION_USER_COOLDOWN_MS = 700;
  var REACTION_OUTPUT_GAP_MS = 180;
  var MAX_REACTION_QUEUE = 12;
  var GALLERY_IMAGE_SIZE = 480;
  var GALLERY_IMAGE_QUALITY = 0.72;
  var GALLERY_PAGE_SIZE = 40;
  var GALLERY_FAVORITE_LIMIT = 20;
  var CATCH_BGM_SRC = "assets/catchmind-bgm.mp3";
  var CATCH_BGM_VOLUME = 0.04;
  var START_SFX_SRC = "assets/catchmind-start.mp3";
  var START_SFX_VOLUME = 1;
  var COUNTDOWN_SFX_SRC = "assets/catchmind-countdown.wav";
  var COUNTDOWN_SFX_VOLUME = 1;
  var CLEAR_SFX_SRC = "assets/catchmind-clear.mp3";
  var CLEAR_SFX_VOLUME = 1;
  var FINISH_SFX_SRC = "assets/catchmind-finish.wav";
  var FINISH_SFX_VOLUME = 0.38;
  var RECORD_STATUSES = ["idle", "pending", "saved", "failed", "skipped"];
  var SAVE_RETRY_DELAYS = [1000, 3000, 7000];
  var FALLBACK_WORDS = [
    "가방", "가위", "강아지", "거북이", "고양이", "공룡", "기차", "나무", "냉장고", "눈사람",
    "다리미", "달팽이", "도넛", "딸기", "라면", "로봇", "마이크", "모자", "문어", "바나나",
    "비행기", "사과", "선풍기", "수박", "스케이트", "시계", "신발", "안경", "야구공", "양말",
    "우산", "우주선", "의자", "자동차", "자전거", "전구", "전화기", "주전자", "지갑", "집",
    "책", "축구공", "카메라", "케이크", "코끼리", "컴퓨터", "토끼", "피아노", "해바라기", "헬리콥터",
    "김밥", "나비", "농구공", "드라이기", "마우스", "배", "버스", "병아리", "사다리", "소방차",
    "아이스크림", "연필", "오리", "왕관", "요요", "잠자리", "칫솔", "태양", "트럭", "풍선"
  ];

  var api = null;
  var state = freshState();
  var secretWord = null;
  var usedWords = Object.create(null);
  var previousHost = false;
  var canvas = null;
  var ctx = null;
  var bound = false;
  var tickId = null;
  var drawing = false;
  var currentStroke = null;
  var selectedTool = "pen";
  var selectedColorSlot = 0;
  var paletteTarget = "pen";
  var selectedColor = PEN_COLORS[0];
  var reactionSeq = 0;
  var reactionQueue = [];
  var reactionPumpTimer = null;
  var reactionLastOutputAt = 0;
  var reactionLastBy = Object.create(null);
  var reactionScope = "";
  var bgmEl = null;
  var bgmPlayPending = false;
  var startSfxEl = null;
  var startSfxPlayPending = false;
  var lastStartSfxMatchId = null;
  var countdownSfxEl = null;
  var lastCountdownCue = "";
  var clearSfxEl = null;
  var finishSfxEl = null;
  var lastFinishSfxMatchId = null;
  var lastStrokeSend = 0;
  var pendingStrokeTimer = null;
  var strokeSentCount = 0;
  var canvasLimitNotified = false;
  var saveTimer = null;
  var pendingSave = null;
  var guessTimes = Object.create(null);
  var stateHost = null;
  var lastSyncRequestAt = 0;
  var lastCanvasRequestAt = 0;
  var resultInfo = null;
  var resultInfoMatchId = null;
  var resultLoadMatchId = null;
  var resultLoadToken = 0;
  var resultPopupShownMatchId = null;
  var lastChatViewScope = "";
  var galleryMode = "recent";
  var galleryRows = [];
  var galleryOffset = 0;
  var galleryHasMore = false;
  var galleryFavoriteCount = 0;
  var galleryLoading = false;
  var galleryError = "";
  var galleryRequestToken = 0;
  var gallerySavedRounds = Object.create(null);

  function freshState() {
    return {
      phase: "idle",
      rev: 0,
      matchId: null,
      queue: [],
      spectators: [],
      ready: [],
      roundIndex: 0,
      drawer: null,
      guessers: [],
      deadline: null,
      nextAt: null,
      pauseKind: null,
      pauseUntil: null,
      pausedRemainMs: null,
      scores: Object.create(null),
      stats: Object.create(null),
      correct: Object.create(null),
      strokes: [],
      canvasBg: CANVAS_BG,
      drawSeq: 0,
      feed: [],
      revealWord: null,
      wordLength: 0,
      recordStatus: "idle",
      resultRatings: []
    };
  }

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch];
    });
  }
  function me() { return api ? api.me() : { nick: "", isAdmin: false }; }
  function people() { return api ? api.roster() : []; }
  function orderedPeople() {
    return people().filter(function (person) { return person && person.nick; }).slice().sort(function (a, b) {
      return (a.joinTs || 0) - (b.joinTs || 0) || String(a.nick).localeCompare(String(b.nick));
    });
  }
  function activePeople() { return people().filter(function (p) { return p && p.nick && !p.away; }); }
  function activeNicks() { return activePeople().map(function (p) { return p.nick; }); }
  function has(arr, value) { return arr.indexOf(value) >= 0; }
  function sameList(a, b) {
    return a.length === b.length && a.every(function (value, index) { return value === b[index]; });
  }
  function orderedActivePeople() {
    return orderedPeople().filter(function (person) { return !person.away; });
  }
  function desiredParticipantPeople() {
    var spectators = state.spectators || [];
    return orderedActivePeople().filter(function (person) { return !has(spectators, person.nick); });
  }
  function desiredParticipantNicks() {
    return desiredParticipantPeople().map(function (person) { return person.nick; });
  }
  function desiredSpectatorPeople() {
    var spectators = state.spectators || [];
    return orderedActivePeople().filter(function (person) { return has(spectators, person.nick); });
  }
  function waitingParticipantPeople() {
    var spectators = state.spectators || [];
    return orderedPeople().filter(function (person) { return !has(spectators, person.nick); });
  }
  function waitingSpectatorPeople() {
    var spectators = state.spectators || [];
    return orderedPeople().filter(function (person) { return has(spectators, person.nick); });
  }
  function canChangeRole() {
    return state.phase === "idle" || state.phase === "finished";
  }
  function requiredReadyNicks() {
    var hostNick = api && api.host ? safeNick(api.host()) : "";
    return desiredParticipantNicks().filter(function (nick) {
      return nick !== hostNick;
    });
  }
  function allParticipantsReady() {
    var participants = desiredParticipantNicks();
    if (!api || participants.length < 2 || !has(participants, safeNick(api.host()))) return false;
    return requiredReadyNicks().every(function (nick) {
      return has(state.ready || [], nick);
    });
  }
  function isGroupedChatPhase() {
    return state.phase === "countdown" || state.phase === "drawing" || state.phase === "reveal";
  }
  function chatGroupFor(nick) {
    nick = safeNick(nick);
    if (!isGroupedChatPhase() || !nick) return "all";
    if (!has(state.queue, nick)) return "lounge";
    if ((state.phase === "drawing" || state.phase === "reveal") && state.correct[nick]) return "lounge";
    return "players";
  }
  function canViewChatGroup(nick, group) {
    var ownGroup = chatGroupFor(nick);
    return group === "all" || ownGroup === "all" || ownGroup === group
      || (ownGroup === "lounge" && group === "players");
  }
  function chatOverlaySide(group) {
    return state.phase === "countdown" || group === "lounge" ? "right" : "";
  }
  function normalize(value) { return String(value || "").toLowerCase().replace(/[\s\-_.!,?]/g, ""); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function safeInteger(value, min, max, fallback) {
    var parsed = Number(value);
    if (!isFinite(parsed)) return fallback;
    return clamp(Math.floor(parsed), min, max);
  }
  function safeText(value, max) { return String(value == null ? "" : value).slice(0, max); }
  function safeReactionEmoji(value) {
    value = String(value == null ? "" : value);
    return has(REACTION_EMOJIS, value) ? value : "";
  }
  function safeColor(value) {
    var color = String(value == null ? "" : value).trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : null;
  }
  function safeStrokeColor(value) {
    if (String(value).toLowerCase() === CANVAS_BG) return CANVAS_BG;
    return safeColor(value) || PEN_COLORS[0];
  }
  function loadPenColors() {
    if (!window.localStorage) return;
    try {
      var saved = JSON.parse(window.localStorage.getItem(COLOR_STORAGE_KEY) || "[]");
      if (!Array.isArray(saved)) return;
      for (var i = 0; i < PEN_COLORS.length; i++) PEN_COLORS[i] = safeColor(saved[i]) || PEN_COLORS[i];
    } catch (e) {}
  }
  function savePenColors() {
    if (!window.localStorage) return;
    try { window.localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(PEN_COLORS)); } catch (e) {}
  }
  function safeNick(value) {
    var nick = safeText(value, 40).trim();
    return /^(?:__proto__|prototype|constructor)$/.test(nick) ? "" : nick;
  }
  function safeNickList(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [], seen = Object.create(null);
    for (var i = 0; i < raw.length && out.length < MAX_PLAYERS; i++) {
      var nick = safeNick(raw[i]);
      if (!nick || seen[nick]) continue;
      seen[nick] = true;
      out.push(nick);
    }
    return out;
  }
  function safeDuration(value, max) {
    if (typeof value !== "number" || !isFinite(value)) return null;
    return clamp(Math.round(value), 0, max);
  }
  function safeScores(raw, queue) {
    var out = Object.create(null);
    queue.forEach(function (nick) {
      out[nick] = safeInteger(raw && raw[nick], 0, MAX_SCORE, 0);
    });
    return out;
  }
  function safeStats(raw, queue) {
    var out = Object.create(null);
    queue.forEach(function (nick) {
      var row = raw && raw[nick];
      if (!row || typeof row !== "object") row = {};
      out[nick] = {
        points: safeInteger(row.points, 0, MAX_SCORE, 0),
        maxPoints: safeInteger(row.maxPoints, 0, MAX_SCORE, 0),
        correct: safeInteger(row.correct, 0, MAX_SCORE, 0),
        drawCorrect: safeInteger(row.drawCorrect, 0, MAX_SCORE, 0),
        fastestMs: row.fastestMs == null ? null : safeInteger(row.fastestMs, 0, ROUND_MS, null)
      };
    });
    return out;
  }
  function safeResultRatings(raw, queue) {
    if (!Array.isArray(raw)) return [];
    var out = [], seen = Object.create(null);
    for (var i = 0; i < raw.length && out.length < MAX_PLAYERS; i++) {
      var row = raw[i] && typeof raw[i] === "object" ? raw[i] : {};
      var nick = safeNick(row.nick);
      if (!nick || !has(queue, nick) || seen[nick]) continue;
      var beforeRating = safeInteger(row.beforeRating, 0, MAX_SCORE, null);
      var rating = safeInteger(row.rating, 0, MAX_SCORE, null);
      if (beforeRating == null || rating == null) continue;
      seen[nick] = true;
      out.push({
        nick: nick,
        beforeRating: beforeRating,
        rating: rating,
        delta: safeInteger(row.delta, -MAX_SCORE, MAX_SCORE, rating - beforeRating),
        games: safeInteger(row.games, 0, MAX_SCORE, 0),
        rankText: safeText(row.rankText, 20),
        rankMove: safeInteger(row.rankMove, -MAX_SCORE, MAX_SCORE, 0)
      });
    }
    return out;
  }
  function safeCorrect(raw, guessers) {
    var out = Object.create(null);
    guessers.forEach(function (nick) { if (raw && raw[nick] === true) out[nick] = true; });
    return out;
  }
  function safeFeed(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(-MAX_FEED_LINES).map(function (item) {
      item = item && typeof item === "object" ? item : {};
      var kind = FEED_KINDS.indexOf(item.kind) >= 0 ? item.kind : "guess";
      var channel = item.channel === "players" || item.channel === "all"
        ? item.channel
        : (kind === "guess" ? "players" : "all");
      return { who: safeNick(item.who), text: safeText(item.text, 60), kind: kind, channel: channel };
    });
  }

  function initStats(nick) {
    if (state.scores[nick] == null) state.scores[nick] = 0;
    if (!state.stats[nick]) state.stats[nick] = { points: 0, maxPoints: 0, correct: 0, drawCorrect: 0, fastestMs: null };
    return state.stats[nick];
  }

  function guessScoreForElapsed(elapsedMs) {
    var elapsed = clamp(Number(elapsedMs) || 0, 0, ROUND_MS);
    return clamp(GUESS_SCORE_MAX - Math.floor(elapsed / GUESS_SCORE_STEP_MS), GUESS_SCORE_MIN, GUESS_SCORE_MAX);
  }

  function drawerScoreForGuess(guessScore) {
    if (guessScore >= 9) return 3;
    if (guessScore >= 7) return 2;
    return 1;
  }

  function snapshot() {
    return {
      protocol: 2,
      phase: state.phase,
      rev: state.rev,
      matchId: state.matchId,
      queue: state.queue,
      spectators: state.spectators,
      ready: state.ready,
      roundIndex: state.roundIndex,
      drawer: state.drawer,
      guessers: state.guessers,
      remainMs: state.deadline ? Math.max(0, state.deadline - Date.now()) : null,
      nextRemainMs: state.nextAt ? Math.max(0, state.nextAt - Date.now()) : null,
      pauseKind: state.pauseKind,
      pauseRemainMs: state.pauseUntil ? Math.max(0, state.pauseUntil - Date.now()) : null,
      pausedRemainMs: state.pausedRemainMs,
      scores: state.scores,
      stats: state.stats,
      correct: state.correct,
      strokes: state.strokes,
      canvasBg: state.canvasBg,
      drawSeq: state.drawSeq,
      feed: state.feed,
      revealWord: state.revealWord,
      wordLength: state.wordLength,
      recordStatus: state.recordStatus,
      resultRatings: state.resultRatings,
      recorded: state.recordStatus === "saved"
    };
  }

  function broadcastState() {
    if (!api || !api.isHost()) return;
    api.send({ t: "cm_state", by: me().nick, state: snapshot() });
    api.roomChanged();
  }

  function requestStateSync(force) {
    if (!api || api.isHost()) return;
    var now = Date.now();
    if (!force && now - lastSyncRequestAt < 500) return;
    lastSyncRequestAt = now;
    api.send({ t: "hello", nick: me().nick });
  }

  function requestCanvasSync(force) {
    if (!api || !api.isHost() || state.phase !== "drawing" || state.pauseKind
        || !state.drawer || state.drawer === me().nick) return;
    var now = Date.now();
    if (!force && now - lastCanvasRequestAt < 500) return;
    lastCanvasRequestAt = now;
    api.send({
      t: "cm_canvas_req",
      from: me().nick,
      to: state.drawer,
      matchId: state.matchId,
      roundIndex: state.roundIndex
    });
  }

  function requestCanvasRecovery() {
    if (api && api.isHost()) requestCanvasSync(false);
    else requestStateSync(false);
  }

  function commit() {
    state.rev++;
    broadcastState();
    render();
  }

  function sanitizeSnapshot(next) {
    if (!next || typeof next !== "object") return null;
    var rev = safeInteger(next.rev, 0, Number.MAX_SAFE_INTEGER, null);
    if (rev == null) return null;
    var phases = ["idle", "countdown", "drawing", "reveal", "finished"];
    var phase = phases.indexOf(next.phase) >= 0 ? next.phase : "idle";
    var queue = safeNickList(next.queue);
    var spectators = safeNickList(next.spectators);
    var ready = safeNickList(next.ready).filter(function (nick) {
      return !has(spectators, nick);
    });
    var drawer = safeNick(next.drawer);
    if (!has(queue, drawer)) drawer = null;
    var guessers = safeNickList(next.guessers).filter(function (nick) {
      return nick !== drawer && has(queue, nick);
    });
    var recordStatus = RECORD_STATUSES.indexOf(next.recordStatus) >= 0
      ? next.recordStatus
      : (next.recorded ? "saved" : "idle");
    var pauseKind = next.pauseKind === "drawer" || next.pauseKind === "sync" ? next.pauseKind : null;
    if (phase !== "countdown" && phase !== "drawing") pauseKind = null;
    return {
      phase: phase,
      rev: rev,
      matchId: next.matchId == null ? null : safeText(next.matchId, 80),
      queue: queue,
      spectators: spectators,
      ready: ready,
      roundIndex: safeInteger(next.roundIndex, 0, Math.max(queue.length, 1), 0),
      drawer: drawer,
      guessers: guessers,
      remainMs: safeDuration(next.remainMs, ROUND_MS + 5000),
      nextRemainMs: safeDuration(next.nextRemainMs, REVEAL_MS + 5000),
      pauseKind: pauseKind,
      pauseRemainMs: pauseKind ? safeDuration(next.pauseRemainMs, DRAWER_GRACE_MS + 5000) : null,
      pausedRemainMs: pauseKind ? safeDuration(next.pausedRemainMs, ROUND_MS + 5000) : null,
      scores: safeScores(next.scores, queue),
      stats: safeStats(next.stats, queue),
      correct: safeCorrect(next.correct, guessers),
      strokes: sanitizeStrokes(next.strokes),
      canvasBg: safeColor(next.canvasBg) || CANVAS_BG,
      drawSeq: safeInteger(next.drawSeq, 0, Number.MAX_SAFE_INTEGER, 0),
      feed: safeFeed(next.feed),
      revealWord: next.revealWord == null ? null : safeText(next.revealWord, 40),
      wordLength: safeInteger(next.wordLength, 0, 10, 0),
      recordStatus: recordStatus,
      resultRatings: safeResultRatings(next.resultRatings, queue)
    };
  }

  function applyState(next, authorityChanged) {
    var clean = sanitizeSnapshot(next);
    if (!clean || (!authorityChanged && clean.rev < state.rev)) return false;
    var previousPhase = state.phase;
    var previousMatchId = state.matchId;
    var sameRound = state.matchId === clean.matchId && state.roundIndex === clean.roundIndex;
    if (!authorityChanged && clean.rev === state.rev) {
      if (!sameRound || clean.drawSeq <= state.drawSeq) return false;
      state.strokes = clean.strokes;
      state.canvasBg = clean.canvasBg;
      state.drawSeq = clean.drawSeq;
      redraw();
      return true;
    }
    var keepNewerCanvas = !authorityChanged && sameRound && state.drawSeq > clean.drawSeq;
    state = {
      phase: clean.phase,
      rev: clean.rev,
      matchId: clean.matchId,
      queue: clean.queue,
      spectators: clean.spectators,
      ready: clean.ready,
      roundIndex: clean.roundIndex,
      drawer: clean.drawer,
      guessers: clean.guessers,
      deadline: clean.remainMs != null ? Date.now() + clean.remainMs : null,
      nextAt: clean.nextRemainMs != null ? Date.now() + clean.nextRemainMs : null,
      pauseKind: clean.pauseKind,
      pauseUntil: clean.pauseRemainMs != null ? Date.now() + clean.pauseRemainMs : null,
      pausedRemainMs: clean.pausedRemainMs,
      scores: clean.scores,
      stats: clean.stats,
      correct: clean.correct,
      strokes: keepNewerCanvas ? state.strokes : clean.strokes,
      canvasBg: keepNewerCanvas ? state.canvasBg : clean.canvasBg,
      drawSeq: keepNewerCanvas ? state.drawSeq : clean.drawSeq,
      feed: clean.feed,
      revealWord: clean.revealWord,
      wordLength: clean.wordLength,
      recordStatus: clean.recordStatus,
      resultRatings: clean.resultRatings
    };
    if (!sameRound) secretWord = null;
    if (clean.phase === "finished" && previousPhase !== "finished" && previousMatchId === clean.matchId) playFinishSfx();
    render();
    return true;
  }

  function addFeed(who, text, kind, channel) {
    kind = FEED_KINDS.indexOf(kind) >= 0 ? kind : "guess";
    channel = channel === "players" || channel === "all"
      ? channel
      : (kind === "guess" ? "players" : "all");
    state.feed.push({ who: who || "", text: String(text || "").slice(0, 60), kind: kind, channel: channel });
    while (state.feed.length > MAX_FEED_LINES) state.feed.shift();
  }

  function wordPool() {
    var pool = Array.isArray(window.CATCHMIND_WORDS) && window.CATCHMIND_WORDS.length ? window.CATCHMIND_WORDS : FALLBACK_WORDS;
    return pool.filter(function (word) { return typeof word === "string" && /^[가-힣]{1,10}$/.test(word); });
  }

  function pickWord() {
    var pool = wordPool();
    if (!pool.length) return FALLBACK_WORDS[Math.floor(Math.random() * FALLBACK_WORDS.length)];
    var usedCount = Object.keys(usedWords).length;
    if (usedCount >= pool.length) usedWords = Object.create(null);
    for (var tries = 0; tries < 80; tries++) {
      var candidate = pool[Math.floor(Math.random() * pool.length)];
      if (!usedWords[candidate]) {
        usedWords[candidate] = true;
        return candidate;
      }
    }
    for (var i = 0; i < pool.length; i++) {
      if (!usedWords[pool[i]]) {
        usedWords[pool[i]] = true;
        return pool[i];
      }
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function clearSaveRetry() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    pendingSave = null;
  }

  function resetMatchState(queue, matchId) {
    var currentRev = state.rev;
    var currentSpectators = (state.spectators || []).slice();
    state = freshState();
    state.rev = currentRev;
    state.matchId = matchId || (Date.now().toString(36) + "-" + Math.floor(Math.random() * 100000).toString(36));
    state.queue = safeNickList(queue);
    state.spectators = currentSpectators;
    return state;
  }

  function resultsFromState() {
    return state.queue.map(function (nick) {
      var s = state.stats[nick];
      if (!s || !s.maxPoints) return null;
      return {
        nick: nick,
        score: state.scores[nick] || 0,
        points: s.points,
        maxPoints: s.maxPoints,
        correct: s.correct,
        drawCorrect: s.drawCorrect
      };
    }).filter(Boolean);
  }

  function recordSaveFailed(matchId, results, attempt) {
    if (!api || !api.isHost() || state.matchId !== matchId || state.phase !== "finished") return;
    if (attempt < SAVE_RETRY_DELAYS.length) {
      pendingSave = { matchId: matchId, results: results, attempt: attempt };
      saveTimer = setTimeout(function () {
        saveTimer = null;
        persistResults(matchId, results, attempt + 1);
      }, SAVE_RETRY_DELAYS[attempt]);
      return;
    }
    pendingSave = null;
    state.recordStatus = "failed";
    commit();
    api.toast("랭킹 기록 저장에 실패했어요");
  }

  function persistResults(matchId, results, attempt) {
    if (!api || !api.isHost() || state.matchId !== matchId || state.phase !== "finished") return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    pendingSave = { matchId: matchId, results: results, attempt: attempt };
    var request;
    try { request = api.recordMatch(matchId, results); }
    catch (error) { recordSaveFailed(matchId, results, attempt); return; }
    Promise.resolve(request).then(function (res) {
      if (!pendingSave || pendingSave.matchId !== matchId || pendingSave.attempt !== attempt) return;
      if (res && res.error) { recordSaveFailed(matchId, results, attempt); return; }
      pendingSave = null;
      if (api && api.isHost() && state.matchId === matchId && state.phase === "finished") {
        state.recordStatus = "saved";
        commit();
      }
      if (api) api.scoresChanged();
    }).catch(function () { recordSaveFailed(matchId, results, attempt); });
  }

  function hostStartMatch() {
    if (!api || !api.isHost() || !canChangeRole()) return;
    var queue = safeNickList(desiredParticipantNicks());
    if (queue.length < 2) { api.toast("참가자가 2명 이상이어야 시작할 수 있어요"); return; }
    if (!allParticipantsReady()) { api.toast("참가자 모두가 레디해야 시작할 수 있어요"); return; }
    clearSaveRetry();
    resetMatchState(queue);
    state.queue.forEach(initStats);
    secretWord = null;
    usedWords = Object.create(null);
    hostStartRound(0);
  }

  function startPractice() {
    if (!api) return;
    if (activePeople().length > 1) { api.toast("연습모드는 방에 혼자 있을 때만 쓸 수 있어요"); return; }
    clearSaveRetry();
    state = freshState();
    state.phase = "practice";
    state.matchId = "practice-" + Date.now().toString(36);
    state.queue = [me().nick];
    state.drawer = me().nick;
    state.guessers = [];
    state.strokes = [];
    state.canvasBg = CANVAS_BG;
    state.drawSeq = 0;
    state.feed = [{ who: "", text: "혼자 그림을 연습하는 중이에요", kind: "system" }];
    state.recordStatus = "idle";
    secretWord = null;
    drawing = false;
    currentStroke = null;
    strokeSentCount = 0;
    canvasLimitNotified = false;
    render();
    if (api.roomChanged) api.roomChanged();
    api.toast("연습모드 — 자유롭게 그려보세요");
  }

  function hostStartRound(index) {
    if (!api || !api.isHost()) return;
    var live = activeNicks();
    while (index < state.queue.length && !has(live, state.queue[index])) index++;
    if (index >= state.queue.length) { hostFinishMatch(); return; }
    var drawer = state.queue[index];
    var guessers = state.queue.filter(function (nick) { return nick !== drawer && has(live, nick); });
    if (!guessers.length) { hostFinishMatch(); return; }

    state.phase = "countdown";
    state.roundIndex = index;
    state.drawer = drawer;
    state.guessers = guessers;
    state.correct = {};
    state.strokes = [];
    state.canvasBg = CANVAS_BG;
    state.drawSeq = 0;
    state.feed = [];
    state.revealWord = null;
    state.deadline = Date.now() + ROUND_COUNTDOWN_MS;
    state.nextAt = null;
    state.pauseKind = null;
    state.pauseUntil = null;
    state.pausedRemainMs = null;
    state.recordStatus = "idle";
    lastCanvasRequestAt = 0;
    drawing = false;
    currentStroke = null;
    strokeSentCount = 0;
    canvasLimitNotified = false;
    guessTimes = Object.create(null);
    secretWord = pickWord();
    state.wordLength = 0;

    addFeed("", state.drawer + "님이 그릴 차례예요", "system");
    state.rev++;
    broadcastState();
    sendSecretToDrawer();
    render();
  }

  function sendSecretToDrawer() {
    if (!api || !api.isHost() || (state.phase !== "countdown" && state.phase !== "drawing")
        || !secretWord || !state.drawer) return;
    api.send({
      t: "cm_secret",
      from: me().nick,
      to: state.drawer,
      matchId: state.matchId,
      roundIndex: state.roundIndex,
      word: secretWord
    });
  }

  function hostBeginDrawing() {
    if (!api || !api.isHost() || state.phase !== "countdown" || state.pauseKind) return;
    var live = activeNicks();
    if (!has(live, state.drawer)) { hostPauseForDrawer(); return; }
    state.guessers = state.guessers.filter(function (nick) { return has(live, nick); });
    if (!state.guessers.length) { hostEndRound("정답을 맞힐 사람이 없어 턴을 넘겼어요"); return; }
    if (!secretWord) secretWord = pickWord();

    state.phase = "drawing";
    state.deadline = Date.now() + ROUND_MS;
    state.wordLength = Array.from(secretWord).length;
    state.guessers.forEach(function (nick) { initStats(nick).maxPoints += GUESS_RANK_POINTS; });
    initStats(state.drawer).maxPoints += state.guessers.length * DRAWER_RANK_POINTS;
    addFeed("", state.drawer + "님이 그림을 시작했어요", "system");
    state.rev++;
    broadcastState();
    sendSecretToDrawer();
    render();
  }

  function hostPauseForDrawer() {
    if (!api || !api.isHost() || (state.phase !== "countdown" && state.phase !== "drawing")) return;
    if (state.pauseKind === "drawer") return;
    var fallback = state.phase === "countdown" ? ROUND_COUNTDOWN_MS : ROUND_MS;
    state.pausedRemainMs = state.deadline ? Math.max(0, state.deadline - Date.now()) : (state.pausedRemainMs == null ? fallback : state.pausedRemainMs);
    state.deadline = null;
    state.pauseKind = "drawer";
    state.pauseUntil = Date.now() + DRAWER_GRACE_MS;
    drawing = false;
    currentStroke = null;
    addFeed("", state.drawer + "님 연결이 끊겨 잠시 멈췄어요", "system");
    commit();
  }

  function hostResumeRound() {
    if (!api || !api.isHost() || !state.pauseKind) return;
    var fallback = state.phase === "countdown" ? ROUND_COUNTDOWN_MS : ROUND_MS;
    var remain = state.pausedRemainMs == null ? fallback : state.pausedRemainMs;
    state.pauseKind = null;
    state.pauseUntil = null;
    state.pausedRemainMs = null;
    state.deadline = Date.now() + Math.max(250, remain);
    addFeed("", state.drawer + "님이 돌아와 게임을 이어가요", "system");
    commit();
    if (state.phase === "countdown" || state.phase === "drawing") sendSecretToDrawer();
  }

  function hostRequestSecretRecovery() {
    if (!api || !api.isHost() || state.phase !== "drawing" || secretWord || !has(activeNicks(), state.drawer)) return;
    if (state.pauseKind !== "sync") {
      state.pausedRemainMs = state.deadline ? Math.max(0, state.deadline - Date.now()) : state.pausedRemainMs;
      state.deadline = null;
      state.pauseKind = "sync";
      state.pauseUntil = Date.now() + SECRET_RECOVERY_MS;
      commit();
    }
    api.send({
      t: "cm_secret_req",
      from: me().nick,
      to: state.drawer,
      matchId: state.matchId,
      roundIndex: state.roundIndex
    });
  }

  function answerSecretRecovery(msg) {
    if (!api || state.phase !== "drawing" || me().nick !== state.drawer || !secretWord) return;
    if (msg.from !== api.host() || msg.to !== me().nick || msg.matchId !== state.matchId || msg.roundIndex !== state.roundIndex) return;
    api.send({
      t: "cm_secret_restore",
      from: me().nick,
      to: api.host(),
      matchId: state.matchId,
      roundIndex: state.roundIndex,
      word: secretWord
    });
  }

  function hostRestoreSecret(msg) {
    if (!api || !api.isHost() || state.phase !== "drawing" || state.pauseKind !== "sync") return;
    if (msg.from !== state.drawer || msg.to !== me().nick || msg.matchId !== state.matchId || msg.roundIndex !== state.roundIndex) return;
    var restored = safeText(msg.word, 10);
    if (!/^[가-힣]{1,10}$/.test(restored)) return;
    secretWord = restored;
    state.wordLength = Array.from(secretWord).length;
    hostResumeRound();
  }

  function hostRestartAfterSecretLoss() {
    if (!api || !api.isHost() || state.phase !== "drawing" || state.pauseKind !== "sync"
        || !has(activeNicks(), state.drawer)) return;
    secretWord = pickWord();
    state.wordLength = Array.from(secretWord).length;
    state.strokes = [];
    state.canvasBg = CANVAS_BG;
    state.drawSeq++;
    state.pausedRemainMs = ROUND_MS;
    addFeed("", "연결 복구를 위해 새 제시어로 다시 시작해요", "system");
    hostResumeRound();
  }

  function hostEndRound(reason) {
    if (!api || !api.isHost() || (state.phase !== "countdown" && state.phase !== "drawing")) return;
    var galleryDraft = galleryDraftFromRound();
    state.phase = "reveal";
    state.deadline = null;
    state.nextAt = Date.now() + REVEAL_MS;
    state.pauseKind = null;
    state.pauseUntil = null;
    state.pausedRemainMs = null;
    state.revealWord = secretWord || "문제 취소";
    if (reason) addFeed("", reason, "system");
    if (secretWord) addFeed("", "정답은 " + secretWord, "answer");
    commit();
    if (galleryDraft) saveGalleryDraft(galleryDraft);
  }

  function hostFinishMatch() {
    if (!api || !api.isHost() || state.phase === "finished") return;
    state.phase = "finished";
    state.drawer = null;
    state.guessers = [];
    state.deadline = null;
    state.nextAt = null;
    state.pauseKind = null;
    state.pauseUntil = null;
    state.pausedRemainMs = null;
    state.revealWord = null;
    secretWord = null;

    var results = resultsFromState();
    state.recordStatus = results.length >= 2 ? "pending" : "skipped";
    addFeed("", "게임이 끝났어요. 최종 점수를 확인해 보세요", "system");
    playFinishSfx();
    commit();

    if (state.recordStatus === "pending") persistResults(state.matchId, results, 0);
  }

  function allGuessersCorrect() {
    var live = api ? activeNicks() : state.guessers;
    var current = state.guessers.filter(function (nick) { return has(live, nick); });
    return current.length > 0 && current.every(function (nick) { return !!state.correct[nick]; });
  }

  function hostGuess(msg) {
    if (!api.isHost() || state.phase !== "drawing" || state.pauseKind || !state.deadline || !secretWord) return;
    if (msg.matchId !== state.matchId || msg.roundIndex !== state.roundIndex) return;
    var nick = safeNick(msg.nick), text = safeText(msg.text, 40).trim();
    if (!text || !has(state.guessers, nick) || !has(activeNicks(), nick) || state.correct[nick]) return;
    var now = Date.now();
    if (guessTimes[nick] && now - guessTimes[nick] < 250) return;
    guessTimes[nick] = now;

    if (normalize(text) === normalize(secretWord)) {
      var guesserStats = initStats(nick);
      var elapsedMs = clamp(ROUND_MS - Math.max(0, state.deadline - now), 0, ROUND_MS);
      var guessScore = guessScoreForElapsed(elapsedMs);
      var drawerScore = drawerScoreForGuess(guessScore);
      state.correct[nick] = true;
      state.scores[nick] = (state.scores[nick] || 0) + guessScore;
      // Season performance stays success-based so old and new match records remain comparable.
      guesserStats.points += GUESS_RANK_POINTS;
      guesserStats.correct++;
      if (guesserStats.fastestMs == null || elapsedMs < guesserStats.fastestMs) guesserStats.fastestMs = elapsedMs;
      if (state.stats[state.drawer]) {
        state.scores[state.drawer] = (state.scores[state.drawer] || 0) + drawerScore;
        state.stats[state.drawer].points += DRAWER_RANK_POINTS;
        state.stats[state.drawer].drawCorrect++;
      }
      addFeed("", nick + "님 정답! +" + guessScore, "correct");
      commit();
      if (allGuessersCorrect()) hostEndRound("모두 맞혔어요");
    } else {
      addFeed(nick, text, "guess");
      commit();
    }
  }

  function hostMatchChatInput(msg) {
    if (!api || !api.isHost() || !isGroupedChatPhase() || state.pauseKind) return;
    if (msg.matchId !== state.matchId || msg.roundIndex !== state.roundIndex) return;
    var nick = safeNick(msg.nick), text = safeText(msg.text, 40).trim();
    if (!nick || !text || !has(activeNicks(), nick)) return;
    var group = chatGroupFor(nick);
    if (group !== "players" && group !== "lounge") return;
    if (state.phase === "drawing" && group === "players") return;
    if (state.phase === "drawing" && !has(state.queue, nick) && secretWord
        && normalize(text) === normalize(secretWord)) {
      if (nick === me().nick) api.toast("관전자는 정답을 입력할 수 없어요");
      else api.send({
        t: "cm_notice",
        from: me().nick,
        to: nick,
        matchId: state.matchId,
        roundIndex: state.roundIndex
      });
      return;
    }
    if (canViewChatGroup(me().nick, group) && api.showChat) api.showChat(nick, text, chatOverlaySide(group));
    api.send({
      t: "cm_group_chat",
      from: me().nick,
      nick: nick,
      text: text,
      group: group,
      matchId: state.matchId,
      roundIndex: state.roundIndex
    });
  }

  function receiveMatchChat(msg) {
    if (!api || !isGroupedChatPhase() || state.pauseKind || msg.from !== api.host() || msg.from === me().nick) return;
    if (msg.matchId !== state.matchId || msg.roundIndex !== state.roundIndex) return;
    var nick = safeNick(msg.nick), text = safeText(msg.text, 40).trim();
    var group = msg.group === "players" || msg.group === "lounge" ? msg.group : "";
    if (!nick || !text || !group || !canViewChatGroup(me().nick, group)) return;
    if (api.showChat) api.showChat(nick, text, chatOverlaySide(group));
  }

  function hostSetReady(nick, ready) {
    if (!api || !api.isHost() || !canChangeRole()) return false;
    nick = safeNick(nick);
    var allowed = requiredReadyNicks();
    if (!nick || !has(allowed, nick)) return false;
    var current = state.ready || [];
    var next = allowed.filter(function (name) {
      return name === nick ? ready : has(current, name);
    });
    if (!sameList(current, next)) {
      state.ready = next;
      commit();
    }
    return true;
  }

  function hostReadyRequest(msg) {
    if (!api || !api.isHost()) return;
    var nick = safeNick(msg.nick);
    var from = safeNick(msg.from);
    if (!nick || nick !== from || typeof msg.ready !== "boolean") return;
    hostSetReady(nick, msg.ready);
  }

  function toggleReady() {
    if (!api || !canChangeRole()) return;
    var nick = me().nick;
    if (nick === api.host() || has(state.spectators || [], nick) || !has(desiredParticipantNicks(), nick)) return;
    api.send({
      t: "cm_ready_req",
      from: nick,
      nick: nick,
      ready: !has(state.ready || [], nick)
    });
  }

  function hostSetSpectatorPreference(nick, spectating) {
    if (!api || !api.isHost() || !canChangeRole()) return false;
    nick = safeNick(nick);
    if (!nick || !has(activeNicks(), nick)) return false;
    if (spectating && nick === api.host()) {
      var nextHostExists = activePeople().some(function (person) {
        return person.nick !== nick && !has(state.spectators || [], person.nick);
      });
      if (!nextHostExists) return false;
    }

    var known = people().filter(function (person) { return person && person.nick; })
      .map(function (person) { return person.nick; });
    var next = (state.spectators || []).filter(function (name) { return has(known, name); });
    if (spectating && !has(next, nick)) next.push(nick);
    if (!spectating) next = next.filter(function (name) { return name !== nick; });
    next = safeNickList(next);
    var nextReady = (state.ready || []).filter(function (name) { return name !== nick; });
    if (!sameList(state.spectators || [], next) || !sameList(state.ready || [], nextReady)) {
      state.spectators = next;
      state.ready = nextReady;
      commit();
    }
    return true;
  }

  function hostRoleRequest(msg) {
    if (!api || !api.isHost()) return;
    var nick = safeNick(msg.nick);
    var from = safeNick(msg.from);
    if (!nick || from !== nick || typeof msg.spectating !== "boolean") return;
    var accepted = hostSetSpectatorPreference(nick, msg.spectating);
    if (nick !== me().nick && has(activeNicks(), nick)) {
      api.send({
        t: "cm_role_ack",
        from: me().nick,
        to: nick,
        spectating: !!msg.spectating,
        accepted: accepted
      });
    }
  }

  function toggleRolePreference() {
    if (!api) return;
    if (!canChangeRole()) {
      api.toast("게임 시작 전이나 종료 후에 바꿀 수 있어요");
      return;
    }
    var nick = me().nick;
    var spectating = !has(state.spectators || [], nick);
    if (api.isHost()) {
      if (hostSetSpectatorPreference(nick, spectating)) {
        api.toast(spectating ? "방장을 넘기고 관전 모드로 바꿨어요" : "참가 모드로 바꿨어요");
      } else if (spectating) api.toast("방장을 넘길 참가자가 한 명 이상 필요해요");
      return;
    }
    api.send({
      t: "cm_role_req",
      from: nick,
      nick: nick,
      spectating: spectating
    });
  }

  function validRoundMessage(msg) {
    return state.phase === "drawing" && !state.pauseKind
      && msg.matchId === state.matchId && msg.roundIndex === state.roundIndex
      && safeNick(msg.nick) === state.drawer && has(activeNicks(), state.drawer);
  }

  function safePoint(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    return { x: clamp(Number(raw.x) || 0, 0, 1), y: clamp(Number(raw.y) || 0, 0, 1) };
  }

  function sanitizeStroke(raw, pointLimit) {
    if (!raw || !raw.id || !Array.isArray(raw.points)) return null;
    var color = safeStrokeColor(raw.color);
    var limit = Math.min(MAX_POINTS_PER_STROKE, Math.max(0, pointLimit == null ? MAX_POINTS_PER_STROKE : pointLimit));
    var points = raw.points.slice(0, limit).map(safePoint);
    if (!points.length) return null;
    return { id: safeText(raw.id, 80), color: color, width: clamp(Number(raw.width) || 8, 4, MAX_STROKE_WIDTH), points: points };
  }

  function sanitizeStrokes(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [], total = 0;
    for (var i = 0; i < raw.length && out.length < MAX_STROKES && total < MAX_CANVAS_POINTS; i++) {
      var stroke = sanitizeStroke(raw[i], MAX_CANVAS_POINTS - total);
      if (!stroke) continue;
      out.push(stroke);
      total += stroke.points.length;
    }
    return out;
  }

  function canvasPointCount() {
    return state.strokes.reduce(function (sum, stroke) {
      return sum + (stroke && Array.isArray(stroke.points) ? stroke.points.length : 0);
    }, 0);
  }

  function upsertStroke(stroke) {
    var found = -1;
    for (var i = 0; i < state.strokes.length; i++) if (state.strokes[i].id === stroke.id) { found = i; break; }
    var previousPoints = found >= 0 ? state.strokes[found].points.length : 0;
    var available = Math.max(0, MAX_CANVAS_POINTS - (canvasPointCount() - previousPoints));
    stroke.points = stroke.points.slice(0, Math.min(MAX_POINTS_PER_STROKE, available));
    if (!stroke.points.length) return false;
    if (found >= 0) state.strokes[found] = stroke;
    else if (state.strokes.length < MAX_STROKES) state.strokes.push(stroke);
    else return false;
    redraw();
    return true;
  }

  function sanitizeStrokeDelta(raw) {
    if (!raw || !raw.id || !Array.isArray(raw.points)) return null;
    var offset = safeInteger(raw.offset, 0, MAX_POINTS_PER_STROKE, null);
    if (offset == null) return null;
    var color = safeStrokeColor(raw.color);
    return {
      id: safeText(raw.id, 80),
      color: color,
      width: clamp(Number(raw.width) || 8, 4, MAX_STROKE_WIDTH),
      offset: offset,
      points: raw.points.slice(0, MAX_POINTS_PER_STROKE).map(safePoint)
    };
  }

  function applyStrokeDelta(raw) {
    var delta = sanitizeStrokeDelta(raw);
    if (!delta || !delta.points.length) return false;
    var found = -1;
    for (var i = 0; i < state.strokes.length; i++) if (state.strokes[i].id === delta.id) { found = i; break; }
    if (found < 0 && delta.offset !== 0) return false;
    var existing = found >= 0 ? state.strokes[found] : null;
    var points = existing ? existing.points.slice() : [];
    if (delta.offset > points.length) return false;
    var otherPoints = canvasPointCount() - points.length;
    var maxLength = Math.min(MAX_POINTS_PER_STROKE, Math.max(0, MAX_CANVAS_POINTS - otherPoints));
    for (var j = 0; j < delta.points.length; j++) {
      var at = delta.offset + j;
      if (at >= maxLength) break;
      if (at < points.length) points[at] = delta.points[j];
      else if (at === points.length) points.push(delta.points[j]);
      else break;
    }
    if (!points.length) return false;
    return upsertStroke({
      id: delta.id,
      color: existing ? existing.color : delta.color,
      width: existing ? existing.width : delta.width,
      points: points
    });
  }

  function applyDrawMessage(msg) {
    var seq = safeInteger(msg.seq, 1, Number.MAX_SAFE_INTEGER, null);
    if (seq == null || seq <= state.drawSeq || !validRoundMessage(msg)) return;
    if (seq !== state.drawSeq + 1 || !applyStrokeDelta(msg.stroke)) {
      requestCanvasRecovery();
      return;
    }
    state.drawSeq = seq;
  }

  function applyCanvasCommand(msg, type) {
    var seq = safeInteger(msg.seq, 1, Number.MAX_SAFE_INTEGER, null);
    if (seq == null || seq <= state.drawSeq || !validRoundMessage(msg)) return;
    if (seq !== state.drawSeq + 1) { requestCanvasRecovery(); return; }
    if (type === "cm_undo") state.strokes.pop();
    else if (type === "cm_clear") {
      state.strokes = [];
      playClearSfx();
    }
    else if (type === "cm_bg") state.canvasBg = safeColor(msg.color) || state.canvasBg || CANVAS_BG;
    state.drawSeq = seq;
    redraw();
  }

  function sendCanvasSnapshot(msg) {
    if (!api || state.phase !== "drawing" || state.pauseKind || state.drawer !== me().nick) return;
    if (msg.from !== api.host() || msg.to !== me().nick || msg.matchId !== state.matchId || msg.roundIndex !== state.roundIndex) return;
    api.send({
      t: "cm_canvas_state",
      from: me().nick,
      to: api.host(),
      matchId: state.matchId,
      roundIndex: state.roundIndex,
      drawSeq: state.drawSeq,
      canvasBg: state.canvasBg,
      strokes: state.strokes
    });
  }

  function applyCanvasSnapshot(msg) {
    if (!api || !api.isHost() || state.phase !== "drawing" || state.pauseKind) return;
    if (msg.from !== state.drawer || msg.to !== me().nick || msg.matchId !== state.matchId || msg.roundIndex !== state.roundIndex) return;
    var seq = safeInteger(msg.drawSeq, 0, Number.MAX_SAFE_INTEGER, null);
    if (seq == null || seq < state.drawSeq || !Array.isArray(msg.strokes)) return;
    state.strokes = sanitizeStrokes(msg.strokes);
    state.canvasBg = safeColor(msg.canvasBg) || CANVAS_BG;
    state.drawSeq = seq;
    lastCanvasRequestAt = Date.now();
    redraw();
    broadcastState();
  }

  function reactionScopeKey() {
    return state.phase + ":" + state.matchId + ":" + state.roundIndex;
  }

  function clearReactionEffects() {
    reactionQueue = [];
    if (reactionPumpTimer) {
      clearTimeout(reactionPumpTimer);
      reactionPumpTimer = null;
    }
    reactionLastBy = Object.create(null);
    var layer = $("catch-reaction-layer");
    if (layer) layer.innerHTML = "";
  }

  function syncReactionScope() {
    var scope = state.phase === "drawing" && !state.pauseKind ? reactionScopeKey() : "";
    if (reactionScope === scope) return;
    reactionScope = scope;
    clearReactionEffects();
  }

  function activeReactionCount(layer) {
    return layer ? layer.querySelectorAll(".catch-reaction-pop").length : 0;
  }

  function renderReaction(emoji) {
    emoji = safeReactionEmoji(emoji);
    var layer = $("catch-reaction-layer");
    if (!emoji || !layer) return;
    var node = document.createElement("span");
    var drift = Math.round((Math.random() * 58) - 29);
    var bottom = 12 + Math.round(Math.random() * 12);
    var left = 10 + Math.round(Math.random() * 76);
    var size = 28 + Math.round(Math.random() * 9);
    var spin = Math.round((Math.random() * 18) - 9);
    node.className = "catch-reaction-pop";
    node.textContent = emoji;
    node.style.left = left + "%";
    node.style.bottom = bottom + "%";
    node.style.fontSize = size + "px";
    node.style.setProperty("--reaction-drift", drift + "px");
    node.style.setProperty("--reaction-spin", spin + "deg");
    node.style.animationDelay = ((reactionSeq++ % 4) * 45) + "ms";
    layer.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
      scheduleReactionPump();
    }, 2300);
  }

  function pumpReactionQueue() {
    reactionPumpTimer = null;
    if (state.phase !== "drawing" || state.pauseKind) {
      clearReactionEffects();
      return;
    }
    var layer = $("catch-reaction-layer");
    if (!layer || !reactionQueue.length) return;
    if (activeReactionCount(layer) >= MAX_ACTIVE_REACTIONS) {
      reactionPumpTimer = setTimeout(pumpReactionQueue, REACTION_OUTPUT_GAP_MS);
      return;
    }
    renderReaction(reactionQueue.shift());
    reactionLastOutputAt = Date.now();
    if (reactionQueue.length) scheduleReactionPump();
  }

  function scheduleReactionPump() {
    if (reactionPumpTimer || !reactionQueue.length) return;
    var wait = Math.max(0, REACTION_OUTPUT_GAP_MS - (Date.now() - reactionLastOutputAt));
    reactionPumpTimer = setTimeout(pumpReactionQueue, wait);
  }

  function showReaction(emoji, nick) {
    emoji = safeReactionEmoji(emoji);
    nick = safeNick(nick);
    if (!emoji || state.phase !== "drawing" || state.pauseKind) return false;
    syncReactionScope();
    var now = Date.now();
    if (nick && reactionLastBy[nick] && now - reactionLastBy[nick] < REACTION_USER_COOLDOWN_MS) return false;
    if (reactionQueue.length >= MAX_REACTION_QUEUE) return false;
    if (nick) reactionLastBy[nick] = now;
    reactionQueue.push(emoji);
    scheduleReactionPump();
    return true;
  }

  function canReact(nick) {
    nick = safeNick(nick);
    return !!(state.phase === "drawing" && !state.pauseKind && nick && has(state.guessers, nick) && state.correct[nick]);
  }

  function validReactionMessage(msg) {
    var nick = safeNick(msg && msg.nick);
    return !!(state.phase === "drawing"
      && !state.pauseKind
      && msg.matchId === state.matchId
      && msg.roundIndex === state.roundIndex
      && nick
      && nick !== state.drawer
      && has(state.guessers, nick)
      && has(activeNicks(), nick));
  }

  function sendReaction(emoji) {
    var mine = me().nick;
    if (!api || !canReact(mine)) return;
    emoji = safeReactionEmoji(emoji);
    if (!emoji) return;
    if (!showReaction(emoji, mine)) return;
    api.send({
      t: "cm_react",
      nick: mine,
      emoji: emoji,
      matchId: state.matchId,
      roundIndex: state.roundIndex
    });
  }

  function onMessage(msg) {
    if (!msg || typeof msg.t !== "string") return false;
    if (msg.t === "hello") {
      var helloNick = safeNick(msg.nick);
      if (api && api.isHost() && helloNick && helloNick !== me().nick && has(activeNicks(), helloNick)) {
        broadcastState();
        if ((state.phase === "countdown" || state.phase === "drawing")
            && !state.pauseKind && secretWord && helloNick === state.drawer) {
          api.send({
            t: "cm_secret",
            from: me().nick,
            to: state.drawer,
            matchId: state.matchId,
            roundIndex: state.roundIndex,
            word: secretWord
          });
        }
      }
      return true;
    }
    if (msg.t.indexOf("cm_") !== 0) return false;

    if (msg.t === "cm_state") {
      if (api && !api.isHost() && msg.by === api.host()) {
        if (applyState(msg.state, stateHost !== msg.by)) stateHost = msg.by;
      }
    }
    else if (msg.t === "cm_secret") {
      if (api && msg.from === api.host() && msg.to === me().nick && msg.matchId === state.matchId && msg.roundIndex === state.roundIndex) {
        var incomingWord = safeText(msg.word, 10);
        if (!/^[가-힣]{1,10}$/.test(incomingWord)) return true;
        secretWord = incomingWord;
        render();
      }
    } else if (msg.t === "cm_canvas_req") sendCanvasSnapshot(msg);
    else if (msg.t === "cm_canvas_state") applyCanvasSnapshot(msg);
    else if (msg.t === "cm_role_req") hostRoleRequest(msg);
    else if (msg.t === "cm_ready_req") hostReadyRequest(msg);
    else if (msg.t === "cm_role_ack") {
      if (api && msg.from === api.host() && msg.to === me().nick) {
        if (msg.accepted) {
          if (api.setHostEligible) api.setHostEligible(!msg.spectating);
          api.toast(msg.spectating ? "관전 모드로 바꿨어요" : "참가 모드로 바꿨어요");
        }
        else api.toast("게임 시작 전이나 종료 후에 바꿀 수 있어요");
      }
    }
    else if (msg.t === "cm_guess") hostGuess(msg);
    else if (msg.t === "cm_group_input" || msg.t === "cm_spectator_input") hostMatchChatInput(msg);
    else if (msg.t === "cm_group_chat") receiveMatchChat(msg);
    else if (msg.t === "cm_secret_req") answerSecretRecovery(msg);
    else if (msg.t === "cm_secret_restore") hostRestoreSecret(msg);
    else if (msg.t === "cm_notice") {
      if (api && msg.from === api.host() && msg.to === me().nick && msg.matchId === state.matchId && msg.roundIndex === state.roundIndex) {
        api.toast("관전자는 정답을 입력할 수 없어요");
      }
    }
    else if (msg.t === "cm_chat_ack") {
      if (api && api.showChat && msg.from === api.host() && msg.to === me().nick && msg.nick === me().nick
          && msg.matchId === state.matchId && msg.roundIndex === state.roundIndex) {
        api.showChat(me().nick, safeText(msg.text, 40), "right");
      }
    }
    else if (msg.t === "cm_draw") applyDrawMessage(msg);
    else if (msg.t === "cm_undo") applyCanvasCommand(msg, "cm_undo");
    else if (msg.t === "cm_clear") applyCanvasCommand(msg, "cm_clear");
    else if (msg.t === "cm_bg") applyCanvasCommand(msg, "cm_bg");
    else if (msg.t === "cm_react") {
      var reactNick = safeNick(msg.nick);
      if (validReactionMessage(msg) && reactNick !== me().nick) showReaction(msg.emoji, reactNick);
    }
    return true;
  }

  function isSoundMuted() {
    try { return localStorage.getItem("omok_mute") === "1"; }
    catch (e) { return false; }
  }

  function ensureBgm() {
    if (bgmEl) return bgmEl;
    if (typeof document === "undefined" || !document.createElement) return null;
    bgmEl = document.createElement("audio");
    bgmEl.src = CATCH_BGM_SRC;
    bgmEl.loop = true;
    bgmEl.preload = "auto";
    bgmEl.volume = CATCH_BGM_VOLUME;
    bgmEl.setAttribute("playsinline", "");
    bgmEl.setAttribute("webkit-playsinline", "");
    bgmEl.style.display = "none";
    if (document.body) document.body.appendChild(bgmEl);
    return bgmEl;
  }

  function stopBgm(reset) {
    bgmPlayPending = false;
    if (!bgmEl) return;
    try {
      bgmEl.pause();
      if (reset) bgmEl.currentTime = 0;
    } catch (e) {}
  }

  function isMatchPlaying() {
    return state.phase === "countdown" || state.phase === "drawing" || state.phase === "reveal";
  }

  function syncBgm() {
    if (!api || isMatchPlaying() || isSoundMuted()) { stopBgm(false); return; }
    var el = ensureBgm();
    if (!el || !el.paused || bgmPlayPending) return;
    bgmPlayPending = true;
    el.volume = CATCH_BGM_VOLUME;
    var play = el.play();
    if (play && play.then) {
      play.then(function () { bgmPlayPending = false; })
        .catch(function () { bgmPlayPending = false; });
    } else {
      bgmPlayPending = false;
    }
  }

  function ensureStartSfx() {
    if (startSfxEl) return startSfxEl;
    if (typeof Audio === "undefined") return null;
    try {
      startSfxEl = new Audio(START_SFX_SRC);
      startSfxEl.preload = "auto";
      startSfxEl.volume = START_SFX_VOLUME;
      startSfxEl.loop = true;
      startSfxEl.setAttribute("playsinline", "");
      return startSfxEl;
    } catch (e) {
      return null;
    }
  }

  function stopStartSfx(reset) {
    startSfxPlayPending = false;
    if (!startSfxEl) return;
    try {
      startSfxEl.pause();
      if (reset) startSfxEl.currentTime = 0;
    } catch (e) {}
  }

  function playStartSfx() {
    var matchId = state.matchId;
    if (!matchId || startSfxPlayPending) return;
    stopBgm(false);
    if (isSoundMuted()) return;
    var el = ensureStartSfx();
    if (!el) return;
    var isNewMatch = lastStartSfxMatchId !== matchId;
    if (!isNewMatch && !el.paused) return;
    try {
      if (isNewMatch) {
        el.pause();
        el.currentTime = 0;
      }
      lastStartSfxMatchId = matchId;
      el.volume = START_SFX_VOLUME;
      el.loop = true;
      startSfxPlayPending = true;
      var play = el.play();
      if (play && play.then) {
        play.then(function () { startSfxPlayPending = false; })
          .catch(function () {
            startSfxPlayPending = false;
          });
      } else {
        startSfxPlayPending = false;
      }
    } catch (e) {
      startSfxPlayPending = false;
    }
  }

  function syncStartSfx() {
    if (!api || isSoundMuted()) { stopStartSfx(false); return; }
    if (!isMatchPlaying()) { stopStartSfx(true); return; }
    playStartSfx();
  }

  function ensureCountdownSfx() {
    if (countdownSfxEl) return countdownSfxEl;
    if (typeof Audio === "undefined") return null;
    try {
      countdownSfxEl = new Audio(COUNTDOWN_SFX_SRC);
      countdownSfxEl.preload = "auto";
      countdownSfxEl.volume = COUNTDOWN_SFX_VOLUME;
      countdownSfxEl.setAttribute("playsinline", "");
      return countdownSfxEl;
    } catch (e) {
      return null;
    }
  }

  function stopCountdownSfx() {
    if (!countdownSfxEl) return;
    try {
      countdownSfxEl.pause();
      countdownSfxEl.currentTime = 0;
    } catch (e) {}
  }

  function playCountdownSfx() {
    var el = ensureCountdownSfx();
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
      el.volume = COUNTDOWN_SFX_VOLUME;
      var play = el.play();
      if (play && play.catch) play.catch(function () {});
    } catch (e) {}
  }

  function syncCountdownSfx() {
    if (!api || isSoundMuted()) {
      lastCountdownCue = "";
      stopCountdownSfx();
      return;
    }
    if (state.phase !== "countdown" || state.pauseKind || !state.deadline) {
      lastCountdownCue = "";
      return;
    }
    var count = clamp(Math.ceil((state.deadline - Date.now()) / 1000), 1, Math.ceil(ROUND_COUNTDOWN_MS / 1000));
    var cue = [state.matchId || "", state.roundIndex, state.deadline, count].join(":");
    if (cue === lastCountdownCue) return;
    lastCountdownCue = cue;
    playCountdownSfx();
  }

  function syncAudio() {
    syncBgm();
    syncStartSfx();
    syncCountdownSfx();
  }

  function ensureClearSfx() {
    if (clearSfxEl) return clearSfxEl;
    if (typeof Audio === "undefined") return null;
    try {
      clearSfxEl = new Audio(CLEAR_SFX_SRC);
      clearSfxEl.preload = "auto";
      clearSfxEl.volume = CLEAR_SFX_VOLUME;
      clearSfxEl.setAttribute("playsinline", "");
      return clearSfxEl;
    } catch (e) {
      return null;
    }
  }

  function playClearSfx() {
    if (isSoundMuted()) return;
    var el = ensureClearSfx();
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
      el.volume = CLEAR_SFX_VOLUME;
      var play = el.play();
      if (play && play.catch) play.catch(function () {});
    } catch (e) {}
  }

  function ensureFinishSfx() {
    if (finishSfxEl) return finishSfxEl;
    if (typeof Audio === "undefined") return null;
    try {
      finishSfxEl = new Audio(FINISH_SFX_SRC);
      finishSfxEl.preload = "auto";
      finishSfxEl.volume = FINISH_SFX_VOLUME;
      finishSfxEl.setAttribute("playsinline", "");
      return finishSfxEl;
    } catch (e) {
      return null;
    }
  }

  function playFinishSfx() {
    if (!state.matchId || lastFinishSfxMatchId === state.matchId) return;
    lastFinishSfxMatchId = state.matchId;
    stopBgm(false);
    stopStartSfx(true);
    if (isSoundMuted()) return;
    var el = ensureFinishSfx();
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
      el.volume = FINISH_SFX_VOLUME;
      var play = el.play();
      if (play && play.catch) play.catch(function () {});
    } catch (e) {}
  }

  function onPresence(_list, options) {
    if (!api) return;
    if (state.phase === "practice" && activePeople().length > 1) {
      state = freshState();
      secretWord = null;
      drawing = false;
      currentStroke = null;
      api.toast("다른 사람이 들어와 연습모드를 종료했어요");
      render();
      return;
    }
    var isHost = api.isHost();
    var becameHost = options && options.becameHost;
    var lostHost = previousHost && !isHost;
    if (isHost) stateHost = me().nick;
    if (isHost && canChangeRole()) {
      var allowedReady = requiredReadyNicks();
      var nextReady = allowedReady.filter(function (nick) {
        return has(state.ready || [], nick);
      });
      if (!sameList(state.ready || [], nextReady)) {
        state.ready = nextReady;
        state.rev++;
      }
    }
    if (isHost && becameHost && state.phase === "countdown" && !secretWord) secretWord = pickWord();
    if (isHost && (state.phase === "countdown" || state.phase === "drawing")) {
      var live = activeNicks();
      var activeGuessers = state.guessers.filter(function (nick) { return has(live, nick); });
      if (!has(live, state.drawer)) {
        hostPauseForDrawer();
      } else if (!activeGuessers.length) {
        hostEndRound("정답을 맞힐 사람이 없어 턴을 넘겼어요");
      } else if (state.phase === "drawing" && activeGuessers.every(function (nick) { return !!state.correct[nick]; })) {
        hostEndRound("남아 있는 참가자가 모두 맞혔어요");
      } else if (state.pauseKind === "drawer") {
        if (state.phase === "drawing" && !secretWord) hostRequestSecretRecovery();
        else hostResumeRound();
      } else if (state.phase === "drawing" && !secretWord) {
        hostRequestSecretRecovery();
      } else {
        broadcastState();
      }
    } else if (isHost) {
      broadcastState();
    }
    if (isHost && becameHost && state.phase === "finished" && state.recordStatus === "pending") {
      persistResults(state.matchId, resultsFromState(), 0);
    }
    if (isHost && becameHost && state.phase === "finished" && (!state.resultRatings || !state.resultRatings.length)) {
      resultLoadMatchId = null;
    }
    if (isHost && (state.phase === "countdown" || state.phase === "drawing")
        && !state.pauseKind && has(activeNicks(), state.drawer)) {
      sendSecretToDrawer();
    }
    if (isHost && state.phase === "drawing" && !state.pauseKind && has(activeNicks(), state.drawer)) {
      requestCanvasSync(false);
    }
    if (!isHost && (lostHost || stateHost !== api.host())) requestStateSync(true);
    previousHost = isHost;
    render();
  }

  function tick() {
    if (!api) return;
    syncAudio();
    renderTimer();
    renderStage();
    if (!api.isHost()) return;
    var now = Date.now();
    if (state.pauseKind === "drawer") {
      if (has(activeNicks(), state.drawer)) {
        if (state.phase === "drawing" && !secretWord) hostRequestSecretRecovery();
        else hostResumeRound();
      } else if (state.pauseUntil && now >= state.pauseUntil) {
        hostEndRound(state.drawer + "님이 돌아오지 않아 턴을 넘겼어요");
      }
      return;
    }
    if (state.pauseKind === "sync") {
      if (secretWord) hostResumeRound();
      else if (state.pauseUntil && now >= state.pauseUntil) hostRestartAfterSecretLoss();
      return;
    }
    if (state.phase === "countdown" && state.deadline && now >= state.deadline) hostBeginDrawing();
    else if (state.phase === "drawing" && state.deadline && now >= state.deadline) hostEndRound("시간이 끝났어요");
    else if (state.phase === "reveal" && state.nextAt && now >= state.nextAt) hostStartRound(state.roundIndex + 1);
  }

  function scoreOrder() {
    return state.queue.slice().sort(function (a, b) {
      return (state.scores[b] || 0) - (state.scores[a] || 0) || state.queue.indexOf(a) - state.queue.indexOf(b);
    });
  }

  function matchHighlights() {
    var highlights = { mostCorrect: null, fastest: null, bestDrawer: null, totalCorrect: 0 };
    state.queue.forEach(function (nick) {
      var stats = state.stats[nick] || {};
      var correct = safeInteger(stats.correct, 0, MAX_SCORE, 0);
      var drawCorrect = safeInteger(stats.drawCorrect, 0, MAX_SCORE, 0);
      var fastestMs = stats.fastestMs == null ? null : safeInteger(stats.fastestMs, 0, ROUND_MS, null);
      highlights.totalCorrect += correct;
      if (correct > 0 && (!highlights.mostCorrect || correct > highlights.mostCorrect.value)) {
        highlights.mostCorrect = { nick: nick, value: correct };
      }
      if (fastestMs != null && (!highlights.fastest || fastestMs < highlights.fastest.value)) {
        highlights.fastest = { nick: nick, value: fastestMs };
      }
      if (drawCorrect > 0 && (!highlights.bestDrawer || drawCorrect > highlights.bestDrawer.value)) {
        highlights.bestDrawer = { nick: nick, value: drawCorrect };
      }
    });
    return highlights;
  }

  function formatHighlightSeconds(milliseconds) {
    if (milliseconds == null) return "--";
    var seconds = Math.max(0.1, milliseconds / 1000);
    return seconds.toFixed(1).replace(/\.0$/, "") + "초";
  }

  function renderMatchHighlights() {
    var correctName = $("catch-highlight-correct-name");
    var correctValue = $("catch-highlight-correct-value");
    var fastName = $("catch-highlight-fast-name");
    var fastValue = $("catch-highlight-fast-value");
    var drawName = $("catch-highlight-draw-name");
    var drawValue = $("catch-highlight-draw-value");
    var note = $("catch-finish-note");
    var highlights = matchHighlights();
    if (correctName) correctName.textContent = highlights.mostCorrect ? highlights.mostCorrect.nick : "기록 없음";
    if (correctValue) correctValue.textContent = highlights.mostCorrect ? "정답 " + highlights.mostCorrect.value + "개" : "정답 0개";
    if (fastName) fastName.textContent = highlights.fastest ? highlights.fastest.nick : "정답 없음";
    if (fastValue) fastValue.textContent = highlights.fastest ? formatHighlightSeconds(highlights.fastest.value) : "--";
    if (drawName) drawName.textContent = highlights.bestDrawer ? highlights.bestDrawer.nick : "기록 없음";
    if (drawValue) drawValue.textContent = highlights.bestDrawer ? highlights.bestDrawer.value + "명 정답" : "0명 정답";
    if (note) {
      var text = highlights.totalCorrect
        ? "이번 게임에서 모두 " + highlights.totalCorrect + "개의 정답을 만들었어요"
        : "이번 게임에서는 정답이 나오지 않았어요";
      if (state.recordStatus === "pending") text += " · 결과 저장 중";
      else if (state.recordStatus === "saved") text += " · 시즌 기록 반영 완료";
      else if (state.recordStatus === "failed") text += " · 기록 저장 실패";
      note.textContent = text;
    }
  }

  function formatResultNumber(value) {
    return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function fallbackResultInfo() {
    return {
      matchId: state.matchId,
      players: scoreOrder().map(function (nick) {
        var stats = state.stats[nick] || {};
        var points = safeInteger(stats.points, 0, MAX_SCORE, state.scores[nick] || 0);
        var maxPoints = safeInteger(stats.maxPoints, 0, MAX_SCORE, 0);
        return {
          nick: nick,
          score: safeInteger(state.scores[nick], 0, MAX_SCORE, 0),
          correct: safeInteger(stats.correct, 0, MAX_SCORE, 0),
          drawCorrect: safeInteger(stats.drawCorrect, 0, MAX_SCORE, 0),
          performance: maxPoints ? Math.min(100, Math.round(points / maxPoints * 100)) : 0,
          ratingReady: false,
          beforeRating: 0,
          rating: 0,
          delta: 0,
          games: 0,
          rankText: "",
          rankMove: 0
        };
      })
    };
  }

  function mergeResultInfo(raw) {
    var fallback = fallbackResultInfo();
    if (!raw || typeof raw !== "object" || String(raw.matchId || "") !== String(state.matchId || "")
        || !Array.isArray(raw.players)) return fallback;
    var computed = Object.create(null);
    raw.players.forEach(function (player) {
      if (!player || typeof player !== "object") return;
      var nick = safeNick(player.nick);
      if (!nick || !has(state.queue, nick) || computed[nick]) return;
      var beforeRating = safeInteger(player.beforeRating, 0, MAX_SCORE, null);
      var rating = safeInteger(player.rating, 0, MAX_SCORE, null);
      if (beforeRating == null || rating == null) return;
      computed[nick] = {
        beforeRating: beforeRating,
        rating: rating,
        delta: safeInteger(player.delta, -MAX_SCORE, MAX_SCORE, rating - beforeRating),
        games: safeInteger(player.games, 0, MAX_SCORE, 0),
        rankText: safeText(player.rankText, 20),
        rankMove: safeInteger(player.rankMove, -MAX_SCORE, MAX_SCORE, 0)
      };
    });
    fallback.players.forEach(function (player) {
      var row = computed[player.nick];
      if (!row) return;
      player.ratingReady = true;
      player.beforeRating = row.beforeRating;
      player.rating = row.rating;
      player.delta = row.delta;
      player.games = row.games;
      player.rankText = row.rankText;
      player.rankMove = row.rankMove;
    });
    return fallback;
  }

  function resultRatingHtml(player) {
    if (state.recordStatus !== "saved" || !player.ratingReady) {
      var label = "계산 중";
      var cls = "";
      if (state.recordStatus === "pending") label = "저장 중";
      else if (state.recordStatus === "failed") { label = "저장 실패"; cls = " failed"; }
      else if (state.recordStatus === "skipped") label = "미반영";
      else if (state.recordStatus === "saved") label = "반영 완료";
      return '<span class="cm-result-rating-state' + cls + '">' + label + '</span>';
    }
    var delta = player.delta || 0;
    var deltaClass = delta > 0 ? "up" : delta < 0 ? "down" : "same";
    var deltaText = (delta > 0 ? "+" : "") + delta;
    var rankClass = player.rankMove > 0 ? "up" : player.rankMove < 0 ? "down" : "same";
    var rankPrefix = player.rankMove > 0 ? "▲ " : player.rankMove < 0 ? "▼ " : "";
    return '<div class="cm-result-rating-main"><span class="cm-result-before">'
      + formatResultNumber(player.beforeRating) + ' →</span><strong>' + formatResultNumber(player.rating)
      + '</strong><span class="cm-result-delta ' + deltaClass + '">' + deltaText + '</span></div>'
      + (player.rankText ? '<span class="cm-result-rank ' + rankClass + '">' + rankPrefix + esc(player.rankText) + '</span>' : "");
  }

  function renderResultPopup() {
    var list = $("catch-result-list");
    var meta = $("catch-result-meta");
    var winnerName = $("catch-result-winner");
    var winnerScore = $("catch-result-winner-score");
    var winnerRate = $("catch-result-winner-rate");
    if (!list || !meta || !winnerName || !winnerScore || !winnerRate) return;
    var info = resultInfo && resultInfoMatchId === state.matchId ? resultInfo : fallbackResultInfo();
    var players = info.players || [];
    var winner = players[0] || null;
    meta.textContent = "캐치마인드 · 참가자 " + players.length + "명";
    winnerName.textContent = winner ? winner.nick : "-";
    winnerScore.textContent = winner ? winner.score + "점" : "0점";
    winnerRate.textContent = "활약도 " + (winner ? winner.performance : 0) + "%";
    list.innerHTML = players.map(function (player, index) {
      var mine = player.nick === me().nick;
      return '<li class="cm-result-row' + (mine ? " me" : "") + '">'
        + '<span class="cm-result-place">' + (index + 1) + '</span>'
        + '<div class="cm-result-person"><div class="cm-result-person-name"><strong>' + esc(player.nick) + '</strong>'
        + (mine ? '<span class="cm-result-me">나</span>' : "") + '</div>'
        + '<span class="cm-result-match">' + player.score + '점 · 정답 ' + player.correct
        + ' · 그림 성공 ' + player.drawCorrect + '</span></div>'
        + '<div class="cm-result-rating">' + resultRatingHtml(player) + '</div></li>';
    }).join("");
  }

  function setResultPopupOpen(open) {
    var backdrop = $("catch-result-backdrop"); if (!backdrop) return;
    backdrop.classList.toggle("hidden", !open);
    if (backdrop.setAttribute) backdrop.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function openResultPopup() {
    if (state.phase !== "finished") return;
    renderResultPopup();
    resultPopupShownMatchId = state.matchId;
    setResultPopupOpen(true);
  }

  function closeResultPopup() {
    setResultPopupOpen(false);
  }

  function requestResultInfo() {
    if (!api || !api.isHost() || !api.resultSummary || !state.matchId
        || state.recordStatus === "skipped" || resultLoadMatchId === state.matchId) return;
    var matchId = state.matchId;
    var token = ++resultLoadToken;
    resultLoadMatchId = matchId;
    var request;
    try { request = api.resultSummary(matchId, resultsFromState()); }
    catch (error) { return; }
    Promise.resolve(request).then(function (summary) {
      if (!api || !api.isHost() || token !== resultLoadToken || state.phase !== "finished" || state.matchId !== matchId) return;
      resultInfo = mergeResultInfo(summary);
      resultInfoMatchId = matchId;
      state.resultRatings = resultInfo.players.filter(function (player) {
        return player.ratingReady;
      }).map(function (player) {
        return {
          nick: player.nick,
          beforeRating: player.beforeRating,
          rating: player.rating,
          delta: player.delta,
          games: player.games,
          rankText: player.rankText,
          rankMove: player.rankMove
        };
      });
      if (state.resultRatings.length) commit();
      else renderResultPopup();
    }).catch(function () {});
  }

  function syncResultPopup() {
    if (!$("catch-result-backdrop")) return;
    if (state.phase !== "finished" || !state.matchId) {
      setResultPopupOpen(false);
      return;
    }
    if (resultInfoMatchId !== state.matchId) {
      resultInfoMatchId = state.matchId;
      resultInfo = fallbackResultInfo();
      resultLoadMatchId = null;
    }
    if (state.resultRatings && state.resultRatings.length) {
      resultInfo = mergeResultInfo({ matchId: state.matchId, players: state.resultRatings });
      resultInfoMatchId = state.matchId;
    }
    renderResultPopup();
    if (resultPopupShownMatchId !== state.matchId) openResultPopup();
    if (!state.resultRatings || !state.resultRatings.length) requestResultInfo();
  }

  function resetResultPopup() {
    resultLoadToken++;
    resultInfo = null;
    resultInfoMatchId = null;
    resultLoadMatchId = null;
    resultPopupShownMatchId = null;
    setResultPopupOpen(false);
  }

  function participantNicks() {
    var live = activeNicks();
    var source = state.queue.length ? state.queue : desiredParticipantNicks();
    return source.filter(function (nick) { return has(live, nick); });
  }

  function renderHeader() {
    var label = $("catch-round-label");
    if (label) {
      if (state.phase === "practice") label.textContent = "연습모드";
      else if (state.phase === "countdown") label.textContent = (state.drawer || "출제자") + " 준비 · " + (state.roundIndex + 1) + "/" + state.queue.length;
      else if (state.phase === "drawing" || state.phase === "reveal") label.textContent = (state.drawer || "출제자") + " 그림 · " + (state.roundIndex + 1) + "/" + state.queue.length;
      else if (state.phase === "finished") label.textContent = "게임 종료";
      else label.textContent = "게임 대기 중";
    }
    var peopleCount = $("catch-online-num");
    if (peopleCount) peopleCount.textContent = participantNicks().length;
    renderTimer();
  }

  function renderTimer() {
    var box = $("catch-timer"); if (!box) return;
    if (state.pauseKind === "drawer" && state.pauseUntil) {
      box.textContent = Math.max(0, Math.ceil((state.pauseUntil - Date.now()) / 1000)) + "초";
      box.classList.add("urgent");
    } else if (state.pauseKind === "sync") {
      box.textContent = "동기화";
      box.classList.remove("urgent");
    } else if (state.phase === "countdown") {
      box.textContent = "준비";
      box.classList.remove("urgent");
    } else if (state.phase === "drawing" && state.deadline) {
      var sec = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
      box.textContent = sec + "초";
      box.classList.toggle("urgent", sec <= 10);
    } else {
      box.textContent = state.phase === "reveal" ? "정답" : "--";
      box.classList.remove("urgent");
    }
  }

  function renderScores() {
    var box = $("catch-score-strip"); if (!box) return;
    var shownPeople = orderedPeople();
    if (!shownPeople.length) {
      box.textContent = "";
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    var shownNicks = shownPeople.map(function (person) { return person.nick; });
    var peopleByNick = Object.create(null);
    shownPeople.forEach(function (person) { peopleByNick[person.nick] = person; });
    var participantSet = Object.create(null);
    var participantSource = state.queue.length
      ? state.queue
      : waitingParticipantPeople().map(function (person) { return person.nick; });
    participantSource.forEach(function (nick) { participantSet[nick] = true; });
    var ordered = participantSource.filter(function (nick) { return has(shownNicks, nick); });
    shownPeople.forEach(function (person) { if (!has(ordered, person.nick)) ordered.push(person.nick); });
    box.innerHTML = ordered.map(function (nick) {
      var person = peopleByNick[nick] || {};
      var isAway = !!person.away;
      var isParticipant = !!participantSet[nick];
      var isCorrect = state.phase === "drawing" && !!state.correct[nick];
      var classes = [];
      if (nick === state.drawer) classes.push("drawer");
      if (isCorrect) classes.push("correct");
      if (!isParticipant) classes.push("spectator");
      if (isAway) classes.push("away");
      var score = isParticipant && state.queue.length
        ? '<span class="catch-inline-score">' + (state.scores[nick] || 0) + '점</span>'
        : "";
      var badge = isCorrect ? ' <em>정답</em>' : "";
      var crown = api && !isAway && nick === api.host()
        ? ' <span class="catch-host-crown" title="방장" aria-label="방장">👑</span>'
        : "";
      var awayBadge = isAway ? ' <i class="catch-away-tag">자리비움</i>' : "";
      return '<span class="' + classes.join(" ") + '"><b>' + esc(nick) + '</b>' + crown + awayBadge + badge + score + '</span>';
    }).join("");
  }

  function maskWord(length) {
    var out = [];
    for (var i = 0; i < length; i++) out.push("○");
    return out.join(" ");
  }

  function renderWord() {
    var box = $("catch-word"); if (!box) return;
    if (state.phase === "practice") box.textContent = "연습모드";
    else if (state.phase === "countdown") box.textContent = state.drawer === me().nick && secretWord ? secretWord : "준비 중";
    else if (state.phase === "drawing") box.textContent = state.drawer === me().nick && secretWord ? secretWord : maskWord(state.wordLength);
    else if (state.phase === "reveal") box.textContent = state.revealWord || "문제 취소";
    else if (state.phase === "finished") box.textContent = "게임 종료";
    else box.textContent = "준비 중";
  }

  function renderFeed() {
    var box = $("catch-feed"); if (!box) return;
    var visible = state.feed.filter(function (item) {
      return canViewChatGroup(me().nick, item.channel);
    });
    box.innerHTML = visible.map(function (item, index) {
      var kind = FEED_KINDS.indexOf(item.kind) >= 0 ? item.kind : "guess";
      var age = Math.min(visible.length - 1 - index, MAX_FEED_LINES - 1);
      var cls = "catch-feed-line " + kind + " feed-age-" + age;
      if (item.who) return '<div class="' + cls + '"><b>' + esc(item.who) + '</b> ' + esc(item.text) + '</div>';
      return '<div class="' + cls + '">' + esc(item.text) + '</div>';
    }).join("");
  }

  function renderLobbyRoles() {
    var box = $("catch-lobby-roles");
    var participantRow = $("catch-lobby-participant-row");
    var spectatorRow = $("catch-lobby-spectator-row");
    var participantList = $("catch-lobby-participants");
    var spectatorList = $("catch-lobby-spectators");
    var participantCount = $("catch-lobby-participant-count");
    var spectatorCount = $("catch-lobby-spectator-count");
    if (!box || !participantRow || !spectatorRow || !participantList || !spectatorList || !participantCount || !spectatorCount) return;

    var show = (state.phase === "idle" || state.phase === "finished") && !state.pauseKind;
    box.classList.toggle("hidden", !show);
    if (!show) return;

    function namesHtml(list, spectator) {
      if (!list.length) return "";
      return list.map(function (person) {
        var away = !!person.away;
        var crown = api && !away && person.nick === api.host()
          ? '<span class="catch-lobby-crown" title="방장" aria-label="방장">👑</span>'
          : "";
        var mine = person.nick === me().nick ? " mine" : "";
        var cls = "catch-lobby-name" + (spectator ? " spectator" : "") + mine + (away ? " away" : "");
        var awayBadge = away ? '<span class="catch-lobby-away">자리비움</span>' : "";
        var readyBadge = !spectator && !away && api && person.nick !== api.host() && has(state.ready || [], person.nick)
          ? '<span class="catch-lobby-ready" title="레디" aria-label="레디">✓</span>'
          : "";
        return '<span class="' + cls + '"><b>' + esc(person.nick) + '</b>' + crown + readyBadge + awayBadge + '</span>';
      }).join("");
    }

    var participants = waitingParticipantPeople();
    var spectators = waitingSpectatorPeople();
    participantCount.textContent = participants.length;
    spectatorCount.textContent = spectators.length;
    participantRow.classList.toggle("empty", !participants.length);
    spectatorRow.classList.toggle("empty", !spectators.length);
    participantList.innerHTML = namesHtml(participants, false);
    spectatorList.innerHTML = namesHtml(spectators, true);
  }

  function renderStage() {
    var stage = $("catch-stage"), kicker = $("catch-stage-kicker"), title = $("catch-stage-title"), sub = $("catch-stage-sub");
    var actions = $("catch-stage-actions"), start = $("catch-start-btn"), practice = $("catch-practice-btn");
    var readyButton = $("catch-ready-btn");
    var resultOpen = $("catch-result-open-btn");
    var marks = $("catch-stage-marks"), hostReady = $("catch-host-ready"), hostReadyText = $("catch-host-ready-text");
    var highlights = $("catch-round-highlights"), finishNote = $("catch-finish-note");
    var countdownCopy = $("catch-countdown-copy"), countdownSteps = $("catch-countdown-steps");
    if (!stage || !kicker || !title || !sub || !actions || !start || !practice) return;
    var show = state.phase !== "drawing" && state.phase !== "practice";
    var idle = state.phase === "idle" && !state.pauseKind;
    var finished = state.phase === "finished" && !state.pauseKind;
    var countdown = state.phase === "countdown" && !state.pauseKind;
    var showLobbyRoles = idle || finished;
    if (state.pauseKind) show = true;
    stage.classList.toggle("hidden", !show);
    stage.classList.remove("side");
    stage.classList.toggle("countdown", countdown);
    stage.classList.toggle("paused", !!state.pauseKind);
    stage.classList.toggle("drawer-wait", state.pauseKind === "drawer");
    stage.classList.toggle("lobby-roles", showLobbyRoles);
    stage.classList.toggle("idle", idle);
    stage.classList.toggle("finished", finished);
    kicker.classList.toggle("hidden", !idle && !finished && !countdown);
    if (marks) marks.classList.toggle("hidden", !idle && !finished);
    if (countdownCopy) countdownCopy.classList.toggle("hidden", !countdown);
    if (countdownSteps) countdownSteps.classList.toggle("hidden", !countdown);
    if (hostReady) hostReady.classList.add("hidden");
    if (highlights) highlights.classList.toggle("hidden", !finished);
    if (finishNote) finishNote.classList.toggle("hidden", !finished);
    if (resultOpen) resultOpen.classList.toggle("hidden", !finished);
    if (readyButton) readyButton.classList.add("hidden");
    if (!show) return;
    var participantNicks = desiredParticipantNicks();
    var participantCount = participantNicks.length;
    var mine = me().nick;
    var isHost = !!(api && api.isHost());
    var isParticipant = has(participantNicks, mine);
    var canStart = isHost && participantCount >= 2 && isParticipant;
    var everyoneReady = allParticipantsReady();
    var readyNicks = requiredReadyNicks();
    var readyCount = readyNicks.filter(function (nick) { return has(state.ready || [], nick); }).length;
    var showReadyButton = !isHost && isParticipant && (idle || finished);
    var canPractice = api && activePeople().length <= 1;
    if (readyButton) {
      var mineReady = has(state.ready || [], mine);
      readyButton.textContent = mineReady ? "레디 취소" : "레디";
      readyButton.disabled = false;
      readyButton.setAttribute("aria-pressed", String(mineReady));
      readyButton.classList.toggle("hidden", !showReadyButton);
    }
    if (state.pauseKind === "drawer") {
      var waitSec = state.pauseUntil ? Math.max(0, Math.ceil((state.pauseUntil - Date.now()) / 1000)) : 15;
      title.textContent = state.drawer + "님 재접속 대기";
      sub.textContent = waitSec + "초";
      sub.classList.remove("hidden");
      start.classList.add("hidden");
      practice.classList.add("hidden");
    } else if (state.pauseKind === "sync") {
      title.textContent = "게임을 이어가는 중";
      sub.textContent = "잠시만 기다려주세요";
      sub.classList.remove("hidden");
      start.classList.add("hidden");
      practice.classList.add("hidden");
    } else if (state.phase === "countdown") {
      var countdownSeconds = Math.ceil(ROUND_COUNTDOWN_MS / 1000);
      var count = state.deadline ? clamp(Math.ceil((state.deadline - Date.now()) / 1000), 1, countdownSeconds) : countdownSeconds;
      kicker.textContent = "이번 출제자";
      title.textContent = state.drawer + "님의 그림 차례";
      sub.textContent = count + "";
      sub.classList.remove("hidden");
      if (countdownCopy) countdownCopy.textContent = count === 1 ? "곧 그림이 시작돼요" : "그림을 준비해주세요";
      if (countdownSteps && countdownSteps.children) {
        var activeStep = countdownSeconds - count;
        for (var stepIndex = 0; stepIndex < countdownSteps.children.length; stepIndex++) {
          countdownSteps.children[stepIndex].classList.toggle("passed", stepIndex < activeStep);
          countdownSteps.children[stepIndex].classList.toggle("active", stepIndex === activeStep);
        }
      }
      start.classList.add("hidden");
      practice.classList.add("hidden");
    } else if (state.phase === "reveal") {
      title.textContent = "정답 · " + (state.revealWord || "문제 취소");
      sub.textContent = "다음 그림을 준비하고 있어요";
      sub.classList.remove("hidden");
      start.classList.add("hidden");
      practice.classList.add("hidden");
    } else if (state.phase === "finished") {
      kicker.textContent = "ROUND COMPLETE";
      title.textContent = "그림 릴레이 끝!";
      sub.textContent = "이번 판에서 나온 재미있는 기록이에요";
      sub.classList.remove("hidden");
      renderMatchHighlights();
      start.textContent = "다시 시작";
      start.classList.toggle("hidden", !canStart);
      start.disabled = state.recordStatus === "pending" || !everyoneReady;
      practice.classList.toggle("hidden", !canPractice);
      practice.disabled = !canPractice;
    } else {
      kicker.textContent = "READY TO DRAW";
      title.textContent = "그릴 준비 됐나요?";
      sub.textContent = "";
      sub.classList.add("hidden");
      if (hostReady && hostReadyText) {
        var hostNick = api && api.host ? api.host() : "";
        if (canPractice) {
          hostReadyText.textContent = "";
        } else {
          if (participantCount < 2) hostReadyText.textContent = "참가자가 2명 이상 모이면 시작할 수 있어요";
          else if (isHost && everyoneReady) hostReadyText.textContent = "모두 레디했어요. 게임을 시작할 수 있어요";
          else if (isHost) hostReadyText.textContent = readyCount + "/" + readyNicks.length + "명 레디 중";
          else if (isParticipant && has(state.ready || [], mine)) hostReadyText.textContent = "레디 완료! 방장이 시작할 때까지 기다려주세요";
          else if (isParticipant) hostReadyText.textContent = "레디 버튼을 눌러 준비를 알려주세요";
          else hostReadyText.textContent = "참가자들이 준비 중이에요";
          if (hostNick || participantCount) hostReady.classList.remove("hidden");
        }
      }
      start.textContent = "게임 시작";
      start.classList.toggle("hidden", !canStart);
      start.disabled = !everyoneReady;
      practice.classList.toggle("hidden", !canPractice);
      practice.disabled = !canPractice;
    }
    actions.classList.toggle("hidden", start.classList.contains("hidden") && practice.classList.contains("hidden")
      && (!readyButton || readyButton.classList.contains("hidden"))
      && (!resultOpen || resultOpen.classList.contains("hidden")));
  }

  function renderControls() {
    var mine = me().nick;
    var paused = !!state.pauseKind;
    var isPractice = state.phase === "practice" && state.drawer === mine;
    var isDrawer = (state.phase === "drawing" && !paused && state.drawer === mine) || isPractice;
    var isGuesser = state.phase === "drawing" && !paused && has(state.guessers, mine) && !state.correct[mine];
    var isCorrectGuesser = state.phase === "drawing" && !!state.correct[mine];
    var chatGroup = chatGroupFor(mine);
    var tools = $("catch-tools"), inputRow = $("catch-input-row"), input = $("catch-chat-input"), emojiRow = $("catch-emoji-row");
    if (tools) tools.classList.toggle("hidden", !isDrawer);
    if (!isDrawer) setPaletteOpen(false);
    if (inputRow) inputRow.classList.toggle("hidden", isDrawer || paused);
    if (emojiRow) emojiRow.classList.toggle("hidden", !isCorrectGuesser || paused);
    if (input) {
      input.disabled = paused;
      if (isPractice) input.placeholder = "연습 중 · 채팅 입력";
      else if (isGuesser) input.placeholder = "정답 또는 채팅 입력";
      else if (isGroupedChatPhase() && chatGroup === "lounge") input.placeholder = "관전자 · 정답자 채팅";
      else if (isGroupedChatPhase()) input.placeholder = "참가자 채팅";
      else input.placeholder = "채팅 입력";
    }
    syncToolButtons();
  }

  function renderChatOverlayPosition() {
    var overlay = $("catch-chat-overlay"); if (!overlay) return;
    var mine = me().nick;
    var group = chatGroupFor(mine);
    var scope = isGroupedChatPhase()
      ? String(state.matchId || "") + ":" + state.roundIndex + ":" + (state.phase === "countdown" ? "countdown" : group)
      : state.phase + ":all";
    if (lastChatViewScope && lastChatViewScope !== scope) overlay.innerHTML = "";
    lastChatViewScope = scope;
    overlay.classList.remove("hidden");
    var right = state.phase === "countdown" || state.phase === "idle" || state.phase === "finished" || group === "lounge";
    overlay.classList.toggle("right", right);
  }

  function renderRoleButton() {
    var spectating = has(state.spectators || [], me().nick);
    if (api && api.setHostEligible) api.setHostEligible(!spectating);
    var button = $("catch-role-btn"); if (!button) return;
    button.textContent = spectating ? "참가하기" : "관전하기";
    button.disabled = !canChangeRole();
    button.setAttribute("aria-pressed", String(spectating));
    button.setAttribute("aria-label", spectating ? "다음 게임에 참가하기" : "다음 게임 관전하기");
  }

  function render() {
    if (!api) return;
    syncAudio();
    syncReactionScope();
    renderHeader();
    renderScores();
    renderWord();
    renderFeed();
    renderLobbyRoles();
    renderStage();
    renderControls();
    renderRoleButton();
    renderChatOverlayPosition();
    syncResultPopup();
    redraw();
  }

  function canDraw() {
    return !!(api && state.drawer === me().nick && (state.phase === "practice"
      || (state.phase === "drawing" && !state.pauseKind && state.deadline && secretWord)));
  }

  function pointFromEvent(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function drawStroke(targetCtx, width, height, stroke) {
    if (!targetCtx || !stroke || !stroke.points || !stroke.points.length) return;
    var points = stroke.points;
    var lineWidth = stroke.width * Math.min(width, height) / 720;
    targetCtx.strokeStyle = stroke.color;
    targetCtx.fillStyle = stroke.color;
    targetCtx.lineWidth = lineWidth;
    targetCtx.lineCap = "round";
    targetCtx.lineJoin = "round";
    if (points.length === 1) {
      targetCtx.beginPath();
      targetCtx.arc(points[0].x * width, points[0].y * height, lineWidth / 2, 0, Math.PI * 2);
      targetCtx.fill();
      return;
    }
    targetCtx.beginPath();
    targetCtx.moveTo(points[0].x * width, points[0].y * height);
    for (var i = 1; i < points.length; i++) targetCtx.lineTo(points[i].x * width, points[i].y * height);
    targetCtx.stroke();
  }

  function drawOne(stroke) {
    if (!ctx || !canvas) return;
    drawStroke(ctx, canvas.width, canvas.height, stroke);
  }

  function redraw() {
    if (!ctx || !canvas) return;
    ctx.fillStyle = state.canvasBg || CANVAS_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    state.strokes.forEach(drawOne);
  }

  function galleryDraftFromRound() {
    if (state.phase !== "drawing" || !secretWord || !state.matchId || !state.drawer) return null;
    var strokes = sanitizeStrokes(state.strokes);
    var background = safeColor(state.canvasBg) || CANVAS_BG;
    if (!strokes.length && background === CANVAS_BG) return null;
    return {
      matchId: safeText(state.matchId, 80),
      roundIndex: safeInteger(state.roundIndex, 0, MAX_PLAYERS - 1, 0),
      drawer: safeNick(state.drawer),
      word: safeText(secretWord, 10),
      canvasBg: background,
      strokes: strokes
    };
  }

  function galleryBlob(draft) {
    return new Promise(function (resolve, reject) {
      if (!document.createElement) { reject(new Error("canvas unavailable")); return; }
      var output = document.createElement("canvas");
      output.width = GALLERY_IMAGE_SIZE;
      output.height = GALLERY_IMAGE_SIZE;
      var outputCtx = output.getContext && output.getContext("2d");
      if (!outputCtx || !output.toBlob) { reject(new Error("image export unavailable")); return; }
      outputCtx.fillStyle = draft.canvasBg || CANVAS_BG;
      outputCtx.fillRect(0, 0, output.width, output.height);
      draft.strokes.forEach(function (stroke) {
        drawStroke(outputCtx, output.width, output.height, stroke);
      });
      output.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("image export failed"));
      }, "image/webp", GALLERY_IMAGE_QUALITY);
    });
  }

  async function blobBase64(blob) {
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var binary = "";
    for (var i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return window.btoa(binary);
  }

  async function saveGalleryDraft(draft) {
    if (!api || !api.saveDrawing || !draft) return;
    var galleryApi = api;
    var key = draft.matchId + ":" + draft.roundIndex;
    if (gallerySavedRounds[key]) return;
    gallerySavedRounds[key] = true;
    try {
      var blob = await galleryBlob(draft);
      var result = await galleryApi.saveDrawing({
        matchId: draft.matchId,
        roundIndex: draft.roundIndex,
        drawer: draft.drawer,
        word: draft.word,
        mimeType: blob.type || "image/webp",
        byteSize: blob.size || 0,
        imageBase64: await blobBase64(blob)
      });
      if (!result || !result.ok) throw new Error(result && (result.msg || result.reason) || "save failed");
    } catch (error) {
      delete gallerySavedRounds[key];
      if (window.console && console.warn) console.warn("CatchMind gallery save failed:", error);
    }
  }

  function galleryTime(value) {
    var time = new Date(value || 0);
    if (isNaN(time.getTime())) return "";
    var now = new Date();
    if (time.toDateString() === now.toDateString()) {
      return String(time.getHours()).padStart(2, "0") + ":" + String(time.getMinutes()).padStart(2, "0");
    }
    return (time.getMonth() + 1) + "." + time.getDate();
  }

  function renderGallery() {
    var grid = $("catch-gallery-grid");
    var status = $("catch-gallery-status");
    var more = $("catch-gallery-more");
    var count = $("catch-gallery-favorite-count");
    var recentTab = $("catch-gallery-recent-tab");
    var favoriteTab = $("catch-gallery-favorite-tab");
    if (!grid || !status) return;
    if (count) count.textContent = galleryFavoriteCount + "/" + GALLERY_FAVORITE_LIMIT;
    if (recentTab) {
      recentTab.classList.toggle("active", galleryMode === "recent");
      recentTab.setAttribute("aria-selected", String(galleryMode === "recent"));
    }
    if (favoriteTab) {
      favoriteTab.classList.toggle("active", galleryMode === "favorites");
      favoriteTab.setAttribute("aria-selected", String(galleryMode === "favorites"));
    }
    if (galleryLoading && !galleryRows.length) {
      status.textContent = "그림을 불러오는 중이에요";
      grid.innerHTML = "";
    } else if (galleryError) {
      status.textContent = galleryError;
      grid.innerHTML = '<div class="cm-gallery-empty">갤러리를 열 수 없어요.<br>잠시 뒤 다시 시도해주세요.</div>';
    } else {
      status.textContent = galleryMode === "favorites"
        ? "내가 저장한 그림 " + galleryFavoriteCount + "장"
        : "최근 그림은 최대 1,000장까지 보관돼요";
      grid.innerHTML = galleryRows.length ? galleryRows.map(function (row) {
        var id = safeInteger(row.id, 1, 2147483647, 0);
        var url = esc(row.imageUrl || "");
        var word = esc(row.word || "제시어 없음");
        var drawer = esc(row.drawer || "알 수 없음");
        var favorite = !!row.favorite;
        return '<article class="cm-gallery-item" data-gallery-row="' + id + '">'
          + '<div class="cm-gallery-media">'
          + '<button class="cm-gallery-thumb" type="button" data-gallery-open="' + id + '" aria-label="' + word + ' 그림 크게 보기">'
          + '<img src="' + url + '" alt="' + word + ' 그림" loading="lazy"></button>'
          + '<button class="cm-gallery-favorite' + (favorite ? ' active' : '') + '" type="button" data-gallery-favorite="' + id + '" aria-label="' + (favorite ? "즐겨찾기 해제" : "즐겨찾기") + '">' + (favorite ? "★" : "☆") + '</button>'
          + '</div><div class="cm-gallery-copy"><strong>' + word + '</strong><span>' + drawer + ' · ' + esc(galleryTime(row.createdAt)) + '</span></div>'
          + '</article>';
      }).join("") : '<div class="cm-gallery-empty">' + (galleryMode === "favorites"
        ? "즐겨찾기한 그림이 아직 없어요.<br>마음에 드는 그림의 별을 눌러보세요."
        : "아직 저장된 그림이 없어요.<br>게임에서 완성한 그림이 여기에 모여요.") + '</div>';
    }
    if (more) {
      more.classList.toggle("hidden", !galleryHasMore);
      more.disabled = galleryLoading;
      more.textContent = galleryLoading ? "불러오는 중…" : "더 보기";
    }
  }

  async function loadGallery(reset) {
    if (!api || !api.loadGallery || galleryLoading) return;
    if (reset) {
      galleryRows = [];
      galleryOffset = 0;
      galleryHasMore = false;
      galleryError = "";
    }
    galleryLoading = true;
    var token = ++galleryRequestToken;
    renderGallery();
    try {
      var result = await api.loadGallery(galleryMode, galleryOffset, GALLERY_PAGE_SIZE);
      if (token !== galleryRequestToken) return;
      if (!result || !result.ok) throw new Error(result && (result.msg || result.reason) || "load failed");
      var rows = Array.isArray(result.rows) ? result.rows : [];
      galleryRows = reset ? rows : galleryRows.concat(rows);
      galleryOffset = galleryRows.length;
      galleryHasMore = !!result.hasMore;
      galleryFavoriteCount = safeInteger(result.favoriteCount, 0, GALLERY_FAVORITE_LIMIT, 0);
    } catch (error) {
      if (token === galleryRequestToken) {
        galleryRows = [];
        galleryHasMore = false;
        galleryError = "갤러리를 불러오지 못했어요. 잠시 뒤 다시 열어주세요.";
      }
    } finally {
      if (token === galleryRequestToken) {
        galleryLoading = false;
        renderGallery();
      }
    }
  }

  function openGallery() {
    var backdrop = $("catch-gallery-backdrop");
    if (!backdrop) return;
    closeGalleryPreview();
    backdrop.classList.remove("hidden");
    backdrop.setAttribute("aria-hidden", "false");
    loadGallery(true);
  }

  function closeGallery() {
    var backdrop = $("catch-gallery-backdrop");
    if (!backdrop) return;
    galleryRequestToken++;
    galleryLoading = false;
    backdrop.classList.add("hidden");
    backdrop.setAttribute("aria-hidden", "true");
    closeGalleryPreview();
  }

  function setGalleryMode(mode) {
    mode = mode === "favorites" ? "favorites" : "recent";
    if (galleryMode === mode && galleryRows.length) return;
    galleryMode = mode;
    loadGallery(true);
  }

  function galleryRow(id) {
    id = Number(id);
    for (var i = 0; i < galleryRows.length; i++) {
      if (Number(galleryRows[i].id) === id) return galleryRows[i];
    }
    return null;
  }

  function openGalleryPreview(id) {
    var row = galleryRow(id);
    var preview = $("catch-gallery-preview");
    if (!row || !preview) return;
    $("catch-gallery-preview-image").src = row.imageUrl || "";
    $("catch-gallery-preview-image").alt = (row.word || "제시어 없음") + " 그림";
    $("catch-gallery-preview-word").textContent = row.word || "제시어 없음";
    $("catch-gallery-preview-meta").textContent = (row.drawer || "알 수 없음") + " · " + galleryTime(row.createdAt);
    preview.classList.remove("hidden");
    preview.setAttribute("aria-hidden", "false");
  }

  function closeGalleryPreview() {
    var preview = $("catch-gallery-preview");
    if (!preview) return;
    preview.classList.add("hidden");
    preview.setAttribute("aria-hidden", "true");
    var image = $("catch-gallery-preview-image");
    if (image) image.removeAttribute("src");
  }

  async function toggleGalleryFavorite(id, button) {
    var row = galleryRow(id);
    if (!row || !api || !api.toggleGalleryFavorite) return;
    var next = !row.favorite;
    if (next && galleryFavoriteCount >= GALLERY_FAVORITE_LIMIT) {
      api.toast("즐겨찾기는 계정당 20개까지 저장할 수 있어요");
      return;
    }
    if (button) button.disabled = true;
    try {
      var result = await api.toggleGalleryFavorite(row.id, next);
      if (!result || !result.ok) {
        if (result && result.reason === "favorite_limit") api.toast("즐겨찾기는 계정당 20개까지 저장할 수 있어요");
        else api.toast("즐겨찾기를 변경하지 못했어요");
        return;
      }
      galleryFavoriteCount = safeInteger(result.favoriteCount, 0, GALLERY_FAVORITE_LIMIT, galleryFavoriteCount);
      if (galleryMode === "favorites" && !next) galleryRows = galleryRows.filter(function (item) { return Number(item.id) !== Number(row.id); });
      else row.favorite = next;
      renderGallery();
    } finally {
      if (button && button.isConnected) button.disabled = false;
    }
  }

  function sendCurrentStroke(force) {
    if (!api || !currentStroke) return;
    if (state.phase === "practice") return;
    if (strokeSentCount >= currentStroke.points.length) return;
    var now = Date.now();
    if (!force && now - lastStrokeSend < DRAW_SEND_MS) {
      if (!pendingStrokeTimer) {
        pendingStrokeTimer = setTimeout(function () { pendingStrokeTimer = null; sendCurrentStroke(true); }, DRAW_SEND_MS);
      }
      return;
    }
    lastStrokeSend = now;
    var offset = strokeSentCount;
    var points = currentStroke.points.slice(offset).map(function (point) { return { x: point.x, y: point.y }; });
    if (!points.length) return;
    strokeSentCount = currentStroke.points.length;
    state.drawSeq++;
    api.send({
      t: "cm_draw",
      nick: me().nick,
      matchId: state.matchId,
      roundIndex: state.roundIndex,
      seq: state.drawSeq,
      stroke: {
        id: currentStroke.id,
        color: currentStroke.color,
        width: currentStroke.width,
        offset: offset,
        points: points
      }
    });
  }

  function notifyCanvasLimit() {
    if (canvasLimitNotified || !api) return;
    canvasLimitNotified = true;
    api.toast("그림이 너무 길어 새 선을 더 그릴 수 없어요");
  }

  function pointerDown(event) {
    if (!canDraw()) return;
    if (state.strokes.length >= MAX_STROKES || canvasPointCount() >= MAX_CANVAS_POINTS) {
      notifyCanvasLimit();
      return;
    }
    event.preventDefault();
    drawing = true;
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    var color = selectedTool === "eraser" ? (state.canvasBg || CANVAS_BG) : selectedColor;
    currentStroke = {
      id: me().nick + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 10000).toString(36),
      color: color,
      width: brushWidth(selectedTool, selectedColorSlot),
      points: [pointFromEvent(event)]
    };
    strokeSentCount = 0;
    if (!upsertStroke(currentStroke)) {
      drawing = false;
      currentStroke = null;
      notifyCanvasLimit();
      return;
    }
    sendCurrentStroke(true);
  }

  function pointerMove(event) {
    if (!drawing || !currentStroke || !canDraw()) return;
    event.preventDefault();
    var point = pointFromEvent(event), prev = currentStroke.points[currentStroke.points.length - 1];
    var dx = point.x - prev.x, dy = point.y - prev.y;
    if (dx * dx + dy * dy < 0.000015) return;
    if (currentStroke.points.length >= MAX_POINTS_PER_STROKE) return;
    if (canvasPointCount() >= MAX_CANVAS_POINTS) {
      notifyCanvasLimit();
      return;
    }
    currentStroke.points.push(point);
    upsertStroke(currentStroke);
    sendCurrentStroke(false);
  }

  function pointerUp(event) {
    if (!drawing) return;
    event.preventDefault();
    drawing = false;
    if (pendingStrokeTimer) { clearTimeout(pendingStrokeTimer); pendingStrokeTimer = null; }
    sendCurrentStroke(true);
    currentStroke = null;
  }

  function colorSlotFromButton(button, fallback) {
    var raw = button ? button.getAttribute("data-catch-color-slot") : null;
    if (raw == null || raw === "") return fallback;
    return safeInteger(raw, 0, PEN_COLORS.length - 1, fallback);
  }

  function brushWidth(tool, slot) {
    if (tool === "eraser") return ERASER_WIDTH;
    slot = safeInteger(slot, 0, PEN_WIDTHS.length - 1, 0);
    return PEN_WIDTHS[slot] || PEN_WIDTHS[0];
  }

  function updateColorButtons() {
    var colorButtons = document.querySelectorAll("[data-catch-color]");
    for (var i = 0; i < colorButtons.length; i++) {
      var slot = colorSlotFromButton(colorButtons[i], i);
      var color = PEN_COLORS[slot] || PEN_COLORS[0];
      colorButtons[i].setAttribute("data-catch-color-slot", String(slot));
      colorButtons[i].setAttribute("data-catch-color", color);
      colorButtons[i].setAttribute("aria-label", slot === 1 ? "굵은 펜 색상" : "일반 펜 색상");
      var chip = colorButtons[i].querySelector("span");
      if (chip) chip.style.background = color;
    }
  }

  function setupToolButtons() {
    var tools = $("catch-tools");
    if (!tools) return;
    var pen = document.querySelector('[data-catch-tool="pen"]');
    var eraser = document.querySelector('[data-catch-tool="eraser"]');
    var undo = $("catch-undo-btn");
    var clear = $("catch-clear-btn");
    var bg = $("catch-bg-btn");
    var firstColor = document.querySelector("[data-catch-color]");
    if (pen) { pen.classList.add("catch-tool-icon"); pen.textContent = "✏️"; pen.setAttribute("aria-label", "펜"); }
    if (eraser) { eraser.classList.add("catch-tool-icon"); eraser.textContent = "🧽"; eraser.setAttribute("aria-label", "지우개"); }
    if (clear) { clear.textContent = "🗑️"; clear.setAttribute("aria-label", "그림 모두 지우기"); }
    if (bg) { bg.textContent = "▣"; bg.setAttribute("aria-label", "배경색"); }
    if (undo) { undo.textContent = "↶"; undo.setAttribute("aria-label", "마지막 선 되돌리기"); }
    if (clear && firstColor) tools.insertBefore(clear, firstColor);
    if (bg && firstColor) tools.insertBefore(bg, firstColor);
  }

  function setPaletteOpen(open) {
    var palette = $("catch-palette"), button = $("catch-palette-btn");
    if (palette) palette.classList.toggle("hidden", !open);
    if (button) {
      button.classList.toggle("active", !!open && paletteTarget !== "bg");
      button.setAttribute("aria-expanded", String(!!open));
    }
    var bg = $("catch-bg-btn");
    if (bg) bg.classList.toggle("active", !!open && paletteTarget === "bg");
  }

  function buildPaletteUi() {
    var tools = $("catch-tools");
    if (!tools || $("catch-palette-btn")) return;
    var undo = $("catch-undo-btn");
    var button = document.createElement("button");
    button.id = "catch-palette-btn";
    button.className = "catch-tool catch-tool-icon catch-palette-btn";
    button.type = "button";
    button.setAttribute("aria-label", "palette");
    button.setAttribute("aria-expanded", "false");
    button.appendChild(document.createElement("span"));
    tools.insertBefore(button, undo || null);

    var palette = document.createElement("div");
    palette.id = "catch-palette";
    palette.className = "catch-palette hidden";
    palette.setAttribute("aria-label", "color palette");
    PALETTE_COLORS.forEach(function (color) {
      var swatch = document.createElement("button");
      swatch.className = "catch-palette-color";
      swatch.type = "button";
      swatch.setAttribute("data-catch-palette-color", color);
      swatch.setAttribute("aria-label", color);
      swatch.style.background = color;
      palette.appendChild(swatch);
    });
    tools.parentNode.insertBefore(palette, tools.nextSibling);
  }

  function selectColorSlot(slot) {
    selectedColorSlot = slot == null || slot === "" ? 0 : safeInteger(slot, 0, PEN_COLORS.length - 1, 0);
    selectedColor = PEN_COLORS[selectedColorSlot] || PEN_COLORS[0];
    paletteTarget = "pen";
    selectedTool = "pen";
    syncToolButtons();
  }

  function applyPaletteColor(color) {
    color = safeColor(color);
    if (!color) return;
    if (paletteTarget === "bg") {
      setCanvasBackground(color);
      setPaletteOpen(false);
      syncToolButtons();
      return;
    }
    PEN_COLORS[selectedColorSlot] = color;
    selectedColor = color;
    selectedTool = "pen";
    savePenColors();
    updateColorButtons();
    setPaletteOpen(false);
    syncToolButtons();
  }

  function syncToolButtons() {
    updateColorButtons();
    var toolButtons = document.querySelectorAll("[data-catch-tool]");
    for (var i = 0; i < toolButtons.length; i++) {
      var on = toolButtons[i].getAttribute("data-catch-tool") === selectedTool;
      toolButtons[i].classList.toggle("active", on);
      toolButtons[i].setAttribute("aria-pressed", String(on));
    }
    var colorButtons = document.querySelectorAll("[data-catch-color]");
    for (var j = 0; j < colorButtons.length; j++) {
      var active = colorSlotFromButton(colorButtons[j], j) === selectedColorSlot && selectedTool === "pen";
      colorButtons[j].classList.toggle("active", active);
      colorButtons[j].setAttribute("aria-pressed", String(active));
    }
  }

  function sendInput() {
    if (!api) return;
    var input = $("catch-chat-input"); if (!input) return;
    var text = input.value.trim().slice(0, 40); if (!text) return;
    var mine = me().nick;
    if (state.phase === "drawing" && has(state.guessers, mine) && !state.correct[mine]) {
      api.send({ t: "cm_guess", nick: mine, text: text, matchId: state.matchId, roundIndex: state.roundIndex });
    } else if (isGroupedChatPhase()) {
      var groupMessage = { t: "cm_group_input", nick: mine, text: text, matchId: state.matchId, roundIndex: state.roundIndex };
      if (api.isHost()) hostMatchChatInput(groupMessage);
      else api.send(groupMessage);
    } else {
      api.sendChat(text);
    }
    input.value = "";
  }

  function sendCanvasCommand(type) {
    if (!canDraw() || drawing) return;
    if (type === "cm_undo") {
      if (!state.strokes.length) return;
      state.strokes.pop();
    } else if (type === "cm_clear") {
      if (!state.strokes.length) return;
      state.strokes = [];
      playClearSfx();
    } else return;
    canvasLimitNotified = false;
    state.drawSeq++;
    redraw();
    if (state.phase === "practice") return;
    api.send({
      t: type,
      nick: me().nick,
      matchId: state.matchId,
      roundIndex: state.roundIndex,
      seq: state.drawSeq
    });
  }

  function setCanvasBackground(color) {
    color = safeColor(color);
    if (!color || !canDraw() || drawing) return;
    if (state.canvasBg === color) return;
    state.canvasBg = color;
    canvasLimitNotified = false;
    state.drawSeq++;
    redraw();
    if (state.phase === "practice") return;
    api.send({
      t: "cm_bg",
      nick: me().nick,
      matchId: state.matchId,
      roundIndex: state.roundIndex,
      seq: state.drawSeq,
      color: color
    });
  }

  function bindHorizontalDrag(scroller) {
    if (!scroller || scroller.getAttribute("data-drag-scroll") === "1") return;
    scroller.setAttribute("data-drag-scroll", "1");
    var drag = null;
    scroller.addEventListener("pointerdown", function (event) {
      if (event.pointerType && event.pointerType !== "mouse") return;
      if (event.button !== 0 || scroller.scrollWidth <= scroller.clientWidth) return;
      drag = { id: event.pointerId, x: event.clientX, left: scroller.scrollLeft };
      scroller.classList.add("dragging");
      if (scroller.setPointerCapture) scroller.setPointerCapture(event.pointerId);
    });
    scroller.addEventListener("pointermove", function (event) {
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      scroller.scrollLeft = drag.left - (event.clientX - drag.x);
    });
    function endDrag(event) {
      if (!drag || (event && drag.id !== event.pointerId)) return;
      drag = null;
      scroller.classList.remove("dragging");
    }
    scroller.addEventListener("pointerup", endDrag);
    scroller.addEventListener("pointercancel", endDrag);
    scroller.addEventListener("wheel", function (event) {
      if (scroller.scrollWidth <= scroller.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY;
    }, { passive: false });
  }

  function bind() {
    if (bound) return;
    bound = true;
    loadPenColors();
    selectedColor = PEN_COLORS[selectedColorSlot] || PEN_COLORS[0];
    setupToolButtons();
    buildPaletteUi();
    updateColorButtons();
    bindHorizontalDrag($("catch-score-strip"));
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);

    $("catch-start-btn").addEventListener("click", hostStartMatch);
    $("catch-ready-btn").addEventListener("click", toggleReady);
    $("catch-practice-btn").addEventListener("click", startPractice);
    var resultOpenButton = $("catch-result-open-btn");
    var resultCloseButton = $("catch-result-close");
    var resultConfirmButton = $("catch-result-confirm");
    var resultRankButton = $("catch-result-rank");
    if (resultOpenButton) resultOpenButton.addEventListener("click", openResultPopup);
    if (resultCloseButton) resultCloseButton.addEventListener("click", closeResultPopup);
    if (resultConfirmButton) resultConfirmButton.addEventListener("click", closeResultPopup);
    if (resultRankButton) resultRankButton.addEventListener("click", function () {
        closeResultPopup();
        if (api) api.openRank();
      });
    $("catch-chat-input").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.isComposing) sendInput();
    });
    var emojiButtons = document.querySelectorAll("[data-catch-emoji]");
    for (var e = 0; e < emojiButtons.length; e++) emojiButtons[e].addEventListener("click", function () {
      sendReaction(this.getAttribute("data-catch-emoji"));
    });
    $("catch-leave-btn").addEventListener("click", function () { if (api) api.leaveRoom(); });
    $("catch-role-btn").addEventListener("click", toggleRolePreference);
    $("catch-people-btn").addEventListener("click", function () { if (api) api.openPlayers(); });
    $("catch-rank-btn").addEventListener("click", function () { if (api) api.openRank(); });
    var galleryButton = $("catch-gallery-btn");
    var galleryClose = $("catch-gallery-close");
    var galleryBackdrop = $("catch-gallery-backdrop");
    var galleryGrid = $("catch-gallery-grid");
    if (galleryButton) galleryButton.addEventListener("click", openGallery);
    if (galleryClose) galleryClose.addEventListener("click", closeGallery);
    if (galleryBackdrop) galleryBackdrop.addEventListener("click", function (event) {
      if (event.target === galleryBackdrop) closeGallery();
    });
    var galleryRecentTab = $("catch-gallery-recent-tab");
    var galleryFavoriteTab = $("catch-gallery-favorite-tab");
    var galleryMore = $("catch-gallery-more");
    var galleryPreviewClose = $("catch-gallery-preview-close");
    if (galleryRecentTab) galleryRecentTab.addEventListener("click", function () { setGalleryMode("recent"); });
    if (galleryFavoriteTab) galleryFavoriteTab.addEventListener("click", function () { setGalleryMode("favorites"); });
    if (galleryMore) galleryMore.addEventListener("click", function () { loadGallery(false); });
    if (galleryPreviewClose) galleryPreviewClose.addEventListener("click", closeGalleryPreview);
    if (galleryGrid) galleryGrid.addEventListener("click", function (event) {
      var favoriteButton = event.target.closest && event.target.closest("[data-gallery-favorite]");
      if (favoriteButton) {
        toggleGalleryFavorite(favoriteButton.getAttribute("data-gallery-favorite"), favoriteButton);
        return;
      }
      var openButton = event.target.closest && event.target.closest("[data-gallery-open]");
      if (openButton) openGalleryPreview(openButton.getAttribute("data-gallery-open"));
    });
    $("catch-menu-btn").addEventListener("click", function () { if (api) api.openMenu(); });

    var toolButtons = document.querySelectorAll("[data-catch-tool]");
    for (var i = 0; i < toolButtons.length; i++) toolButtons[i].addEventListener("click", function () {
      selectedTool = this.getAttribute("data-catch-tool"); setPaletteOpen(false); syncToolButtons();
    });
    var colorButtons = document.querySelectorAll("[data-catch-color]");
    for (var j = 0; j < colorButtons.length; j++) colorButtons[j].addEventListener("click", function () {
      selectColorSlot(this.getAttribute("data-catch-color-slot"));
    });
    $("catch-bg-btn").addEventListener("click", function () {
      paletteTarget = "bg";
      selectedTool = "pen";
      syncToolButtons();
      var palette = $("catch-palette");
      setPaletteOpen(!palette || palette.classList.contains("hidden"));
    });
    $("catch-palette-btn").addEventListener("click", function () {
      paletteTarget = "pen";
      var palette = $("catch-palette");
      setPaletteOpen(!palette || palette.classList.contains("hidden"));
    });
    var paletteButtons = document.querySelectorAll("[data-catch-palette-color]");
    for (var k = 0; k < paletteButtons.length; k++) paletteButtons[k].addEventListener("click", function () {
      applyPaletteColor(this.getAttribute("data-catch-palette-color"));
    });
    $("catch-undo-btn").addEventListener("click", function () {
      sendCanvasCommand("cm_undo");
    });
    $("catch-clear-btn").addEventListener("click", function () {
      sendCanvasCommand("cm_clear");
    });
  }

  function enter(nextApi) {
    clearSaveRetry();
    api = nextApi;
    state = freshState();
    secretWord = null;
    previousHost = false;
    drawing = false;
    currentStroke = null;
    strokeSentCount = 0;
    canvasLimitNotified = false;
    guessTimes = Object.create(null);
    stateHost = null;
    lastSyncRequestAt = 0;
    lastCanvasRequestAt = 0;
    lastChatViewScope = "";
    gallerySavedRounds = Object.create(null);
    resetResultPopup();
    lastStartSfxMatchId = null;
    stopStartSfx(true);
    ensureStartSfx();
    lastCountdownCue = "";
    stopCountdownSfx();
    ensureCountdownSfx();
    if (finishSfxEl) {
      try { finishSfxEl.pause(); finishSfxEl.currentTime = 0; } catch (e) {}
    }
    canvas = $("catch-board");
    ctx = canvas ? canvas.getContext("2d") : null;
    if (canvas) bind();
    if (tickId) clearInterval(tickId);
    tickId = setInterval(tick, 250);
    render();
  }

  function leave() {
    stopBgm(true);
    stopStartSfx(true);
    lastStartSfxMatchId = null;
    lastCountdownCue = "";
    stopCountdownSfx();
    resetResultPopup();
    closeGallery();
    if (finishSfxEl) {
      try { finishSfxEl.pause(); finishSfxEl.currentTime = 0; } catch (e) {}
    }
    if (tickId) { clearInterval(tickId); tickId = null; }
    if (pendingStrokeTimer) { clearTimeout(pendingStrokeTimer); pendingStrokeTimer = null; }
    clearSaveRetry();
    api = null;
    state = freshState();
    secretWord = null;
    drawing = false;
    currentStroke = null;
    strokeSentCount = 0;
    canvasLimitNotified = false;
    guessTimes = Object.create(null);
    stateHost = null;
    lastSyncRequestAt = 0;
    lastCanvasRequestAt = 0;
    lastChatViewScope = "";
  }

  function onReady() {
    if (api && api.isHost()) requestCanvasSync(false);
    else requestStateSync(false);
  }

  function roomMeta() {
    if (state.phase === "practice") return { status: "대기중", summary: "연습모드" };
    if (state.phase === "countdown") {
      return { status: "게임중", summary: (state.drawer || "출제자") + " 준비 · " + (state.roundIndex + 1) + "/" + state.queue.length };
    }
    if (state.phase === "drawing") {
      var solved = Object.keys(state.correct).filter(function (nick) { return state.correct[nick]; }).length;
      var reconnecting = state.pauseKind === "drawer" ? " · 재접속 대기" : "";
      return { status: "게임중", summary: (state.drawer || "출제자") + " 그림" + reconnecting + " · " + solved + "/" + state.guessers.length + " 정답" };
    }
    if (state.phase === "reveal") return { status: "게임중", summary: "정답 공개 · 다음 라운드 준비" };
    if (state.phase === "finished") {
      var order = scoreOrder();
      return { status: "끝", summary: order.length ? order[0] + " 1위 · " + (state.scores[order[0]] || 0) + "점" : "게임 종료" };
    }
    var waitingParticipants = desiredParticipantNicks().length;
    var waitingSpectators = desiredSpectatorPeople().length;
    return { status: "대기중", summary: waitingParticipants + "명 참가 · " + waitingSpectators + "명 관전" };
  }

  function isBusy() {
    return (state.phase === "countdown" || state.phase === "drawing" || state.phase === "reveal") && has(state.queue, me().nick);
  }

  function canChat(nick) {
    return !isGroupedChatPhase();
  }

  function renderPlayers(box, hint) {
    if (!box || !api) return;
    if (hint) {
      hint.className = "players-hint";
      hint.textContent = "현재 역할과 이번 게임 점수입니다. 중간 입장자는 다음 게임부터 참여합니다.";
    }
    var mine = me().nick, host = api.host();
    var list = people().slice().sort(function (a, b) { return (a.joinTs || 0) - (b.joinTs || 0); });
    box.innerHTML = list.map(function (person) {
      var role = "다음 게임", cls = "role-catch";
      if (canChangeRole() && has(state.spectators || [], person.nick)) { role = "관전"; cls = "role-catch"; }
      else if (canChangeRole()) { role = "참가"; cls = "role-catch"; }
      else if (state.phase === "drawing" && person.nick === state.drawer) { role = "그림"; cls = "role-draw"; }
      else if (state.correct[person.nick]) { role = "정답"; cls = "role-correct"; }
      else if (has(state.queue, person.nick)) { role = "참여"; cls = "role-catch"; }
      var hostMark = person.nick === host && !person.away ? ' <span class="mini-host">방장</span>' : "";
      var meMark = person.nick === mine ? ' <span class="mini-me">나</span>' : "";
      var awayMark = person.away ? ' <span class="mini-away">자리비움</span>' : "";
      return '<div class="prow' + (person.away ? ' away' : '') + '"><span class="pname"><span class="rtag ' + cls + '">' + role + '</span>'
        + esc(person.nick) + hostMark + meMark + awayMark + '</span><span class="catch-player-score">' + (state.scores[person.nick] || 0) + '점</span></div>';
    }).join("");
  }

  function rules() {
    return {
      title: "캐치마인드 규칙",
      html: '<div class="cm-rules">'
        + '<p class="rule-intro">한 사람씩 제시어를 보고 그림을 그려요. 나머지 참가자는 그림을 보고 정답을 맞히며, <b>게임이 끝났을 때 경기 점수가 가장 높은 사람이 1등</b>입니다.</p>'
        + '<section class="cm-rule-section"><h3>1. 게임 진행</h3>'
        + '<ul class="cm-rule-list">'
        + '<li>내 차례가 되면 준비 화면에서 <b>3초</b>를 센 뒤 그림을 시작해요.</li>'
        + '<li>그림을 그릴 수 있는 시간은 한 사람당 <b>90초</b>예요.</li>'
        + '<li>참가자가 모두 맞히거나 90초가 지나면 다음 사람 차례로 넘어가요.</li>'
        + '<li>모든 참가자가 한 번씩 그림을 그리면 게임이 끝나요.</li>'
        + '</ul></section>'
        + '<section class="cm-rule-section"><h3>2. 경기 점수</h3>'
        + '<p>정답은 <b>빨리 맞힐수록 높은 점수</b>를 받아요. 출제자도 그림을 빨리 알아본 사람이 많을수록 더 높은 점수를 얻어요.</p>'
        + '<table class="cm-rule-score-table" aria-label="캐치마인드 시간별 경기 점수">'
        + '<thead><tr><th>정답한 시간</th><th>정답자</th><th>출제자</th></tr></thead>'
        + '<tbody>'
        + '<tr><td>0~14초</td><td><b>10점</b></td><td><b>3점</b></td></tr>'
        + '<tr><td>15~29초</td><td><b>9점</b></td><td><b>3점</b></td></tr>'
        + '<tr><td>30~44초</td><td><b>8점</b></td><td><b>2점</b></td></tr>'
        + '<tr><td>45~59초</td><td><b>7점</b></td><td><b>2점</b></td></tr>'
        + '<tr><td>60~74초</td><td><b>6점</b></td><td><b>1점</b></td></tr>'
        + '<tr><td>75~90초</td><td><b>5점</b></td><td><b>1점</b></td></tr>'
        + '</tbody></table>'
        + '<p class="cm-rule-example"><b>예시</b> · 그림 시작 38초 뒤에 맞히면 정답자는 8점, 출제자는 2점을 받아요.</p>'
        + '<p class="cm-rule-muted">틀린 답을 입력해도 점수는 깎이지 않아요.</p></section>'
        + '<section class="cm-rule-section"><h3>3. 시즌 랭킹은 따로 계산해요</h3>'
        + '<p><b>경기 점수</b>는 이번 게임의 승부를 정하고, <b>시즌 활약도</b>는 서로 다른 인원수의 게임도 공정하게 비교하기 위해 따로 계산해요.</p>'
        + '<ul class="cm-rule-list">'
        + '<li>정답에 성공하면 활약도 계산용 <b>10점</b>을 기록해요.</li>'
        + '<li>내 그림을 한 사람이 맞힐 때마다 활약도 계산용 <b>3점</b>을 기록해요.</li>'
        + '<li>기록한 점수를 이번 게임에서 얻을 수 있었던 최대점수로 나눈 값이 <b>활약도</b>예요.</li>'
        + '</ul>'
        + '<p class="cm-rule-muted">따라서 빠른 정답은 이번 경기의 승리에 유리하고, 시즌 랭킹은 꾸준히 정답을 맞히고 이해하기 좋은 그림을 그릴수록 유리해요.</p></section>'
        + '<section class="cm-rule-section"><h3>4. 알아두기</h3>'
        + '<ul class="cm-rule-list">'
        + '<li>관전자는 정답을 입력할 수 없고 관전자끼리 채팅할 수 있어요.</li>'
        + '<li>정답을 맞힌 참가자는 다음 턴 전까지 관전자 채팅에 함께 참여해요.</li>'
        + '<li>출제자의 연결이 끊기면 게임이 최대 <b>15초</b> 멈춰요. 돌아오면 이어서 진행하고, 돌아오지 않으면 다음 차례로 넘어가요.</li>'
        + '</ul></section></div>'
    };
  }

  var controller = {
    enter: enter,
    leave: leave,
    onReady: onReady,
    onMessage: onMessage,
    onPresence: onPresence,
    roomMeta: roomMeta,
    isBusy: isBusy,
    canChat: canChat,
    renderPlayers: renderPlayers,
    render: render,
    rules: rules,
    get state() { return state; }
  };
  if (window.__CATCHMIND_TEST__) {
    controller._test = {
      freshState: freshState,
      resetMatchState: resetMatchState,
      sanitizeSnapshot: sanitizeSnapshot,
      sanitizeStrokes: sanitizeStrokes,
      applyState: applyState,
      applyStrokeDelta: applyStrokeDelta,
      allGuessersCorrect: allGuessersCorrect,
      hostStartMatch: hostStartMatch,
      hostStartRound: hostStartRound,
      hostBeginDrawing: hostBeginDrawing,
      hostGuess: hostGuess,
      hostPauseForDrawer: hostPauseForDrawer,
      hostResumeRound: hostResumeRound,
      hostSpectatorInput: hostMatchChatInput,
      hostMatchChatInput: hostMatchChatInput,
      receiveMatchChat: receiveMatchChat,
      requiredReadyNicks: requiredReadyNicks,
      allParticipantsReady: allParticipantsReady,
      hostSetReady: hostSetReady,
      toggleReady: toggleReady,
      hostSetSpectatorPreference: hostSetSpectatorPreference,
      toggleRolePreference: toggleRolePreference,
      tick: tick,
      brushWidth: brushWidth,
      canDraw: canDraw,
      setSecretWord: function (word) { secretWord = word; },
      validReactionMessage: validReactionMessage,
      canChat: canChat,
      onMessage: onMessage,
      onPresence: onPresence,
      persistResults: persistResults,
      clearSaveRetry: clearSaveRetry,
      guessScoreForElapsed: guessScoreForElapsed,
      drawerScoreForGuess: drawerScoreForGuess,
      rules: rules,
      snapshot: snapshot,
      participantNicks: participantNicks,
      desiredParticipantNicks: desiredParticipantNicks,
      desiredSpectatorPeople: desiredSpectatorPeople,
      waitingParticipantPeople: waitingParticipantPeople,
      waitingSpectatorPeople: waitingSpectatorPeople,
      chatGroupFor: chatGroupFor,
      canViewChatGroup: canViewChatGroup,
      chatOverlaySide: chatOverlaySide,
      galleryDraftFromRound: galleryDraftFromRound,
      galleryTime: galleryTime,
      renderScores: renderScores,
      renderLobbyRoles: renderLobbyRoles,
      renderStage: renderStage,
      renderWord: renderWord,
      renderFeed: renderFeed,
      renderControls: renderControls,
      renderChatOverlayPosition: renderChatOverlayPosition,
      sendInput: sendInput,
      matchHighlights: matchHighlights,
      formatHighlightSeconds: formatHighlightSeconds,
      fallbackResultInfo: fallbackResultInfo,
      mergeResultInfo: mergeResultInfo,
      renderResultPopup: renderResultPopup,
      syncResultPopup: syncResultPopup,
      openResultPopup: openResultPopup,
      closeResultPopup: closeResultPopup,
      syncAudio: syncAudio,
      stopBgm: stopBgm,
      stopStartSfx: stopStartSfx,
      audioConfig: {
        bgmSrc: CATCH_BGM_SRC,
        bgmVolume: CATCH_BGM_VOLUME,
        startSrc: START_SFX_SRC,
        startVolume: START_SFX_VOLUME,
        countdownSrc: COUNTDOWN_SFX_SRC,
        countdownVolume: COUNTDOWN_SFX_VOLUME,
        clearSrc: CLEAR_SFX_SRC,
        clearVolume: CLEAR_SFX_VOLUME
      },
      paletteColors: PALETTE_COLORS.slice(),
      getState: function () { return state; },
      setState: function (next) { state = next; },
      setApi: function (next) { api = next; },
      limits: {
        strokes: MAX_STROKES,
        pointsPerStroke: MAX_POINTS_PER_STROKE,
        canvasPoints: MAX_CANVAS_POINTS,
        players: MAX_PLAYERS,
        strokeWidth: MAX_STROKE_WIDTH,
        roundMs: ROUND_MS,
        countdownMs: ROUND_COUNTDOWN_MS,
        drawerGraceMs: DRAWER_GRACE_MS
      }
    };
  }
  return controller;
})();
