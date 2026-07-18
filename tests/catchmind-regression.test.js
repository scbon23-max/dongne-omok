"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCatchMind(options) {
  options = options || {};
  const source = fs.readFileSync(path.join(__dirname, "..", "catchmind.js"), "utf8");
  const elements = options.elements || {};
  const context = {
    window: { __CATCHMIND_TEST__: true, CATCHMIND_WORDS: ["사과"] },
    document: { getElementById(id) { return elements[id] || null; }, querySelectorAll() { return []; } },
    console,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    setInterval,
    clearInterval
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "catchmind.js" });
  return context.window.CatchMind._test;
}

function fakeElement() {
  const classes = new Set();
  return {
    innerHTML: "",
    textContent: "",
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        if (force === undefined) force = !classes.has(name);
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    }
  };
}

function baseSnapshot(overrides) {
  return Object.assign({
    phase: "drawing",
    rev: 1,
    matchId: "match-a",
    queue: ["A", "B", "C"],
    spectators: [],
    roundIndex: 0,
    drawer: "A",
    guessers: ["B", "C"],
    remainMs: 50000,
    nextRemainMs: null,
    scores: { A: 0, B: 0, C: 0 },
    stats: {
      A: { points: 0, maxPoints: 6, correct: 0, drawCorrect: 0 },
      B: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 },
      C: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 }
    },
    correct: {},
    strokes: [],
    drawSeq: 0,
    feed: [],
    revealWord: null,
    wordLength: 2,
    recordStatus: "idle"
  }, overrides || {});
}

test("new matches preserve and advance the room revision", () => {
  const api = loadCatchMind();
  const oldState = api.freshState();
  oldState.phase = "finished";
  oldState.rev = 20;
  oldState.matchId = "old-match";
  api.setState(oldState);

  const reset = api.resetMatchState(["A", "B"], "new-match");
  assert.equal(reset.rev, 20);
  assert.equal(reset.matchId, "new-match");

  api.applyState(baseSnapshot({ rev: 21, matchId: "new-match", queue: ["A", "B"], guessers: ["B"] }));
  assert.equal(api.getState().matchId, "new-match");
  assert.equal(api.getState().rev, 21);

  api.applyState(baseSnapshot({ rev: 20, matchId: "old-match" }));
  assert.equal(api.getState().matchId, "new-match");
});

test("equal revisions cannot roll the canvas back", () => {
  const api = loadCatchMind();
  api.applyState(baseSnapshot({ rev: 10, drawSeq: 2, strokes: [{ id: "new", color: "#17252f", width: 8, points: [{ x: 0.2, y: 0.2 }] }] }));

  api.applyState(baseSnapshot({ rev: 10, drawSeq: 1, strokes: [{ id: "old", color: "#17252f", width: 8, points: [{ x: 0.1, y: 0.1 }] }] }));
  assert.equal(api.getState().strokes[0].id, "new");

  api.applyState(baseSnapshot({ rev: 10, drawSeq: 3, strokes: [{ id: "newer", color: "#17252f", width: 8, points: [{ x: 0.3, y: 0.3 }] }] }));
  assert.equal(api.getState().strokes[0].id, "newer");
  assert.equal(api.getState().drawSeq, 3);
});

test("state sanitizing blocks markup and malformed values", () => {
  const api = loadCatchMind();
  const clean = api.sanitizeSnapshot(baseSnapshot({
    scores: { A: '<img src=x onerror="alert(1)">', B: -5, C: 12 },
    stats: { A: null },
    feed: [{ who: "A", text: "hello", kind: 'x\" onmouseover=\"alert(1)' }],
    resultRatings: [
      { nick: "A", beforeRating: 1000, rating: 1012, delta: 12, games: 5, rankText: "<img>", rankMove: 1 },
      { nick: "constructor", beforeRating: 1000, rating: 2000 }
    ]
  }));

  assert.equal(clean.scores.A, 0);
  assert.equal(clean.scores.B, 0);
  assert.equal(clean.scores.C, 12);
  assert.deepEqual(Object.assign({}, clean.stats.A), { points: 0, maxPoints: 0, correct: 0, drawCorrect: 0, fastestMs: null });
  assert.equal(clean.feed[0].kind, "guess");
  assert.equal(clean.resultRatings.length, 1);
  assert.equal(clean.resultRatings[0].rankText, "<img>");
});

test("custom drawing colors allow safe hex values only", () => {
  const api = loadCatchMind();
  const clean = api.sanitizeSnapshot(baseSnapshot({
    strokes: [
      { id: "custom", color: "#22C55E", width: 8, points: [{ x: 0.2, y: 0.2 }] },
      { id: "bad", color: "url(javascript:alert(1))", width: 8, points: [{ x: 0.3, y: 0.3 }] }
    ]
  }));

  assert.equal(clean.strokes[0].color, "#22c55e");
  assert.equal(clean.strokes[1].color, "#17252f");
});

test("the drawing palette has three diverse rows including white", () => {
  const api = loadCatchMind();
  const colors = Array.from(api.paletteColors);

  assert.equal(colors.length, 18);
  assert.equal(new Set(colors).size, 18);
  assert.equal(colors.includes("#ffffff"), true);
  assert.equal(colors.every(color => /^#[0-9a-f]{6}$/.test(color)), true);
});

test("canvas background fill syncs as a draw command", () => {
  const api = loadCatchMind();
  api.setState(api.sanitizeSnapshot(baseSnapshot({ drawSeq: 0, strokes: [], canvasBg: "#ffffff" })));
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; },
    send() {},
    roomChanged() {},
    toast() {}
  });

  api.onMessage({ t: "cm_bg", nick: "A", matchId: "match-a", roundIndex: 0, seq: 1, color: "#eab308" });

  assert.equal(api.getState().canvasBg, "#eab308");
  assert.equal(api.getState().drawSeq, 1);
});

test("the drawing feed keeps the newest five messages", () => {
  const api = loadCatchMind();
  const clean = api.sanitizeSnapshot(baseSnapshot({
    feed: Array.from({ length: 7 }, (_, index) => ({ who: "A", text: String(index), kind: "guess" }))
  }));

  assert.equal(clean.feed.length, 5);
  assert.equal(clean.feed[0].text, "2");
  assert.equal(clean.feed[4].text, "6");
});

test("canvas snapshots remain below the free broadcast payload limit", () => {
  const api = loadCatchMind();
  const queue = Array.from({ length: api.limits.players }, (_, index) => ("\uAC00".repeat(36) + index).slice(0, 40));
  const scores = {};
  const stats = {};
  queue.forEach(nick => {
    scores[nick] = 999999;
    stats[nick] = { points: 999999, maxPoints: 999999, correct: 9999, drawCorrect: 9999 };
  });
  const strokes = Array.from({ length: api.limits.strokes }, (_, strokeIndex) => ({
    id: "stroke-" + strokeIndex,
    color: "#17252f",
    width: 8,
    points: Array.from({ length: api.limits.pointsPerStroke }, (_, pointIndex) => ({
      x: (pointIndex % 97) / 96,
      y: ((pointIndex * 37) % 97) / 96
    }))
  }));
  const clean = api.sanitizeSnapshot(baseSnapshot({
    queue,
    drawer: queue[0],
    guessers: queue.slice(1),
    scores,
    stats,
    strokes,
    drawSeq: 99,
    feed: [
      { who: queue[1], text: "\uAC00".repeat(60), kind: "guess" },
      { who: queue[2], text: "\uAC00".repeat(60), kind: "correct" },
      { who: queue[3], text: "\uAC00".repeat(60), kind: "system" }
    ]
  }));
  const pointCount = clean.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
  const bytes = Buffer.byteLength(JSON.stringify({ t: "cm_state", by: "A", state: clean }));

  assert.equal(pointCount, api.limits.canvasPoints);
  assert.ok(bytes < 256 * 1024, "snapshot was " + bytes + " bytes");
});

test("stroke deltas append once and reject gaps", () => {
  const api = loadCatchMind();
  api.setState(api.sanitizeSnapshot(baseSnapshot({ strokes: [] })));

  assert.equal(api.applyStrokeDelta({ id: "s1", color: "#17252f", width: 8, offset: 0, points: [{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }] }), true);
  assert.equal(api.applyStrokeDelta({ id: "s1", color: "#17252f", width: 8, offset: 2, points: [{ x: 0.2, y: 0.2 }] }), true);
  assert.equal(api.getState().strokes[0].points.length, 3);
  assert.equal(api.applyStrokeDelta({ id: "s1", color: "#17252f", width: 8, offset: 5, points: [{ x: 0.5, y: 0.5 }] }), false);
  assert.equal(api.getState().strokes[0].points.length, 3);
});

test("a missing draw event requests an authoritative snapshot", () => {
  const api = loadCatchMind();
  const sent = [];
  api.setState(api.sanitizeSnapshot(baseSnapshot({ drawSeq: 0, strokes: [] })));
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });

  api.onMessage({
    t: "cm_draw",
    nick: "A",
    matchId: "match-a",
    roundIndex: 0,
    seq: 2,
    stroke: { id: "s1", color: "#17252f", width: 8, offset: 0, points: [{ x: 0.1, y: 0.1 }] }
  });

  assert.equal(api.getState().drawSeq, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, "hello");
});

test("the host recovers a missed draw event from the drawer", () => {
  const api = loadCatchMind();
  const sent = [];
  api.setState(api.sanitizeSnapshot(baseSnapshot({ drawer: "B", guessers: ["A", "C"], drawSeq: 0, strokes: [] })));
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });

  api.onMessage({
    t: "cm_draw",
    nick: "B",
    matchId: "match-a",
    roundIndex: 0,
    seq: 2,
    stroke: { id: "s1", color: "#17252f", width: 8, offset: 1, points: [{ x: 0.2, y: 0.2 }] }
  });
  assert.equal(sent[0].t, "cm_canvas_req");
  assert.equal(sent[0].to, "B");

  api.onMessage({
    t: "cm_canvas_state",
    from: "B",
    to: "A",
    matchId: "match-a",
    roundIndex: 0,
    drawSeq: 2,
    strokes: [{ id: "s1", color: "#17252f", width: 8, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }]
  });

  assert.equal(api.getState().drawSeq, 2);
  assert.equal(api.getState().strokes[0].points.length, 2);
  assert.equal(sent[sent.length - 1].t, "cm_state");
});

test("the drawer answers an elected host canvas request", () => {
  const api = loadCatchMind();
  const sent = [];
  api.setState(api.sanitizeSnapshot(baseSnapshot({
    drawer: "B",
    guessers: ["A", "C"],
    drawSeq: 1,
    strokes: [{ id: "s1", color: "#17252f", width: 8, points: [{ x: 0.1, y: 0.1 }] }]
  })));
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });

  api.onMessage({ t: "cm_canvas_req", from: "A", to: "B", matchId: "match-a", roundIndex: 0 });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, "cm_canvas_state");
  assert.equal(sent[0].drawSeq, 1);
});

test("a round only finishes after every guesser is correct", () => {
  const api = loadCatchMind();
  api.setState(api.sanitizeSnapshot(baseSnapshot({ correct: { B: true } })));
  assert.equal(api.allGuessersCorrect(), false);
  api.setState(api.sanitizeSnapshot(baseSnapshot({ correct: { B: true, C: true } })));
  assert.equal(api.allGuessersCorrect(), true);
});

test("correct guessers cannot chat during the active round", () => {
  const api = loadCatchMind();
  api.setState(api.sanitizeSnapshot(baseSnapshot({ correct: { B: true } })));

  assert.equal(api.canChat("B"), false);
  assert.equal(api.canChat("C"), true);

  api.setState(api.sanitizeSnapshot(baseSnapshot({ phase: "reveal", correct: { B: true } })));
  assert.equal(api.canChat("B"), true);
});

test("remote reactions are accepted from round guessers", () => {
  const api = loadCatchMind();
  api.setState(api.sanitizeSnapshot(baseSnapshot({ correct: {} })));
  api.setApi({
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; }
  });

  assert.equal(api.validReactionMessage({
    t: "cm_react",
    nick: "B",
    emoji: "🤣",
    matchId: "match-a",
    roundIndex: 0
  }), true);
  assert.equal(api.validReactionMessage({
    t: "cm_react",
    nick: "A",
    emoji: "🤣",
    matchId: "match-a",
    roundIndex: 0
  }), false);
});

test("participant count excludes active spectators during a match", () => {
  const api = loadCatchMind();
  api.setState(api.sanitizeSnapshot(baseSnapshot({
    queue: ["A", "B", "C"],
    drawer: "A",
    guessers: ["B", "C"],
    scores: { A: 0, B: 0, C: 0 },
    stats: {
      A: { points: 0, maxPoints: 6, correct: 0, drawCorrect: 0 },
      B: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 },
      C: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 }
    }
  })));
  api.setApi({
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }, { nick: "D" }]; }
  });

  assert.deepEqual(Array.from(api.participantNicks()), ["A", "B", "C"]);
});

test("away members remain visible while active participant counts exclude them", () => {
  const strip = fakeElement();
  const roleBox = fakeElement();
  const participantRow = fakeElement();
  const spectatorRow = fakeElement();
  const participantList = fakeElement();
  const spectatorList = fakeElement();
  const participantCount = fakeElement();
  const spectatorCount = fakeElement();
  const api = loadCatchMind({
    elements: {
      "catch-score-strip": strip,
      "catch-lobby-roles": roleBox,
      "catch-lobby-participant-row": participantRow,
      "catch-lobby-spectator-row": spectatorRow,
      "catch-lobby-participants": participantList,
      "catch-lobby-spectators": spectatorList,
      "catch-lobby-participant-count": participantCount,
      "catch-lobby-spectator-count": spectatorCount
    }
  });
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() {
      return [
        { nick: "A", joinTs: 1 },
        { nick: "B", joinTs: 2, away: true },
        { nick: "S", joinTs: 3, away: true }
      ];
    }
  });
  api.setState(api.sanitizeSnapshot(baseSnapshot({
    queue: ["A", "B"],
    spectators: ["S"],
    drawer: "A",
    guessers: ["B"],
    scores: { A: 0, B: 0 },
    stats: {
      A: { points: 0, maxPoints: 3, correct: 0, drawCorrect: 0 },
      B: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 }
    }
  })));

  assert.deepEqual(Array.from(api.participantNicks()), ["A"]);
  api.renderScores();
  assert.match(strip.innerHTML, />B</);
  assert.match(strip.innerHTML, />S</);
  assert.equal((strip.innerHTML.match(/자리비움/g) || []).length, 2);
  assert.match(strip.innerHTML, /class="[^"]*away[^"]*"/);

  const waiting = api.freshState();
  waiting.spectators = ["S"];
  api.setState(waiting);
  api.renderLobbyRoles();
  assert.equal(participantCount.textContent, 2);
  assert.equal(spectatorCount.textContent, 1);
  assert.match(participantList.innerHTML, />B</);
  assert.match(participantList.innerHTML, /자리비움/);
  assert.match(spectatorList.innerHTML, />S</);
  assert.match(spectatorList.innerHTML, /자리비움/);
});

test("waiting and finished stages share the light CatchMind status hierarchy", () => {
  const stage = fakeElement();
  const kicker = fakeElement();
  const title = fakeElement();
  const sub = fakeElement();
  const actions = fakeElement();
  const start = fakeElement();
  const practice = fakeElement();
  const resultOpen = fakeElement();
  const marks = fakeElement();
  const hostReady = fakeElement();
  const hostReadyText = fakeElement();
  const highlights = fakeElement();
  const finishNote = fakeElement();
  const correctName = fakeElement();
  const correctValue = fakeElement();
  const fastName = fakeElement();
  const fastValue = fakeElement();
  const drawName = fakeElement();
  const drawValue = fakeElement();
  kicker.classList.add("hidden");
  actions.classList.add("hidden");
  start.classList.add("hidden");
  practice.classList.add("hidden");
  resultOpen.classList.add("hidden");
  marks.classList.add("hidden");
  hostReady.classList.add("hidden");
  highlights.classList.add("hidden");
  finishNote.classList.add("hidden");
  let roster = [{ nick: "A", joinTs: 1 }];
  const api = loadCatchMind({
    elements: {
      "catch-stage": stage,
      "catch-stage-kicker": kicker,
      "catch-stage-title": title,
      "catch-stage-sub": sub,
      "catch-stage-marks": marks,
      "catch-host-ready": hostReady,
      "catch-host-ready-text": hostReadyText,
      "catch-round-highlights": highlights,
      "catch-finish-note": finishNote,
      "catch-highlight-correct-name": correctName,
      "catch-highlight-correct-value": correctValue,
      "catch-highlight-fast-name": fastName,
      "catch-highlight-fast-value": fastValue,
      "catch-highlight-draw-name": drawName,
      "catch-highlight-draw-value": drawValue,
      "catch-stage-actions": actions,
      "catch-result-open-btn": resultOpen,
      "catch-start-btn": start,
      "catch-practice-btn": practice
    }
  });
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return roster; }
  });

  api.setState(api.freshState());
  api.renderStage();
  assert.equal(stage.classList.contains("idle"), true);
  assert.equal(stage.classList.contains("lobby-roles"), true);
  assert.equal(kicker.textContent, "READY TO DRAW");
  assert.equal(kicker.classList.contains("hidden"), false);
  assert.equal(marks.classList.contains("hidden"), false);
  assert.equal(title.textContent, "그릴 준비 됐나요?");
  assert.equal(sub.textContent, "1명의 참가자가 모였어요. 시작하면 첫 번째 제시어가 공개됩니다.");
  assert.equal(hostReady.classList.contains("hidden"), false);
  assert.equal(hostReadyText.textContent, "혼자라면 연습모드로 그림을 테스트할 수 있어요");
  assert.equal(start.classList.contains("hidden"), true);
  assert.equal(practice.classList.contains("hidden"), false);
  assert.equal(actions.classList.contains("hidden"), false);

  roster = [{ nick: "A", joinTs: 1 }, { nick: "B", joinTs: 2 }];
  api.setState(api.sanitizeSnapshot(baseSnapshot({
    phase: "finished",
    queue: ["A", "B"],
    drawer: null,
    guessers: [],
    remainMs: null,
    scores: { A: 42, B: 25 },
    stats: {
      A: { points: 42, maxPoints: 50, correct: 3, drawCorrect: 4, fastestMs: 4200 },
      B: { points: 25, maxPoints: 50, correct: 2, drawCorrect: 1, fastestMs: 6800 }
    },
    recordStatus: "saved"
  })));
  api.renderStage();
  assert.equal(stage.classList.contains("idle"), false);
  assert.equal(stage.classList.contains("lobby-roles"), false);
  assert.equal(stage.classList.contains("finished"), true);
  assert.equal(kicker.textContent, "ROUND COMPLETE");
  assert.equal(title.textContent, "그림 릴레이 끝!");
  assert.equal(sub.textContent, "이번 판에서 나온 재미있는 기록이에요");
  assert.equal(hostReady.classList.contains("hidden"), true);
  assert.equal(highlights.classList.contains("hidden"), false);
  assert.equal(correctName.textContent, "A");
  assert.equal(correctValue.textContent, "정답 3개");
  assert.equal(fastName.textContent, "A");
  assert.equal(fastValue.textContent, "4.2초");
  assert.equal(drawName.textContent, "A");
  assert.equal(drawValue.textContent, "4명 정답");
  assert.equal(finishNote.textContent, "이번 게임에서 모두 5개의 정답을 만들었어요 · 시즌 기록 반영 완료");
  assert.equal(resultOpen.classList.contains("hidden"), false);
  assert.equal(start.textContent, "다시 시작");
  assert.equal(start.classList.contains("hidden"), false);
  assert.equal(practice.classList.contains("hidden"), true);
  assert.equal(actions.classList.contains("hidden"), false);
});

test("a correct guess records the player's fastest real answer time", () => {
  const api = loadCatchMind();
  const now = Date.now();
  const state = api.freshState();
  state.phase = "drawing";
  state.matchId = "match-fast";
  state.queue = ["A", "B"];
  state.drawer = "A";
  state.guessers = ["B"];
  state.deadline = now + api.limits.roundMs - 5000;
  state.scores.A = 0;
  state.scores.B = 0;
  state.stats.A = { points: 0, maxPoints: 3, correct: 0, drawCorrect: 0, fastestMs: null };
  state.stats.B = { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0, fastestMs: null };
  api.setState(state);
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; },
    send() {},
    roomChanged() {},
    toast() {}
  });
  api.setSecretWord("사과");

  api.hostGuess({ nick: "B", text: "사과", matchId: "match-fast", roundIndex: 0 });

  assert.equal(api.getState().stats.B.correct, 1);
  assert.ok(api.getState().stats.B.fastestMs >= 5000);
  assert.ok(api.getState().stats.B.fastestMs < 5200);
  assert.equal(api.formatHighlightSeconds(api.getState().stats.B.fastestMs), "5초");
});

test("finished matches open a reusable result popup with every player's rating change", async () => {
  const backdrop = fakeElement();
  backdrop.classList.add("hidden");
  const meta = fakeElement();
  const winner = fakeElement();
  const winnerScore = fakeElement();
  const winnerRate = fakeElement();
  const list = fakeElement();
  const api = loadCatchMind({
    elements: {
      "catch-result-backdrop": backdrop,
      "catch-result-meta": meta,
      "catch-result-winner": winner,
      "catch-result-winner-score": winnerScore,
      "catch-result-winner-rate": winnerRate,
      "catch-result-list": list
    }
  });
  api.setState(api.sanitizeSnapshot(baseSnapshot({
    phase: "finished",
    matchId: "match-a",
    drawer: null,
    guessers: [],
    remainMs: null,
    scores: { A: 42, B: 25 },
    stats: {
      A: { points: 42, maxPoints: 50, correct: 3, drawCorrect: 4 },
      B: { points: 25, maxPoints: 50, correct: 2, drawCorrect: 1 }
    },
    queue: ["A", "B"],
    recordStatus: "saved"
  })));
  api.setApi({
    isHost() { return true; },
    me() { return { nick: "A", isAdmin: false }; },
    send() {},
    roomChanged() {},
    resultSummary() {
      return Promise.resolve({
        matchId: "match-a",
        players: [
          { nick: "A", beforeRating: 1066, rating: 1084, delta: 18, games: 8, rankText: "1등", rankMove: 2 },
          { nick: "B", beforeRating: 1005, rating: 997, delta: -8, games: 8, rankText: "7등", rankMove: -1 }
        ]
      });
    }
  });

  api.syncResultPopup();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(backdrop.classList.contains("hidden"), false);
  assert.equal(meta.textContent, "캐치마인드 · 참가자 2명");
  assert.equal(winner.textContent, "A");
  assert.equal(winnerScore.textContent, "42점");
  assert.equal(winnerRate.textContent, "활약도 84%");
  assert.match(list.innerHTML, /A/);
  assert.match(list.innerHTML, /B/);
  assert.match(list.innerHTML, /1,066 →/);
  assert.match(list.innerHTML, /1,084/);
  assert.match(list.innerHTML, /\+18/);
  assert.match(list.innerHTML, /▲ 1등/);
  assert.match(list.innerHTML, /▼ 7등/);
  assert.equal(api.getState().resultRatings.length, 2);

  api.closeResultPopup();
  api.syncResultPopup();
  assert.equal(backdrop.classList.contains("hidden"), true);
  api.openResultPopup();
  assert.equal(backdrop.classList.contains("hidden"), false);
});

test("ranking saves retry before reporting success", async () => {
  const api = loadCatchMind({
    setTimeout(callback) { queueMicrotask(callback); return 1; },
    clearTimeout() {}
  });
  let attempts = 0;
  let scoreRefreshes = 0;
  api.setState(api.sanitizeSnapshot(baseSnapshot({
    phase: "finished",
    rev: 30,
    drawer: null,
    guessers: [],
    remainMs: null,
    recordStatus: "pending"
  })));
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return []; },
    send() {},
    roomChanged() {},
    recordMatch() {
      attempts++;
      return Promise.resolve(attempts < 3 ? { error: { message: "temporary" } } : { data: [] });
    },
    scoresChanged() { scoreRefreshes++; },
    toast() {}
  });

  api.persistResults("match-a", [
    { nick: "A", points: 6, maxPoints: 6, correct: 0, drawCorrect: 2 },
    { nick: "B", points: 10, maxPoints: 10, correct: 1, drawCorrect: 0 }
  ], 0);
  for (let i = 0; i < 8 && api.getState().recordStatus !== "saved"; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(attempts, 3);
  assert.equal(api.getState().recordStatus, "saved");
  assert.equal(scoreRefreshes, 1);
  api.clearSaveRetry();
});

test("only the elected host can replace game state", () => {
  const api = loadCatchMind();
  let hostMode = false;
  let electedHost = "A";
  api.setApi({
    isHost() { return hostMode; },
    host() { return electedHost; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; },
    send() {},
    roomChanged() {},
    toast() {}
  });

  api.onMessage({ t: "cm_state", by: "C", state: baseSnapshot({ rev: 5, matchId: "forged" }) });
  assert.notEqual(api.getState().matchId, "forged");

  api.onMessage({ t: "cm_state", by: "A", state: baseSnapshot({ rev: 5, matchId: "accepted" }) });
  assert.equal(api.getState().matchId, "accepted");

  electedHost = "C";
  api.onMessage({ t: "cm_state", by: "C", state: baseSnapshot({ rev: 2, matchId: "new-authority" }) });
  assert.equal(api.getState().matchId, "new-authority");
  assert.equal(api.getState().rev, 2);

  hostMode = true;
  api.onMessage({ t: "cm_state", by: "C", state: baseSnapshot({ rev: 6, matchId: "ignored-by-host" }) });
  assert.equal(api.getState().matchId, "new-authority");
});

test("a temporary host requests a fresh state after losing authority", () => {
  const api = loadCatchMind();
  const sent = [];
  let hostMode = true;
  let hostNick = "B";
  api.setApi({
    isHost() { return hostMode; },
    host() { return hostNick; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });

  api.onPresence([], { becameHost: true });
  hostMode = false;
  hostNick = "A";
  api.onPresence([], { becameHost: false });

  assert.equal(sent[sent.length - 1].t, "hello");
  assert.equal(sent[sent.length - 1].nick, "B");
});

test("a guest requests state after the first host election", () => {
  const api = loadCatchMind();
  const sent = [];
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });

  api.onPresence([], { becameHost: false });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, "hello");
  assert.equal(sent[0].nick, "B");
});

test("prototype-like nicknames do not count as already correct", () => {
  const api = loadCatchMind();
  const state = api.sanitizeSnapshot(baseSnapshot({
    queue: ["A", "toString"],
    drawer: "A",
    guessers: ["toString"],
    scores: { A: 0, toString: 0 },
    stats: {
      A: { points: 0, maxPoints: 3, correct: 0, drawCorrect: 0 },
      toString: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 }
    },
    correct: {}
  }));
  api.setState(state);

  assert.equal(state.correct.toString, undefined);
  assert.equal(api.allGuessersCorrect(), false);
});

test("a match uses a three-second ready phase and a ninety-second drawing phase", () => {
  const api = loadCatchMind();
  const sent = [];
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A", joinTs: 1 }, { nick: "B", joinTs: 2 }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });

  const beforeCountdown = Date.now();
  api.hostStartMatch();
  assert.equal(api.getState().phase, "countdown");
  assert.ok(api.getState().deadline - beforeCountdown <= api.limits.countdownMs + 100);
  assert.equal(sent.some(message => message.t === "cm_secret"), false);

  const beforeDrawing = Date.now();
  api.hostBeginDrawing();
  assert.equal(api.getState().phase, "drawing");
  assert.ok(api.getState().deadline - beforeDrawing >= api.limits.roundMs - 100);
  assert.ok(api.getState().deadline - beforeDrawing <= api.limits.roundMs + 100);
  assert.equal(sent.filter(message => message.t === "cm_secret").length, 1);
});

test("the drawer gets a fifteen-second reconnect pause and resumes the same round", () => {
  const api = loadCatchMind();
  const sent = [];
  let roster = [{ nick: "A" }, { nick: "B" }, { nick: "C" }];
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return roster; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });
  api.applyState(baseSnapshot({ drawer: "B", guessers: ["A", "C"], remainMs: 50000 }));
  api.setSecretWord("사과");

  roster = [{ nick: "A" }, { nick: "C" }];
  const pauseStarted = Date.now();
  api.onPresence([], { becameHost: false });
  assert.equal(api.getState().pauseKind, "drawer");
  assert.equal(api.getState().deadline, null);
  assert.ok(api.getState().pauseUntil - pauseStarted >= api.limits.drawerGraceMs - 100);

  roster = [{ nick: "A" }, { nick: "B" }, { nick: "C" }];
  api.onPresence([], { becameHost: false });
  assert.equal(api.getState().phase, "drawing");
  assert.equal(api.getState().pauseKind, null);
  assert.ok(api.getState().deadline > Date.now());
  assert.ok(sent.some(message => message.t === "cm_secret" && message.to === "B"));
});

test("an absent drawer loses the turn after the reconnect deadline", () => {
  const api = loadCatchMind();
  let roster = [{ nick: "A" }, { nick: "B" }, { nick: "C" }];
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return roster; },
    send() {},
    roomChanged() {},
    toast() {}
  });
  api.applyState(baseSnapshot({ drawer: "B", guessers: ["A", "C"] }));
  api.setSecretWord("사과");

  roster = [{ nick: "A" }, { nick: "C" }];
  api.onPresence([], { becameHost: false });
  api.getState().pauseUntil = Date.now() - 1;
  api.tick();

  assert.equal(api.getState().phase, "reveal");
  assert.equal(api.getState().pauseKind, null);
  assert.ok(api.getState().feed.some(item => item.text.includes("턴을 넘겼어요")));
});

test("a new host restarts safely if the private word cannot be recovered", () => {
  const api = loadCatchMind();
  const sent = [];
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });
  api.applyState(baseSnapshot({
    drawer: "B",
    guessers: ["A", "C"],
    strokes: [{ id: "old", color: "#17252f", width: 8, points: [{ x: 0.2, y: 0.2 }] }]
  }));

  api.onPresence([], { becameHost: true });
  assert.equal(api.getState().pauseKind, "sync");
  assert.ok(sent.some(message => message.t === "cm_secret_req" && message.to === "B"));

  api.getState().pauseUntil = Date.now() - 1;
  api.tick();
  assert.equal(api.getState().phase, "drawing");
  assert.equal(api.getState().pauseKind, null);
  assert.equal(api.getState().strokes.length, 0);
  assert.equal(api.getState().wordLength, 2);
  assert.ok(api.getState().deadline - Date.now() >= api.limits.roundMs - 100);
  assert.ok(sent.some(message => message.t === "cm_secret" && message.to === "B"));
});

test("spectators cannot submit the exact answer but can still chat", () => {
  const api = loadCatchMind();
  const sent = [];
  const relayed = [];
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "S" }]; },
    send(message) { sent.push(message); },
    relayChat(nick, text, overlaySide) { relayed.push({ nick, text, overlaySide }); },
    roomChanged() {},
    toast() {}
  });
  api.applyState(baseSnapshot({
    queue: ["A", "B"],
    drawer: "A",
    guessers: ["B"],
    scores: { A: 0, B: 0 },
    stats: {
      A: { points: 0, maxPoints: 3, correct: 0, drawCorrect: 0 },
      B: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 }
    }
  }));
  api.setSecretWord("사과");

  api.hostSpectatorInput({ nick: "S", text: "사과", matchId: "match-a", roundIndex: 0 });
  assert.equal(relayed.length, 0);
  assert.ok(sent.some(message => message.t === "cm_notice" && message.to === "S"));

  api.hostSpectatorInput({ nick: "S", text: "멋진 그림", matchId: "match-a", roundIndex: 0 });
  assert.deepEqual(relayed, [{ nick: "S", text: "멋진 그림", overlaySide: "right" }]);
  assert.ok(sent.some(message => message.t === "cm_chat_ack" && message.to === "S"));
});

test("a spectator sees their acknowledged chat on the right overlay", () => {
  const api = loadCatchMind();
  const shown = [];
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "S", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "S" }]; },
    send() {},
    showChat(nick, text, overlaySide) { shown.push({ nick, text, overlaySide }); },
    roomChanged() {},
    toast() {}
  });
  api.applyState(baseSnapshot({
    queue: ["A", "B"],
    drawer: "A",
    guessers: ["B"],
    scores: { A: 0, B: 0 },
    stats: {
      A: { points: 0, maxPoints: 3, correct: 0, drawCorrect: 0 },
      B: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 }
    }
  }));

  api.onMessage({
    t: "cm_chat_ack",
    from: "A",
    to: "S",
    nick: "S",
    text: "멋진 그림",
    matchId: "match-a",
    roundIndex: 0
  });

  assert.deepEqual(shown, [{ nick: "S", text: "멋진 그림", overlaySide: "right" }]);
});

test("drawing widths distinguish normal pen, thick pen, and eraser", () => {
  const api = loadCatchMind();
  assert.equal(api.brushWidth("pen", 0), 8);
  assert.equal(api.brushWidth("pen", 1), 24);
  assert.equal(api.brushWidth("eraser", 0), 90);

  const clean = api.sanitizeSnapshot(baseSnapshot({
    strokes: [{ id: "wide", color: "#17252f", width: 90, points: [{ x: 0.2, y: 0.2 }] }]
  }));
  assert.equal(clean.strokes[0].width, 90);
  assert.equal(api.limits.strokeWidth, 96);
});

test("the round advances when every remaining guesser has left", () => {
  const api = loadCatchMind();
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }]; },
    send() {},
    roomChanged() {},
    toast() {}
  });
  api.applyState(baseSnapshot());
  api.setSecretWord("사과");

  api.onPresence([], { becameHost: false });
  assert.equal(api.getState().phase, "reveal");
  assert.ok(api.getState().feed.some(item => item.text.includes("정답을 맞힐 사람이 없어")));
});

test("paused rounds reject stale drawing and reaction messages", () => {
  const api = loadCatchMind();
  api.setState(api.sanitizeSnapshot(baseSnapshot({
    pauseKind: "drawer",
    pauseRemainMs: 12000,
    pausedRemainMs: 40000
  })));
  api.setApi({
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; }
  });

  api.onMessage({
    t: "cm_draw",
    nick: "A",
    matchId: "match-a",
    roundIndex: 0,
    seq: 1,
    stroke: { id: "late", color: "#17252f", width: 8, offset: 0, points: [{ x: 0.2, y: 0.2 }] }
  });

  assert.equal(api.getState().drawSeq, 0);
  assert.equal(api.validReactionMessage({
    t: "cm_react",
    nick: "B",
    emoji: "🤣",
    matchId: "match-a",
    roundIndex: 0
  }), false);
});

test("a returning guesser keeps the same game role without disturbing others", () => {
  const api = loadCatchMind();
  let roster = [{ nick: "A" }, { nick: "B" }];
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return roster; },
    send() {},
    roomChanged() {},
    toast() {}
  });
  api.applyState(baseSnapshot());
  api.setSecretWord("사과");

  api.onPresence([], { becameHost: false });
  assert.equal(api.getState().phase, "drawing");
  assert.deepEqual(Array.from(api.getState().guessers), ["B", "C"]);

  roster = [{ nick: "A" }, { nick: "B" }, { nick: "C" }];
  api.onPresence([], { becameHost: false });
  api.onMessage({ t: "cm_guess", nick: "C", text: "사과", matchId: "match-a", roundIndex: 0 });

  assert.equal(api.getState().phase, "drawing");
  assert.equal(api.getState().correct.C, true);
  assert.equal(api.getState().scores.C, 10);
});

test("spectator preferences produce the exact participant queue at match start", () => {
  const api = loadCatchMind();
  const sent = [];
  const roster = ["A", "B", "C", "D", "E", "F"].map((nick, index) => ({ nick, joinTs: index + 1 }));
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return roster; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });

  api.onMessage({ t: "cm_role_req", from: "E", nick: "E", spectating: true });
  api.onMessage({ t: "cm_role_req", from: "F", nick: "F", spectating: true });

  assert.deepEqual(Array.from(api.getState().spectators), ["E", "F"]);
  assert.deepEqual(Array.from(api.desiredParticipantNicks()), ["A", "B", "C", "D"]);
  assert.deepEqual(Array.from(api.desiredSpectatorPeople(), person => person.nick), ["E", "F"]);

  api.hostStartMatch();
  assert.equal(api.getState().phase, "countdown");
  assert.deepEqual(Array.from(api.getState().queue), ["A", "B", "C", "D"]);
  assert.deepEqual(Array.from(api.getState().spectators), ["E", "F"]);
  assert.equal(sent.filter(message => message.t === "cm_role_ack").length, 2);
});

test("a spectator can switch back to participant before the match", () => {
  const api = loadCatchMind();
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    send() {},
    roomChanged() {},
    toast() {}
  });

  assert.equal(api.hostSetSpectatorPreference("B", true), true);
  assert.deepEqual(Array.from(api.getState().spectators), ["B"]);
  assert.equal(api.hostSetSpectatorPreference("B", false), true);
  assert.deepEqual(Array.from(api.getState().spectators), []);
  assert.deepEqual(Array.from(api.desiredParticipantNicks()), ["A", "B", "C"]);
});

test("non-host role toggles are sent to the elected host", () => {
  const api = loadCatchMind();
  const sent = [];
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });

  api.toggleRolePreference();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, "cm_role_req");
  assert.equal(sent[0].from, "B");
  assert.equal(sent[0].nick, "B");
  assert.equal(sent[0].spectating, true);
});

test("role changes are frozen once the countdown starts", () => {
  const api = loadCatchMind();
  const sent = [];
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast() {}
  });

  api.hostStartMatch();
  api.onMessage({ t: "cm_role_req", from: "B", nick: "B", spectating: true });

  assert.equal(api.getState().phase, "countdown");
  assert.deepEqual(Array.from(api.getState().queue), ["A", "B", "C"]);
  assert.deepEqual(Array.from(api.getState().spectators), []);
  const ack = sent.filter(message => message.t === "cm_role_ack").pop();
  assert.equal(ack.to, "B");
  assert.equal(ack.accepted, false);
});

test("a match cannot start with fewer than two willing participants", () => {
  const api = loadCatchMind();
  const toasts = [];
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; },
    send() {},
    roomChanged() {},
    toast(message) { toasts.push(message); }
  });

  api.hostSetSpectatorPreference("B", true);
  api.hostStartMatch();

  assert.equal(api.getState().phase, "idle");
  assert.deepEqual(Array.from(api.getState().queue), []);
  assert.ok(toasts.some(message => message.includes("참가자가 2명 이상")));
});
