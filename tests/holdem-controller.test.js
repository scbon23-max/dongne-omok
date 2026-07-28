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
  assert.equal(normalized.toCall, 100);
  assert.equal(normalized.legal.call.move, "call");
  assert.equal(normalized.smallBlind, 100);
  assert.equal(normalized.bigBlind, 200);
});

test("seat action tags fall back to the latest server action history", () => {
  const controller = loadController();
  const normalized = controller._test.normalizeSnapshot({
    phase: "turn",
    actionSeq: 9,
    seats: [
      { seat: 0, nick: "alice", stack: 9800, inHand: true },
      { seat: 1, nick: "bob", stack: 9900, inHand: true },
    ],
    actionHistory: [
      { seq: 8, seat: 0, action: "call", amount: 200 },
      { seq: 9, seat: 1, action: "check", amount: 0 },
    ],
  }, 8);

  controller._test.setState(normalized);

  assert.equal(normalized.actionHistory.at(-1).action, "check");
  assert.equal(normalized.seats[1].lastAction, "");
  assert.equal(controller._test.seatActionLabel(normalized.seats[1]), "체크");
  assert.equal(controller._test.seatActionClass(normalized.seats[1]), "action-check");
  assert.equal(controller._test.seatActionLabel(normalized.seats[0]), "");
});

test("seat action tags preserve latest bet and raise amounts from action history", () => {
  const controller = loadController();
  const normalized = controller._test.normalizeSnapshot({
    phase: "river",
    actionSeq: 12,
    seats: [
      { seat: 0, nick: "alice", stack: 8000, inHand: true },
      { seat: 1, nick: "bob", stack: 7000, inHand: true },
    ],
    actionHistory: [
      { seq: 12, seat: 0, action: "raise", amount: 2400 },
    ],
  }, 9);

  controller._test.setState(normalized);

  assert.equal(controller._test.seatActionLabel(normalized.seats[0]), "레이즈 2,400원");
});

test("central pot readout omits the side pot subline", () => {
  const controller = loadController();
  const base = {
    phase: "flop",
    pot: 700,
    pots: [{ amount: 300 }, { amount: 400 }],
    seats: [
      { seat: 0, nick: "alice", stack: 9700, totalBet: 300, inHand: true },
      { seat: 1, nick: "bob", stack: 9700, totalBet: 300, inHand: true },
      { seat: 2, nick: "chris", stack: 9900, totalBet: 100, inHand: true },
    ],
  };

  const waitingForCalls = controller._test.normalizeSnapshot(base, 8);
  assert.deepEqual(Array.from(waitingForCalls.sidePots), []);

  const allInCapped = controller._test.normalizeSnapshot({
    ...base,
    seats: base.seats.map((seat) => seat.seat === 2
      ? { ...seat, stack: 0, allIn: true }
      : seat),
  }, 9);
  assert.deepEqual(Array.from(allInCapped.sidePots), [400]);
  assert.doesNotMatch(indexSource, /id=["']holdem-side-pots["']/);
  assert.doesNotMatch(source, /setText\(["']holdem-side-pots["']/);
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

test("practice join request controls are present and normalized", () => {
  const controller = loadController("guest");
  const normalized = controller._test.normalizeSnapshot({
    phase: "preflop",
    mode: "ring",
    settings: { mode: "ring", assetBacked: false },
    seats: [
      { seat: 0, nick: "owner", stack: 20000 },
      { seat: 1, nick: "AI 1", isBot: true, botId: "bot-1", botPersonality: "tight_passive", stack: 20000 },
    ],
    pendingJoinRequests: [{
      nick: "guest",
      targetNick: "owner",
      requestedAt: 1_800_000_000_000,
      expiresAt: 1_800_000_060_000,
    }],
    newGameBuyInRequired: true,
  }, 14);

  assert.equal(normalized.practiceMode, true);
  assert.equal(normalized.newGameBuyInRequired, true);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.pendingJoinRequests)), [{
    nick: "guest",
    targetNick: "owner",
    requestedAt: 1_800_000_000_000,
    expiresAt: 1_800_000_060_000,
  }]);
  assert.match(indexSource, /id="holdem-join-request-btn"/);
  assert.match(indexSource, /id="holdem-join-request-alert"/);
  assert.match(source, /function requestPracticeJoin\(\)/);
  assert.match(source, /function resolvePracticeJoin\(accepted\)/);
  assert.match(source, /openBuyInDialog\("new_game", state\.heroSeat\)/);
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

test("completed all-in boards reveal flop, turn, and river in order", () => {
  const controller = loadController();
  let { state } = serverView();
  let guard = 0;
  while (["preflop", "flop", "turn", "river"].includes(state.phase)) {
    assert.ok(guard++ < 30);
    const actor = state.seats[state.actorSeat];
    const legal = Engine.legalActions(state, actor.nick);
    const action = legal.actions.includes("check") ? "check" : "call";
    state = Engine.command(state, { type: "act", nick: actor.nick, action }, {
      now: 300 + guard,
      randomInt: () => 0,
    }).state;
  }
  const snapshot = Engine.view(state, "alice");
  const completed = controller._test.normalizeSnapshot(snapshot, 21);
  assert.equal(completed.board.length, 5);
  controller._test.setState(Object.assign({}, completed, {
    phase: "flop",
    board: [],
    version: 20,
  }));

  const originalNow = Date.now;
  let now = 1_900_000_000_000;
  Date.now = () => now;
  try {
    assert.equal(controller._test.applySnapshot(snapshot, 21), true);
    assert.equal(controller._test.resultBoardVisibleCount(), 3);
    now += controller._test.constants.resultFinalActionMs +
      controller._test.constants.resultBoardRevealStepMs;
    assert.equal(controller._test.resultBoardVisibleCount(), 4);
    now += controller._test.constants.resultBoardRevealStepMs;
    assert.equal(controller._test.resultBoardVisibleCount(), 5);
  } finally {
    Date.now = originalNow;
  }
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
  const renderedAce = controller._test.cardHtml({ rank: "A", suit: "h" });
  assert.match(requestId, /^[A-Za-z0-9._:-]{1,100}$/);
  assert.match(renderedAce, /aria-label="하트 A"/);
  assert.match(renderedAce, /data-rank="A"/);
  assert.match(renderedAce, /holdem-card-rank-svg/);
  assert.match(renderedAce, /holdem-card-suit-svg/);
  assert.doesNotMatch(renderedAce, />A<\/span>/);
  const rankings = controller._test.handRankings();
  assert.equal(rankings.title, "홀덤 족보");
  assert.match(rankings.html, /로열 스트레이트 플러시/);
  assert.match(rankings.html, /holdem-card-rank-svg/);
  assert.match(rankings.html, /holdem-hand-row/);
  assert.match(rankings.html, /holdem-card empty/);
  assert.match(controller._test.cardHtml(null, "back"), /aria-label="비공개 카드"/);
});

test("ring refill status survives controller normalization", () => {
  const controller = loadController();
  let state = Engine.createTable({
    roomId: "room-controller",
    ownerNick: "alice",
    mode: "ring",
    startingStack: 10000,
    refillAmount: 10000,
    dailyRefillLimit: 3,
  });
  state = Engine.command(state, { type: "join", nick: "alice" }, {
    now: 1,
    randomInt: () => 0,
  }).state;
  state.seats[0].stack = 0;
  const snapshot = Engine.view(state, "alice");
  snapshot.ringRefill = {
    amount: 10000,
    dailyLimit: 3,
    usedToday: 1,
    remainingToday: 2,
    canRefill: true,
  };
  snapshot.canRefill = true;

  const normalized = controller._test.normalizeSnapshot(snapshot, 20);
  assert.equal(normalized.mode, "ring");
  assert.equal(normalized.refillAmount, 10000);
  assert.equal(normalized.dailyRefillLimit, 3);
  assert.equal(normalized.refillsUsedToday, 1);
  assert.equal(normalized.refillsRemainingToday, 2);
  assert.equal(normalized.refillStatusKnown, true);
  assert.equal(normalized.canRefill, true);
});

test("a busted ring player receives the free refill without opening a wallet dialog", async () => {
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      return Promise.resolve({
        ok: true,
        version: 2,
        snapshot: {
          phase: "hand_end",
          mode: "ring",
          handId: "7",
          canRefill: false,
          seats: [{ seat: 0, nick: "alice", stack: 20000 }],
        },
      });
    },
  };
  const controller = loadController("alice", { db });
  const state = controller._test.emptyState();
  state.mode = "ring";
  state.phase = "complete";
  state.version = 1;
  state.handId = "7";
  state.heroSeat = 0;
  state.seats[0] = { seat: 0, nick: "alice", stack: 0 };
  state.canRefill = true;
  state.refillAmount = 20000;
  controller._test.setState(state);
  controller._test.setActive(true);
  controller._test.setHasSnapshot(true);

  controller._test.maybeAutoOpenRebuyDialog();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls.map((call) => call.action), ["refill"]);
  assert.equal(calls[0].payload.expectedVersion, 1);
  controller.leave();
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

test("join requests can carry the selected ring buy-in", async () => {
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      return Promise.resolve({
        ok: true,
        version: 1,
        snapshot: { phase: "waiting", seats: [{ seat: payload.seat, nick: auth.nick, stack: payload.buyIn }] },
      });
    },
  };
  const controller = loadController("alice", { db });
  controller._test.setActive(true);

  await controller._test.joinTable(3, 30000);

  assert.equal(calls[0].action, "join");
  assert.equal(calls[0].payload.seat, 3);
  assert.equal(calls[0].payload.buyIn, 30000);
});

test("spectators automatically claim the first open table seat", async () => {
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      return Promise.resolve({
        ok: true,
        version: 2,
        snapshot: {
          phase: "waiting",
          seats: [
            { seat: payload.seat, nick: auth.nick, stack: 20000 },
            { seat: 1, nick: "bob", stack: 20000 },
          ],
        },
      });
    },
  };
  const controller = loadController("alice", { db });
  const state = controller._test.emptyState();
  state.phase = "waiting";
  state.version = 1;
  state.heroSeat = -1;
  state.seats[1] = { seat: 1, nick: "bob", stack: 20000 };
  controller._test.setState(state);
  controller._test.setActive(true);
  controller._test.setHasSnapshot(true);

  controller._test.maybeAutoSeatJoin();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls[0].action, "join");
  assert.equal(calls[0].payload.seat, 0);
});

test("switching to spectate leaves the current table seat", async () => {
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      return Promise.resolve({
        ok: true,
        version: 2,
        snapshot: { phase: "waiting", seats: [] },
      });
    },
  };
  const controller = loadController("alice", { db });
  const state = controller._test.emptyState();
  state.phase = "waiting";
  state.version = 1;
  state.heroSeat = 0;
  state.seats[0] = { seat: 0, nick: "alice", stack: 20000 };
  controller._test.setState(state);
  controller._test.setActive(true);
  controller._test.setHasSnapshot(true);

  await controller._test.leaveTableForSpectate();

  assert.equal(calls[0].action, "leave");
  assert.equal(calls[0].payload.expectedVersion, 1);
});

test("ring rebuys use a separate wallet-backed server command", async () => {
  const calls = [];
  const db = {
    getHoldemWallet(auth) {
      calls.push({ auth, action: "wallet", payload: {} });
      return Promise.resolve({ ok: true, wallet: { balance: 40000, tableBalance: 0, totalAssets: 40000 } });
    },
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      return Promise.resolve({ ok: true, version: 2, snapshot: { phase: "waiting", seats: [] } });
    },
  };
  const controller = loadController("alice", { db });
  const state = controller._test.emptyState();
  state.mode = "ring";
  state.phase = "complete";
  state.version = 1;
  state.heroSeat = 0;
  state.seats[0] = { seat: 0, nick: "alice", stack: 0 };
  state.buyInMin = 10000;
  state.buyInMax = 50000;
  state.buyInDefault = 30000;
  controller._test.setState(state);
  controller._test.setActive(true);

  controller._test.openBuyInDialog("rebuy", 0);
  await Promise.resolve();
  await Promise.resolve();
  controller._test.confirmBuyInDialog();

  assert.equal(calls[0].action, "wallet");
  assert.equal(calls[1].action, "rebuy");
  assert.equal(calls[1].payload.amount, 30000);
});

test("bot add requests can target a clicked empty seat without choosing a personality", async () => {
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      return Promise.resolve({
        ok: true,
        version: 2,
        snapshot: null,
      });
    },
  };
  const controller = loadController("alice", { db });
  const state = controller._test.emptyState();
  state.phase = "waiting";
  state.version = 1;
  state.ownerNick = "alice";
  state.heroSeat = 1;
  state.canManageBots = true;
  state.seats[1] = { seat: 1, nick: "alice", stack: 20000, ready: true };
  controller._test.setState(state);
  controller._test.setActive(true);

  await controller._test.addBot({ seat: 4, silent: true });
  controller.leave();

  assert.equal(calls[0].action, "add_bot");
  assert.equal(calls[0].payload.seat, 4);
  assert.equal(Object.hasOwn(calls[0].payload, "botPersonality"), false);
  assert.equal(Object.hasOwn(calls[0].payload, "personality"), false);
});

test("the page loads the strong AI before the controller and exposes exact personality names", () => {
  const aiScriptIndex = indexSource.indexOf('{ src: "holdem-ai.js" }');
  const controllerScriptIndex = indexSource.indexOf('{ src: "holdem.js" }');
  assert.ok(aiScriptIndex >= 0, "holdem-ai.js is present in the asset list");
  assert.ok(controllerScriptIndex > aiScriptIndex, "holdem-ai.js loads before holdem.js");

  [
    "holdem-bot-controls",
    "holdem-bot-add-btn",
    "holdem-bot-fill-btn",
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
  assert.match(source, /function addFiveBots\(\)/);
  assert.match(source, /5 - state\.botCount/);
  assert.match(source, /id === "holdem-bot-fill-btn"[\s\S]*addFiveBots\(\)/);

  const addBotFunction = source.match(
    /function addBot\([^)]*\)\s*\{([\s\S]*?)\r?\n  \}\r?\n\r?\n  function chooseEmptySeat/,
  );
  assert.ok(addBotFunction, "addBot exists");
  assert.match(addBotFunction[1], /var payload = \{[\s\S]*expectedVersion\s*:/);
  assert.match(addBotFunction[1], /if \(seat >= 0\) payload\.seat = seat/);
  assert.match(addBotFunction[1], /invoke\("add_bot",\s*payload,/);
  assert.doesNotMatch(addBotFunction[1], /difficulty|level|personality/i);
});

test("the bot-step request sends only optimistic-lock turn coordinates", () => {
  const requestFunction = source.match(
    /function requestBotStep\(key\)\s*\{([\s\S]*?)\r?\n  \}\r?\n\r?\n  function scheduleBotStep/,
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
