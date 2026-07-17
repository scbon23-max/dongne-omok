window.CatchMind = (function () {
  "use strict";

  var ROUND_MS = 120000;
  var REVEAL_MS = 3000;
  var DRAW_SEND_MS = 60;
  var CANVAS_BG = "#ffffff";
  var PEN_COLORS = ["#17252f", "#d23b3b"];
  var PALETTE_COLORS = [
    "#17252f", "#6b7280", "#d23b3b", "#f97316", "#eab308", "#22c55e",
    "#14b8a6", "#38bdf8", "#2474b5", "#8b5cf6", "#ec4899", "#7c4a2d"
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
  var CATCH_BGM_SRC = "assets/catchmind-bgm.mp3";
  var CATCH_BGM_VOLUME = 0.09;
  var DRAW_SFX_VOLUME = 0.2;
  var DRAW_SFX_COOLDOWN_MS = 85;
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
  var sfxCtx = null;
  var scratchBuffer = null;
  var lastDrawSfxAt = 0;
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

  function freshState() {
    return {
      phase: "idle",
      rev: 0,
      matchId: null,
      queue: [],
      roundIndex: 0,
      drawer: null,
      guessers: [],
      deadline: null,
      nextAt: null,
      scores: Object.create(null),
      stats: Object.create(null),
      correct: Object.create(null),
      strokes: [],
      canvasBg: CANVAS_BG,
      drawSeq: 0,
      feed: [],
      revealWord: null,
      wordLength: 0,
      recordStatus: "idle"
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
  function activePeople() { return people().filter(function (p) { return p && p.nick && !p.away; }); }
  function activeNicks() { return activePeople().map(function (p) { return p.nick; }); }
  function has(arr, value) { return arr.indexOf(value) >= 0; }
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
        drawCorrect: safeInteger(row.drawCorrect, 0, MAX_SCORE, 0)
      };
    });
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
      return { who: safeNick(item.who), text: safeText(item.text, 60), kind: kind };
    });
  }

  function initStats(nick) {
    if (state.scores[nick] == null) state.scores[nick] = 0;
    if (!state.stats[nick]) state.stats[nick] = { points: 0, maxPoints: 0, correct: 0, drawCorrect: 0 };
    return state.stats[nick];
  }

  function snapshot() {
    return {
      protocol: 2,
      phase: state.phase,
      rev: state.rev,
      matchId: state.matchId,
      queue: state.queue,
      roundIndex: state.roundIndex,
      drawer: state.drawer,
      guessers: state.guessers,
      remainMs: state.deadline ? Math.max(0, state.deadline - Date.now()) : null,
      nextRemainMs: state.nextAt ? Math.max(0, state.nextAt - Date.now()) : null,
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
    if (!api || !api.isHost() || state.phase !== "drawing" || !state.drawer || state.drawer === me().nick) return;
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
    var phases = ["idle", "drawing", "reveal", "finished"];
    var phase = phases.indexOf(next.phase) >= 0 ? next.phase : "idle";
    var queue = safeNickList(next.queue);
    var drawer = safeNick(next.drawer);
    if (!has(queue, drawer)) drawer = null;
    var guessers = safeNickList(next.guessers).filter(function (nick) {
      return nick !== drawer && has(queue, nick);
    });
    var recordStatus = RECORD_STATUSES.indexOf(next.recordStatus) >= 0
      ? next.recordStatus
      : (next.recorded ? "saved" : "idle");
    return {
      phase: phase,
      rev: rev,
      matchId: next.matchId == null ? null : safeText(next.matchId, 80),
      queue: queue,
      roundIndex: safeInteger(next.roundIndex, 0, Math.max(queue.length, 1), 0),
      drawer: drawer,
      guessers: guessers,
      remainMs: safeDuration(next.remainMs, ROUND_MS + 5000),
      nextRemainMs: safeDuration(next.nextRemainMs, REVEAL_MS + 5000),
      scores: safeScores(next.scores, queue),
      stats: safeStats(next.stats, queue),
      correct: safeCorrect(next.correct, guessers),
      strokes: sanitizeStrokes(next.strokes),
      canvasBg: safeColor(next.canvasBg) || CANVAS_BG,
      drawSeq: safeInteger(next.drawSeq, 0, Number.MAX_SAFE_INTEGER, 0),
      feed: safeFeed(next.feed),
      revealWord: next.revealWord == null ? null : safeText(next.revealWord, 40),
      wordLength: safeInteger(next.wordLength, 0, 10, 0),
      recordStatus: recordStatus
    };
  }

  function applyState(next, authorityChanged) {
    var clean = sanitizeSnapshot(next);
    if (!clean || (!authorityChanged && clean.rev < state.rev)) return false;
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
      roundIndex: clean.roundIndex,
      drawer: clean.drawer,
      guessers: clean.guessers,
      deadline: clean.remainMs != null ? Date.now() + clean.remainMs : null,
      nextAt: clean.nextRemainMs != null ? Date.now() + clean.nextRemainMs : null,
      scores: clean.scores,
      stats: clean.stats,
      correct: clean.correct,
      strokes: keepNewerCanvas ? state.strokes : clean.strokes,
      canvasBg: keepNewerCanvas ? state.canvasBg : clean.canvasBg,
      drawSeq: keepNewerCanvas ? state.drawSeq : clean.drawSeq,
      feed: clean.feed,
      revealWord: clean.revealWord,
      wordLength: clean.wordLength,
      recordStatus: clean.recordStatus
    };
    if (!sameRound) secretWord = null;
    render();
    return true;
  }

  function addFeed(who, text, kind) {
    state.feed.push({ who: who || "", text: String(text || "").slice(0, 60), kind: kind || "guess" });
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
    state = freshState();
    state.rev = currentRev;
    state.matchId = matchId || (Date.now().toString(36) + "-" + Math.floor(Math.random() * 100000).toString(36));
    state.queue = safeNickList(queue);
    return state;
  }

  function resultsFromState() {
    return state.queue.map(function (nick) {
      var s = state.stats[nick];
      if (!s || !s.maxPoints) return null;
      return { nick: nick, points: s.points, maxPoints: s.maxPoints, correct: s.correct, drawCorrect: s.drawCorrect };
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
    if (!api || !api.isHost()) return;
    var queue = activePeople().sort(function (a, b) {
      return (a.joinTs || 0) - (b.joinTs || 0) || String(a.nick).localeCompare(String(b.nick));
    }).map(function (p) { return p.nick; });
    queue = safeNickList(queue);
    if (queue.length < 2) { api.toast("2명 이상 모여야 시작할 수 있어요"); return; }
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

    state.phase = "drawing";
    state.roundIndex = index;
    state.drawer = drawer;
    state.guessers = guessers;
    state.correct = {};
    state.strokes = [];
    state.canvasBg = CANVAS_BG;
    state.drawSeq = 0;
    state.feed = [];
    state.revealWord = null;
    state.deadline = Date.now() + ROUND_MS;
    state.nextAt = null;
    state.recordStatus = "idle";
    lastCanvasRequestAt = 0;
    drawing = false;
    currentStroke = null;
    strokeSentCount = 0;
    canvasLimitNotified = false;
    guessTimes = Object.create(null);
    secretWord = pickWord();
    state.wordLength = Array.from(secretWord).length;

    state.guessers.forEach(function (nick) { initStats(nick).maxPoints += 10; });
    initStats(state.drawer).maxPoints += state.guessers.length * 3;
    addFeed("", state.drawer + "님이 그림을 시작했어요", "system");
    state.rev++;
    broadcastState();
    api.send({
      t: "cm_secret",
      from: me().nick,
      to: state.drawer,
      matchId: state.matchId,
      roundIndex: state.roundIndex,
      word: secretWord
    });
    render();
  }

  function hostEndRound(reason) {
    if (!api || !api.isHost() || state.phase !== "drawing") return;
    state.phase = "reveal";
    state.deadline = null;
    state.nextAt = Date.now() + REVEAL_MS;
    state.revealWord = secretWord || "문제 취소";
    if (reason) addFeed("", reason, "system");
    if (secretWord) addFeed("", "정답은 " + secretWord, "answer");
    commit();
  }

  function hostFinishMatch() {
    if (!api || !api.isHost() || state.phase === "finished") return;
    state.phase = "finished";
    state.drawer = null;
    state.guessers = [];
    state.deadline = null;
    state.nextAt = null;
    state.revealWord = null;
    secretWord = null;

    var results = resultsFromState();
    state.recordStatus = results.length >= 2 ? "pending" : "skipped";
    addFeed("", "게임이 끝났어요. 최종 점수를 확인해 보세요", "system");
    commit();

    if (state.recordStatus === "pending") persistResults(state.matchId, results, 0);
  }

  function allGuessersCorrect() {
    return state.guessers.length > 0 && state.guessers.every(function (nick) { return !!state.correct[nick]; });
  }

  function hostGuess(msg) {
    if (!api.isHost() || state.phase !== "drawing" || !secretWord) return;
    if (msg.matchId !== state.matchId || msg.roundIndex !== state.roundIndex) return;
    var nick = safeNick(msg.nick), text = safeText(msg.text, 40).trim();
    if (!text || !has(state.guessers, nick) || !has(activeNicks(), nick) || state.correct[nick]) return;
    var now = Date.now();
    if (guessTimes[nick] && now - guessTimes[nick] < 250) return;
    guessTimes[nick] = now;

    if (normalize(text) === normalize(secretWord)) {
      state.correct[nick] = true;
      state.scores[nick] = (state.scores[nick] || 0) + 10;
      state.stats[nick].points += 10;
      state.stats[nick].correct++;
      if (state.stats[state.drawer]) {
        state.scores[state.drawer] = (state.scores[state.drawer] || 0) + 3;
        state.stats[state.drawer].points += 3;
        state.stats[state.drawer].drawCorrect++;
      }
      addFeed("", nick + "님 정답! +10", "correct");
      commit();
      if (allGuessersCorrect()) hostEndRound("모두 맞혔어요");
    } else {
      addFeed(nick, text, "guess");
      commit();
    }
  }

  function validRoundMessage(msg) {
    return state.phase === "drawing" && msg.matchId === state.matchId && msg.roundIndex === state.roundIndex
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
    return { id: safeText(raw.id, 80), color: color, width: clamp(Number(raw.width) || 8, 4, 36), points: points };
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
      width: clamp(Number(raw.width) || 8, 4, 36),
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
    else if (type === "cm_clear") state.strokes = [];
    else if (type === "cm_bg") state.canvasBg = safeColor(msg.color) || state.canvasBg || CANVAS_BG;
    state.drawSeq = seq;
    redraw();
  }

  function sendCanvasSnapshot(msg) {
    if (!api || state.phase !== "drawing" || state.drawer !== me().nick) return;
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
    if (!api || !api.isHost() || state.phase !== "drawing") return;
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
    var scope = state.phase === "drawing" ? reactionScopeKey() : "";
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
    if (state.phase !== "drawing") {
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
    if (!emoji || state.phase !== "drawing") return false;
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
    return !!(state.phase === "drawing" && nick && has(state.guessers, nick) && state.correct[nick]);
  }

  function validReactionMessage(msg) {
    var nick = safeNick(msg && msg.nick);
    return !!(state.phase === "drawing"
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
        if (state.phase === "drawing" && secretWord && helloNick === state.drawer) {
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
    else if (msg.t === "cm_guess") hostGuess(msg);
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

  function syncBgm() {
    if (!api || isSoundMuted()) { stopBgm(false); return; }
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

  function ensureSfxContext() {
    if (typeof window === "undefined") return null;
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    try {
      if (!sfxCtx) sfxCtx = new AudioContextCtor();
      if (sfxCtx.state === "suspended" && sfxCtx.resume) sfxCtx.resume();
      return sfxCtx;
    } catch (e) {
      return null;
    }
  }

  function getScratchBuffer(ctx) {
    if (scratchBuffer && scratchBuffer.sampleRate === ctx.sampleRate) return scratchBuffer;
    var length = Math.max(1, Math.floor(ctx.sampleRate * 0.12));
    scratchBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = scratchBuffer.getChannelData(0);
    for (var i = 0; i < length; i++) {
      var fade = Math.pow(1 - i / length, 2.2);
      data[i] = (Math.random() * 2 - 1) * fade;
    }
    return scratchBuffer;
  }

  function playDrawSfx(tool) {
    if (isSoundMuted()) return;
    var nowMs = Date.now();
    if (nowMs - lastDrawSfxAt < DRAW_SFX_COOLDOWN_MS) return;
    lastDrawSfxAt = nowMs;
    var ctx = ensureSfxContext();
    if (!ctx) return;
    try {
      var now = ctx.currentTime;
      var duration = tool === "eraser" ? 0.16 : 0.105;
      var noise = ctx.createBufferSource();
      var filter = ctx.createBiquadFilter();
      var gain = ctx.createGain();
      noise.buffer = getScratchBuffer(ctx);
      filter.type = tool === "eraser" ? "bandpass" : "highpass";
      filter.frequency.setValueAtTime(tool === "eraser" ? 720 : 1800, now);
      filter.Q.value = tool === "eraser" ? 0.8 : 0.55;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(DRAW_SFX_VOLUME * (tool === "eraser" ? 0.7 : 1), now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + duration);
      if (tool !== "eraser") {
        var tap = ctx.createOscillator();
        var tapGain = ctx.createGain();
        tap.type = "triangle";
        tap.frequency.setValueAtTime(880, now);
        tap.frequency.exponentialRampToValueAtTime(520, now + 0.035);
        tapGain.gain.setValueAtTime(0.0001, now);
        tapGain.gain.linearRampToValueAtTime(DRAW_SFX_VOLUME * 0.28, now + 0.006);
        tapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        tap.connect(tapGain);
        tapGain.connect(ctx.destination);
        tap.start(now);
        tap.stop(now + 0.06);
      }
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
    if (isHost && becameHost && state.phase === "drawing" && !secretWord) {
      hostEndRound("방장이 바뀌어 이번 문제를 넘겼어요");
    } else if (isHost && state.phase === "drawing") {
      // Presence can briefly mark a reconnecting player away. Only accepted guesses finish a round.
      broadcastState();
    } else if (isHost) {
      broadcastState();
    }
    if (isHost && becameHost && state.phase === "finished" && state.recordStatus === "pending") {
      persistResults(state.matchId, resultsFromState(), 0);
    }
    if (isHost && state.phase === "drawing") requestCanvasSync(false);
    if (!isHost && (lostHost || stateHost !== api.host())) requestStateSync(true);
    previousHost = isHost;
    render();
  }

  function tick() {
    if (!api) return;
    syncBgm();
    renderTimer();
    if (!api.isHost()) return;
    var now = Date.now();
    if (state.phase === "drawing" && state.deadline && now >= state.deadline) hostEndRound("시간이 끝났어요");
    else if (state.phase === "reveal" && state.nextAt && now >= state.nextAt) hostStartRound(state.roundIndex + 1);
  }

  function scoreOrder() {
    return state.queue.slice().sort(function (a, b) {
      return (state.scores[b] || 0) - (state.scores[a] || 0) || state.queue.indexOf(a) - state.queue.indexOf(b);
    });
  }

  function participantNicks() {
    var live = activeNicks();
    var source = state.queue.length ? state.queue : live;
    return source.filter(function (nick) { return has(live, nick); });
  }

  function renderHeader() {
    var label = $("catch-round-label");
    if (label) {
      if (state.phase === "practice") label.textContent = "연습모드";
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
    if (state.phase === "drawing" && state.deadline) {
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
    var livePeople = activePeople().slice().sort(function (a, b) { return (a.joinTs || 0) - (b.joinTs || 0); });
    if (!livePeople.length) {
      box.textContent = "";
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    var liveNicks = livePeople.map(function (p) { return p.nick; });
    var participantSet = Object.create(null);
    participantNicks().forEach(function (nick) { participantSet[nick] = true; });
    var ordered = scoreOrder().filter(function (nick) { return has(liveNicks, nick); });
    livePeople.forEach(function (person) { if (!has(ordered, person.nick)) ordered.push(person.nick); });
    box.innerHTML = ordered.map(function (nick) {
      var isParticipant = !!participantSet[nick];
      var isCorrect = state.phase === "drawing" && !!state.correct[nick];
      var cls = (nick === state.drawer ? " drawer" : "") + (isCorrect ? " correct" : "") + (isParticipant ? "" : " spectator");
      var score = isParticipant && state.queue.length ? " " + (state.scores[nick] || 0) + "점" : "";
      var badge = isCorrect ? ' <em>정답</em>' : "";
      return '<span class="' + cls.trim() + '"><b>' + esc(nick) + '</b>' + badge + score + '</span>';
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
    else if (state.phase === "drawing") box.textContent = state.drawer === me().nick && secretWord ? secretWord : maskWord(state.wordLength);
    else if (state.phase === "reveal") box.textContent = state.revealWord || "문제 취소";
    else if (state.phase === "finished") box.textContent = "게임 종료";
    else box.textContent = "준비 중";
  }

  function renderFeed() {
    var box = $("catch-feed"); if (!box) return;
    box.innerHTML = state.feed.map(function (item, index) {
      var kind = FEED_KINDS.indexOf(item.kind) >= 0 ? item.kind : "guess";
      var age = Math.min(state.feed.length - 1 - index, MAX_FEED_LINES - 1);
      var cls = "catch-feed-line " + kind + " feed-age-" + age;
      if (item.who) return '<div class="' + cls + '"><b>' + esc(item.who) + '</b> ' + esc(item.text) + '</div>';
      return '<div class="' + cls + '">' + esc(item.text) + '</div>';
    }).join("");
  }

  function renderStage() {
    var stage = $("catch-stage"), title = $("catch-stage-title"), sub = $("catch-stage-sub"), start = $("catch-start-btn"), practice = $("catch-practice-btn");
    if (!stage || !title || !sub || !start || !practice) return;
    var mine = me().nick;
    var waitingDuringRound = state.phase === "drawing" && !has(state.queue, mine);
    var show = (state.phase !== "drawing" && state.phase !== "practice") || waitingDuringRound;
    stage.classList.toggle("hidden", !show);
    stage.classList.toggle("side", waitingDuringRound || state.phase === "finished");
    if (!show) return;
    var canStart = api && api.isHost() && activePeople().length >= 2;
    var canPractice = api && activePeople().length <= 1;
    if (waitingDuringRound) {
      title.textContent = "대기 중";
      sub.textContent = "이번 판은 진행 중이에요. 다음 게임부터 참여해요";
      sub.classList.remove("hidden");
      start.classList.add("hidden");
      practice.classList.add("hidden");
    } else if (state.phase === "reveal") {
      title.textContent = "정답 · " + (state.revealWord || "문제 취소");
      sub.textContent = "다음 그림을 준비하고 있어요";
      sub.classList.remove("hidden");
      start.classList.add("hidden");
      practice.classList.add("hidden");
    } else if (state.phase === "finished") {
      var order = scoreOrder(), winner = order[0];
      title.textContent = winner ? winner + "님 1위!" : "게임 종료";
      if (state.recordStatus === "pending") sub.textContent = "랭킹 기록을 저장하고 있어요";
      else if (state.recordStatus === "saved") sub.textContent = "결과가 시즌 랭킹에 반영됐어요";
      else if (state.recordStatus === "failed") sub.textContent = "랭킹 기록 저장에 실패했어요";
      else sub.textContent = "참여 기록이 부족해 랭킹에는 반영되지 않았어요";
      sub.classList.remove("hidden");
      start.textContent = "다시 시작";
      start.classList.toggle("hidden", !canStart);
      start.disabled = state.recordStatus === "pending";
      practice.classList.toggle("hidden", !canPractice);
      practice.disabled = !canPractice;
    } else {
      title.textContent = "게임 대기 중";
      sub.textContent = canPractice ? "혼자라면 연습모드로 그림을 테스트할 수 있어요" : (api && api.isHost() ? "2명 이상이면 바로 시작할 수 있어요" : "방장이 시작하면 모두 함께 참여해요");
      sub.classList.remove("hidden");
      start.textContent = "게임 시작";
      start.classList.toggle("hidden", !canStart);
      start.disabled = false;
      practice.classList.toggle("hidden", !canPractice);
      practice.disabled = !canPractice;
    }
  }

  function renderControls() {
    var mine = me().nick;
    var isPractice = state.phase === "practice" && state.drawer === mine;
    var isDrawer = (state.phase === "drawing" && state.drawer === mine) || isPractice;
    var isGuesser = state.phase === "drawing" && has(state.guessers, mine) && !state.correct[mine];
    var isCorrectGuesser = state.phase === "drawing" && !!state.correct[mine];
    var tools = $("catch-tools"), inputRow = $("catch-input-row"), input = $("catch-chat-input"), emojiRow = $("catch-emoji-row");
    if (tools) tools.classList.toggle("hidden", !isDrawer);
    if (!isDrawer) setPaletteOpen(false);
    if (inputRow) inputRow.classList.toggle("hidden", isDrawer || isCorrectGuesser);
    if (emojiRow) emojiRow.classList.toggle("hidden", !isCorrectGuesser);
    if (input) {
      input.disabled = isCorrectGuesser;
      if (isCorrectGuesser) input.value = "";
      if (isPractice) input.placeholder = "연습 중 · 채팅 입력";
      else if (isGuesser) input.placeholder = "정답 또는 채팅 입력";
      else if (isCorrectGuesser) input.placeholder = "정답 완료 · 다음 라운드까지 대기";
      else if (state.phase === "drawing" && !has(state.queue, mine)) input.placeholder = "다음 게임부터 참여 · 채팅 입력";
      else input.placeholder = "채팅 입력";
    }
    syncToolButtons();
  }

  function render() {
    if (!api) return;
    syncReactionScope();
    renderHeader();
    renderScores();
    renderWord();
    renderFeed();
    renderStage();
    renderControls();
    redraw();
  }

  function canDraw() {
    return !!(api && state.drawer === me().nick && (state.phase === "practice" || (state.phase === "drawing" && secretWord)));
  }

  function pointFromEvent(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function drawOne(stroke) {
    if (!ctx || !stroke || !stroke.points || !stroke.points.length) return;
    var points = stroke.points;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x * canvas.width, points[0].y * canvas.height, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x * canvas.width, points[i].y * canvas.height);
    ctx.stroke();
  }

  function redraw() {
    if (!ctx || !canvas) return;
    ctx.fillStyle = state.canvasBg || CANVAS_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    state.strokes.forEach(drawOne);
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
      width: selectedTool === "eraser" ? 30 : 8,
      points: [pointFromEvent(event)]
    };
    strokeSentCount = 0;
    if (!upsertStroke(currentStroke)) {
      drawing = false;
      currentStroke = null;
      notifyCanvasLimit();
      return;
    }
    playDrawSfx(selectedTool);
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

  function updateColorButtons() {
    var colorButtons = document.querySelectorAll("[data-catch-color]");
    for (var i = 0; i < colorButtons.length; i++) {
      var slot = colorSlotFromButton(colorButtons[i], i);
      var color = PEN_COLORS[slot] || PEN_COLORS[0];
      colorButtons[i].setAttribute("data-catch-color-slot", String(slot));
      colorButtons[i].setAttribute("data-catch-color", color);
      colorButtons[i].setAttribute("aria-label", "color " + (slot + 1));
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
    if (state.phase === "drawing" && state.correct[mine]) { input.value = ""; return; }
    if (state.phase === "drawing" && has(state.guessers, mine) && !state.correct[mine]) {
      api.send({ t: "cm_guess", nick: mine, text: text, matchId: state.matchId, roundIndex: state.roundIndex });
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

  function bind() {
    if (bound) return;
    bound = true;
    loadPenColors();
    selectedColor = PEN_COLORS[selectedColorSlot] || PEN_COLORS[0];
    setupToolButtons();
    buildPaletteUi();
    updateColorButtons();
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);

    $("catch-start-btn").addEventListener("click", hostStartMatch);
    $("catch-practice-btn").addEventListener("click", startPractice);
    $("catch-chat-input").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.isComposing) sendInput();
    });
    var emojiButtons = document.querySelectorAll("[data-catch-emoji]");
    for (var e = 0; e < emojiButtons.length; e++) emojiButtons[e].addEventListener("click", function () {
      sendReaction(this.getAttribute("data-catch-emoji"));
    });
    $("catch-leave-btn").addEventListener("click", function () { if (api) api.leaveRoom(); });
    $("catch-people-btn").addEventListener("click", function () { if (api) api.openPlayers(); });
    $("catch-rank-btn").addEventListener("click", function () { if (api) api.openRank(); });
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
    canvas = $("catch-board");
    ctx = canvas ? canvas.getContext("2d") : null;
    if (canvas) bind();
    if (tickId) clearInterval(tickId);
    tickId = setInterval(tick, 250);
    render();
    syncBgm();
  }

  function leave() {
    stopBgm(true);
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
  }

  function onReady() {
    if (api && api.isHost()) requestCanvasSync(false);
    else requestStateSync(false);
  }

  function roomMeta() {
    if (state.phase === "practice") return { status: "대기중", summary: "연습모드" };
    if (state.phase === "drawing") {
      var solved = Object.keys(state.correct).filter(function (nick) { return state.correct[nick]; }).length;
      return { status: "게임중", summary: (state.drawer || "출제자") + " 그림 · " + solved + "/" + state.guessers.length + " 정답" };
    }
    if (state.phase === "reveal") return { status: "게임중", summary: "정답 공개 · 다음 라운드 준비" };
    if (state.phase === "finished") {
      var order = scoreOrder();
      return { status: "끝", summary: order.length ? order[0] + " 1위 · " + (state.scores[order[0]] || 0) + "점" : "게임 종료" };
    }
    return { status: "대기중", summary: activePeople().length + "명 참여" };
  }

  function isBusy() {
    return (state.phase === "drawing" || state.phase === "reveal") && has(state.queue, me().nick);
  }

  function canChat(nick) {
    nick = safeNick(nick);
    return !(state.phase === "drawing" && nick && state.correct[nick]);
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
      if (state.phase === "drawing" && person.nick === state.drawer) { role = "그림"; cls = "role-draw"; }
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
      html: '<p class="rule-intro">한 사람씩 제시어를 보고 그림을 그리고, 나머지 사람은 제한시간 안에 정답을 맞힙니다.</p>'
        + '<p class="rule-foot" style="text-align:left;line-height:1.8">'
        + '· 방에 있는 사람이 한 번씩 <b>120초</b> 동안 그림을 그립니다.<br>'
        + '· 정답을 맞히면 <b>+10점</b>, 내 그림을 한 사람이 맞힐 때마다 출제자도 <b>+3점</b>을 얻습니다.<br>'
        + '· 모두 맞히거나 시간이 끝나면 다음 사람 차례로 넘어갑니다.<br>'
        + '· 한 바퀴가 끝나면 결과가 시즌 랭킹에 반영됩니다.<br>'
        + '· 시즌 랭킹은 인원수 차이를 줄이기 위해 획득점수를 가능한 최대점수로 나눈 활약도를 사용합니다.</p>'
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
      validReactionMessage: validReactionMessage,
      canChat: canChat,
      onMessage: onMessage,
      onPresence: onPresence,
      persistResults: persistResults,
      clearSaveRetry: clearSaveRetry,
      snapshot: snapshot,
      participantNicks: participantNicks,
      getState: function () { return state; },
      setState: function (next) { state = next; },
      setApi: function (next) { api = next; },
      limits: { strokes: MAX_STROKES, pointsPerStroke: MAX_POINTS_PER_STROKE, canvasPoints: MAX_CANVAS_POINTS, players: MAX_PLAYERS }
    };
  }
  return controller;
})();
