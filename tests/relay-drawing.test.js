"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRelay(options) {
  options = options || {};
  const source = fs.readFileSync(path.join(__dirname, "..", "relay-drawing.js"), "utf8");
  const document = Object.assign({
    getElementById() { return null; },
    querySelectorAll() { return []; }
  }, options.document || {});
  const windowObject = { __RELAY_DRAWING_TEST__: true };
  const context = {
    window: windowObject,
    document,
    console,
    Date: options.Date || Date,
    Event: function Event(type) { this.type = type; },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Set
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "relay-drawing.js" });
  return context.window.RelayDrawing._test;
}

function apiFor(testApi, people) {
  const sent = [];
  const api = {
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return people.map((nick, index) => ({ nick, joinTs: index + 1 })); },
    isHost() { return true; },
    host() { return "A"; },
    send(message) {
      sent.push(message);
      testApi.onMessage(message);
    },
    roomChanged() {},
    toast() {}
  };
  return { api, sent };
}

test("each chain rotates to a different participant at every step", () => {
  const relay = loadRelay();
  const players = ["A", "B", "C", "D"];

  assert.equal(relay.assignmentOrigin(players, "A", 0), "A");
  assert.equal(relay.assignmentOrigin(players, "A", 1), "D");
  assert.equal(relay.assignmentOrigin(players, "A", 2), "C");
  assert.equal(relay.assignmentOrigin(players, "A", 3), "B");

  for (let step = 0; step < players.length; step++) {
    const origins = players.map((nick) => relay.assignmentOrigin(players, nick, step));
    assert.equal(new Set(origins).size, players.length);
  }
});

test("steps alternate prompt, drawing, and caption", () => {
  const relay = loadRelay();

  assert.equal(relay.phaseForStep(0), "prompt");
  assert.equal(relay.phaseForStep(1), "drawing");
  assert.equal(relay.phaseForStep(2), "caption");
  assert.equal(relay.phaseForStep(3), "drawing");
  assert.equal(relay.expectedKind(4), "caption");
});

test("incoming text and drawing entries are bounded and sanitized", () => {
  const relay = loadRelay();
  const longText = "<b>" + "가".repeat(80);
  const text = relay.sanitizeEntry({ text: longText }, "prompt", "A", 0);
  const drawing = relay.sanitizeEntry({
    strokes: [{
      id: "line",
      color: "url(javascript:alert(1))",
      width: 999,
      points: [{ x: -2, y: 3 }, { x: 0.5, y: 0.5 }]
    }]
  }, "drawing", "B", 1);

  assert.equal(text.text.length, relay.limits.maxText);
  assert.equal(drawing.strokes[0].color, "#17252f");
  assert.equal(drawing.strokes[0].width, 70);
  assert.deepEqual(Object.assign({}, drawing.strokes[0].points[0]), { x: 0, y: 1 });
});

test("a host starts only with three players and all guests ready", () => {
  const relay = loadRelay({ Date: class extends Date { static now() { return 1000; } } });
  const setup = apiFor(relay, ["A", "B", "C"]);
  relay.setApi(setup.api);

  let state = relay.freshState();
  state.ready = ["B"];
  relay.setState(state);
  assert.equal(relay.hostStartMatch(), false);

  state.ready = ["B", "C"];
  relay.setState(state);
  assert.equal(relay.hostStartMatch(), true);
  assert.equal(relay.getState().phase, "prompt");
  assert.deepEqual(Array.from(relay.getState().players), ["A", "B", "C"]);
  assert.equal(relay.getState().totalSteps, 3);
});

test("all simultaneous submissions advance and finish a three-player chain", () => {
  const relay = loadRelay();
  const setup = apiFor(relay, ["A", "B", "C"]);
  relay.setApi(setup.api);
  relay.setState({
    phase: "prompt",
    rev: 1,
    matchId: "relay-test",
    players: ["A", "B", "C"],
    spectators: [],
    ready: [],
    stepIndex: 0,
    totalSteps: 3,
    deadline: Date.now() + 40000,
    submitted: []
  });
  relay.setChains({ A: [], B: [], C: [] });

  ["A", "B", "C"].forEach((nick) => relay.hostAcceptSubmission(nick, { text: nick + "의 문장" }, false));
  assert.equal(relay.getState().phase, "drawing");
  assert.equal(relay.getState().stepIndex, 1);

  const drawing = { strokes: [{ id: "x", color: "#17252f", width: 8, points: [{ x: 0.1, y: 0.2 }] }] };
  ["A", "B", "C"].forEach((nick) => relay.hostAcceptSubmission(nick, drawing, false));
  assert.equal(relay.getState().phase, "caption");
  assert.equal(relay.getState().stepIndex, 2);

  ["A", "B", "C"].forEach((nick) => relay.hostAcceptSubmission(nick, { text: nick + "의 설명" }, false));
  assert.equal(relay.getState().phase, "finished");

  for (const origin of ["A", "B", "C"]) {
    assert.equal(relay.getChains()[origin].length, 3);
    assert.deepEqual(Array.from(relay.getChains()[origin], (entry) => entry.kind), ["prompt", "drawing", "caption"]);
  }
});

test("expired participants receive placeholders before the next step", () => {
  const relay = loadRelay();
  const setup = apiFor(relay, ["A", "B", "C"]);
  relay.setApi(setup.api);
  relay.setState({
    phase: "prompt",
    rev: 1,
    matchId: "relay-timeout",
    players: ["A", "B", "C"],
    spectators: [],
    ready: [],
    stepIndex: 0,
    totalSteps: 3,
    deadline: 1,
    submitted: ["A"]
  });
  relay.setChains({
    A: [{ kind: "prompt", author: "A", step: 0, text: "A의 문장" }],
    B: [],
    C: []
  });

  relay.hostFinishExpiredStep();
  assert.equal(relay.getState().phase, "drawing");
  assert.equal(relay.getChains().B[0].auto, true);
  assert.equal(relay.getChains().C[0].auto, true);
});
