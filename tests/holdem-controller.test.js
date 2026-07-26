"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Engine = require("../holdem-engine.js");

const source = fs.readFileSync(path.join(__dirname, "..", "holdem.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function loadController(nick = "alice", options = {}) {
  const window = { __HOLDEM_TEST__: true };
  const context = {
    window,
    Db: options.db,
    console,
    Intl,
    Date,
    Math,
    Number,
    Object,
    Array,
    String,
    RegExp,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  if (options.db) window.Db = options.db;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "holdem.js" });
  window.TexasHoldem._test.setApi({
    me: () => ({ nick }),
    roomId: () => "room-controller",
    galleryAuth: () => ({ nick, hash: "a".repeat(64) }),
  });
  return window.TexasHoldem;
}

function serverView() {
  let state = Engine.createTable({
    roomId: "room-controller",
    ownerNick: "alice",
  });
  const ctx = { now: 100, randomInt: () => 0 };
  for (const nick of ["alice", "bob"]) {
    state = Engine.command(state, { type: "join", nick }, ctx).state;
    state = Engine.command(state, { type: "ready", nick, ready: true }, ctx).state;
  }
  state = Engine.command(state, { type: "start", nick: "alice" }, ctx).state;
  return { state, snapshot: Engine.view(state, "alice") };
}

function serverBotViews() {
  const now = 1_800_000_000_000;
  const ctx = { now, randomInt: () => 0 };
  let state = Engine.createTable({
    roomId: "room-controller",
    ownerNick: "alice",
  });
  const commands = [
    { type: "join", nick: "alice", seat: 1 },
    { type: "add_bot", nick: "alice", seat: 0 },
    { type: "ready", nick: "alice", ready: true },
  ];
  for (const command of commands) {
    const result = Engine.command(state, command, ctx);
    assert.equal(result.ok, true, result.reason);
    state = result.state;
  }
  const waiting = Engine.view(state, "alice");
  const started = Engine.command(state, { type: "start", nick: "alice" }, ctx);
  assert.equal(started.ok, true, started.reason);
  state = started.state;
  state.actionSeq = 17;
  const playing = Engine.view(state, "alice");
  return { waiting, playing };
}

test("the controller consumes the engine's personalized snapshot contract", () => {
  const controller = loadController();
  const { state, snapshot } = serverView();
  const normalized = controller._test.normalizeSnapshot(snapshot, 7);

  assert.equal(normalized.version, 7);
  assert.equal(normalized.phase, "preflop");
  assert.equal(normalized.heroSeat, 0);
  assert.equal(normalized.actingSeat, state.actorSeat);
  assert.equal(normalized.heroCards.length, 2);
  assert.equal(normalized.seats[1].cardCount, 2);
  assert.equal(normalized.seats[state.smallBlindSeat].lastAction, "small_blind");
  assert.equal(normalized.seats[state.bigBlindSeat].lastAction, "big_blind");
  assert.equal(normalized.toCall, 50);
  assert.equal(normalized.legal.call.move, "call");
  assert.equal(normalized.smallBlind, 50);
  assert.equal(normalized.bigBlind, 100);
});

test("engine bot metadata and turn-coordination fields survive controller normalization", () => {
  const controller = loadController();
  const { waiting, playing } = serverBotViews();

  const waitingNormalized = controller._test.normalizeSnapshot(waiting, 12);
  assert.equal(waiting.canManageBots, true);
  assert.equal(waitingNormalized.canManageBots, true);
  assert.equal(waitingNormalized.botCount, 1);
  assert.equal(waitingNormalized.seats[0].isBot, true);
  assert.equal(waitingNormalized.seats[0].botId, "bot-1");
  assert.equal(waitingNormalized.seats[0].botPersonality, "tight_passive");

  const playingNormalized = controller._test.normalizeSnapshot(playing, 13);
  assert.equal(playing.actorIsBot, true);
  assert.equal(playingNormalized.actingSeat, 0);
  assert.equal(playingNormalized.actorIsBot, true);
  assert.equal(playingNormalized.botDueAt, playing.botDueAt);
  assert.equal(playingNormalized.actionSeq, 17);
  assert.equal(playingNormalized.canManageBots, false);
  assert.equal(playingNormalized.seats[0].isBot, true);
  assert.equal(playingNormalized.seats[0].botId, "bot-1");
  assert.equal(playingNormalized.seats[0].botPersonality, "tight_passive");
});

test("hand-end snapshots map to the completed UI and expose only server showdown cards", () => {
  const controller = loadController();
  let { state } = serverView();
  let guard = 0;
  while (["preflop", "flop", "turn", "river"].includes(state.phase)) {
    assert.ok(guard++ < 30);
    const actor = state.seats[state.actorSeat];
    const legal = Engine.legalActions(state, actor.nick);
    const action = legal.actions.includes("check") ? "check" : "call";
    state = Engine.command(state, { type: "act", nick: actor.nick, action }, {
      now: 200 + guard,
      randomInt: () => 0,
    }).state;
  }
  const snapshot = Engine.view(state, "alice");
  const normalized = controller._test.normalizeSnapshot(snapshot, 9);
  assert.equal(normalized.phase, "complete");
  assert.equal(normalized.revealedCards[1].length, 2);
  assert.ok(normalized.winners.length >= 1);
  assert.ok(normalized.showdown.some((row) => row.handName));
});

test("the completed UI receives an AI winner's cards even without a showdown", () => {
  const controller = loadController();
  const ctx = { now: 1_800_000_000_000, randomInt: () => 0 };
  let state = Engine.createTable({
    roomId: "room-controller",
    ownerNick: "alice",
  });
  for (const command of [
    { type: "join", nick: "alice" },
    { type: "add_bot", nick: "alice" },
    { type: "ready", nick: "alice", ready: true },
    { type: "start", nick: "alice" },
  ]) {
    const result = Engine.command(state, command, ctx);
    assert.equal(result.ok, true, result.reason);
    state = result.state;
  }
  const bot = state.seats.find((seat) => seat && seat.isBot);
  const owner = state.seats[state.actorSeat];
  assert.equal(owner.nick, "alice");
  state = Engine.command(state, {
    type: "act",
    nick: owner.nick,
    action: "fold",
  }, ctx).state;

  const snapshot = Engine.view(state, "alice");
  assert.equal(snapshot.showdown.some((entry) => entry.seat === bot.seat), true);
  const normalized = controller._test.normalizeSnapshot(snapshot, 14);
  assert.equal(normalized.phase, "complete");
  assert.equal(normalized.revealedCards[bot.seat].length, 2);
  assert.equal(normalized.showdown.some((entry) => entry.seat === bot.seat && entry.testReveal), true);
});

test("completed AI tables are immediately eligible for automatic next hand", () => {
  const controller = loadController();
  const ctx = { now: 1_800_000_000_000, randomInt: () => 0 };
  let state = Engine.createTable({
    roomId: "room-controller",
    ownerNick: "alice",
  });
  for (const command of [
    { type: "join", nick: "alice" },
    { type: "add_bot", nick: "alice" },
    { type: "ready", nick: "alice", ready: true },
    { type: "start", nick: "alice" },
  ]) {
    const result = Engine.command(state, command, ctx);
    assert.equal(result.ok, true, result.reason);
    state = result.state;
  }

  const actor = state.seats[state.actorSeat];
  assert.equal(actor.nick, "alice");
  state = Engine.command(state, {
    type: "act",
    nick: actor.nick,
    action: "fold",
  }, ctx).state;

  const snapshot = Engine.view(state, "alice");
  assert.equal(snapshot.canStart, true);
  assert.equal(snapshot.canNext, true);
  const normalized = controller._test.normalizeSnapshot(snapshot, 15);
  assert.equal(normalized.phase, "complete");
  assert.equal(normalized.heroReady, true);
  assert.equal(normalized.canNext, true);
});

test("public refresh messages are treated only as invalidation hints", () => {
  const controller = loadController();
  controller._test.setActive(false);
  const handled = controller.onMessage({
    t: "holdem_refresh",
    version: 99,
    snapshot: { deck: ["As"], seats: [{ cards: ["Ah", "Ad"] }] },
    cards: ["Kh", "Kd"],
  });
  assert.equal(handled, true);
  assert.equal(controller._test.getRawSnapshot(), null);
});

test("request ids and rendered cards stay bounded and accessible", () => {
  const controller = loadController();
  const requestId = controller._test.requestId("move", "7:hand:2");
  assert.match(requestId, /^[A-Za-z0-9._:-]{1,100}$/);
  assert.match(controller._test.cardHtml({ rank: "A", suit: "h" }), /aria-label="하트 A"/);
  assert.match(controller._test.cardHtml(null, "back"), /aria-label="비공개 카드"/);
});

test("an in-flight join cannot leak an old-room snapshot and cleans its seat after exit", async () => {
  let resolveJoin;
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      if (action === "join") {
        return new Promise((resolve) => { resolveJoin = resolve; });
      }
      return Promise.resolve({ ok: true, version: 2, snapshot: null });
    },
  };
  const controller = loadController("alice", { db });
  controller._test.setActive(true);
  const generation = controller._test.getLifecycleGeneration();
  const pending = controller._test.invoke("join", {}, {
    key: "join",
    broadcast: true,
  });

  controller.leave();
  assert.ok(controller._test.getLifecycleGeneration() > generation);
  resolveJoin({
    ok: true,
    version: 1,
    snapshot: { phase: "waiting", seats: [{ seat: 0, nick: "alice" }] },
  });

  const result = await pending;
  await Promise.resolve();
  assert.equal(result.stale, true);
  assert.equal(controller._test.getRawSnapshot(), null);
  assert.deepEqual(calls.map((call) => call.action), ["join", "leave"]);
  assert.equal(calls[1].payload.roomId, "room-controller");
});

test("join requests can carry a preferred seat", async () => {
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      return Promise.resolve({
        ok: true,
        version: 1,
        snapshot: { phase: "waiting", seats: [{ seat: payload.seat, nick: auth.nick }] },
      });
    },
  };
  const controller = loadController("alice", { db });
  controller._test.setActive(true);

  await controller._test.joinTable(4);

  assert.equal(calls[0].action, "join");
  assert.equal(calls[0].payload.seat, 4);
});

test("the page loads the strong AI before the controller and exposes exact personality names", () => {
  const aiScriptIndex = indexSource.indexOf('{ src: "holdem-ai.js" }');
  const controllerScriptIndex = indexSource.indexOf('{ src: "holdem.js" }');
  assert.ok(aiScriptIndex >= 0, "holdem-ai.js is present in the asset list");
  assert.ok(controllerScriptIndex > aiScriptIndex, "holdem-ai.js loads before holdem.js");

  [
    "holdem-bot-controls",
    "holdem-bot-add-btn",
    "holdem-bot-remove-btn",
    "holdem-bot-count",
    "holdem-bot-note",
  ].forEach((id) => {
    assert.match(indexSource, new RegExp(`id=["']${id}["']`), `${id} exists`);
  });
  assert.doesNotMatch(indexSource, /id=["']holdem-bot-difficulty["']/);
  assert.doesNotMatch(
    indexSource,
    /<select[^>]+aria-label=["']추가할 AI 난이도["']/,
  );
  assert.match(indexSource, /class=["']holdem-bot-title["']>AI 상대</);
  for (const label of [
    "타이트 패시브",
    "타이트 어그레시브",
    "루즈 패시브",
    "루즈 어그레시브",
  ]) {
    assert.match(source + indexSource, new RegExp(label));
  }
  assert.doesNotMatch(source, /botDifficulty|botLevel/);

  const addBotFunction = source.match(
    /function addBot\(\)\s*\{([\s\S]*?)\n  \}\n\n  function removeBot/,
  );
  assert.ok(addBotFunction, "addBot exists");
  const addInvoke = addBotFunction[1].match(
    /invoke\("add_bot",\s*\{([\s\S]*?)\}\s*,\s*\{/,
  );
  assert.ok(addInvoke, "addBot invokes add_bot");
  assert.match(addInvoke[1], /expectedVersion\s*:/);
  assert.doesNotMatch(addInvoke[1], /difficulty|level|personality/i);
});

test("the bot-step request sends only optimistic-lock turn coordinates", () => {
  const requestFunction = source.match(
    /function requestBotStep\(key\)\s*\{([\s\S]*?)\n  \}\n\n  function scheduleBotStep/,
  );
  assert.ok(requestFunction, "requestBotStep exists");
  const invokeMatch = requestFunction[1].match(
    /invoke\("bot_step",\s*\{([\s\S]*?)\}\s*,\s*\{/,
  );
  assert.ok(invokeMatch, "requestBotStep invokes bot_step with an object payload");

  const payloadSource = invokeMatch[1];
  const payloadKeys = Array.from(
    payloadSource.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g),
    (match) => match[1],
  );
  assert.deepEqual(payloadKeys, ["expectedVersion", "handId", "actionSeq"]);
  assert.doesNotMatch(payloadSource, /\b(?:move|amount)\s*:/);
});
