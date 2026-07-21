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
    Audio: options.Audio,
    localStorage: options.localStorage || { getItem() { return "0"; } },
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

test("drawing coordinates are compact enough for the realtime payload limit", () => {
  const relay = loadRelay();
  const source = Array.from({ length: 8 }, (_, strokeIndex) => ({
    id: "stroke-" + strokeIndex,
    color: "#17252f",
    width: 8,
    points: Array.from({ length: 625 }, (_, pointIndex) => ({
      x: (pointIndex + 0.123456789) / 625,
      y: (strokeIndex + pointIndex + 0.987654321) / 633
    }))
  }));
  const compact = relay.sanitizeStrokes(source);
  const bytes = Buffer.byteLength(JSON.stringify({ entry: { kind: "drawing", strokes: compact } }));

  assert.equal(compact[0].points[0].x, 0.0002);
  assert.ok(bytes < 200 * 1024, `expected a safe realtime payload, got ${bytes} bytes`);
});

test("automatic story prompts combine broad, easy character and action vocabularies", () => {
  const relay = loadRelay();
  const parts = relay.promptParts;

  assert.equal(parts.characters.length, 200);
  assert.equal(parts.actions.length, 200);
  assert.equal(parts.situations.length, 200);
  assert.equal(new Set(parts.characters).size, parts.characters.length);
  assert.equal(new Set(parts.actions).size, parts.actions.length);
  assert.equal(new Set(parts.situations).size, parts.situations.length);
  assert.equal(parts.situationRatio, 0.15);
  assert.ok(parts.characters.includes("고양이"));
  assert.ok(parts.characters.includes("로봇"));
  assert.ok(parts.actions.includes("춤추는"));
  assert.ok(parts.actions.includes("책 읽는"));
  assert.ok(parts.situations.includes("비 오는 날"));

  const baseValues = [0.8, 0, 0];
  const base = relay.buildPromptSuggestion(() => baseValues.shift() ?? 0);
  assert.equal(base, "춤추는 강아지");

  const situationValues = [0.1, 0, 0, 0];
  const situation = relay.buildPromptSuggestion(() => situationValues.shift() ?? 0);
  assert.equal(situation, "비 오는 날 춤추는 강아지");
  assert.ok(base.length <= relay.limits.maxText);
  assert.ok(situation.length <= relay.limits.maxText);
  assert.ok(parts.characters.length * parts.actions.length >= 40000);
  assert.equal(parts.characters.length * parts.actions.length * parts.situations.length, 8000000);
});

test("relay drawing reuses CatchMind waiting and game music at identical volumes", async () => {
  function media(src) {
    return {
      src: src || "",
      paused: true,
      currentTime: 0,
      volume: 0,
      loop: false,
      preload: "",
      style: {},
      playCount: 0,
      pauseCount: 0,
      setAttribute() {},
      play() {
        this.paused = false;
        this.playCount++;
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
        this.pauseCount++;
      }
    };
  }

  const waiting = media();
  const game = media();
  function FakeAudio(src) {
    game.src = src;
    return game;
  }
  const relay = loadRelay({
    Audio: FakeAudio,
    localStorage: { getItem() { return "0"; } },
    document: {
      createElement(tag) {
        assert.equal(tag, "audio");
        return waiting;
      },
      body: { appendChild() {} }
    }
  });
  relay.setApi({ me() { return { nick: "A" }; } });
  const state = relay.freshState();
  relay.setState(state);

  relay.syncAudio();
  await Promise.resolve();
  assert.equal(waiting.src, "assets/catchmind-bgm.mp3");
  assert.equal(waiting.volume, 0.04);
  assert.equal(waiting.loop, true);
  assert.equal(waiting.playCount, 1);

  waiting.currentTime = 18;
  state.phase = "prompt";
  state.matchId = "relay-one";
  relay.syncAudio();
  await Promise.resolve();
  assert.equal(waiting.paused, true);
  assert.equal(waiting.currentTime, 18);
  assert.equal(game.src, "assets/catchmind-start.mp3");
  assert.equal(game.volume, 1);
  assert.equal(game.loop, true);
  assert.equal(game.playCount, 1);

  state.phase = "drawing";
  relay.syncAudio();
  state.phase = "caption";
  relay.syncAudio();
  assert.equal(game.playCount, 1);

  game.currentTime = 21;
  game.pause();
  relay.syncAudio();
  await Promise.resolve();
  assert.equal(game.playCount, 2);
  assert.equal(game.currentTime, 21);

  state.phase = "finished";
  relay.syncAudio();
  await Promise.resolve();
  assert.equal(game.paused, true);
  assert.equal(game.currentTime, 0);
  assert.equal(waiting.playCount, 2);
  assert.equal(waiting.currentTime, 18);

  state.phase = "prompt";
  state.matchId = "relay-two";
  relay.syncAudio();
  await Promise.resolve();
  assert.equal(game.playCount, 3);
  assert.equal(game.currentTime, 0);
  assert.equal(relay.audioConfig.waitingSrc, "assets/catchmind-bgm.mp3");
  assert.equal(relay.audioConfig.waitingVolume, 0.04);
  assert.equal(relay.audioConfig.gameSrc, "assets/catchmind-start.mp3");
  assert.equal(relay.audioConfig.gameVolume, 1);
});

test("UI preview exposes every relay screen with complete sample chains", () => {
  const relay = loadRelay();
  const players = ["나", "민서", "서준", "지우"];

  assert.equal(relay.normalizePreviewPhase("idle"), "waiting");
  assert.equal(relay.normalizePreviewPhase("finished"), "result");
  assert.equal(relay.normalizePreviewPhase("unknown"), "waiting");

  const chains = relay.buildPreviewChains(players);
  for (const origin of players) {
    assert.equal(chains[origin].length, players.length);
    assert.deepEqual(Array.from(chains[origin], (entry) => entry.kind), ["prompt", "drawing", "caption", "drawing"]);
    assert.ok(chains[origin][1].strokes.length > 0);
  }
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
  assert.equal(drawing.strokes[0].width, 90);
  assert.deepEqual(Object.assign({}, drawing.strokes[0].points[0]), { x: 0, y: 1 });
});

test("the five-second cue plays once for each active relay task", () => {
  class FixedDate extends Date { static now() { return 5000; } }
  const timer = {
    textContent: "",
    classList: {
      remove() {},
      toggle() {}
    }
  };
  const relay = loadRelay({
    Date: FixedDate,
    document: {
      getElementById(id) { return id === "relay-timer" ? timer : null; }
    }
  });
  let warnings = 0;
  relay.setApi({
    me() { return { nick: "A" }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    isHost() { return false; },
    host() { return "B"; },
    playWarning() { warnings++; }
  });
  relay.setState({
    phase: "prompt",
    rev: 1,
    matchId: "relay-warning",
    players: ["A", "B", "C"],
    spectators: [],
    ready: [],
    stepIndex: 0,
    totalSteps: 3,
    deadline: 10000,
    submitted: []
  });

  relay.tick();
  relay.tick();
  assert.equal(timer.textContent, "00:05");
  assert.equal(warnings, 1);
});

test("timeout submission preserves the participant's latest text", () => {
  const draft = "마지막에 적고 있던 문장";
  const input = { value: draft, disabled: false };
  const relay = loadRelay({
    document: {
      getElementById(id) { return id === "relay-text-input" ? input : null; }
    }
  });
  const sent = [];
  relay.setApi({
    me() { return { nick: "A" }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    isHost() { return false; },
    host() { return "B"; },
    send(message) { sent.push(message); },
    toast() {}
  });
  relay.setState({
    phase: "prompt",
    rev: 1,
    matchId: "relay-auto-submit",
    players: ["A", "B", "C"],
    spectators: [],
    ready: [],
    stepIndex: 0,
    totalSteps: 3,
    deadline: Date.now() - 1,
    submitted: []
  });

  assert.equal(relay.autoSubmitCurrentState(), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].entry.text, draft);
  assert.equal(sent[0].entry.auto, true);
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
