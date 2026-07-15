window.CatchMind = (function () {
  "use strict";

  var ROUND_MS = 60000;
  var REVEAL_MS = 3000;
  var CANVAS_BG = "#ffffff";
  var PEN_COLORS = ["#17252f", "#d23b3b", "#2474b5"];
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
  var usedWords = {};
  var previousHost = false;
  var canvas = null;
  var ctx = null;
  var bound = false;
  var tickId = null;
  var drawing = false;
  var currentStroke = null;
  var selectedTool = "pen";
  var selectedColor = PEN_COLORS[0];
  var lastStrokeSend = 0;
  var pendingStrokeTimer = null;

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
      scores: {},
      stats: {},
      correct: {},
      strokes: [],
      feed: [],
      revealWord: null,
      wordLength: 0,
      recorded: false
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
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function normalize(value) { return String(value || "").toLowerCase().replace(/[\s\-_.!,?]/g, ""); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function initStats(nick) {
    if (state.scores[nick] == null) state.scores[nick] = 0;
    if (!state.stats[nick]) state.stats[nick] = { points: 0, maxPoints: 0, correct: 0, drawCorrect: 0 };
    return state.stats[nick];
  }

  function snapshot() {
    return {
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
      feed: state.feed,
      revealWord: state.revealWord,
      wordLength: state.wordLength,
      recorded: state.recorded
    };
  }

  function broadcastState() {
    if (!api || !api.isHost()) return;
    api.send({ t: "cm_state", state: snapshot() });
    api.roomChanged();
  }

  function commit() {
    state.rev++;
    broadcastState();
    render();
  }

  function applyState(next) {
    if (!next || typeof next.rev !== "number" || next.rev < state.rev) return;
    var sameRound = state.matchId === next.matchId && state.roundIndex === next.roundIndex;
    state = {
      phase: next.phase || "idle",
      rev: next.rev,
      matchId: next.matchId || null,
      queue: next.queue || [],
      roundIndex: next.roundIndex || 0,
      drawer: next.drawer || null,
      guessers: next.guessers || [],
      deadline: typeof next.remainMs === "number" ? Date.now() + next.remainMs : null,
      nextAt: typeof next.nextRemainMs === "number" ? Date.now() + next.nextRemainMs : null,
      scores: next.scores || {},
      stats: next.stats || {},
      correct: next.correct || {},
      strokes: next.strokes || [],
      feed: next.feed || [],
      revealWord: next.revealWord || null,
      wordLength: next.wordLength || 0,
      recorded: !!next.recorded
    };
    if (!sameRound) secretWord = null;
    render();
  }

  function addFeed(who, text, kind) {
    state.feed.push({ who: who || "", text: String(text || "").slice(0, 60), kind: kind || "guess" });
    while (state.feed.length > 3) state.feed.shift();
  }

  function wordPool() {
    var pool = Array.isArray(window.CATCHMIND_WORDS) && window.CATCHMIND_WORDS.length ? window.CATCHMIND_WORDS : FALLBACK_WORDS;
    return pool.filter(function (word) { return typeof word === "string" && /^[가-힣]{1,10}$/.test(word); });
  }

  function pickWord() {
    var pool = wordPool();
    if (!pool.length) return FALLBACK_WORDS[Math.floor(Math.random() * FALLBACK_WORDS.length)];
    var usedCount = Object.keys(usedWords).length;
    if (usedCount >= pool.length) usedWords = {};
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

  function hostStartMatch() {
    if (!api || !api.isHost()) return;
    var queue = activePeople().sort(function (a, b) {
      return (a.joinTs || 0) - (b.joinTs || 0) || String(a.nick).localeCompare(String(b.nick));
    }).map(function (p) { return p.nick; });
    if (queue.length < 2) { api.toast("2명 이상 모여야 시작할 수 있어요"); return; }
    state = freshState();
    state.matchId = Date.now().toString(36) + "-" + Math.floor(Math.random() * 100000).toString(36);
    state.queue = queue;
    queue.forEach(initStats);
    secretWord = null;
    usedWords = {};
    hostStartRound(0);
  }

  function hostStartRound(index) {
    if (!api || !api.isHost()) return;
    var live = activeNicks();
    while (index < state.queue.length && !has(live, state.queue[index])) index++;
    if (index >= state.queue.length) { hostFinishMatch(); return; }

    state.phase = "drawing";
    state.roundIndex = index;
    state.drawer = state.queue[index];
    state.guessers = state.queue.filter(function (nick) { return nick !== state.drawer && has(live, nick); });
    state.correct = {};
    state.strokes = [];
    state.feed = [];
    state.revealWord = null;
    state.deadline = Date.now() + ROUND_MS;
    state.nextAt = null;
    state.recorded = false;
    secretWord = pickWord();
    state.wordLength = Array.from(secretWord).length;

    state.guessers.forEach(function (nick) { initStats(nick).maxPoints += 10; });
    initStats(state.drawer).maxPoints += state.guessers.length * 3;
    addFeed("", state.drawer + "님이 그림을 시작했어요", "system");
    state.rev++;
    broadcastState();
    api.send({
      t: "cm_secret",
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

    var results = state.queue.map(function (nick) {
      var s = state.stats[nick];
      if (!s || !s.maxPoints) return null;
      return { nick: nick, points: s.points, maxPoints: s.maxPoints, correct: s.correct, drawCorrect: s.drawCorrect };
    }).filter(Boolean);
    state.recorded = results.length >= 2;
    addFeed("", "게임이 끝났어요. 최종 점수를 확인해 보세요", "system");
    commit();

    if (state.recorded) {
      api.recordMatch(state.matchId, results).then(function (res) {
        if (res && res.error) { api.toast("랭킹 기록 저장에 실패했어요"); return; }
        api.scoresChanged();
      }).catch(function () { api.toast("랭킹 기록 저장에 실패했어요"); });
    }
  }

  function allGuessersCorrect() {
    return state.guessers.length > 0 && state.guessers.every(function (nick) { return !!state.correct[nick]; });
  }

  function hostGuess(msg) {
    if (!api.isHost() || state.phase !== "drawing" || !secretWord) return;
    if (msg.matchId !== state.matchId || msg.roundIndex !== state.roundIndex) return;
    var nick = String(msg.nick || ""), text = String(msg.text || "").trim().slice(0, 40);
    if (!text || !has(state.guessers, nick) || state.correct[nick]) return;

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
    return state.phase === "drawing" && msg.matchId === state.matchId && msg.roundIndex === state.roundIndex && msg.nick === state.drawer;
  }

  function sanitizeStroke(raw) {
    if (!raw || !raw.id || !Array.isArray(raw.points)) return null;
    var color = PEN_COLORS.indexOf(raw.color) >= 0 || raw.color === CANVAS_BG ? raw.color : PEN_COLORS[0];
    var points = raw.points.slice(0, 600).map(function (p) {
      return { x: clamp(Number(p.x) || 0, 0, 1), y: clamp(Number(p.y) || 0, 0, 1) };
    });
    if (!points.length) return null;
    return { id: String(raw.id).slice(0, 80), color: color, width: clamp(Number(raw.width) || 8, 4, 36), points: points };
  }

  function upsertStroke(stroke) {
    var found = -1;
    for (var i = 0; i < state.strokes.length; i++) if (state.strokes[i].id === stroke.id) { found = i; break; }
    if (found >= 0) state.strokes[found] = stroke;
    else if (state.strokes.length < 120) state.strokes.push(stroke);
    redraw();
  }

  function onMessage(msg) {
    if (!msg || !msg.t) return false;
    if (msg.t === "hello") {
      if (api && api.isHost() && msg.nick !== me().nick) {
        broadcastState();
        if (state.phase === "drawing" && secretWord && msg.nick === state.drawer) {
          api.send({
            t: "cm_secret",
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

    if (msg.t === "cm_state") applyState(msg.state);
    else if (msg.t === "cm_secret") {
      if (msg.to === me().nick && msg.matchId === state.matchId && msg.roundIndex === state.roundIndex) {
        secretWord = String(msg.word || "");
        render();
      }
    } else if (msg.t === "cm_guess") hostGuess(msg);
    else if (msg.t === "cm_draw" && validRoundMessage(msg)) {
      var stroke = sanitizeStroke(msg.stroke);
      if (stroke) upsertStroke(stroke);
    } else if (msg.t === "cm_undo" && validRoundMessage(msg)) {
      state.strokes.pop(); redraw();
    } else if (msg.t === "cm_clear" && validRoundMessage(msg)) {
      state.strokes = []; redraw();
    }
    return true;
  }

  function onPresence(_list, options) {
    if (!api) return;
    var isHost = api.isHost();
    var becameHost = options && options.becameHost;
    if (isHost && becameHost && state.phase === "drawing" && !secretWord) {
      hostEndRound("방장이 바뀌어 이번 문제를 넘겼어요");
    } else if (isHost && state.phase === "drawing") {
      // Presence can briefly mark a reconnecting player away. Only accepted guesses finish a round.
      broadcastState();
    } else if (isHost) {
      broadcastState();
    }
    previousHost = isHost;
    render();
  }

  function tick() {
    if (!api) return;
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

  function renderHeader() {
    var label = $("catch-round-label");
    if (label) {
      if (state.phase === "drawing" || state.phase === "reveal") label.textContent = (state.drawer || "출제자") + " 그림 · " + (state.roundIndex + 1) + "/" + state.queue.length;
      else if (state.phase === "finished") label.textContent = "게임 종료";
      else label.textContent = "게임 대기 중";
    }
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
    if (!state.queue.length) {
      var count = activePeople().length;
      box.textContent = count < 2 ? "2명 이상 모이면 시작할 수 있어요" : count + "명 준비 완료";
      return;
    }
    var top = scoreOrder().slice(0, 3);
    box.innerHTML = top.map(function (nick) {
      return '<span><b>' + esc(nick) + '</b> ' + (state.scores[nick] || 0) + '점</span>';
    }).join("");
  }

  function maskWord(length) {
    var out = [];
    for (var i = 0; i < length; i++) out.push("○");
    return out.join(" ");
  }

  function renderWord() {
    var box = $("catch-word"); if (!box) return;
    if (state.phase === "drawing") box.textContent = state.drawer === me().nick && secretWord ? secretWord : maskWord(state.wordLength);
    else if (state.phase === "reveal") box.textContent = state.revealWord || "문제 취소";
    else if (state.phase === "finished") box.textContent = "게임 종료";
    else box.textContent = "준비 중";
  }

  function renderFeed() {
    var box = $("catch-feed"); if (!box) return;
    box.innerHTML = state.feed.map(function (item) {
      var cls = "catch-feed-line " + (item.kind || "guess");
      if (item.who) return '<div class="' + cls + '"><b>' + esc(item.who) + '</b> ' + esc(item.text) + '</div>';
      return '<div class="' + cls + '">' + esc(item.text) + '</div>';
    }).join("");
  }

  function renderStage() {
    var stage = $("catch-stage"), title = $("catch-stage-title"), sub = $("catch-stage-sub"), start = $("catch-start-btn");
    if (!stage || !title || !sub || !start) return;
    var show = state.phase !== "drawing";
    stage.classList.toggle("hidden", !show);
    if (!show) return;
    var canStart = api && api.isHost() && activePeople().length >= 2;
    if (state.phase === "reveal") {
      title.textContent = "정답 · " + (state.revealWord || "문제 취소");
      sub.textContent = "다음 그림을 준비하고 있어요";
      start.classList.add("hidden");
    } else if (state.phase === "finished") {
      var order = scoreOrder(), winner = order[0];
      title.textContent = winner ? winner + "님 1위!" : "게임 종료";
      sub.textContent = state.recorded ? "결과가 시즌 랭킹에 반영돼요" : "참여 기록이 부족해 랭킹에는 반영되지 않았어요";
      start.textContent = "다시 시작";
      start.classList.toggle("hidden", !canStart);
      start.disabled = false;
    } else {
      title.textContent = "게임 대기 중";
      sub.textContent = api && api.isHost() ? "2명 이상이면 바로 시작할 수 있어요" : "방장이 시작하면 모두 함께 참여해요";
      start.textContent = "게임 시작";
      start.classList.toggle("hidden", !canStart);
      start.disabled = false;
    }
  }

  function renderControls() {
    var mine = me().nick;
    var isDrawer = state.phase === "drawing" && state.drawer === mine;
    var isGuesser = state.phase === "drawing" && has(state.guessers, mine) && !state.correct[mine];
    var tools = $("catch-tools"), inputRow = $("catch-input-row"), input = $("catch-chat-input");
    if (tools) tools.classList.toggle("hidden", !isDrawer);
    if (inputRow) inputRow.classList.toggle("hidden", isDrawer);
    if (input) {
      if (isGuesser) input.placeholder = "정답 또는 채팅 입력";
      else if (state.phase === "drawing" && state.correct[mine]) input.placeholder = "정답 완료 · 채팅 입력";
      else if (state.phase === "drawing" && !has(state.queue, mine)) input.placeholder = "다음 게임부터 참여 · 채팅 입력";
      else input.placeholder = "채팅 입력";
    }
    syncToolButtons();
  }

  function render() {
    if (!api) return;
    renderHeader();
    renderScores();
    renderWord();
    renderFeed();
    renderStage();
    renderControls();
    redraw();
  }

  function canDraw() {
    return !!(api && state.phase === "drawing" && state.drawer === me().nick && secretWord);
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
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    state.strokes.forEach(drawOne);
  }

  function sendCurrentStroke(force) {
    if (!api || !currentStroke) return;
    var now = Date.now();
    if (!force && now - lastStrokeSend < 50) {
      if (!pendingStrokeTimer) {
        pendingStrokeTimer = setTimeout(function () { pendingStrokeTimer = null; sendCurrentStroke(true); }, 50);
      }
      return;
    }
    lastStrokeSend = now;
    api.send({
      t: "cm_draw",
      nick: me().nick,
      matchId: state.matchId,
      roundIndex: state.roundIndex,
      stroke: clone(currentStroke)
    });
  }

  function pointerDown(event) {
    if (!canDraw()) return;
    event.preventDefault();
    drawing = true;
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    var color = selectedTool === "eraser" ? CANVAS_BG : selectedColor;
    currentStroke = {
      id: me().nick + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 10000).toString(36),
      color: color,
      width: selectedTool === "eraser" ? 30 : 8,
      points: [pointFromEvent(event)]
    };
    upsertStroke(currentStroke);
    sendCurrentStroke(true);
  }

  function pointerMove(event) {
    if (!drawing || !currentStroke || !canDraw()) return;
    event.preventDefault();
    var point = pointFromEvent(event), prev = currentStroke.points[currentStroke.points.length - 1];
    var dx = point.x - prev.x, dy = point.y - prev.y;
    if (dx * dx + dy * dy < 0.000015) return;
    if (currentStroke.points.length < 600) currentStroke.points.push(point);
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

  function syncToolButtons() {
    var toolButtons = document.querySelectorAll("[data-catch-tool]");
    for (var i = 0; i < toolButtons.length; i++) {
      var on = toolButtons[i].getAttribute("data-catch-tool") === selectedTool;
      toolButtons[i].classList.toggle("active", on);
      toolButtons[i].setAttribute("aria-pressed", String(on));
    }
    var colorButtons = document.querySelectorAll("[data-catch-color]");
    for (var j = 0; j < colorButtons.length; j++) {
      var active = colorButtons[j].getAttribute("data-catch-color") === selectedColor && selectedTool === "pen";
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
    } else {
      api.sendChat(text);
    }
    input.value = "";
  }

  function bind() {
    if (bound) return;
    bound = true;
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);

    $("catch-start-btn").addEventListener("click", hostStartMatch);
    $("catch-send-btn").addEventListener("click", sendInput);
    $("catch-chat-input").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.isComposing) sendInput();
    });
    $("catch-leave-btn").addEventListener("click", function () { if (api) api.leaveRoom(); });
    $("catch-people-btn").addEventListener("click", function () { if (api) api.openPlayers(); });
    $("catch-rank-btn").addEventListener("click", function () { if (api) api.openRank(); });
    $("catch-menu-btn").addEventListener("click", function () { if (api) api.openMenu(); });

    var toolButtons = document.querySelectorAll("[data-catch-tool]");
    for (var i = 0; i < toolButtons.length; i++) toolButtons[i].addEventListener("click", function () {
      selectedTool = this.getAttribute("data-catch-tool"); syncToolButtons();
    });
    var colorButtons = document.querySelectorAll("[data-catch-color]");
    for (var j = 0; j < colorButtons.length; j++) colorButtons[j].addEventListener("click", function () {
      selectedColor = this.getAttribute("data-catch-color"); selectedTool = "pen"; syncToolButtons();
    });
    $("catch-undo-btn").addEventListener("click", function () {
      if (!canDraw()) return;
      api.send({ t: "cm_undo", nick: me().nick, matchId: state.matchId, roundIndex: state.roundIndex });
    });
    $("catch-clear-btn").addEventListener("click", function () {
      if (!canDraw()) return;
      api.send({ t: "cm_clear", nick: me().nick, matchId: state.matchId, roundIndex: state.roundIndex });
    });
  }

  function enter(nextApi) {
    api = nextApi;
    state = freshState();
    secretWord = null;
    previousHost = false;
    drawing = false;
    currentStroke = null;
    canvas = $("catch-board");
    ctx = canvas ? canvas.getContext("2d") : null;
    if (canvas) bind();
    if (tickId) clearInterval(tickId);
    tickId = setInterval(tick, 250);
    render();
  }

  function leave() {
    if (tickId) { clearInterval(tickId); tickId = null; }
    if (pendingStrokeTimer) { clearTimeout(pendingStrokeTimer); pendingStrokeTimer = null; }
    api = null;
    state = freshState();
    secretWord = null;
    drawing = false;
    currentStroke = null;
  }

  function onReady() {
    if (api) api.send({ t: "hello", nick: me().nick });
  }

  function roomMeta() {
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
        + '· 방에 있는 사람이 한 번씩 <b>60초</b> 동안 그림을 그립니다.<br>'
        + '· 정답을 맞히면 <b>+10점</b>, 내 그림을 한 사람이 맞힐 때마다 출제자도 <b>+3점</b>을 얻습니다.<br>'
        + '· 모두 맞히거나 시간이 끝나면 다음 사람 차례로 넘어갑니다.<br>'
        + '· 한 바퀴가 끝나면 결과가 시즌 랭킹에 반영됩니다.<br>'
        + '· 시즌 랭킹은 인원수 차이를 줄이기 위해 획득점수를 가능한 최대점수로 나눈 활약도를 사용합니다.</p>'
    };
  }

  return {
    enter: enter,
    leave: leave,
    onReady: onReady,
    onMessage: onMessage,
    onPresence: onPresence,
    roomMeta: roomMeta,
    isBusy: isBusy,
    renderPlayers: renderPlayers,
    render: render,
    rules: rules,
    get state() { return state; }
  };
})();
