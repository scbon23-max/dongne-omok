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
  const document = Object.assign({
    getElementById(id) { return elements[id] || null; },
    querySelectorAll() { return []; }
  }, options.document || {});
  const windowObject = Object.assign({ __CATCHMIND_TEST__: true, CATCHMIND_WORDS: ["사과"] }, options.window || {});
  const context = {
    window: windowObject,
    document,
    console,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    setInterval,
    clearInterval
  };
  if (options.Audio) context.Audio = options.Audio;
  if (options.localStorage) context.localStorage = options.localStorage;
  if (options.Date) context.Date = options.Date;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "catchmind.js" });
  return context.window.CatchMind._test;
}

function fakeElement() {
  const classes = new Set();
  const attributes = new Map();
  return {
    innerHTML: "",
    textContent: "",
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
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
    ready: [],
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
    revealOutcome: null,
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

test("gallery captures only completed drawing rounds with visible content", () => {
  const api = loadCatchMind();
  api.setState(baseSnapshot({
    phase: "drawing",
    matchId: "match-gallery",
    roundIndex: 1,
    drawer: "B",
    canvasBg: "#ffffff",
    strokes: [{ id: "line", color: "#22c55e", width: 8, points: [{ x: 0.2, y: 0.3 }] }]
  }));
  api.setSecretWord("사과");

  const draft = api.galleryDraftFromRound();
  assert.equal(draft.matchId, "match-gallery");
  assert.equal(draft.roundIndex, 1);
  assert.equal(draft.drawer, "B");
  assert.equal(draft.word, "사과");
  assert.equal(draft.strokes.length, 1);

  api.setState(baseSnapshot({ phase: "drawing", canvasBg: "#ffffff", strokes: [] }));
  assert.equal(api.galleryDraftFromRound(), null);
  api.setState(baseSnapshot({ phase: "practice", canvasBg: "#d23b3b", strokes: [] }));
  assert.equal(api.galleryDraftFromRound(), null);
});

test("the drawing palette has three diverse rows including white", () => {
  const api = loadCatchMind();
  const colors = Array.from(api.paletteColors);

  assert.equal(colors.length, 18);
  assert.equal(new Set(colors).size, 18);
  assert.equal(colors.includes("#ffffff"), true);
  assert.equal(colors.every(color => /^#[0-9a-f]{6}$/.test(color)), true);
});

test("color slots open the shared palette without a separate palette button", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "catchmind.js"), "utf8");

  assert.doesNotMatch(source, /catch-palette-btn/);
  assert.match(source, /var shouldClose = paletteOpen && paletteTarget === "pen" && selectedColorSlot === slot/);
  assert.match(source, /selectColorSlot\(slot\);\s*setPaletteOpen\(!shouldClose\)/);
  assert.match(source, /function pointerDown\(event\) \{\s*if \(!canDraw\(\)\) return;\s*setPaletteOpen\(false\)/);
});

test("waiting music yields to looping match music and resumes after play", async () => {
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

  const bgm = media();
  const start = media();
  const created = [];
  function FakeAudio(src) {
    start.src = src;
    created.push(src);
    return start;
  }
  const api = loadCatchMind({
    Audio: FakeAudio,
    localStorage: { getItem() { return "0"; } },
    document: {
      createElement(tag) {
        assert.equal(tag, "audio");
        return bgm;
      },
      body: { appendChild() {} }
    }
  });
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; }
  });

  const state = api.freshState();
  api.setState(state);
  api.syncAudio();
  await Promise.resolve();
  assert.equal(bgm.src, "assets/catchmind-bgm.mp3");
  assert.equal(bgm.volume, 0.028);
  assert.equal(bgm.playCount, 1);

  bgm.currentTime = 18;
  state.phase = "countdown";
  state.matchId = "match-one";
  state.roundIndex = 0;
  api.syncAudio();
  await Promise.resolve();
  assert.equal(bgm.paused, true);
  assert.equal(bgm.currentTime, 18);
  assert.equal(created.length, 1);
  assert.equal(start.src, "assets/catchmind-start.mp3");
  assert.equal(start.volume, 1);
  assert.equal(start.loop, true);
  assert.equal(start.playCount, 1);

  state.phase = "drawing";
  api.syncAudio();
  state.phase = "reveal";
  api.syncAudio();
  state.phase = "countdown";
  state.roundIndex = 1;
  api.syncAudio();
  assert.equal(start.playCount, 1);
  assert.equal(bgm.playCount, 1);

  start.currentTime = 21;
  start.pause();
  api.syncAudio();
  await Promise.resolve();
  assert.equal(start.playCount, 2);
  assert.equal(start.currentTime, 21);

  state.phase = "finished";
  api.syncAudio();
  await Promise.resolve();
  assert.equal(start.paused, true);
  assert.equal(start.currentTime, 0);
  assert.equal(bgm.playCount, 2);
  assert.equal(bgm.currentTime, 18);

  state.phase = "drawing";
  state.matchId = "match-two";
  state.roundIndex = 0;
  api.syncAudio();
  await Promise.resolve();
  assert.equal(start.playCount, 3);
  assert.equal(start.currentTime, 0);
  assert.equal(api.audioConfig.bgmVolume, 0.028);
  assert.equal(api.audioConfig.startVolume, 1);
  assert.equal(api.audioConfig.clearSrc, "assets/catchmind-clear-loud.mp3");
  assert.equal(api.audioConfig.clearVolume, 1);
});

test("the countdown sound plays once for each visible 5 4 3 2 1 step", async () => {
  function media(src) {
    return {
      src,
      paused: true,
      currentTime: 0,
      volume: 0,
      playCount: 0,
      setAttribute() {},
      play() {
        this.paused = false;
        this.playCount++;
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
      }
    };
  }

  let now = 1000;
  const tracks = Object.create(null);
  function FakeAudio(src) {
    tracks[src] = tracks[src] || media(src);
    return tracks[src];
  }
  const api = loadCatchMind({
    Audio: FakeAudio,
    Date: { now() { return now; } },
    localStorage: { getItem() { return "0"; } }
  });
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; }
  });

  const state = api.freshState();
  state.phase = "countdown";
  state.matchId = "match-countdown";
  state.roundIndex = 0;
  state.deadline = 6000;
  api.setState(state);

  api.syncAudio();
  await Promise.resolve();
  const countdown = tracks["assets/catchmind-countdown.wav"];
  assert.ok(countdown);
  assert.equal(countdown.volume, 1);
  assert.equal(countdown.playCount, 1);

  api.syncAudio();
  assert.equal(countdown.playCount, 1);
  now = 2001;
  api.syncAudio();
  assert.equal(countdown.playCount, 2);
  now = 3001;
  api.syncAudio();
  assert.equal(countdown.playCount, 3);
  now = 4001;
  api.syncAudio();
  assert.equal(countdown.playCount, 4);
  now = 5001;
  api.syncAudio();
  assert.equal(countdown.playCount, 5);
  api.syncAudio();
  assert.equal(countdown.playCount, 5);

  state.pauseKind = "drawer";
  api.syncAudio();
  assert.equal(countdown.playCount, 5);
  assert.equal(api.audioConfig.countdownSrc, "assets/catchmind-countdown.wav");
  assert.equal(api.audioConfig.countdownVolume, 1);
});

test("countdown chat stays on the right and clears before drawing chat", () => {
  const overlay = fakeElement();
  const api = loadCatchMind({ elements: { "catch-chat-overlay": overlay } });
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; }
  });

  const state = api.freshState();
  state.phase = "countdown";
  state.queue = ["A", "B"];
  api.setState(state);
  api.renderChatOverlayPosition();
  assert.equal(overlay.classList.contains("hidden"), false);
  assert.equal(overlay.classList.contains("right"), true);

  overlay.innerHTML = "카운트다운 채팅";
  state.phase = "drawing";
  api.renderChatOverlayPosition();
  assert.equal(overlay.classList.contains("hidden"), false);
  assert.equal(overlay.classList.contains("right"), false);
  assert.equal(overlay.innerHTML, "");

  overlay.innerHTML = "이전 참가자 채팅";
  state.correct.B = true;
  api.renderChatOverlayPosition();
  assert.equal(overlay.classList.contains("right"), true);
  assert.equal(overlay.innerHTML, "");

  state.correct.B = false;
  state.phase = "reveal";
  api.renderChatOverlayPosition();
  assert.equal(overlay.classList.contains("right"), true);

  state.phase = "finished";
  api.renderChatOverlayPosition();
  assert.equal(overlay.classList.contains("hidden"), false);
  assert.equal(overlay.classList.contains("right"), true);
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

test("spectators and solved players can read the participant feed", () => {
  const feed = fakeElement();
  const api = loadCatchMind({
    elements: {
      "catch-feed": feed
    }
  });
  const roster = [{ nick: "A" }, { nick: "B" }, { nick: "C" }, { nick: "S" }];
  api.setState(api.sanitizeSnapshot(baseSnapshot({
    feed: [
      { who: "C", text: "비밀 추측", kind: "guess" },
      { who: "", text: "게임 안내", kind: "system" }
    ]
  })));

  api.setApi({
    me() { return { nick: "S", isAdmin: false }; },
    roster() { return roster; }
  });
  api.renderFeed();
  assert.match(feed.innerHTML, /비밀 추측/);
  assert.match(feed.innerHTML, /게임 안내/);

  api.setApi({
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return roster; }
  });
  api.getState().correct.B = true;
  api.renderFeed();
  assert.match(feed.innerHTML, /비밀 추측/);

  api.setApi({
    me() { return { nick: "C", isAdmin: false }; },
    roster() { return roster; }
  });
  api.renderFeed();
  assert.match(feed.innerHTML, /비밀 추측/);
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

test("drawing capacity supports detailed tablet sketches", () => {
  const api = loadCatchMind();

  assert.ok(api.limits.strokes >= 200);
  assert.ok(api.limits.pointsPerStroke >= 1000);
  assert.ok(api.limits.canvasPoints >= 7000);
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

test("match chat separates active players from spectators and solved players", () => {
  const api = loadCatchMind();
  api.setState(api.sanitizeSnapshot(baseSnapshot({ correct: { B: true } })));

  assert.equal(api.chatGroupFor("A"), "players");
  assert.equal(api.chatGroupFor("B"), "lounge");
  assert.equal(api.chatGroupFor("C"), "players");
  assert.equal(api.chatGroupFor("S"), "lounge");
  assert.equal(api.canViewChatGroup("S", "players"), true);
  assert.equal(api.canViewChatGroup("B", "players"), true);
  assert.equal(api.canViewChatGroup("C", "lounge"), false);
  assert.equal(api.canChat("B"), false);
  assert.equal(api.canChat("C"), false);
  assert.equal(api.canChat("S"), false);

  api.setState(api.sanitizeSnapshot(baseSnapshot({ phase: "reveal", correct: { B: true } })));
  assert.equal(api.chatGroupFor("B"), "lounge");

  api.setState(api.sanitizeSnapshot(baseSnapshot({ phase: "countdown", correct: {} })));
  assert.equal(api.chatGroupFor("B"), "players");

  api.setState(api.freshState());
  assert.equal(api.canChat("B"), true);
});

test("participants and spectators can chat on the right during countdown", () => {
  const sent = [];
  const shownForHost = [];
  const hostApi = loadCatchMind();
  const state = hostApi.freshState();
  state.phase = "countdown";
  state.matchId = "match-countdown-chat";
  state.queue = ["A", "B"];
  state.spectators = ["S"];
  state.drawer = "A";
  state.guessers = ["B"];
  hostApi.setState(state);
  hostApi.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "S" }]; },
    showChat(nick, text, side) { shownForHost.push({ nick, text, side }); },
    send(message) { sent.push(message); }
  });

  hostApi.hostMatchChatInput({
    nick: "B",
    text: "곧 시작!",
    matchId: "match-countdown-chat",
    roundIndex: 0
  });
  hostApi.hostMatchChatInput({
    nick: "S",
    text: "구경 중",
    matchId: "match-countdown-chat",
    roundIndex: 0
  });

  assert.deepEqual(shownForHost, [{ nick: "B", text: "곧 시작!", side: "right" }]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].group, "players");
  assert.equal(sent[1].group, "lounge");

  const shownForSpectator = [];
  const spectatorApi = loadCatchMind();
  spectatorApi.setState(state);
  spectatorApi.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "S", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "S" }]; },
    showChat(nick, text, side) { shownForSpectator.push({ nick, text, side }); }
  });
  spectatorApi.receiveMatchChat(sent[0]);
  spectatorApi.receiveMatchChat(sent[1]);

  assert.deepEqual(shownForSpectator, [
    { nick: "B", text: "곧 시작!", side: "right" },
    { nick: "S", text: "구경 중", side: "right" }
  ]);
});

test("a solved player gets chat input and returns to the player group next turn", () => {
  const inputRow = fakeElement();
  const input = fakeElement();
  const emojiRow = fakeElement();
  inputRow.classList.add("hidden");
  emojiRow.classList.add("hidden");
  input.value = "";
  const sent = [];
  const api = loadCatchMind({
    elements: {
      "catch-input-row": inputRow,
      "catch-chat-input": input,
      "catch-emoji-row": emojiRow
    }
  });
  api.setApi({
    isHost() { return false; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    send(message) { sent.push(message); }
  });
  api.setState(api.sanitizeSnapshot(baseSnapshot({ correct: { B: true } })));

  api.renderControls();
  assert.equal(inputRow.classList.contains("hidden"), false);
  assert.equal(emojiRow.classList.contains("hidden"), false);
  assert.equal(input.disabled, false);
  assert.equal(input.placeholder, "관전자 · 정답자 채팅");

  input.value = "이제 같이 봐요";
  api.sendInput();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, "cm_group_input");
  assert.equal(sent[0].nick, "B");

  api.setState(api.sanitizeSnapshot(baseSnapshot({
    phase: "countdown",
    roundIndex: 1,
    drawer: "B",
    guessers: ["A", "C"],
    correct: {}
  })));
  api.renderControls();
  assert.equal(api.chatGroupFor("B"), "players");
  assert.equal(emojiRow.classList.contains("hidden"), true);
  assert.equal(input.placeholder, "참가자 채팅");
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

test("ready participants show a check in the waiting list", () => {
  const roleBox = fakeElement();
  const participantRow = fakeElement();
  const spectatorRow = fakeElement();
  const participantList = fakeElement();
  const spectatorList = fakeElement();
  const api = loadCatchMind({
    elements: {
      "catch-lobby-roles": roleBox,
      "catch-lobby-participant-row": participantRow,
      "catch-lobby-spectator-row": spectatorRow,
      "catch-lobby-participants": participantList,
      "catch-lobby-spectators": spectatorList,
      "catch-lobby-participant-count": fakeElement(),
      "catch-lobby-spectator-count": fakeElement()
    }
  });
  api.setApi({
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "S" }]; }
  });
  const waiting = api.freshState();
  waiting.ready = ["B"];
  waiting.spectators = ["S"];
  api.setState(waiting);

  api.renderLobbyRoles();

  assert.match(participantList.innerHTML, /<b>B<\/b>.*aria-label="레디">✓/);
  assert.doesNotMatch(spectatorList.innerHTML, /aria-label="레디"/);
});

test("the player strip follows game order before spectators", () => {
  const strip = fakeElement();
  const api = loadCatchMind({
    elements: {
      "catch-score-strip": strip
    }
  });
  api.setApi({
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() {
      return [
        { nick: "B", joinTs: 1 },
        { nick: "S", joinTs: 2 },
        { nick: "A", joinTs: 3 },
        { nick: "C", joinTs: 4 }
      ];
    }
  });
  api.setState(api.sanitizeSnapshot(baseSnapshot({
    queue: ["C", "A", "B"],
    spectators: ["S"],
    drawer: "C",
    guessers: ["A", "B"],
    scores: { C: 0, A: 99, B: 50 },
    stats: {
      C: { points: 0, maxPoints: 6, correct: 0, drawCorrect: 0 },
      A: { points: 99, maxPoints: 10, correct: 0, drawCorrect: 0 },
      B: { points: 50, maxPoints: 10, correct: 0, drawCorrect: 0 }
    }
  })));

  api.renderScores();

  assert.ok(strip.innerHTML.indexOf("<b>C</b>") < strip.innerHTML.indexOf("<b>A</b>"));
  assert.ok(strip.innerHTML.indexOf("<b>A</b>") < strip.innerHTML.indexOf("<b>B</b>"));
  assert.ok(strip.innerHTML.indexOf("<b>B</b>") < strip.innerHTML.indexOf("<b>S</b>"));
});

test("countdown stage uses the simple CatchMind progress design", () => {
  const stage = fakeElement();
  const kicker = fakeElement();
  const title = fakeElement();
  const sub = fakeElement();
  const copy = fakeElement();
  const steps = fakeElement();
  const marks = fakeElement();
  const actions = fakeElement();
  const start = fakeElement();
  const practice = fakeElement();
  steps.children = [fakeElement(), fakeElement(), fakeElement(), fakeElement(), fakeElement()];
  kicker.classList.add("hidden");
  copy.classList.add("hidden");
  steps.classList.add("hidden");
  marks.classList.add("hidden");
  const api = loadCatchMind({
    Date: { now() { return 1000; } },
    elements: {
      "catch-stage": stage,
      "catch-stage-kicker": kicker,
      "catch-stage-title": title,
      "catch-stage-sub": sub,
      "catch-countdown-copy": copy,
      "catch-countdown-steps": steps,
      "catch-stage-marks": marks,
      "catch-stage-actions": actions,
      "catch-start-btn": start,
      "catch-practice-btn": practice
    }
  });
  const state = api.freshState();
  state.phase = "countdown";
  state.matchId = "match-countdown-ui";
  state.queue = ["A", "B", "C"];
  state.drawer = "B";
  state.guessers = ["A", "C"];
  state.deadline = 6000;
  api.setState(state);

  api.renderStage();

  assert.equal(stage.classList.contains("countdown"), true);
  assert.equal(kicker.classList.contains("hidden"), false);
  assert.equal(marks.classList.contains("hidden"), true);
  assert.equal(copy.classList.contains("hidden"), false);
  assert.equal(steps.classList.contains("hidden"), false);
  assert.equal(kicker.textContent, "1/3");
  assert.equal(title.textContent, "B님의 그림 차례");
  assert.equal(sub.textContent, "5");
  assert.equal(copy.textContent, "그림을 준비해주세요");
  assert.equal(steps.children[0].classList.contains("active"), true);

  state.deadline = 2000;
  api.renderStage();

  assert.equal(sub.textContent, "1");
  assert.equal(copy.textContent, "곧 그림이 시작돼요");
  assert.equal(steps.children[0].classList.contains("passed"), true);
  assert.equal(steps.children[1].classList.contains("passed"), true);
  assert.equal(steps.children[2].classList.contains("passed"), true);
  assert.equal(steps.children[3].classList.contains("passed"), true);
  assert.equal(steps.children[4].classList.contains("active"), true);
});

test("round reveal clearly distinguishes all-correct and timeout outcomes", () => {
  const stage = fakeElement();
  const kicker = fakeElement();
  const title = fakeElement();
  const sub = fakeElement();
  const actions = fakeElement();
  const start = fakeElement();
  const practice = fakeElement();
  const api = loadCatchMind({
    elements: {
      "catch-stage": stage,
      "catch-stage-kicker": kicker,
      "catch-stage-title": title,
      "catch-stage-sub": sub,
      "catch-stage-actions": actions,
      "catch-start-btn": start,
      "catch-practice-btn": practice
    }
  });
  const state = api.freshState();
  state.phase = "reveal";
  state.revealWord = "사과";
  state.revealOutcome = "all-correct";
  api.setState(state);

  api.renderStage();

  assert.equal(stage.classList.contains("reveal"), true);
  assert.equal(stage.classList.contains("reveal-success"), true);
  assert.equal(stage.classList.contains("reveal-timeout"), false);
  assert.equal(kicker.textContent, "전원 정답");
  assert.equal(title.textContent, "모두 맞혔어요!");
  assert.equal(sub.textContent, "사과");

  state.revealOutcome = "timeout";
  api.renderStage();

  assert.equal(stage.classList.contains("reveal-success"), false);
  assert.equal(stage.classList.contains("reveal-timeout"), true);
  assert.equal(kicker.textContent, "시간 초과");
  assert.equal(title.textContent, "아쉽게 시간이 끝났어요");
  assert.equal(sub.textContent, "사과");
});

test("admin preview builds every CatchMind screen from real controller state", () => {
  const api = loadCatchMind();
  const roster = [
    "구나", "민서", "서준", "지우", "도윤", "하린", "유진", "현우", "수빈"
  ].map((nick, index) => ({ nick, joinTs: index + 1 }));
  api.setApi({
    me() { return { nick: "구나", isAdmin: true }; },
    roster() { return roster; },
    isHost() { return true; },
    host() { return "구나"; },
    setHostEligible() {},
    send() {},
    roomChanged() {}
  });

  assert.equal(api.normalizePreviewPhase("unknown"), "waiting");
  assert.ok(api.previewDrawing().length >= 8);

  assert.equal(api.setPreviewPhase("waiting"), "waiting");
  assert.equal(api.getState().phase, "idle");
  assert.deepEqual(Array.from(api.getState().spectators), ["수빈", "소연"]);

  api.setPreviewPhase("countdown");
  assert.equal(api.getState().phase, "countdown");
  assert.equal(api.getState().drawer, "구나");

  api.setPreviewPhase("drawing");
  assert.equal(api.getState().phase, "drawing");
  assert.equal(api.getState().drawer, "구나");
  assert.ok(api.getState().strokes.length > 0);

  api.setPreviewPhase("guessing");
  assert.equal(api.getState().drawer, "민서");
  assert.equal(api.getState().wordLength, 3);

  api.setPreviewPhase("solved");
  assert.equal(api.getState().correct["구나"], true);

  api.setPreviewPhase("paused");
  assert.equal(api.getState().pauseKind, "drawer");
  assert.ok(api.getState().pauseUntil > Date.now());

  api.setPreviewPhase("reveal-success");
  assert.equal(api.getState().revealOutcome, "all-correct");

  api.setPreviewPhase("reveal-timeout");
  assert.equal(api.getState().revealOutcome, "timeout");

  api.setPreviewPhase("finished");
  assert.equal(api.getState().phase, "finished");
  assert.equal(api.getState().resultRatings.length, 8);

  assert.equal(api.setPreviewPhase("result"), "result");
  assert.equal(api.getState().phase, "finished");

  assert.equal(api.setPreviewPhase("level-plates"), "level-plates");
  assert.equal(api.getState().phase, "drawing");
  assert.equal(api.getState().correct["서준"], true);

  for (const phase of ["mvp-vote", "xp-result", "xp-mvp", "xp-levelup"]) {
    assert.equal(api.setPreviewPhase(phase), phase);
    assert.equal(api.getState().phase, "finished");
  }
});

test("only the current drawer sees the word during the countdown", () => {
  const word = fakeElement();
  const api = loadCatchMind({ elements: { "catch-word": word } });
  const sharedApi = {
    isHost() { return true; },
    host() { return "A"; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; },
    send() {},
    roomChanged() {}
  };
  const state = api.freshState();
  state.phase = "countdown";
  state.matchId = "match-preview";
  state.queue = ["A", "B"];
  state.drawer = "B";
  state.guessers = ["A"];
  api.setState(state);
  api.setSecretWord("고양이");

  api.setApi(Object.assign({}, sharedApi, {
    me() { return { nick: "A", isAdmin: false }; }
  }));
  api.renderWord();
  assert.equal(word.textContent, "준비 중");

  api.setApi(Object.assign({}, sharedApi, {
    me() { return { nick: "B", isAdmin: false }; }
  }));
  api.renderWord();
  assert.equal(word.textContent, "고양이");
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
  assert.equal(sub.textContent, "");
  assert.equal(sub.classList.contains("hidden"), true);
  assert.equal(hostReady.classList.contains("hidden"), true);
  assert.equal(hostReadyText.textContent, "");
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
  assert.equal(stage.classList.contains("lobby-roles"), true);
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
  assert.equal(start.disabled, true);
  api.getState().ready = ["B"];
  api.renderStage();
  assert.equal(start.disabled, false);
  assert.equal(practice.classList.contains("hidden"), true);
  assert.equal(actions.classList.contains("hidden"), false);
});

test("finished stage keeps the next participant and spectator lists visible", () => {
  const roleBox = fakeElement();
  const participantRow = fakeElement();
  const spectatorRow = fakeElement();
  const participantList = fakeElement();
  const spectatorList = fakeElement();
  const participantCount = fakeElement();
  const spectatorCount = fakeElement();
  const api = loadCatchMind({
    elements: {
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
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() {
      return [
        { nick: "A", joinTs: 1 },
        { nick: "B", joinTs: 2 },
        { nick: "S", joinTs: 3 }
      ];
    }
  });
  api.setState(api.sanitizeSnapshot(baseSnapshot({
    phase: "finished",
    queue: ["A", "B"],
    spectators: ["S"],
    drawer: null,
    guessers: [],
    remainMs: null,
    scores: { A: 10, B: 0 },
    stats: {
      A: { points: 10, maxPoints: 10, correct: 1, drawCorrect: 0 },
      B: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 }
    }
  })));

  api.renderLobbyRoles();

  assert.equal(roleBox.classList.contains("hidden"), false);
  assert.equal(participantCount.textContent, 2);
  assert.equal(spectatorCount.textContent, 1);
  assert.match(participantList.innerHTML, /<b>A<\/b>/);
  assert.match(participantList.innerHTML, /<b>B<\/b>/);
  assert.match(spectatorList.innerHTML, /<b>S<\/b>/);
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
  assert.equal(api.getState().phase, "reveal");
  assert.equal(api.getState().revealOutcome, "all-correct");
});

test("a timed-out round stores a synchronized timeout reveal outcome", () => {
  const api = loadCatchMind();
  api.setState(api.sanitizeSnapshot(baseSnapshot()));
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    send() {},
    roomChanged() {},
    toast() {}
  });
  api.setSecretWord("사과");

  api.hostEndRound("시간이 끝났어요", "timeout");

  assert.equal(api.getState().phase, "reveal");
  assert.equal(api.getState().revealOutcome, "timeout");
  assert.equal(api.snapshot().revealOutcome, "timeout");
  assert.equal(api.sanitizeSnapshot(api.snapshot()).revealOutcome, "timeout");
});

test("match points reward speed in clear 15-second tiers", () => {
  const api = loadCatchMind();

  assert.equal(api.guessScoreForElapsed(0), 10);
  assert.equal(api.guessScoreForElapsed(14999), 10);
  assert.equal(api.guessScoreForElapsed(15000), 9);
  assert.equal(api.guessScoreForElapsed(44999), 8);
  assert.equal(api.guessScoreForElapsed(45000), 7);
  assert.equal(api.guessScoreForElapsed(74999), 6);
  assert.equal(api.guessScoreForElapsed(75000), 5);
  assert.equal(api.guessScoreForElapsed(api.limits.roundMs), 5);
  assert.equal(api.drawerScoreForGuess(10), 3);
  assert.equal(api.drawerScoreForGuess(8), 2);
  assert.equal(api.drawerScoreForGuess(5), 1);
});

test("rules explain rank-based season rating", () => {
  const content = loadCatchMind().rules();

  assert.equal(content.title, "캐치마인드 규칙");
  assert.match(content.html, /0~14초[\s\S]*10점[\s\S]*3점/);
  assert.match(content.html, /75~90초[\s\S]*5점[\s\S]*1점/);
  assert.match(content.html, /38초 뒤에 맞히면 정답자는 8점, 출제자는 2점/);
  assert.match(content.html, /최종 경기 점수 순위[\s\S]*상대의 시즌 점수/);
  assert.match(content.html, /단독 1등은 시즌 점수가 깎이지 않고 최소 1점/);
  assert.match(content.html, /활약도는[\s\S]*참고 통계/);
  assert.match(content.html, /틀린 답을 입력해도 점수는 깎이지 않아요/);
});

test("speed affects match score without changing season performance points", () => {
  const api = loadCatchMind();
  const now = Date.now();
  const state = api.freshState();
  state.phase = "drawing";
  state.matchId = "match-speed";
  state.queue = ["A", "B", "C"];
  state.drawer = "A";
  state.guessers = ["B", "C"];
  state.deadline = now + api.limits.roundMs - 50000;
  state.scores = { A: 0, B: 0, C: 0 };
  state.stats = {
    A: { points: 0, maxPoints: 6, correct: 0, drawCorrect: 0, fastestMs: null },
    B: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0, fastestMs: null },
    C: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0, fastestMs: null }
  };
  api.setState(state);
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    send() {},
    roomChanged() {},
    toast() {}
  });
  api.setSecretWord("사과");

  api.hostGuess({ nick: "B", text: "사과", matchId: "match-speed", roundIndex: 0 });

  const scored = api.getState();
  assert.equal(scored.scores.B, 7);
  assert.equal(scored.scores.A, 2);
  assert.equal(scored.stats.B.points, 10);
  assert.equal(scored.stats.A.points, 3);
  assert.equal(scored.stats.B.correct, 1);
  assert.equal(scored.stats.A.drawCorrect, 1);
  assert.match(scored.feed.find(item => item.kind === "correct").text, /\+7$/);
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

test("equal match scores share the same displayed place", () => {
  const api = loadCatchMind();
  const players = [{ score: 30 }, { score: 30 }, { score: 20 }];

  assert.equal(api.resultPlace(players, 0), 1);
  assert.equal(api.resultPlace(players, 1), 1);
  assert.equal(api.resultPlace(players, 2), 3);
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

test("the host can start only after every active participant is ready", () => {
  const sent = [];
  const toasts = [];
  const api = loadCatchMind();
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast(message) { toasts.push(message); }
  });

  api.hostStartMatch();
  assert.equal(api.getState().phase, "idle");
  assert.ok(toasts.some(message => message.includes("모두가 레디")));

  api.onMessage({ t: "cm_ready_req", from: "B", nick: "C", ready: true });
  assert.deepEqual(Array.from(api.getState().ready), []);

  api.onMessage({ t: "cm_ready_req", from: "B", nick: "B", ready: true });
  assert.deepEqual(Array.from(api.getState().ready), ["B"]);
  assert.equal(api.allParticipantsReady(), false);
  api.hostStartMatch();
  assert.equal(api.getState().phase, "idle");

  api.onMessage({ t: "cm_ready_req", from: "C", nick: "C", ready: true });
  assert.equal(api.allParticipantsReady(), true);
  api.hostStartMatch();

  assert.equal(api.getState().phase, "countdown");
  assert.deepEqual(Array.from(api.getState().queue), ["A", "B", "C"]);
  assert.deepEqual(Array.from(api.getState().ready), []);
  assert.ok(sent.some(message => message.t === "cm_state"));
});

test("participants see a ready action while spectators do not", () => {
  const stage = fakeElement();
  const kicker = fakeElement();
  const title = fakeElement();
  const sub = fakeElement();
  const actions = fakeElement();
  const start = fakeElement();
  const ready = fakeElement();
  const practice = fakeElement();
  start.classList.add("hidden");
  ready.classList.add("hidden");
  practice.classList.add("hidden");
  const api = loadCatchMind({
    elements: {
      "catch-stage": stage,
      "catch-stage-kicker": kicker,
      "catch-stage-title": title,
      "catch-stage-sub": sub,
      "catch-stage-actions": actions,
      "catch-start-btn": start,
      "catch-ready-btn": ready,
      "catch-practice-btn": practice
    }
  });
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }]; }
  });
  api.setState(api.freshState());

  api.renderStage();
  assert.equal(ready.classList.contains("hidden"), false);
  assert.equal(ready.textContent, "레디");
  assert.equal(ready.getAttribute("aria-pressed"), "false");

  api.getState().ready = ["B"];
  api.renderStage();
  assert.equal(ready.textContent, "레디 취소");
  assert.equal(ready.getAttribute("aria-pressed"), "true");

  api.getState().spectators = ["B"];
  api.renderStage();
  assert.equal(ready.classList.contains("hidden"), true);
});

test("away and role changes clear stale ready state", () => {
  let roster = [{ nick: "A" }, { nick: "B" }, { nick: "C" }];
  const api = loadCatchMind();
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return roster; },
    send() {},
    roomChanged() {},
    toast() {}
  });
  api.getState().ready = ["B", "C"];

  api.hostSetSpectatorPreference("B", true);
  assert.deepEqual(Array.from(api.getState().ready), ["C"]);

  roster = [{ nick: "A" }, { nick: "B" }, { nick: "C", away: true }];
  api.onPresence([], { becameHost: false });
  assert.deepEqual(Array.from(api.getState().ready), []);
});

test("a match uses a five-second ready phase, previews the word to the drawer, and draws for ninety seconds", () => {
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
  api.getState().ready = ["B"];
  api.hostStartMatch();
  assert.equal(api.getState().phase, "countdown");
  assert.ok(api.getState().deadline - beforeCountdown <= api.limits.countdownMs + 100);
  assert.equal(api.limits.countdownMs, 5000);
  const preview = sent.find(message => message.t === "cm_secret");
  assert.ok(preview);
  assert.equal(preview.to, "A");
  assert.equal(Object.prototype.hasOwnProperty.call(api.snapshot(), "word"), false);

  const beforeDrawing = Date.now();
  api.hostBeginDrawing();
  assert.equal(api.getState().phase, "drawing");
  assert.ok(api.getState().deadline - beforeDrawing >= api.limits.roundMs - 100);
  assert.ok(api.getState().deadline - beforeDrawing <= api.limits.roundMs + 100);
  assert.equal(sent.filter(message => message.t === "cm_secret").length, 2);
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
  assert.equal(api.getState().revealOutcome, "skipped");
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

test("spectators can say the exact answer inside the hidden lounge chat", () => {
  const api = loadCatchMind();
  const sent = [];
  const shown = [];
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "S" }]; },
    send(message) { sent.push(message); },
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
  api.setSecretWord("사과");

  api.hostSpectatorInput({ nick: "S", text: "사과", matchId: "match-a", roundIndex: 0 });
  const answerMessage = sent.find(message => message.t === "cm_group_chat" && message.text === "사과");
  assert.ok(answerMessage);
  assert.equal(answerMessage.nick, "S");
  assert.equal(answerMessage.group, "lounge");
  assert.equal(sent.some(message => message.t === "cm_notice"), false);

  api.hostSpectatorInput({ nick: "S", text: "멋진 그림", matchId: "match-a", roundIndex: 0 });
  const loungeMessage = sent.find(message => message.t === "cm_group_chat" && message.text === "멋진 그림");
  assert.ok(loungeMessage);
  assert.equal(loungeMessage.nick, "S");
  assert.equal(loungeMessage.group, "lounge");
  assert.deepEqual(shown, []);

  api.setState(api.sanitizeSnapshot(baseSnapshot({
    queue: ["A", "B"],
    drawer: "A",
    guessers: ["B"],
    correct: { B: true },
    scores: { A: 3, B: 10 },
    stats: {
      A: { points: 3, maxPoints: 3, correct: 0, drawCorrect: 1 },
      B: { points: 10, maxPoints: 10, correct: 1, drawCorrect: 0 }
    }
  })));
  api.hostMatchChatInput({ nick: "B", text: "관전자랑 대화", matchId: "match-a", roundIndex: 0 });
  const solvedMessage = sent.filter(message => message.t === "cm_group_chat").pop();
  assert.equal(solvedMessage.nick, "B");
  assert.equal(solvedMessage.group, "lounge");
});

test("spectators and solved players see lounge chat while active players do not", () => {
  const api = loadCatchMind();
  const shown = [];
  let mine = "S";
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: mine, isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }, { nick: "S" }]; },
    send() {},
    showChat(nick, text, overlaySide) { shown.push({ nick, text, overlaySide }); },
    roomChanged() {},
    toast() {}
  });
  api.applyState(baseSnapshot({
    queue: ["A", "B", "C"],
    drawer: "A",
    guessers: ["B", "C"],
    correct: { B: true },
    scores: { A: 0, B: 0, C: 0 },
    stats: {
      A: { points: 0, maxPoints: 6, correct: 0, drawCorrect: 0 },
      B: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 },
      C: { points: 0, maxPoints: 10, correct: 0, drawCorrect: 0 }
    }
  }));

  const message = {
    t: "cm_group_chat",
    from: "A",
    nick: "S",
    text: "멋진 그림",
    group: "lounge",
    matchId: "match-a",
    roundIndex: 0
  };

  api.onMessage(message);
  assert.deepEqual(shown, [{ nick: "S", text: "멋진 그림", overlaySide: "right" }]);

  mine = "B";
  api.onMessage(message);
  assert.equal(shown.length, 2);
  assert.deepEqual(shown[1], { nick: "S", text: "멋진 그림", overlaySide: "right" });

  mine = "C";
  api.onMessage(message);
  assert.equal(shown.length, 2);
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
  assert.equal(api.getState().revealOutcome, "skipped");
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
  assert.equal(api.getState().scores.C, 8);
  assert.equal(api.getState().stats.C.points, 10);
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

  api.getState().ready = ["B", "C", "D"];
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

test("the host can move other players between participant and spectator from the top strip", () => {
  const strip = fakeElement();
  const toasts = [];
  const sent = [];
  const api = loadCatchMind({ elements: { "catch-score-strip": strip } });
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() { return [{ nick: "A", joinTs: 1 }, { nick: "B", joinTs: 2 }, { nick: "C", joinTs: 3 }]; },
    send(message) { sent.push(message); },
    roomChanged() {},
    toast(message) { toasts.push(message); }
  });
  api.getState().ready = ["B"];
  api.renderScores();

  assert.match(strip.innerHTML, /data-catch-role-nick="B"/);
  assert.doesNotMatch(strip.innerHTML, /data-catch-role-nick="A"/);
  assert.equal(api.hostTogglePlayerRole("B"), true);
  assert.deepEqual(Array.from(api.getState().spectators), ["B"]);
  assert.deepEqual(Array.from(api.getState().ready), []);
  assert.equal(sent[sent.length - 1].t, "cm_role_ack");
  assert.equal(sent[sent.length - 1].to, "B");
  assert.equal(sent[sent.length - 1].spectating, true);
  assert.match(strip.innerHTML, /class="[^"]*spectator[^"]*host-manageable[^"]*"[^>]*data-catch-role-nick="B"/);
  assert.ok(toasts.some(message => message.includes("B님을 관전")));

  assert.equal(api.hostTogglePlayerRole("B"), true);
  assert.deepEqual(Array.from(api.getState().spectators), []);
  assert.equal(sent[sent.length - 1].spectating, false);
  assert.ok(toasts.some(message => message.includes("B님을 참가")));
  assert.equal(api.hostTogglePlayerRole("A"), false);

  api.getState().phase = "countdown";
  assert.equal(api.hostTogglePlayerRole("C"), false);
  assert.ok(toasts.some(message => message.includes("게임 시작 전이나 종료 후")));
});

test("non-hosts cannot use the host player role control", () => {
  const api = loadCatchMind();
  api.setApi({
    isHost() { return false; },
    host() { return "A"; },
    me() { return { nick: "B", isAdmin: false }; },
    roster() { return [{ nick: "A" }, { nick: "B" }, { nick: "C" }]; },
    send() {},
    roomChanged() {},
    toast() {}
  });

  assert.equal(api.hostTogglePlayerRole("C"), false);
  assert.deepEqual(Array.from(api.getState().spectators), []);
});

test("a host yields room authority when switching to spectator", () => {
  const eligibility = [];
  const toasts = [];
  const api = loadCatchMind();
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() {
      return [
        { nick: "A", joinTs: 1 },
        { nick: "B", joinTs: 2 },
        { nick: "S", joinTs: 3 }
      ];
    },
    setHostEligible(value) { eligibility.push(value); },
    send() {},
    roomChanged() {},
    toast(message) { toasts.push(message); }
  });
  api.getState().spectators = ["S"];

  api.toggleRolePreference();

  assert.deepEqual(Array.from(api.getState().spectators), ["S", "A"]);
  assert.equal(eligibility[eligibility.length - 1], false);
  assert.ok(toasts.some(message => message.includes("방장을 넘기고")));
});

test("spectators are never eligible to become CatchMind host", () => {
  const api = loadCatchMind();
  api.getState().spectators = ["B"];

  assert.equal(api.canHost("A"), true);
  assert.equal(api.canHost("B"), false);
});

test("a host cannot spectate without another willing participant", () => {
  const eligibility = [];
  const toasts = [];
  const api = loadCatchMind();
  api.setApi({
    isHost() { return true; },
    host() { return "A"; },
    me() { return { nick: "A", isAdmin: false }; },
    roster() {
      return [
        { nick: "A", joinTs: 1 },
        { nick: "S", joinTs: 2 }
      ];
    },
    setHostEligible(value) { eligibility.push(value); },
    send() {},
    roomChanged() {},
    toast(message) { toasts.push(message); }
  });
  api.getState().spectators = ["S"];

  api.toggleRolePreference();

  assert.deepEqual(Array.from(api.getState().spectators), ["S"]);
  assert.deepEqual(eligibility, []);
  assert.ok(toasts.some(message => message.includes("참가자가 한 명 이상")));
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

  api.getState().ready = ["B", "C"];
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
