window.RelayDrawing = (function () {
  "use strict";

  var TEXT_MS = 40000;
  var DRAW_MS = 80000;
  var MIN_PLAYERS = 3;
  var MAX_PLAYERS = 12;
  var MAX_TEXT = 40;
  var MAX_STROKES = 160;
  var MAX_POINTS_PER_STROKE = 700;
  var MAX_CANVAS_POINTS = 5000;
  var CANVAS_BG = "#ffffff";
  var PEN_WIDTH = 8;
  var ERASER_WIDTH = 70;
  var SUGGESTIONS = [
    "우주에서 라면을 배달하는 고양이",
    "결혼식에서 춤추는 펭귄",
    "치킨을 훔치다 걸린 공룡",
    "지하철에서 마술을 하는 문어",
    "놀이공원에 간 로봇 가족",
    "비 오는 날 우산을 파는 개구리",
    "달에서 떡볶이를 먹는 토끼",
    "수영장에서 낮잠 자는 북극곰"
  ];

  var api = null;
  var state = freshState();
  var chains = Object.create(null);
  var canvas = null;
  var ctx = null;
  var bound = false;
  var tickId = null;
  var drawing = false;
  var currentStroke = null;
  var localStrokes = [];
  var selectedTool = "pen";
  var selectedColor = "#17252f";
  var taskScope = "";
  var inputScope = "";
  var pendingSubmitScope = "";
  var albumIndex = 0;
  var previewMode = false;

  function freshState() {
    return {
      phase: "idle",
      rev: 0,
      matchId: null,
      players: [],
      spectators: [],
      ready: [],
      stepIndex: 0,
      totalSteps: 0,
      deadline: null,
      submitted: []
    };
  }

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch];
    });
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function safeText(value, max) { return String(value == null ? "" : value).trim().slice(0, max); }
  function safeNick(value) { return safeText(value, 40); }
  function me() { return api ? api.me() : { nick: "", isAdmin: false }; }
  function people() { return api ? api.roster() : []; }
  function has(list, value) { return Array.isArray(list) && list.indexOf(value) >= 0; }
  function sameList(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every(function (value, index) { return value === b[index]; });
  }
  function orderedPeople() {
    return people().filter(function (person) { return person && person.nick; }).slice().sort(function (a, b) {
      return (a.joinTs || 0) - (b.joinTs || 0) || String(a.nick).localeCompare(String(b.nick));
    });
  }
  function activePeople() {
    return orderedPeople().filter(function (person) { return !person.away; });
  }
  function waitingParticipants() {
    return activePeople().filter(function (person) { return !has(state.spectators, person.nick); });
  }
  function waitingSpectators() {
    return activePeople().filter(function (person) { return has(state.spectators, person.nick); });
  }
  function participantNicks() {
    return waitingParticipants().map(function (person) { return person.nick; }).slice(0, MAX_PLAYERS);
  }
  function canChangeRole() { return state.phase === "idle" || state.phase === "finished"; }
  function isActivePhase(phase) {
    phase = phase || state.phase;
    return phase === "prompt" || phase === "drawing" || phase === "caption";
  }
  function phaseForStep(step) {
    if (step === 0) return "prompt";
    return step % 2 ? "drawing" : "caption";
  }
  function durationForPhase(phase) { return phase === "drawing" ? DRAW_MS : TEXT_MS; }
  function phaseName(phase) {
    return phase === "prompt" ? "문장 쓰기" : phase === "drawing" ? "그림 그리기" :
      phase === "caption" ? "그림 설명" : phase === "finished" ? "앨범 공개" : "이어그리기";
  }
  function expectedKind(step) { return step === 0 ? "prompt" : (step % 2 ? "drawing" : "caption"); }

  function assignmentOrigin(players, nick, step) {
    if (!Array.isArray(players) || !players.length) return null;
    var index = players.indexOf(nick);
    if (index < 0) return null;
    return players[(index - step % players.length + players.length) % players.length];
  }
  function currentOrigin(nick) {
    return assignmentOrigin(state.players, nick || me().nick, state.stepIndex);
  }
  function currentChain(nick) {
    var origin = currentOrigin(nick);
    return origin && chains[origin] ? chains[origin] : [];
  }
  function previousEntry(nick) {
    if (state.stepIndex <= 0) return null;
    return currentChain(nick)[state.stepIndex - 1] || null;
  }
  function taskKey() {
    return [state.matchId || "idle", state.stepIndex, state.phase].join(":");
  }
  function mySubmitted() {
    return has(state.submitted, me().nick) || pendingSubmitScope === taskKey();
  }
  function allReady(players) {
    players = players || participantNicks();
    var host = api && api.host ? safeNick(api.host()) : "";
    return players.length >= MIN_PLAYERS && players.indexOf(host) >= 0 &&
      players.filter(function (nick) { return nick !== host; }).every(function (nick) { return has(state.ready, nick); });
  }

  function safeColor(value) {
    value = String(value || "").toLowerCase();
    return /^#[0-9a-f]{6}$/.test(value) ? value : "#17252f";
  }
  function safePoint(raw) {
    if (!raw) return null;
    var x = Number(raw.x), y = Number(raw.y);
    if (!isFinite(x) || !isFinite(y)) return null;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }
  function sanitizeStrokes(raw) {
    if (!Array.isArray(raw)) return [];
    var total = 0, out = [];
    for (var i = 0; i < raw.length && out.length < MAX_STROKES && total < MAX_CANVAS_POINTS; i++) {
      var item = raw[i] || {};
      var points = [], source = Array.isArray(item.points) ? item.points : [];
      for (var j = 0; j < source.length && points.length < MAX_POINTS_PER_STROKE && total < MAX_CANVAS_POINTS; j++) {
        var point = safePoint(source[j]);
        if (!point) continue;
        points.push(point);
        total++;
      }
      if (!points.length) continue;
      out.push({
        id: safeText(item.id, 80) || ("stroke-" + out.length),
        color: safeColor(item.color),
        width: clamp(Number(item.width) || PEN_WIDTH, 3, ERASER_WIDTH),
        points: points
      });
    }
    return out;
  }
  function sanitizeEntry(raw, kind, author, step) {
    raw = raw || {};
    kind = expectedKind(step == null ? Number(raw.step) || 0 : step);
    var entry = {
      kind: kind,
      author: safeNick(author || raw.author),
      step: clamp(Math.floor(Number(step == null ? raw.step : step) || 0), 0, MAX_PLAYERS - 1),
      auto: !!raw.auto
    };
    if (kind === "drawing") {
      entry.bg = CANVAS_BG;
      entry.strokes = sanitizeStrokes(raw.strokes);
    } else {
      entry.text = safeText(raw.text, MAX_TEXT) || (entry.auto ? "시간 안에 작성하지 못했어요" : "");
    }
    return entry;
  }
  function sanitizeState(raw) {
    raw = raw || {};
    var phases = ["idle", "prompt", "drawing", "caption", "finished"];
    var players = Array.isArray(raw.players) ? raw.players.map(safeNick).filter(Boolean).slice(0, MAX_PLAYERS) : [];
    var spectators = Array.isArray(raw.spectators) ? raw.spectators.map(safeNick).filter(Boolean).slice(0, 40) : [];
    var ready = Array.isArray(raw.ready) ? raw.ready.map(safeNick).filter(Boolean).slice(0, MAX_PLAYERS) : [];
    var submitted = Array.isArray(raw.submitted) ? raw.submitted.map(safeNick).filter(function (nick) {
      return players.indexOf(nick) >= 0;
    }) : [];
    return {
      phase: phases.indexOf(raw.phase) >= 0 ? raw.phase : "idle",
      rev: Math.max(0, Math.floor(Number(raw.rev) || 0)),
      matchId: safeText(raw.matchId, 80) || null,
      players: Array.from(new Set(players)),
      spectators: Array.from(new Set(spectators)),
      ready: Array.from(new Set(ready)),
      stepIndex: clamp(Math.floor(Number(raw.stepIndex) || 0), 0, Math.max(0, players.length - 1)),
      totalSteps: clamp(Math.floor(Number(raw.totalSteps) || players.length), 0, players.length),
      deadline: typeof raw.remainMs === "number" ? Date.now() + clamp(raw.remainMs, 0, DRAW_MS) :
        (Number(raw.deadline) || null),
      submitted: Array.from(new Set(submitted))
    };
  }

  function normalizePreviewPhase(value) {
    value = String(value || "").toLowerCase();
    if (value === "idle") value = "waiting";
    if (value === "finished") value = "result";
    return ["waiting", "prompt", "drawing", "caption", "result"].indexOf(value) >= 0 ? value : "waiting";
  }
  function previewStroke(id, color, width, points) {
    return {
      id: id,
      color: color,
      width: width,
      points: points.map(function (point) { return { x: point[0], y: point[1] }; })
    };
  }
  function previewCircle(id, color, width, cx, cy, radius) {
    var points = [];
    for (var i = 0; i <= 28; i++) {
      var angle = Math.PI * 2 * i / 28;
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
    return previewStroke(id, color, width, points);
  }
  function previewDrawing(variant, author, step) {
    var shift = (variant % 3) * 0.035;
    var accent = ["#d9822b", "#2474b5", "#38a875"][variant % 3];
    return {
      kind: "drawing",
      author: author,
      step: step,
      auto: false,
      bg: CANVAS_BG,
      strokes: sanitizeStrokes([
        previewCircle("head-" + variant, accent, 12, 0.48 + shift, 0.45, 0.22),
        previewStroke("ear-left-" + variant, accent, 12, [[0.32 + shift, 0.31], [0.34 + shift, 0.16], [0.43 + shift, 0.27]]),
        previewStroke("ear-right-" + variant, accent, 12, [[0.53 + shift, 0.27], [0.63 + shift, 0.16], [0.65 + shift, 0.33]]),
        previewCircle("eye-left-" + variant, "#17252f", 14, 0.41 + shift, 0.42, 0.012),
        previewCircle("eye-right-" + variant, "#17252f", 14, 0.56 + shift, 0.42, 0.012),
        previewStroke("mouth-" + variant, "#17252f", 8, [[0.46 + shift, 0.51], [0.49 + shift, 0.54], [0.52 + shift, 0.51]]),
        previewStroke("body-" + variant, accent, 15, [[0.38 + shift, 0.66], [0.42 + shift, 0.58], [0.57 + shift, 0.58], [0.63 + shift, 0.78]]),
        previewStroke("ground-" + variant, "#7f9aa6", 7, [[0.22, 0.79], [0.78, 0.79]])
      ])
    };
  }
  function buildPreviewChains(players) {
    var prompts = [
      "우주에서 라면을 배달하는 고양이",
      "결혼식장에서 춤추는 펭귄",
      "치킨을 훔치다 걸린 공룡",
      "수영장에서 낮잠 자는 북극곰"
    ];
    var captions = [
      "우주복을 입은 고양이가 배달 중이에요",
      "신나게 춤추는 동물 같아요",
      "간식을 들고 도망가는 공룡이에요",
      "물가에서 쉬고 있는 북극곰이에요"
    ];
    var result = Object.create(null);
    players.forEach(function (origin, index) {
      result[origin] = [
        { kind: "prompt", author: origin, step: 0, auto: false, text: prompts[index % prompts.length] },
        previewDrawing(index, players[(index + 1) % players.length], 1),
        { kind: "caption", author: players[(index + 2) % players.length], step: 2, auto: false, text: captions[index % captions.length] },
        previewDrawing(index + 1, players[(index + 3) % players.length], 3)
      ];
    });
    return result;
  }
  function setPreviewPhase(value) {
    if (!api) return null;
    var key = normalizePreviewPhase(value);
    var selfNick = safeNick(me().nick) || "나";
    var players = [selfNick, "민서", "서준", "지우"];
    var phase = key === "waiting" ? "idle" : key === "result" ? "finished" : key;
    var stepIndex = phase === "drawing" ? 1 : phase === "caption" ? 2 : phase === "finished" ? 3 : 0;
    var submitted = phase === "prompt" ? ["민서", "서준"] :
      phase === "drawing" ? ["민서"] : phase === "caption" ? ["민서", "서준", "지우"] : [];
    state = {
      phase: phase,
      rev: state.rev + 1,
      matchId: "relay-ui-preview",
      players: phase === "idle" ? [] : players.slice(),
      spectators: ["도윤"],
      ready: phase === "idle" ? ["민서", "서준"] : [],
      stepIndex: stepIndex,
      totalSteps: players.length,
      deadline: isActivePhase(phase) ? Date.now() + (phase === "drawing" ? 68000 : 34000) : null,
      submitted: submitted
    };
    chains = buildPreviewChains(players);
    taskScope = "";
    inputScope = "";
    pendingSubmitScope = "";
    albumIndex = 0;
    render();
    return key;
  }

  function snapshot() {
    return {
      phase: state.phase,
      rev: state.rev,
      matchId: state.matchId,
      players: state.players.slice(),
      spectators: state.spectators.slice(),
      ready: state.ready.slice(),
      stepIndex: state.stepIndex,
      totalSteps: state.totalSteps,
      remainMs: state.deadline ? Math.max(0, state.deadline - Date.now()) : null,
      submitted: state.submitted.slice()
    };
  }
  function clearChains(players) {
    chains = Object.create(null);
    (players || []).forEach(function (nick) { chains[nick] = []; });
    albumIndex = 0;
  }
  function applyState(raw, reset) {
    var next = sanitizeState(raw);
    if (!reset && next.rev < state.rev) return false;
    var matchChanged = next.matchId !== state.matchId;
    if (reset || matchChanged) clearChains(next.players);
    state = next;
    if (pendingSubmitScope && has(state.submitted, me().nick)) pendingSubmitScope = "";
    render();
    return true;
  }
  function storeEntry(origin, raw) {
    origin = safeNick(origin);
    if (!origin || !has(state.players, origin)) return false;
    var step = clamp(Math.floor(Number(raw && raw.step) || 0), 0, Math.max(0, state.totalSteps - 1));
    var entry = sanitizeEntry(raw, expectedKind(step), raw && raw.author, step);
    if (!entry.author || !has(state.players, entry.author)) return false;
    if (!chains[origin]) chains[origin] = [];
    if (chains[origin][step] && !chains[origin][step].auto) return false;
    chains[origin][step] = entry;
    render();
    return true;
  }

  function sendState(reset, to) {
    if (!api || !api.isHost()) return;
    api.send({ t: "relay_state", state: snapshot(), reset: !!reset, to: to || null });
    if (api.roomChanged) api.roomChanged();
  }
  function sendEntry(origin, entry, to) {
    if (!api || !api.isHost()) return;
    api.send({
      t: "relay_entry",
      matchId: state.matchId,
      origin: origin,
      entry: entry,
      to: to || null
    });
  }
  function sendFullSync(to) {
    if (!to) {
      sendState(false);
      return;
    }
    sendState(true, to);
    state.players.forEach(function (origin) {
      var chain = chains[origin] || [];
      chain.forEach(function (entry) { if (entry) sendEntry(origin, entry, to); });
    });
  }

  function hostSetReady(nick, ready) {
    if (!api || !api.isHost() || !canChangeRole()) return;
    nick = safeNick(nick);
    if (!nick || !has(participantNicks(), nick) || nick === api.host()) return;
    var next = state.ready.filter(function (item) { return item !== nick; });
    if (ready) next.push(nick);
    if (sameList(next, state.ready)) return;
    state.ready = next;
    state.rev++;
    sendState(false);
  }
  function toggleReady() {
    if (!api || !canChangeRole() || me().nick === api.host() || has(state.spectators, me().nick)) return;
    api.send({ t: "relay_ready", nick: me().nick, ready: !has(state.ready, me().nick) });
  }
  function hostSetRole(nick, spectator) {
    if (!api || !api.isHost() || !canChangeRole()) return;
    nick = safeNick(nick);
    if (!nick || !activePeople().some(function (person) { return person.nick === nick; })) return;
    var next = state.spectators.filter(function (item) { return item !== nick; });
    if (spectator) next.push(nick);
    state.spectators = next;
    state.ready = state.ready.filter(function (item) { return item !== nick; });
    state.rev++;
    sendState(false);
  }
  function toggleRole() {
    if (!api || !canChangeRole()) {
      if (api) api.toast("게임이 끝난 뒤 역할을 바꿀 수 있어요");
      return;
    }
    var spectator = !has(state.spectators, me().nick);
    api.send({ t: "relay_role", nick: me().nick, spectator: spectator });
    if (api.setHostEligible) api.setHostEligible(!spectator);
  }

  function hostStartMatch() {
    if (!api || !api.isHost() || !canChangeRole()) return false;
    var players = participantNicks();
    if (players.length < MIN_PLAYERS) {
      api.toast("이어그리기는 최소 3명이 필요해요");
      return false;
    }
    if (!allReady(players)) {
      api.toast("모든 참가자가 레디해야 시작할 수 있어요");
      return false;
    }
    state = {
      phase: "prompt",
      rev: state.rev + 1,
      matchId: "relay-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e5).toString(36),
      players: players,
      spectators: state.spectators.filter(function (nick) { return players.indexOf(nick) < 0; }),
      ready: [],
      stepIndex: 0,
      totalSteps: players.length,
      deadline: Date.now() + TEXT_MS,
      submitted: []
    };
    clearChains(players);
    pendingSubmitScope = "";
    taskScope = "";
    inputScope = "";
    sendState(true);
    return true;
  }
  function fallbackEntry(nick) {
    var kind = expectedKind(state.stepIndex);
    return kind === "drawing"
      ? { kind: kind, author: nick, step: state.stepIndex, auto: true, bg: CANVAS_BG, strokes: [] }
      : { kind: kind, author: nick, step: state.stepIndex, auto: true, text: "시간 안에 작성하지 못했어요" };
  }
  function hostAcceptSubmission(nick, raw, deferAdvance) {
    if (!api || !api.isHost() || !isActivePhase()) return false;
    nick = safeNick(nick);
    if (!has(state.players, nick) || has(state.submitted, nick)) return false;
    var origin = assignmentOrigin(state.players, nick, state.stepIndex);
    if (!origin) return false;
    var entry = sanitizeEntry(raw, expectedKind(state.stepIndex), nick, state.stepIndex);
    if (entry.kind !== "drawing" && !entry.text) return false;
    if (!chains[origin]) chains[origin] = [];
    chains[origin][state.stepIndex] = entry;
    sendEntry(origin, entry);
    state.submitted.push(nick);
    state.rev++;
    if (!deferAdvance && state.submitted.length >= state.players.length) hostAdvanceStep();
    else sendState(false);
    return true;
  }
  function hostAdvanceStep() {
    if (!api || !api.isHost() || !isActivePhase()) return;
    var nextStep = state.stepIndex + 1;
    state.submitted = [];
    pendingSubmitScope = "";
    if (nextStep >= state.totalSteps) {
      state.phase = "finished";
      state.deadline = null;
      state.ready = [];
      state.rev++;
      albumIndex = 0;
      sendState(false);
      return;
    }
    state.stepIndex = nextStep;
    state.phase = phaseForStep(nextStep);
    state.deadline = Date.now() + durationForPhase(state.phase);
    state.rev++;
    sendState(false);
  }
  function hostFinishExpiredStep() {
    if (!api || !api.isHost() || !isActivePhase()) return;
    var missing = state.players.filter(function (nick) { return !has(state.submitted, nick); });
    missing.forEach(function (nick) { hostAcceptSubmission(nick, fallbackEntry(nick), true); });
    hostAdvanceStep();
  }
  function submitText() {
    if (!api || (state.phase !== "prompt" && state.phase !== "caption") || !has(state.players, me().nick) || mySubmitted()) return;
    var input = $("relay-text-input");
    var text = safeText(input && input.value, MAX_TEXT);
    if (!text) {
      api.toast("문장을 먼저 적어주세요");
      return;
    }
    pendingSubmitScope = taskKey();
    api.send({
      t: "relay_submit",
      matchId: state.matchId,
      stepIndex: state.stepIndex,
      nick: me().nick,
      entry: { kind: expectedKind(state.stepIndex), text: text }
    });
    render();
  }
  function submitDrawing() {
    if (!api || state.phase !== "drawing" || !has(state.players, me().nick) || mySubmitted()) return;
    if (!localStrokes.length) {
      api.toast("그림을 조금이라도 그려주세요");
      return;
    }
    pendingSubmitScope = taskKey();
    api.send({
      t: "relay_submit",
      matchId: state.matchId,
      stepIndex: state.stepIndex,
      nick: me().nick,
      entry: { kind: "drawing", bg: CANVAS_BG, strokes: sanitizeStrokes(localStrokes) }
    });
    render();
  }

  function onMessage(msg) {
    if (!msg || typeof msg.t !== "string" || msg.t.indexOf("relay_") !== 0) return false;
    if (msg.to && msg.to !== me().nick) return true;
    if (msg.t === "relay_state") {
      applyState(msg.state, !!msg.reset);
    } else if (msg.t === "relay_sync_request") {
      if (api && api.isHost() && msg.nick !== me().nick) sendFullSync(msg.nick);
    } else if (msg.t === "relay_ready") {
      if (api && api.isHost()) hostSetReady(msg.nick, !!msg.ready);
    } else if (msg.t === "relay_role") {
      if (api && api.isHost()) hostSetRole(msg.nick, !!msg.spectator);
    } else if (msg.t === "relay_start") {
      if (api && api.isHost() && msg.nick === api.host()) hostStartMatch();
    } else if (msg.t === "relay_submit") {
      if (api && api.isHost() && msg.matchId === state.matchId && Number(msg.stepIndex) === state.stepIndex) {
        hostAcceptSubmission(msg.nick, msg.entry, false);
      }
    } else if (msg.t === "relay_entry") {
      if (msg.matchId === state.matchId) storeEntry(msg.origin, msg.entry);
    }
    return true;
  }

  function onPresence(_list, options) {
    if (!api) return;
    var active = activePeople().map(function (person) { return person.nick; });
    if (api.isHost() && canChangeRole()) {
      var spectators = state.spectators.filter(function (nick) { return active.indexOf(nick) >= 0; });
      var participants = active.filter(function (nick) { return spectators.indexOf(nick) < 0; }).slice(0, MAX_PLAYERS);
      var ready = state.ready.filter(function (nick) { return participants.indexOf(nick) >= 0 && nick !== api.host(); });
      if (!sameList(spectators, state.spectators) || !sameList(ready, state.ready)) {
        state.spectators = spectators;
        state.ready = ready;
        state.rev++;
        sendState(false);
      } else if (options && options.becameHost) sendState(false);
    } else if (api.isHost() && options && options.becameHost) {
      sendState(false);
    }
    render();
  }
  function onReady() {
    if (!api) return;
    if (api.isHost()) sendState(false);
    else api.send({ t: "relay_sync_request", nick: me().nick });
  }

  function canvasMetrics(target) {
    var width = target ? target.width : 720;
    var height = target ? target.height : 720;
    return { width: width, height: height };
  }
  function paintStrokes(targetCtx, targetCanvas, strokes, bg) {
    if (!targetCtx || !targetCanvas) return;
    var metrics = canvasMetrics(targetCanvas);
    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.fillStyle = bg || CANVAS_BG;
    targetCtx.fillRect(0, 0, metrics.width, metrics.height);
    (strokes || []).forEach(function (stroke) {
      var points = stroke.points || [];
      if (!points.length) return;
      targetCtx.beginPath();
      targetCtx.lineCap = "round";
      targetCtx.lineJoin = "round";
      targetCtx.strokeStyle = stroke.color || "#17252f";
      targetCtx.lineWidth = (stroke.width || PEN_WIDTH) * (metrics.width / 720);
      targetCtx.moveTo(points[0].x * metrics.width, points[0].y * metrics.height);
      if (points.length === 1) {
        targetCtx.lineTo(points[0].x * metrics.width + .01, points[0].y * metrics.height + .01);
      } else {
        for (var i = 1; i < points.length; i++) targetCtx.lineTo(points[i].x * metrics.width, points[i].y * metrics.height);
      }
      targetCtx.stroke();
    });
    targetCtx.restore();
  }
  function redrawLocal() { paintStrokes(ctx, canvas, localStrokes, CANVAS_BG); }
  function showPreviousDrawing() {
    var previous = previousEntry(me().nick);
    if (previous && previous.kind === "drawing") paintStrokes(ctx, canvas, previous.strokes, previous.bg);
    else paintStrokes(ctx, canvas, [], CANVAS_BG);
  }
  function syncCanvasForTask() {
    var scope = taskKey();
    if (taskScope === scope) return;
    taskScope = scope;
    drawing = false;
    currentStroke = null;
    if (state.phase === "drawing") {
      localStrokes = [];
      redrawLocal();
    } else if (state.phase === "caption") {
      localStrokes = [];
      showPreviousDrawing();
    } else {
      localStrokes = [];
      paintStrokes(ctx, canvas, [], CANVAS_BG);
    }
  }
  function canDraw() {
    return state.phase === "drawing" && has(state.players, me().nick) && !mySubmitted();
  }
  function canvasPoint(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1)
    };
  }
  function pointerDown(event) {
    if (!canDraw() || localStrokes.length >= MAX_STROKES) return;
    drawing = true;
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    currentStroke = {
      id: me().nick + "-" + Date.now().toString(36) + "-" + localStrokes.length,
      color: selectedTool === "eraser" ? CANVAS_BG : selectedColor,
      width: selectedTool === "eraser" ? ERASER_WIDTH : PEN_WIDTH,
      points: [canvasPoint(event)]
    };
    localStrokes.push(currentStroke);
    redrawLocal();
    event.preventDefault();
  }
  function pointerMove(event) {
    if (!drawing || !currentStroke || !canDraw()) return;
    if (currentStroke.points.length >= MAX_POINTS_PER_STROKE) return;
    var point = canvasPoint(event);
    var previous = currentStroke.points[currentStroke.points.length - 1];
    var dx = (point.x - previous.x) * 720, dy = (point.y - previous.y) * 720;
    if (dx * dx + dy * dy < 5) return;
    currentStroke.points.push(point);
    redrawLocal();
    event.preventDefault();
  }
  function pointerUp(event) {
    if (!drawing) return;
    drawing = false;
    currentStroke = null;
    if (canvas.releasePointerCapture) {
      try { canvas.releasePointerCapture(event.pointerId); } catch (e) {}
    }
    redrawLocal();
  }

  function toggleHidden(element, hidden) { if (element) element.classList.toggle("hidden", !!hidden); }
  function renderRoster() {
    var box = $("relay-roster");
    if (!box) return;
    var rows = isActivePhase() || state.phase === "finished"
      ? state.players.map(function (nick) { return { nick: nick, spectator: false }; }).concat(
          state.spectators.map(function (nick) { return { nick: nick, spectator: true }; })
        )
      : orderedPeople().map(function (person) { return { nick: person.nick, spectator: has(state.spectators, person.nick) }; });
    box.innerHTML = rows.map(function (row) {
      var cls = "relay-person" + (row.nick === me().nick ? " me" : "") +
        (row.spectator ? " spectator" : "") + (has(state.submitted, row.nick) ? " done" : "");
      var crown = api && row.nick === api.host() ? " 👑" : "";
      return '<span class="' + cls + '">' + esc(row.nick) + crown + (row.spectator ? " · 관전" : "") + "</span>";
    }).join("");
    if ($("relay-online-num")) $("relay-online-num").textContent = rows.length;
  }
  function renderProgress() {
    var box = $("relay-progress");
    if (!box) return;
    if (!isActivePhase()) { box.innerHTML = ""; return; }
    var html = "";
    for (var i = 0; i < state.totalSteps; i++) {
      html += '<span class="' + (i < state.stepIndex ? "passed" : i === state.stepIndex ? "active" : "") + '"></span>';
    }
    box.innerHTML = html;
  }
  function renderIdle() {
    var participants = participantNicks();
    var host = api ? api.host() : "";
    var allPeople = orderedPeople();
    var participantPeople = allPeople.filter(function (person) { return !has(state.spectators, person.nick); });
    var spectatorPeople = allPeople.filter(function (person) { return has(state.spectators, person.nick); });
    function namesHtml(list, spectator) {
      if (!list.length) return "";
      return list.map(function (person) {
        var away = !!person.away;
        var crown = !away && person.nick === host
          ? '<span class="catch-lobby-crown" title="방장" aria-label="방장">👑</span>'
          : "";
        var mine = person.nick === me().nick ? " mine" : "";
        var cls = "catch-lobby-name" + (spectator ? " spectator" : "") + mine + (away ? " away" : "");
        var readyBadge = !spectator && !away && person.nick !== host && has(state.ready, person.nick)
          ? '<span class="catch-lobby-ready" title="레디" aria-label="레디">✓</span>'
          : "";
        var awayBadge = away ? '<span class="catch-lobby-away">자리비움</span>' : "";
        return '<span class="' + cls + '"><b>' + esc(person.nick) + '</b>' + crown + readyBadge + awayBadge + "</span>";
      }).join("");
    }
    var participantRow = $("relay-lobby-participant-row");
    var spectatorRow = $("relay-lobby-spectator-row");
    if ($("relay-lobby-participant-count")) $("relay-lobby-participant-count").textContent = participantPeople.length;
    if ($("relay-lobby-spectator-count")) $("relay-lobby-spectator-count").textContent = spectatorPeople.length;
    if ($("relay-lobby-participants")) $("relay-lobby-participants").innerHTML = namesHtml(participantPeople, false);
    if ($("relay-lobby-spectators")) $("relay-lobby-spectators").innerHTML = namesHtml(spectatorPeople, true);
    if (participantRow) participantRow.classList.toggle("empty", !participantPeople.length);
    if (spectatorRow) spectatorRow.classList.toggle("empty", !spectatorPeople.length);
    var amHost = api && api.isHost();
    var readyButton = $("relay-ready-btn"), startButton = $("relay-start-btn");
    var amSpectator = has(state.spectators, me().nick);
    toggleHidden($("relay-idle-actions"), amSpectator);
    toggleHidden(readyButton, amHost || amSpectator);
    toggleHidden(startButton, !amHost);
    if (readyButton) {
      var ready = has(state.ready, me().nick);
      readyButton.textContent = ready ? "레디 취소" : "레디";
      readyButton.setAttribute("aria-pressed", ready ? "true" : "false");
    }
    if (startButton) {
      startButton.disabled = !allReady(participants);
      startButton.textContent = allReady(participants) ? "게임 시작" :
        participants.length < MIN_PLAYERS ? "3명 이상 모이면 시작" : "모두 준비되면 시작";
    }
  }
  function renderTextTask() {
    var prompt = state.phase === "prompt";
    var previous = previousEntry(me().nick);
    var input = $("relay-text-input");
    if ($("relay-text-panel")) $("relay-text-panel").classList.toggle("caption", !prompt);
    if (inputScope !== taskKey()) {
      inputScope = taskKey();
      if (input) input.value = "";
    }
    if ($("relay-text-kicker")) $("relay-text-kicker").textContent = prompt ? "첫 번째 단계" : (state.stepIndex + 1) + "번째 단계";
    if ($("relay-text-title")) $("relay-text-title").textContent = prompt
      ? "누군가 그림으로 그릴 문장을 만들어주세요"
      : "이 그림은 무슨 상황일까요?";
    if ($("relay-text-hint")) $("relay-text-hint").textContent = prompt
      ? "인물과 행동이 함께 있으면 그림이 더 재미있어져요."
      : "이전 문장은 볼 수 없어요. 보이는 그림만 설명해주세요.";
    if ($("relay-text-example")) $("relay-text-example").classList.toggle("hidden", !prompt);
    if ($("relay-suggest-btn")) $("relay-suggest-btn").classList.toggle("hidden", !prompt);
    if ($("relay-text-submit")) {
      $("relay-text-submit").textContent = prompt ? "이 문장으로 제출" : "이 설명으로 제출";
      $("relay-text-submit").disabled = mySubmitted();
    }
    if (input) input.disabled = mySubmitted();
    if (!prompt && (!previous || previous.kind !== "drawing")) {
      if ($("relay-text-hint")) $("relay-text-hint").textContent = "전달받은 그림을 불러오는 중이에요.";
    }
  }
  function renderWordbar() {
    var label = $("relay-task-label"), text = $("relay-task-text");
    if (!label || !text) return;
    if (state.phase === "prompt") {
      label.textContent = "내 임무"; text.textContent = "재미있는 문장을 써주세요";
    } else if (state.phase === "drawing") {
      var previous = previousEntry(me().nick);
      label.textContent = "받은 문장";
      text.textContent = previous && previous.text ? previous.text : "문장을 불러오는 중";
    } else if (state.phase === "caption") {
      label.textContent = "내 임무"; text.textContent = "그림을 한 문장으로 설명하세요";
    } else if (state.phase === "finished") {
      label.textContent = "결과"; text.textContent = "연쇄 앨범 공개";
    } else {
      label.textContent = "진행"; text.textContent = "문장 ↔ 그림";
    }
  }
  function renderTimer() {
    var timer = $("relay-timer");
    if (!timer) return;
    if (!state.deadline || !isActivePhase()) { timer.textContent = "--"; return; }
    var seconds = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    timer.textContent = Math.floor(seconds / 60).toString().padStart(2, "0") + ":" + (seconds % 60).toString().padStart(2, "0");
  }
  function renderSubmitStatus() {
    var status = $("relay-submit-status");
    if (!status) return;
    status.textContent = mySubmitted()
      ? "제출 완료 · 다른 참가자를 기다리는 중"
      : state.submitted.length + " / " + state.players.length + "명 제출 완료";
  }
  function renderResults() {
    if (!state.players.length) return;
    albumIndex = clamp(albumIndex, 0, state.players.length - 1);
    var origin = state.players[albumIndex];
    var chain = chains[origin] || [];
    if ($("relay-album-kicker")) $("relay-album-kicker").textContent = (albumIndex + 1) + " / " + state.players.length + " · " + origin + "에서 시작";
    if ($("relay-album-meta")) $("relay-album-meta").textContent = "문장과 그림이 어떻게 달라졌는지 확인해보세요";
    var box = $("relay-chain");
    if (!box) return;
    box.innerHTML = chain.map(function (entry, index) {
      if (!entry) return "";
      var label = entry.kind === "prompt" ? "시작 문장" : entry.kind === "drawing" ? "그림" : "그림 설명";
      var cls = "relay-chain-item" + (entry.kind === "prompt" ? " prompt" : "");
      var content = entry.kind === "drawing"
        ? '<div class="relay-chain-drawing"><canvas width="480" height="480" data-relay-result-step="' + index + '"></canvas></div>'
        : '<div class="relay-chain-copy"><div class="relay-chain-meta"><span>' + label + '</span><b>' + esc(entry.author) + '</b></div>'
          + '<strong>' + esc(entry.text || "내용 없음") + '</strong></div>';
      if (entry.kind === "drawing") {
        content = '<div class="relay-chain-copy"><div class="relay-chain-meta"><span>' + label + '</span><b>' + esc(entry.author) + '</b></div></div>' + content;
      }
      return '<article class="' + cls + '">' + content + "</article>";
    }).join("");
    if (!chain.length) box.innerHTML = '<p class="relay-submit-status">앨범 내용을 불러오는 중이에요.</p>';
    var canvases = box.querySelectorAll("[data-relay-result-step]");
    for (var i = 0; i < canvases.length; i++) {
      var step = Number(canvases[i].getAttribute("data-relay-result-step"));
      var entry = chain[step];
      if (entry) paintStrokes(canvases[i].getContext("2d"), canvases[i], entry.strokes, entry.bg);
    }
    if ($("relay-album-prev")) $("relay-album-prev").disabled = state.players.length < 2;
    if ($("relay-album-next")) {
      $("relay-album-next").disabled = state.players.length < 2;
      $("relay-album-next").textContent = albumIndex === state.players.length - 1 ? "첫 앨범으로" : "다음 앨범";
    }
    if ($("relay-again-btn")) {
      if (api && api.isHost()) {
        $("relay-again-btn").textContent = allReady(participantNicks()) ? "다음 게임 시작" : "참가자 준비 기다리는 중";
      } else {
        $("relay-again-btn").textContent = has(state.ready, me().nick) ? "레디 취소" : "다음 게임 준비";
      }
    }
  }
  function renderPlayers(box, hint) {
    if (!box || !api) return;
    if (hint) {
      hint.className = "players-hint";
      hint.textContent = "이어그리기 참가 여부와 현재 제출 상태입니다.";
    }
    var list = orderedPeople();
    box.innerHTML = list.map(function (person) {
      var spectator = has(state.spectators, person.nick);
      var active = has(state.players, person.nick);
      var done = has(state.submitted, person.nick);
      var role = spectator ? "관전" : done ? "제출" : active || canChangeRole() ? "참가" : "다음 게임";
      var cls = done ? "done" : active ? "active" : "";
      return '<div class="prow"><span class="pname"><span class="rtag relay-role-tag ' + cls + '">' + role + "</span>"
        + esc(person.nick) + (person.nick === api.host() ? ' <span class="mini-host">방장</span>' : "")
        + (person.nick === me().nick ? ' <span class="mini-me">나</span>' : "") + "</span></div>";
    }).join("");
  }
  function render() {
    if (!api) return;
    syncCanvasForTask();
    renderRoster();
    renderProgress();
    renderWordbar();
    renderTimer();
    var active = isActivePhase();
    var idle = !active && state.phase !== "finished";
    toggleHidden($("relay-idle"), !idle);
    toggleHidden($("relay-idle-actions"), !idle);
    toggleHidden($("relay-text-panel"), !(state.phase === "prompt" || state.phase === "caption"));
    toggleHidden($("relay-result-panel"), state.phase !== "finished");
    toggleHidden($("relay-tools"), state.phase !== "drawing");
    toggleHidden($("relay-draw-submit"), state.phase !== "drawing");
    toggleHidden($("relay-chat-row"), active);
    if ($("relay-status")) $("relay-status").textContent = active
      ? (state.stepIndex + 1) + " / " + state.totalSteps + " 단계"
      : state.phase === "finished" ? "게임 종료" : "게임 대기 중";
    if ($("relay-phase-name")) $("relay-phase-name").textContent = phaseName(state.phase);
    if ($("relay-role-btn")) {
      var spectator = has(state.spectators, me().nick);
      $("relay-role-btn").textContent = spectator ? "참가하기" : "관전하기";
      $("relay-role-btn").setAttribute("aria-pressed", spectator ? "true" : "false");
      $("relay-role-btn").disabled = !canChangeRole();
    }
    if (idle) renderIdle();
    if (state.phase === "prompt" || state.phase === "caption") {
      renderTextTask();
      renderSubmitStatus();
    }
    if (state.phase === "drawing") {
      if ($("relay-draw-submit")) {
        $("relay-draw-submit").disabled = mySubmitted();
        $("relay-draw-submit").textContent = mySubmitted() ? "그림 제출 완료" : "그림 제출하기";
      }
    }
    if (state.phase === "finished") renderResults();
    syncToolButtons();
  }

  function syncToolButtons() {
    var tools = document.querySelectorAll("[data-relay-tool]");
    for (var i = 0; i < tools.length; i++) {
      tools[i].classList.toggle("active", tools[i].getAttribute("data-relay-tool") === selectedTool);
    }
    var colors = document.querySelectorAll("[data-relay-color]");
    for (var j = 0; j < colors.length; j++) {
      colors[j].classList.toggle("active", colors[j].getAttribute("data-relay-color") === selectedColor && selectedTool === "pen");
    }
  }
  function bind() {
    if (bound || !canvas) return;
    bound = true;
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    $("relay-ready-btn").addEventListener("click", toggleReady);
    $("relay-start-btn").addEventListener("click", function () {
      if (api && api.isHost()) api.send({ t: "relay_start", nick: me().nick });
    });
    $("relay-role-btn").addEventListener("click", toggleRole);
    $("relay-people-btn").addEventListener("click", function () { if (api) api.openPlayers(); });
    $("relay-leave-btn").addEventListener("click", function () { if (api) api.leaveRoom(); });
    $("relay-menu-btn").addEventListener("click", function () { if (api) api.openMenu(); });
    $("relay-rules-btn").addEventListener("click", function () {
      if (api && api.openRules) api.openRules();
      else if (api) api.openMenu();
    });
    $("relay-text-input").addEventListener("input", function () {
      if ($("relay-text-count")) $("relay-text-count").textContent = this.value.length + " / " + MAX_TEXT + "자";
    });
    $("relay-text-input").addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") submitText();
    });
    $("relay-text-submit").addEventListener("click", submitText);
    $("relay-suggest-btn").addEventListener("click", function () {
      var input = $("relay-text-input");
      if (!input || input.disabled) return;
      var next = SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)];
      input.value = next;
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
    $("relay-draw-submit").addEventListener("click", submitDrawing);
    $("relay-undo-btn").addEventListener("click", function () {
      if (!canDraw() || !localStrokes.length) return;
      localStrokes.pop();
      redrawLocal();
    });
    $("relay-clear-btn").addEventListener("click", function () {
      if (!canDraw() || !localStrokes.length) return;
      localStrokes = [];
      redrawLocal();
    });
    var tools = document.querySelectorAll("[data-relay-tool]");
    for (var i = 0; i < tools.length; i++) tools[i].addEventListener("click", function () {
      selectedTool = this.getAttribute("data-relay-tool");
      syncToolButtons();
    });
    var colors = document.querySelectorAll("[data-relay-color]");
    for (var j = 0; j < colors.length; j++) colors[j].addEventListener("click", function () {
      selectedColor = safeColor(this.getAttribute("data-relay-color"));
      selectedTool = "pen";
      syncToolButtons();
    });
    $("relay-chat-input").addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.isComposing || !api) return;
      if (api.sendChat(this.value)) this.value = "";
    });
    $("relay-album-prev").addEventListener("click", function () {
      if (!state.players.length) return;
      albumIndex = (albumIndex - 1 + state.players.length) % state.players.length;
      renderResults();
    });
    $("relay-album-next").addEventListener("click", function () {
      if (!state.players.length) return;
      albumIndex = (albumIndex + 1) % state.players.length;
      renderResults();
    });
    $("relay-again-btn").addEventListener("click", function () {
      if (!api) return;
      if (api.isHost()) api.send({ t: "relay_start", nick: me().nick });
      else toggleReady();
    });
  }

  function tick() {
    if (!api) return;
    renderTimer();
    if (!previewMode && api.isHost() && isActivePhase() && state.deadline && Date.now() >= state.deadline) {
      hostFinishExpiredStep();
    }
  }
  function enter(nextApi) {
    previewMode = false;
    api = nextApi;
    state = freshState();
    clearChains([]);
    taskScope = "";
    inputScope = "";
    pendingSubmitScope = "";
    albumIndex = 0;
    canvas = $("relay-board");
    ctx = canvas ? canvas.getContext("2d") : null;
    if (canvas) {
      bind();
      paintStrokes(ctx, canvas, [], CANVAS_BG);
    }
    if (tickId) clearInterval(tickId);
    tickId = setInterval(tick, 250);
    render();
  }
  function enterPreview(nextApi, phase) {
    enter(nextApi);
    previewMode = true;
    return setPreviewPhase(phase);
  }
  function leave() {
    if (tickId) { clearInterval(tickId); tickId = null; }
    api = null;
    state = freshState();
    clearChains([]);
    drawing = false;
    currentStroke = null;
    localStrokes = [];
    taskScope = "";
    inputScope = "";
    pendingSubmitScope = "";
    previewMode = false;
  }
  function roomMeta() {
    if (state.phase === "finished") return { status: "끝", summary: state.players.length + "개 연쇄 앨범 공개" };
    if (isActivePhase()) {
      return {
        status: "게임중",
        summary: phaseName(state.phase) + " · " + (state.stepIndex + 1) + "/" + state.totalSteps + " · " +
          state.submitted.length + "/" + state.players.length + " 제출"
      };
    }
    return { status: "대기중", summary: participantNicks().length + "명 참가 · " + waitingSpectators().length + "명 관전" };
  }
  function isBusy() { return isActivePhase(); }
  function canChat() { return !isActivePhase(); }
  function rules() {
    return {
      title: "이어그리기 규칙",
      html: '<div class="cm-rules">'
        + '<p class="rule-intro">모두가 동시에 문장과 그림을 주고받으며 하나의 이야기를 엉뚱하게 바꾸는 파티 게임입니다. <b>점수나 승패는 없어요.</b></p>'
        + '<section class="cm-rule-section"><h3>1. 게임 진행</h3><ul class="cm-rule-list">'
        + '<li>첫 단계에서 각자 다른 사람이 그림으로 그릴 <b>시작 문장</b>을 적어요.</li>'
        + '<li>다음 단계에서는 전달받은 문장을 보고 <b>그림</b>을 그려요.</li>'
        + '<li>그다음 사람은 원래 문장을 보지 못하고 그림만 보고 <b>새 설명</b>을 적어요.</li>'
        + '<li>참가 인원수만큼 문장과 그림을 번갈아 이어가면 게임이 끝나요.</li>'
        + '</ul></section>'
        + '<section class="cm-rule-section"><h3>2. 제출 시간</h3><ul class="cm-rule-list">'
        + '<li>문장과 설명은 <b>40초</b>, 그림은 <b>80초</b> 안에 제출해요.</li>'
        + '<li>모두 일찍 제출하면 기다리지 않고 바로 다음 단계로 넘어가요.</li>'
        + '<li>시간 안에 제출하지 못한 단계는 빈 내용으로 이어집니다.</li>'
        + '</ul></section>'
        + '<section class="cm-rule-section"><h3>3. 결과 앨범</h3><p>마지막에는 각 시작 문장이 어떻게 변했는지 연쇄 앨범으로 차례대로 감상합니다. 그림 실력보다 서로의 오해를 즐기는 게임이에요.</p></section>'
        + '<p class="cm-rule-muted">최소 3명부터 시작할 수 있고 4~8명을 권장합니다. 게임 중 들어온 사람은 관전하고 다음 게임부터 참여해요.</p>'
        + '</div>'
    };
  }

  var controller = {
    enter: enter,
    enterPreview: enterPreview,
    setPreviewPhase: setPreviewPhase,
    normalizePreviewPhase: normalizePreviewPhase,
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
    get previewMode() { return previewMode; },
    get state() { return state; }
  };
  if (window.__RELAY_DRAWING_TEST__) {
    controller._test = {
      freshState: freshState,
      sanitizeState: sanitizeState,
      sanitizeEntry: sanitizeEntry,
      sanitizeStrokes: sanitizeStrokes,
      assignmentOrigin: assignmentOrigin,
      phaseForStep: phaseForStep,
      normalizePreviewPhase: normalizePreviewPhase,
      buildPreviewChains: buildPreviewChains,
      expectedKind: expectedKind,
      allReady: allReady,
      hostStartMatch: hostStartMatch,
      hostAcceptSubmission: hostAcceptSubmission,
      hostAdvanceStep: hostAdvanceStep,
      hostFinishExpiredStep: hostFinishExpiredStep,
      storeEntry: storeEntry,
      onMessage: onMessage,
      snapshot: snapshot,
      getState: function () { return state; },
      setState: function (next) { state = next; },
      getChains: function () { return chains; },
      setChains: function (next) { chains = next; },
      setApi: function (next) { api = next; },
      limits: {
        textMs: TEXT_MS,
        drawMs: DRAW_MS,
        minPlayers: MIN_PLAYERS,
        maxPlayers: MAX_PLAYERS,
        maxText: MAX_TEXT,
        maxStrokes: MAX_STROKES,
        maxPoints: MAX_CANVAS_POINTS
      }
    };
  }
  return controller;
})();
