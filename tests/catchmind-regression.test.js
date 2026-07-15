"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCatchMind(options) {
  options = options || {};
  const source = fs.readFileSync(path.join(__dirname, "..", "catchmind.js"), "utf8");
  const context = {
    window: { __CATCHMIND_TEST__: true, CATCHMIND_WORDS: ["사과"] },
    document: { getElementById() { return null; }, querySelectorAll() { return []; } },
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

function baseSnapshot(overrides) {
  return Object.assign({
    phase: "drawing",
    rev: 1,
    matchId: "match-a",
    queue: ["A", "B", "C"],
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
    feed: [{ who: "A", text: "hello", kind: 'x\" onmouseover=\"alert(1)' }]
  }));

  assert.equal(clean.scores.A, 0);
  assert.equal(clean.scores.B, 0);
  assert.equal(clean.scores.C, 12);
  assert.deepEqual(Object.assign({}, clean.stats.A), { points: 0, maxPoints: 0, correct: 0, drawCorrect: 0 });
  assert.equal(clean.feed[0].kind, "guess");
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
