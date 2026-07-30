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
  const window = { __HOLDEM_TEST__: true, HoldemEngine: Engine };
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
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    setInterval,
    clearInterval,
  };
  if (options.document) {
    context.document = options.document;
    window.document = options.document;
  }
  if (options.localStorage) {
    context.localStorage = options.localStorage;
    window.localStorage = options.localStorage;
  }
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

function fakeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : !!force;
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function fakeElement(initialClasses = []) {
  return {
    classList: fakeClassList(initialClasses),
    dataset: {},
    attributes: {},
    children: [],
    parentNode: null,
    textContent: "",
    innerHTML: "",
    disabled: false,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, before) {
      child.parentNode = this;
      const index = this.children.indexOf(before);
      if (index >= 0) this.children.splice(index, 0, child);
      else this.children.push(child);
      return child;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function resultTestDocument() {
  const elements = {
    holdemgame: fakeElement(),
    "holdem-seats": fakeElement(),
    "holdem-board": fakeElement(),
    "holdem-pot-amount": fakeElement(),
    "holdem-result-pot": fakeElement(),
    "holdem-result": fakeElement(["hidden"]),
    "holdem-table-start-btn": fakeElement(["hidden"]),
    "holdem-fold-reveal-panel": fakeElement(["hidden"]),
  };
  return {
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
      createElement() {
        return fakeElement();
      },
    },
    elements,
  };
}

function renderedFaceCards(html) {
  const cards = [];
  const pattern = /<span class="holdem-card ([^"]*)" data-suit="([cdhs])" data-rank="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    cards.push({
      code: (match[3] === "10" ? "T" : match[3]) + match[2],
      classes: new Set(match[1].trim().split(/\s+/).filter(Boolean)),
    });
  }
  return cards;
}

function renderedCodesWithClass(html, className) {
  return renderedFaceCards(html)
    .filter((card) => card.classes.has(className))
    .map((card) => card.code)
    .sort();
}

function controlTestDocument() {
  const ids = [
    "holdemgame",
    "holdem-board",
    "holdem-action-panel",
    "holdem-solo-bot-fill-panel",
    "holdem-solo-bot-fill-btn",
    "holdem-pre-action-panel",
    "holdem-fold-btn",
    "holdem-check-btn",
    "holdem-call-btn",
    "holdem-pre-fold-btn",
    "holdem-pre-check-btn",
    "holdem-pre-call-btn",
    "holdem-pre-call-amount",
    "holdem-bet-btn",
    "holdem-raise-btn",
    "holdem-allin-btn",
    "holdem-raise-panel",
    "holdem-call-amount",
    "holdem-action-label",
    "holdem-hand-name",
    "holdem-lobby",
    "holdem-seat-controls",
    "holdem-bot-controls",
    "holdem-bot-note",
    "holdem-bot-count",
    "holdem-bot-add-btn",
    "holdem-bot-fill-btn",
    "holdem-bot-remove-btn",
    "holdem-table-start-btn",
    "holdem-ready-btn",
    "holdem-start-btn",
    "holdem-refill-panel",
    "holdem-refill-btn",
    "holdem-refill-status",
    "holdem-emoji-toggle",
    "holdem-emoji-panel",
    "holdem-connection",
    "holdem-status",
  ];
  const elements = {};
  ids.forEach((id) => {
    elements[id] = fakeElement(
      id === "holdem-action-panel" ||
      id === "holdem-pre-action-panel" ||
      id === "holdem-solo-bot-fill-panel" ? ["hidden"] : []
    );
  });
  elements.holdemgame.querySelectorAll = () => [];
  return {
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
      createElement() {
        return fakeElement();
      },
    },
    elements,
  };
}

function profileTopUpTestDocument() {
  const ids = [
    "holdemgame",
    "holdem-profile-backdrop",
    "holdem-profile-nick",
    "holdem-profile-title",
    "holdem-profile-avatar-preview",
    "holdem-profile-avatar-remove",
    "holdem-profile-wallet-label",
    "holdem-profile-wallet-balance",
    "holdem-profile-wallet-status",
    "holdem-profile-asset-record-btn",
    "holdem-profile-role-action",
    "holdem-profile-topup",
    "holdem-profile-topup-current",
    "holdem-profile-topup-max",
    "holdem-profile-topup-amount",
    "holdem-profile-topup-slider",
    "holdem-profile-topup-status",
    "holdem-profile-topup-confirm",
  ];
  const elements = {};
  ids.forEach((id) => {
    elements[id] = fakeElement(
      id === "holdem-profile-backdrop" || id === "holdem-profile-topup"
        ? ["hidden"]
        : []
    );
  });
  return {
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
      createElement() {
        return fakeElement();
      },
    },
    elements,
  };
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

test("reserved leave state is kept for seat display", () => {
  const controller = loadController();
  const normalized = controller._test.normalizeSnapshot({
    phase: "flop",
    seats: [
      { seat: 0, nick: "alice", stack: 9800, leaving: true },
      { seat: 1, nick: "bob", stack: 9900 },
    ],
  }, 8);

  assert.equal(normalized.seats[0].leaving, true);
  assert.equal(normalized.seats[1].leaving, false);
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

test("seat action tags show all-in amounts from action history", () => {
  const controller = loadController();
  const normalized = controller._test.normalizeSnapshot({
    phase: "turn",
    actionSeq: 13,
    seats: [
      { seat: 0, nick: "alice", stack: 0, inHand: true, allIn: true },
      { seat: 1, nick: "bob", stack: 7000, inHand: true },
    ],
    actionHistory: [
      { seq: 13, seat: 0, action: "allin", amount: 2400 },
    ],
  }, 10);

  controller._test.setState(normalized);

  assert.equal(controller._test.seatActionLabel(normalized.seats[0]), "올인 2,400원");
});

test("a move shows its local action tag immediately and clears it after rejection", async () => {
  let finishAction;
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      return new Promise((resolve) => {
        finishAction = resolve;
      });
    },
  };
  const controller = loadController("alice", { db });
  const state = controller._test.emptyState();
  state.version = 7;
  state.phase = "flop";
  state.handId = "12";
  state.handNumber = 12;
  state.heroSeat = 0;
  state.perspectiveSeat = 0;
  state.actingSeat = 0;
  state.legal = { raise: true };
  state.seats[0] = {
    seat: 0,
    nick: "alice",
    displayName: "alice",
    stack: 9600,
    bet: 400,
    lastAction: "",
  };
  controller._test.setState(state);
  controller._test.setActive(true);

  const resultPromise = controller._test.performMove("raise", 1200);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "act");
  assert.equal(calls[0].payload.move, "raise");
  assert.equal(controller._test.getPendingMove().amount, 1200);
  assert.equal(controller._test.seatActionLabel(state.seats[0]), "레이즈 1,200원");
  assert.match(controller._test.seatActionClass(state.seats[0]), /\bis-pending\b/);

  finishAction({
    ok: false,
    reason: "stale",
    version: 7,
    snapshot: null,
  });
  const result = await resultPromise;

  assert.equal(result.ok, false);
  assert.equal(controller._test.getPendingMove(), null);
  assert.equal(controller._test.seatActionLabel(state.seats[0]), "");
  controller.leave();
});

test("server confirmation does not replay an already animated local action tag", async () => {
  let finishAction;
  const harness = resultTestDocument();
  const db = {
    holdemInvoke() {
      return new Promise((resolve) => {
        finishAction = resolve;
      });
    },
  };
  const controller = loadController("alice", {
    db,
    document: harness.document,
  });
  const state = controller._test.emptyState();
  state.version = 7;
  state.phase = "flop";
  state.handId = "12";
  state.handNumber = 12;
  state.actionSeq = 4;
  state.heroSeat = 0;
  state.perspectiveSeat = 0;
  state.actingSeat = 0;
  state.toCall = 200;
  state.legal = { call: true };
  state.seats[0] = {
    seat: 0,
    nick: "alice",
    displayName: "alice",
    stack: 9600,
    bet: 400,
    inHand: true,
    lastAction: "",
  };
  state.seats[1] = {
    seat: 1,
    nick: "bob",
    displayName: "bob",
    stack: 9400,
    bet: 600,
    inHand: true,
    lastAction: "raise",
  };
  controller._test.setState(state);
  controller._test.setHasSnapshot(true);
  controller._test.setActive(true);

  const resultPromise = controller._test.performMove("call");
  assert.match(harness.elements["holdem-seats"].innerHTML, /\baction-call is-pending is-action-enter\b/);

  finishAction({
    ok: true,
    version: 8,
    snapshot: {
      phase: "flop",
      handId: "12",
      handNo: 12,
      actionSeq: 5,
      actorSeat: 1,
      seats: [
        {
          seat: 0,
          nick: "alice",
          displayName: "alice",
          stack: 9400,
          streetBet: 600,
          totalBet: 600,
          inHand: true,
          lastAction: "call",
        },
        {
          seat: 1,
          nick: "bob",
          displayName: "bob",
          stack: 9400,
          streetBet: 600,
          totalBet: 600,
          inHand: true,
          lastAction: "raise",
        },
      ],
      viewer: {
        seat: 0,
        cards: [],
        legalActions: { actions: [] },
      },
      actionHistory: [
        {
          seq: 5,
          handNo: 12,
          phase: "flop",
          seat: 0,
          nick: "alice",
          action: "call",
          amount: 600,
        },
      ],
    },
  });
  const result = await resultPromise;

  assert.equal(result.ok, true);
  assert.match(harness.elements["holdem-seats"].innerHTML, /\baction-call\b/);
  assert.doesNotMatch(harness.elements["holdem-seats"].innerHTML, /\bis-pending\b/);
  assert.doesNotMatch(harness.elements["holdem-seats"].innerHTML, /\bis-action-enter\b/);
  controller.leave();
});

test("local action reconciliation covers every poker action without hiding mismatches", () => {
  const controller = loadController();
  const matches = controller._test.pendingMoveMatchesActionEntry;
  const snapshot = { handId: "12", handNumber: 12 };
  const cases = [
    { action: "check", pendingAmount: 0, confirmedAmount: 0 },
    { action: "fold", pendingAmount: 0, confirmedAmount: 400 },
    { action: "call", pendingAmount: 600, confirmedAmount: 600 },
    { action: "bet", pendingAmount: 800, confirmedAmount: 800 },
    { action: "raise", pendingAmount: 1200, confirmedAmount: 1200 },
    { action: "allin", pendingAmount: 9600, confirmedAmount: 9600 },
  ];

  cases.forEach(({ action, pendingAmount, confirmedAmount }) => {
    assert.equal(matches(
      {
        seat: 0,
        action,
        amount: pendingAmount,
        actionSeq: 4,
        handId: "12",
      },
      {
        seat: 0,
        action,
        amount: confirmedAmount,
        seq: 5,
      },
      snapshot,
    ), true, action);
  });

  assert.equal(matches(
    { seat: 0, action: "call", amount: 600, actionSeq: 4, handId: "12" },
    { seat: 0, action: "allin", amount: 600, seq: 5 },
    snapshot,
  ), true);
  assert.equal(matches(
    { seat: 0, action: "raise", amount: 1200, actionSeq: 4, handId: "12" },
    { seat: 1, action: "raise", amount: 1200, seq: 5 },
    snapshot,
  ), false);
  assert.equal(matches(
    { seat: 0, action: "raise", amount: 1200, actionSeq: 4, handId: "12" },
    { seat: 0, action: "raise", amount: 1200, seq: 6 },
    snapshot,
  ), false);
  assert.equal(matches(
    { seat: 0, action: "raise", amount: 1200, actionSeq: 4, handId: "12" },
    { seat: 0, action: "raise", amount: 1400, seq: 5 },
    snapshot,
  ), false);
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
      buyIn: 15000,
      requestedAt: 1_800_000_000_000,
      expiresAt: 1_800_000_060_000,
    }],
    newGameBuyInRequired: false,
  }, 14);

  assert.equal(normalized.practiceMode, true);
  assert.equal(normalized.newGameBuyInRequired, false);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.pendingJoinRequests)), [{
    nick: "guest",
    targetNick: "owner",
    buyIn: 15000,
    requestedAt: 1_800_000_000_000,
    expiresAt: 1_800_000_060_000,
  }]);
  assert.match(indexSource, /id="holdem-join-request-btn"/);
  assert.match(indexSource, /id="holdem-join-request-alert"/);
  assert.match(source, /function requestPracticeJoin\(buyInAmount\)/);
  assert.match(source, /function openPracticeJoinBuyIn\(\)/);
  assert.match(source, /buyInMode = mode === "rebuy" \|\| mode === "new_game" \|\| mode === "join_request"/);
  assert.match(source, /if \(state\.practiceMode\) \{[\s\S]*autoSeatKey = "ai-practice"/);
  assert.match(source, /state\.practiceMode && state\.heroSeat < 0[\s\S]*빈자리에 바로 앉을 수 없어요/);
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

test("active snapshots ignore legacy public folded-card fields", () => {
  const controller = loadController("bob");
  const normalized = controller._test.normalizeSnapshot({
    version: 4,
    phase: "flop",
    handId: "legacy-active-reveal",
    seats: [
      { seat: 0, nick: "alice", inHand: true, folded: true, cardCount: 2 },
      { seat: 1, nick: "bob", inHand: true, folded: false, cardCount: 2 },
    ],
    viewer: { seat: 1, cards: ["Kh", "Kd"], revealCards: [] },
    revealedCards: [{ seat: 0, cards: ["As"], revealCards: [0], folded: true }],
  }, 4);

  assert.equal(normalized.revealedCards[0], null);
  assert.equal(normalized.revealedCardIndexes[0], null);
  assert.equal(Array.from(normalized.showdown).length, 0);
});

test("a reserved folded card throws once when result cards actually become public", () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  const heroDom = resultTestDocument();
  const observerDom = resultTestDocument();
  const heroController = loadController("alice", { document: heroDom.document });
  const observerController = loadController("cara", { document: observerDom.document });
  let serverState = Engine.createTable({
    roomId: "room-controller",
    ownerNick: "alice",
  });
  let commandNow = 100;
  function command(command) {
    const result = Engine.command(serverState, command, {
      now: commandNow++,
      randomInt: () => 0,
    });
    assert.equal(result.ok, true, result.reason);
    serverState = result.state;
  }

  try {
    for (const nick of ["alice", "bob", "cara"]) {
      command({ type: "join", nick });
      command({ type: "ready", nick, ready: true });
    }
    command({ type: "start", nick: "alice" });
    assert.equal(serverState.seats[serverState.actorSeat].nick, "alice");
    const heroCards = serverState.seats[serverState.actorSeat].cards.slice();
    command({ type: "act", nick: "alice", action: "fold" });
    command({ type: "reveal_cards", nick: "alice", cards: [0] });

    const activeHero = Engine.view(serverState, "alice");
    const activeObserver = Engine.view(serverState, "cara");
    assert.deepEqual(activeHero.heroRevealCards, [0]);
    assert.equal(activeObserver.revealedCards, undefined);
    assert.equal(heroController._test.applySnapshot(activeHero, 1, 1), true);
    assert.equal(observerController._test.applySnapshot(activeObserver, 1, 1), true);

    const nextActor = serverState.seats[serverState.actorSeat];
    command({ type: "act", nick: nextActor.nick, action: "fold" });
    assert.equal(serverState.phase, "hand_end");
    const completedHero = Engine.view(serverState, "alice");
    const completedObserver = Engine.view(serverState, "cara");
    assert.equal(heroController._test.applySnapshot(completedHero, 2, 2), true);
    assert.equal(observerController._test.applySnapshot(completedObserver, 2, 2), true);
    assert.equal(heroController._test.resultStage(), "action");
    assert.equal(heroDom.elements["holdem-seats"].innerHTML.includes("is-hero-reveal-forward"), false);
    assert.equal(heroDom.elements["holdem-seats"].innerHTML.includes("is-hero-reveal-throwing"), false);
    assert.equal(observerDom.elements["holdem-seats"].innerHTML.includes("is-revealed-cards"), false);

    now += heroController._test.constants.resultFinalActionMs + 1;
    heroController._test.renderSettlementAnimation();
    observerController._test.renderSettlementAnimation();
    assert.equal(heroController._test.resultStage(), "cards");
    assert.equal((heroDom.elements["holdem-seats"].innerHTML.match(/is-hero-reveal-forward/g) || []).length, 1);
    assert.equal((heroDom.elements["holdem-seats"].innerHTML.match(/is-hero-reveal-throwing/g) || []).length, 1);
    assert.equal(observerDom.elements["holdem-seats"].innerHTML.includes("is-revealed-cards"), true);
    assert.equal(observerDom.elements["holdem-seats"].innerHTML.includes(heroCards[1]), false);

    now += 120;
    assert.equal(heroController._test.applySnapshot(completedHero, 3, 3), true);
    assert.equal((heroDom.elements["holdem-seats"].innerHTML.match(/is-hero-reveal-throwing/g) || []).length, 1);

    now += 800;
    assert.equal(heroController._test.applySnapshot(completedHero, 4, 4), true);
    assert.equal((heroDom.elements["holdem-seats"].innerHTML.match(/is-hero-reveal-forward/g) || []).length, 1);
    assert.equal(heroDom.elements["holdem-seats"].innerHTML.includes("is-hero-reveal-throwing"), false);
  } finally {
    heroController.leave();
    observerController.leave();
    Date.now = originalNow;
  }
});

test("fold reveal controls keep the requested selection while the server confirms it", async () => {
  const dom = resultTestDocument();
  const calls = [];
  let resolveReveal;
  const db = {
    holdemInvoke(_auth, action, payload) {
      calls.push({ action, payload });
      return new Promise((resolve) => {
        resolveReveal = resolve;
      });
    },
  };
  const controller = loadController("alice", { document: dom.document, db });
  const snapshot = (revealCards, version) => ({
    version,
    phase: "flop",
    handId: "1",
    mode: "ring",
    seats: [
      { seat: 0, nick: "alice", stack: 9800, inHand: true, folded: true, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 10200, inHand: true, folded: false, cardCount: 2 },
    ],
    viewer: { seat: 0, cards: ["As", "7d"], revealCards },
    actingSeat: 1,
    legalActions: {},
  });

  try {
    controller._test.setActive(true);
    controller._test.setHasSnapshot(true);
    controller._test.setState(controller._test.normalizeSnapshot(snapshot([], 1), 1));
    controller._test.renderControls();

    const request = controller._test.reserveFoldReveal([0]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "reveal_cards");
    assert.deepEqual(Array.from(calls[0].payload.cards), [0]);
    assert.match(dom.elements["holdem-fold-reveal-panel"].innerHTML, /data-holdem-reveal-cards="0" aria-pressed="true"/);
    assert.match(dom.elements["holdem-fold-reveal-panel"].innerHTML, /예약 중/);

    resolveReveal({ ok: true, version: 2, snapshot: snapshot([0], 2) });
    const result = await request;
    assert.equal(result.ok, true);
    assert.equal(controller._test.getPendingFoldRevealReservation(), null);
    assert.match(dom.elements["holdem-fold-reveal-panel"].innerHTML, /data-holdem-reveal-cards="0" aria-pressed="true"/);
    assert.match(dom.elements["holdem-fold-reveal-panel"].innerHTML, /예약됨/);
  } finally {
    controller.leave();
  }
});

test("a human fold winner can choose to reveal after the hand", () => {
  const dom = resultTestDocument();
  const calls = [];
  const controller = loadController("alice", {
    document: dom.document,
    db: {
      holdemInvoke(_auth, action, payload) {
        calls.push({ action, payload });
        return Promise.resolve({ ok: true, version: 4, snapshot });
      },
    },
  });
  const snapshot = {
    version: 3,
    phase: "hand_end",
    handId: "3",
    mode: "ring",
    seats: [
      { seat: 0, nick: "alice", stack: 11000, inHand: true, folded: false, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 9000, inHand: true, folded: true, cardCount: 2 },
    ],
    pots: [{ amount: 2000, winners: [0] }],
    winners: ["alice"],
    showdown: [],
    viewer: { seat: 0, cards: ["As", "7d"], revealCards: [] },
    legalActions: {},
  };

  try {
    controller._test.setActive(true);
    controller._test.setHasSnapshot(true);
    controller._test.setState(controller._test.normalizeSnapshot(snapshot, 3));
    controller._test.renderControls();

    assert.equal(dom.elements["holdem-fold-reveal-panel"].classList.contains("hidden"), false);
    controller._test.reserveFoldReveal([0, 1]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "reveal_cards");
    assert.deepEqual(Array.from(calls[0].payload.cards), [0, 1]);
  } finally {
    controller.leave();
  }
});

test("a folded player can choose to reveal after the hand ends", () => {
  const dom = resultTestDocument();
  const calls = [];
  const controller = loadController("alice", {
    document: dom.document,
    db: {
      holdemInvoke(_auth, action, payload) {
        calls.push({ action, payload });
        return Promise.resolve({ ok: true, version: 8, snapshot });
      },
    },
  });
  const snapshot = {
    version: 7,
    phase: "hand_end",
    handId: "fold-finish",
    mode: "ring",
    seats: [
      { seat: 0, nick: "alice", stack: 9400, inHand: true, folded: true, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 10600, inHand: true, folded: false, cardCount: 2 },
    ],
    pots: [{ amount: 1200, winners: [1] }],
    winners: ["bob"],
    showdown: [],
    viewer: { seat: 0, cards: ["As", "7d"], revealCards: [] },
    legalActions: {},
  };

  try {
    controller._test.setActive(true);
    controller._test.setHasSnapshot(true);
    controller._test.setState(controller._test.normalizeSnapshot(snapshot, 7));
    controller._test.renderControls();

    assert.equal(dom.elements["holdem-fold-reveal-panel"].classList.contains("hidden"), false);
    controller._test.reserveFoldReveal([0]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "reveal_cards");
    assert.deepEqual(Array.from(calls[0].payload.cards), [0]);
  } finally {
    controller.leave();
  }
});

test("completed snapshots recover winners from pot seats and authoritative payouts", () => {
  const controller = loadController();
  const base = {
    phase: "hand_end",
    seats: [
      { seat: 0, nick: "alice", stack: 10600, winAmount: 600 },
      { seat: 1, nick: "bob", stack: 9400 },
    ],
  };
  const fromPot = controller._test.normalizeSnapshot({
    ...base,
    pots: [{ amount: 600, winners: [0] }],
  }, 10);
  assert.deepEqual(Array.from(fromPot.winners), ["alice"]);
  assert.equal(fromPot.seats[0].winAmount, 600);

  const fromPayout = controller._test.normalizeSnapshot(base, 11);
  assert.deepEqual(Array.from(fromPayout.winners), ["alice"]);
});

test("the result clock inserts the winner tag while next hand stays automatic", () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  const dom = resultTestDocument();
  const controller = loadController("alice", { document: dom.document });

  try {
    assert.equal(controller._test.applySnapshot({
      phase: "hand_end",
      handId: "result-redraw",
      handNo: 12,
      ownerNick: "alice",
      seats: [
        { seat: 0, nick: "alice", stack: 10600, winAmount: 600, handName: "스트레이트" },
        { seat: 1, nick: "bob", stack: 9400 },
      ],
      board: ["As", "Kd", "Qc", "Jh", "Ts"],
      pot: 600,
      pots: [{ amount: 600, winners: [0] }],
      winners: ["alice"],
      canStart: false,
      canNext: true,
    }, 12), true);

    assert.doesNotMatch(dom.elements["holdem-seats"].innerHTML, /holdem-winner-result/);
    assert.equal(dom.elements["holdem-table-start-btn"].classList.contains("hidden"), true);

    now += controller._test.constants.resultCardsFirstMs +
      controller._test.constants.resultBoardRevealStepMs * 2 +
      (controller._test.constants.communityRiverFlipMs -
        controller._test.constants.resultBoardRevealStepMs) +
      controller._test.constants.resultSettleMs;
    controller._test.renderSettlementAnimation();

    assert.match(dom.elements["holdem-seats"].innerHTML, /holdem-winner-result/);
    assert.match(dom.elements["holdem-seats"].innerHTML, /is-winner/);
    assert.equal(dom.elements.holdemgame.classList.contains("is-result-announced"), true);
    assert.equal(dom.elements.holdemgame.classList.contains("is-showdown"), true);
    assert.equal(dom.elements["holdem-table-start-btn"].classList.contains("hidden"), true);
  } finally {
    Date.now = originalNow;
  }
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

test("river action controls wait until the river card finishes opening", () => {
  const dom = controlTestDocument();
  const controller = loadController("alice", { document: dom.document });
  const baseSnapshot = {
    handId: "river-open-delay",
    handNumber: 3,
    heroSeat: 0,
    actingSeat: 0,
    ownerNick: "alice",
    smallBlind: 100,
    bigBlind: 200,
    seats: [
      { seat: 0, nick: "alice", stack: 10000, inHand: true, cards: ["As", "Ad"] },
      { seat: 1, nick: "bob", stack: 10000, inHand: true, cardCount: 2 },
    ],
  };
  const originalNow = Date.now;
  let now = 1_950_000_000_000;
  Date.now = () => now;
  try {
    const turn = controller._test.normalizeSnapshot(Object.assign({}, baseSnapshot, {
      phase: "turn",
      version: 30,
      board: ["Ah", "Kd", "Qs", "Jc"],
      legalActions: [],
    }), 30);
    controller._test.setState(turn);
    controller._test.renderBoard();

    const river = controller._test.normalizeSnapshot(Object.assign({}, baseSnapshot, {
      phase: "river",
      version: 31,
      board: ["Ah", "Kd", "Qs", "Jc", "2d"],
      legalActions: ["fold", "call"],
      callAmount: 200,
    }), 31);
    controller._test.setState(river);
    controller._test.renderBoard();
    controller._test.renderControls();

    assert.equal(controller._test.communityRevealBlocksActions(), true);
    assert.equal(dom.elements["holdem-action-panel"].classList.contains("hidden"), true);

    now += controller._test.constants.communityRiverFlipMs + 1;
    controller._test.renderTimer();

    assert.equal(controller._test.communityRevealBlocksActions(), false);
    assert.equal(dom.elements["holdem-action-panel"].classList.contains("hidden"), false);
  } finally {
    Date.now = originalNow;
  }
});

test("a seated solo owner sees an action-area button to fill AI seats", () => {
  const dom = controlTestDocument();
  const controller = loadController("alice", { document: dom.document });
  const snapshot = controller._test.normalizeSnapshot({
    phase: "waiting",
    version: 7,
    heroSeat: 0,
    ownerNick: "alice",
    canManageBots: true,
    botCount: 0,
    seats: [
      { seat: 0, nick: "alice", stack: 20000, waiting: true },
      null,
      null,
      null,
      null,
      null,
    ],
  }, 7);
  controller._test.setState(snapshot);
  controller._test.renderControls();

  assert.equal(dom.elements["holdem-action-panel"].classList.contains("hidden"), true);
  assert.equal(dom.elements["holdem-solo-bot-fill-panel"].classList.contains("hidden"), false);
  assert.equal(dom.elements["holdem-solo-bot-fill-btn"].disabled, false);
  assert.equal(dom.elements.holdemgame.classList.contains("is-solo-bot-fill"), true);

  const blocked = controller._test.normalizeSnapshot(Object.assign({}, snapshot, {
    botCount: 5,
    seats: [
      { seat: 0, nick: "alice", stack: 20000, waiting: true },
      { seat: 1, nick: "AI 1", isBot: true, botId: "bot-1", stack: 20000 },
      { seat: 2, nick: "AI 2", isBot: true, botId: "bot-2", stack: 20000 },
      { seat: 3, nick: "AI 3", isBot: true, botId: "bot-3", stack: 20000 },
      { seat: 4, nick: "AI 4", isBot: true, botId: "bot-4", stack: 20000 },
      { seat: 5, nick: "AI 5", isBot: true, botId: "bot-5", stack: 20000 },
    ],
  }), 8);
  controller._test.setState(blocked);
  controller._test.renderControls();

  assert.equal(dom.elements["holdem-solo-bot-fill-panel"].classList.contains("hidden"), true);
  assert.equal(dom.elements.holdemgame.classList.contains("is-solo-bot-fill"), false);
});

test("a timeout-sat-out player gets a manual rejoin control", async () => {
  const dom = controlTestDocument();
  const calls = [];
  const resumedSnapshot = {
    phase: "hand_end",
    version: 12,
    handId: "timeout-resume",
    ownerNick: "alice",
    canReady: false,
    canStart: true,
    seats: [
      { seat: 0, nick: "alice", stack: 10000, ready: true, sittingOut: false },
      { seat: 1, nick: "bob", stack: 10000, ready: true },
    ],
    viewer: { seat: 0, cards: [] },
    legalActions: {},
  };
  const controller = loadController("alice", {
    document: dom.document,
    db: {
      holdemInvoke(_auth, action, payload) {
        calls.push({ action, payload });
        return Promise.resolve({ ok: true, version: 12, snapshot: resumedSnapshot });
      },
    },
  });
  const sittingOut = controller._test.normalizeSnapshot({
    ...resumedSnapshot,
    version: 11,
    canReady: true,
    canStart: false,
    seats: [
      { seat: 0, nick: "alice", stack: 10000, ready: false, sittingOut: true },
      { seat: 1, nick: "bob", stack: 10000, ready: true },
    ],
  }, 11);

  try {
    controller._test.setActive(true);
    controller._test.setHasSnapshot(true);
    controller._test.setState(sittingOut);
    controller._test.renderControls();

    assert.equal(dom.elements["holdem-seat-controls"].classList.contains("hidden"), false);
    assert.equal(dom.elements["holdem-ready-btn"].classList.contains("hidden"), false);
    assert.equal(dom.elements["holdem-ready-btn"].textContent, "다시 참가");
    assert.equal(dom.elements["holdem-ready-btn"].disabled, false);

    controller._test.setReady();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "ready");
    assert.equal(calls[0].payload.ready, true);
  } finally {
    controller.leave();
  }
});

test("a timeout-sat-out player can rejoin while the next hand is active", async () => {
  const dom = controlTestDocument();
  const calls = [];
  const controller = loadController("alice", {
    document: dom.document,
    db: {
      holdemInvoke(_auth, action, payload) {
        calls.push({ action, payload });
        return Promise.resolve({
          ok: true,
          version: 14,
          snapshot: {
            phase: "preflop",
            version: 14,
            canReady: false,
            seats: [
              { seat: 0, nick: "alice", stack: 10000, ready: true, sittingOut: false, waiting: true },
              { seat: 1, nick: "bob", stack: 9900, inHand: true },
              { seat: 2, nick: "carol", stack: 9800, inHand: true },
            ],
            viewer: { seat: 0, cards: [] },
            legalActions: {},
          },
        });
      },
    },
  });
  const sittingOut = controller._test.normalizeSnapshot({
    phase: "preflop",
    version: 13,
    handId: "active-resume",
    canReady: true,
    seats: [
      { seat: 0, nick: "alice", stack: 10000, ready: false, sittingOut: true, waiting: true },
      { seat: 1, nick: "bob", stack: 9900, inHand: true },
      { seat: 2, nick: "carol", stack: 9800, inHand: true },
    ],
    viewer: { seat: 0, cards: [] },
    legalActions: {
      actions: ["fold", "call"],
      callAmount: 100,
    },
  }, 13);

  try {
    controller._test.setActive(true);
    controller._test.setHasSnapshot(true);
    controller._test.setState(sittingOut);
    controller._test.renderControls();

    assert.equal(dom.elements["holdem-seat-controls"].classList.contains("hidden"), false);
    assert.equal(dom.elements["holdem-ready-btn"].classList.contains("hidden"), false);
    assert.equal(dom.elements["holdem-ready-btn"].disabled, false);
    assert.equal(dom.elements["holdem-action-panel"].classList.contains("hidden"), true);

    controller._test.setReady();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "ready");
    assert.equal(calls[0].payload.ready, true);
  } finally {
    controller.leave();
  }
});

test("pre-action buttons can be queued before the hero turn", () => {
  const dom = controlTestDocument();
  const controller = loadController("alice", { document: dom.document });
  const snapshot = controller._test.normalizeSnapshot({
    phase: "flop",
    version: 10,
    handId: "pre-action",
    heroSeat: 0,
    actingSeat: 1,
    seats: [
      { seat: 0, nick: "alice", stack: 5000, bet: 100, inHand: true, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 5000, bet: 300, inHand: true, cardCount: 2 },
    ],
  }, 10);
  controller._test.setState(snapshot);
  controller._test.renderControls();

  assert.equal(dom.elements["holdem-action-panel"].classList.contains("hidden"), true);
  assert.equal(dom.elements["holdem-pre-action-panel"].classList.contains("hidden"), false);
  assert.equal(dom.elements["holdem-pre-fold-btn"].classList.contains("hidden"), false);
  assert.equal(dom.elements["holdem-pre-call-btn"].classList.contains("hidden"), false);
  assert.equal(dom.elements["holdem-pre-check-btn"].classList.contains("hidden"), true);
  assert.equal(dom.elements["holdem-pre-call-amount"].textContent, "200원");

  assert.equal(controller._test.queuePreAction("call"), true);
  assert.equal(dom.elements["holdem-pre-call-btn"].classList.contains("is-queued"), true);
  assert.equal(dom.elements["holdem-pre-call-btn"].attributes["aria-pressed"], "true");
  const queued = controller._test.getQueuedAction();
  assert.equal(queued.action, "call");
  assert.equal(queued.label, "콜");
  assert.equal(queued.maxCallAmount, 200);
  assert.equal(queued.handKey, "pre-action");
  assert.equal(queued.heroSeat, 0);
});

test("queued calls do not auto-call a higher changed amount", () => {
  const dom = controlTestDocument();
  const calls = [];
  const controller = loadController("alice", {
    document: dom.document,
    db: {
      holdemInvoke(auth, action, payload) {
        calls.push({ action, payload });
        return Promise.resolve({ ok: true, version: 12, snapshot: controller.state });
      },
    },
  });
  controller._test.setActive(true);
  const waiting = controller._test.normalizeSnapshot({
    phase: "flop",
    version: 10,
    handId: "pre-action-protect",
    heroSeat: 0,
    actingSeat: 1,
    seats: [
      { seat: 0, nick: "alice", stack: 5000, bet: 100, inHand: true, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 5000, bet: 300, inHand: true, cardCount: 2 },
    ],
  }, 10);
  controller._test.setState(waiting);
  assert.equal(controller._test.queuePreAction("call"), true);

  const raised = controller._test.normalizeSnapshot({
    phase: "flop",
    version: 11,
    handId: "pre-action-protect",
    heroSeat: 0,
    actingSeat: 0,
    actionInfo: { toCall: 500 },
    legalActions: ["fold", "call"],
    seats: [
      { seat: 0, nick: "alice", stack: 5000, bet: 100, inHand: true, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 5000, bet: 600, inHand: true, cardCount: 2 },
    ],
  }, 11);
  controller._test.setState(raised);
  controller._test.maybePerformQueuedAction();

  assert.equal(calls.length, 0);
  assert.equal(controller._test.getQueuedAction(), null);
});

test("pressing leave again cancels an active leave reservation", async () => {
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ action, payload });
      return Promise.resolve({
        ok: true,
        version: 12,
        snapshot: {
          phase: "flop",
          version: 12,
          handId: "leave-cancel",
          heroSeat: 0,
          actingSeat: 1,
          seats: [
            { seat: 0, nick: "alice", stack: 5000, inHand: true, leaving: false, cardCount: 2 },
            { seat: 1, nick: "bob", stack: 5000, inHand: true, cardCount: 2 },
          ],
        },
      });
    },
  };
  const controller = loadController("alice", { db });
  controller._test.setActive(true);
  controller._test.setState(controller._test.normalizeSnapshot({
    phase: "flop",
    version: 11,
    handId: "leave-cancel",
    heroSeat: 0,
    actingSeat: 1,
    seats: [
      { seat: 0, nick: "alice", stack: 5000, inHand: true, leaving: true, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 5000, inHand: true, cardCount: 2 },
    ],
  }, 11));

  await controller._test.requestLeaveAfterHand();

  assert.equal(calls[0].action, "leave");
  assert.equal(calls[0].payload.cancelLeave, true);
  assert.equal(calls[0].payload.leaveIntent, undefined);
});

test("reserved room leave waits until the result review is complete", async () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  const leaveCalls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      return Promise.resolve({
        ok: true,
        version: 12,
        snapshot: {
          phase: "flop",
          version: 12,
          handId: "leave-after-result",
          heroSeat: 0,
          actingSeat: 1,
          seats: [
            { seat: 0, nick: "alice", stack: 5000, inHand: true, leaving: true, leaveIntent: "leave", cardCount: 2 },
            { seat: 1, nick: "bob", stack: 5000, inHand: true, cardCount: 2 },
          ],
        },
      });
    },
  };
  const controller = loadController("alice", { db });
  controller._test.setApi({
    me: () => ({ nick: "alice" }),
    roomId: () => "room-controller",
    galleryAuth: () => ({ nick: "alice", hash: "a".repeat(64) }),
    leaveRoom: () => leaveCalls.push("leave"),
  });
  controller._test.setActive(true);
  controller._test.setHasSnapshot(true);
  controller._test.setState(controller._test.normalizeSnapshot({
    phase: "flop",
    version: 11,
    handId: "leave-after-result",
    heroSeat: 0,
    actingSeat: 1,
    seats: [
      { seat: 0, nick: "alice", stack: 5000, inHand: true, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 5000, inHand: true, cardCount: 2 },
    ],
  }, 11));

  try {
    await controller._test.requestLeaveAfterHand();
    assert.deepEqual(leaveCalls, []);

    controller._test.applySnapshot({
      phase: "hand_end",
      version: 13,
      handId: "leave-after-result",
      heroSeat: 0,
      seats: [
        { seat: 0, nick: "alice", stack: 5000, inHand: true, leaving: true, leaveIntent: "leave", cardCount: 2 },
        { seat: 1, nick: "bob", stack: 10000, winAmount: 5000 },
      ],
      pot: 5000,
      pots: [{ amount: 5000, winners: [1] }],
      winners: ["bob"],
    }, 13);
    assert.deepEqual(leaveCalls, []);

    now += 20_000;
    controller._test.renderSettlementAnimation();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(leaveCalls, ["leave"]);
  } finally {
    Date.now = originalNow;
  }
});

test("folded players can leave immediately without waiting for results", async () => {
  const leaveCalls = [];
  const controller = loadController("alice");
  controller._test.setApi({
    me: () => ({ nick: "alice" }),
    roomId: () => "room-controller",
    galleryAuth: () => ({ nick: "alice", hash: "a".repeat(64) }),
    leaveRoom: () => leaveCalls.push("leave"),
  });
  controller._test.setActive(true);
  controller._test.setState(controller._test.normalizeSnapshot({
    phase: "flop",
    version: 11,
    handId: "folded-leave-now",
    heroSeat: 0,
    actingSeat: 1,
    seats: [
      { seat: 0, nick: "alice", stack: 5000, inHand: true, folded: true, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 5000, inHand: true, cardCount: 2 },
    ],
  }, 11));

  const result = await controller._test.requestLeaveAfterHand();

  assert.equal(result.reason, "leave_now");
  assert.deepEqual(leaveCalls, ["leave"]);
  assert.equal(controller.isBusy(), false);
});

test("an all-in result finishes every reveal before opening the rebuy dialog", async () => {
  const calls = [];
  const db = {
    getHoldemWallet() {
      calls.push("wallet");
      return Promise.resolve({
        ok: true,
        wallet: { balance: 50000, tableBalance: 0, totalAssets: 50000 },
      });
    },
  };
  const controller = loadController("alice", { db });
  const previous = controller._test.emptyState();
  previous.mode = "ring";
  previous.phase = "preflop";
  previous.version = 20;
  previous.handId = "7";
  previous.handNumber = 7;
  previous.heroSeat = 0;
  previous.seats[0] = { seat: 0, nick: "alice", stack: 0 };
  previous.seats[1] = { seat: 1, nick: "bob", stack: 30000 };
  controller._test.setState(previous);
  controller._test.setActive(true);
  controller._test.setHasSnapshot(true);

  const originalNow = Date.now;
  let now = 1_900_000_000_000;
  Date.now = () => now;
  try {
    const completed = {
      phase: "hand_end",
      mode: "ring",
      handId: "7",
      handNo: 7,
      settings: {
        mode: "ring",
        chipUnit: 100,
        buyInMin: 10000,
        buyInMax: 50000,
        defaultBuyIn: 30000,
      },
      viewer: { seat: 0 },
      seats: [
        { seat: 0, nick: "alice", stack: 0, lastAction: "allin" },
        { seat: 1, nick: "bob", stack: 30000 },
      ],
      board: ["As", "Kd", "Qc", "Jh", "Ts"],
      winners: ["bob"],
      canRefill: false,
    };
    assert.equal(controller._test.applySnapshot(completed, 21), true);

    const resultDuration =
      controller._test.constants.resultFinalActionMs +
      controller._test.constants.resultCardsFirstMs +
      controller._test.constants.resultBoardRevealStepMs * 2 +
      (controller._test.constants.communityRiverFlipMs -
        controller._test.constants.resultBoardRevealStepMs) +
      controller._test.constants.resultCardHighlightHoldMs +
      controller._test.constants.resultSettleMs +
      controller._test.constants.resultReviewMs;

    assert.equal(controller._test.resultTransitionDelayMs(), resultDuration);
    assert.equal(controller._test.resultTransitionReady(), false);
    assert.equal(controller._test.openBuyInDialog("rebuy", 0), false);
    controller._test.maybeAutoOpenRebuyDialog();
    assert.deepEqual(calls, []);

    now += resultDuration - 1;
    controller._test.maybeAutoOpenRebuyDialog();
    assert.deepEqual(calls, []);

    now += 1;
    assert.equal(controller._test.resultTransitionReady(), true);
    controller._test.maybeAutoOpenRebuyDialog();
    await Promise.resolve();
    assert.deepEqual(calls, ["wallet"]);
  } finally {
    Date.now = originalNow;
    controller._test.setActive(false);
  }
});

test("the completed UI keeps a fold winner's hand hidden until reveal", () => {
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
  const botCards = bot.cards.slice();
  const owner = state.seats[state.actorSeat];
  assert.equal(owner.nick, "alice");
  state = Engine.command(state, {
    type: "act",
    nick: owner.nick,
    action: "fold",
  }, ctx).state;

  const snapshot = Engine.view(state, "alice");
  const winnerRow = snapshot.showdown.find((entry) => entry.seat === bot.seat);
  assert.equal(winnerRow, undefined);
  const normalized = controller._test.normalizeSnapshot(snapshot, 14);
  assert.equal(normalized.phase, "complete");
  assert.deepEqual(Array.from(normalized.revealedCards[bot.seat] || []), []);
  assert.equal(normalized.showdown.some((entry) => entry.seat === bot.seat), false);
  botCards.forEach((card) => assert.equal(JSON.stringify(normalized).includes(`"${card}"`), false));
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

test("holdem emoji reactions send and render on the matching player avatar", () => {
  const { document, elements } = resultTestDocument();
  const sent = [];
  const controller = loadController("alice", { document });
  controller._test.setApi({
    me: () => ({ nick: "alice" }),
    roomId: () => "room-controller",
    galleryAuth: () => ({ nick: "alice", hash: "a".repeat(64) }),
    send: (message) => sent.push(message),
  });
  controller._test.setState(controller._test.normalizeSnapshot({
    phase: "flop",
    heroSeat: 0,
    seats: [
      { seat: 0, nick: "alice", stack: 10000, inHand: true },
      { seat: 1, nick: "bob", stack: 9900, inHand: true },
    ],
  }, 16));

  assert.equal(controller._test.sendHoldemEmoji("😎"), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, "holdem_emoji");
  assert.equal(sent[0].game, "holdem");
  assert.equal(sent[0].nick, "alice");
  assert.equal(sent[0].emoji, "😎");
  assert.match(elements["holdem-seats"].innerHTML, /holdem-seat-emoji-pop/);
  assert.match(elements["holdem-seats"].innerHTML, /😎/);
  assert.match(elements["holdem-seats"].innerHTML, /<\/div><span class="holdem-seat-emoji-pop"/);

  const handled = controller.onMessage({
    t: "holdem_emoji",
    nick: "bob",
    emoji: "👍",
    id: "remote-emoji-1",
  });
  assert.equal(handled, true);
  assert.match(elements["holdem-seats"].innerHTML, /👍/);
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

test("high card highlights the highest card from either hole or board", () => {
  const controller = loadController();
  const state = controller._test.emptyState();
  state.phase = "flop";
  state.heroCards = [
    { rank: "A", suit: "s" },
    { rank: "K", suit: "d" },
  ];
  state.board = [
    { rank: "9", suit: "h" },
    { rank: "7", suit: "s" },
    { rank: "4", suit: "c" },
  ];
  controller._test.setState(state);

  const currentHand = controller._test.heroCurrentHand();
  assert.equal(currentHand.name, "하이카드");
  assert.deepEqual(Object.keys(currentHand.holeCards), ["0"]);
  assert.deepEqual(Object.keys(currentHand.communityCards), []);

  state.heroCards = [
    { rank: "2", suit: "s" },
    { rank: "K", suit: "d" },
  ];
  state.board = [
    { rank: "A", suit: "h" },
    { rank: "7", suit: "s" },
    { rank: "4", suit: "c" },
  ];
  controller._test.setState(state);

  const boardHigh = controller._test.heroCurrentHand();
  assert.equal(boardHigh.name, "하이카드");
  assert.deepEqual(Object.keys(boardHigh.holeCards), []);
  assert.deepEqual(Object.keys(boardHigh.communityCards), ["0"]);
});

test("made hands highlight every hole and community card used by the combination", () => {
  const controller = loadController();
  const state = controller._test.emptyState();
  state.phase = "flop";
  state.heroCards = [
    { rank: "A", suit: "s" },
    { rank: "K", suit: "d" },
  ];
  state.board = [
    { rank: "A", suit: "h" },
    { rank: "7", suit: "s" },
    { rank: "4", suit: "c" },
  ];
  controller._test.setState(state);

  const currentHand = controller._test.heroCurrentHand();
  assert.equal(currentHand.name, "원페어");
  assert.deepEqual(Object.keys(currentHand.holeCards), ["0"]);
  assert.deepEqual(Object.keys(currentHand.communityCards), ["0"]);
});

test("every hand category renders the exact highlighted hole and board cards", () => {
  const originalNow = Date.now;
  let now = 2_100_000_000_000;
  Date.now = () => now;
  const cases = [
    {
      name: "high card",
      hole: ["As", "2d"],
      board: ["Kh", "9c", "7s", "4d", "3c"],
      holeHighlight: ["As"],
      boardHighlight: [],
    },
    {
      name: "pair",
      hole: ["As", "Kd"],
      board: ["Ah", "7s", "4c", "3d", "2c"],
      holeHighlight: ["As"],
      boardHighlight: ["Ah"],
    },
    {
      name: "two pair",
      hole: ["As", "Kd"],
      board: ["Ah", "Ks", "4c", "3d", "2c"],
      holeHighlight: ["As", "Kd"],
      boardHighlight: ["Ah", "Ks"],
    },
    {
      name: "trips",
      hole: ["As", "Kd"],
      board: ["Ah", "Ac", "7s", "4c", "2d"],
      holeHighlight: ["As"],
      boardHighlight: ["Ah", "Ac"],
    },
    {
      name: "straight",
      hole: ["9s", "2d"],
      board: ["8h", "7c", "6s", "5d", "Kc"],
      holeHighlight: ["9s"],
      boardHighlight: ["8h", "7c", "6s", "5d"],
    },
    {
      name: "flush",
      hole: ["As", "9s"],
      board: ["Ks", "7s", "4s", "Qd", "2c"],
      holeHighlight: ["As", "9s"],
      boardHighlight: ["Ks", "7s", "4s"],
    },
    {
      name: "full house",
      hole: ["As", "Kd"],
      board: ["Ah", "Ac", "Ks", "4c", "2d"],
      holeHighlight: ["As", "Kd"],
      boardHighlight: ["Ah", "Ac", "Ks"],
    },
    {
      name: "quads",
      hole: ["As", "Kd"],
      board: ["Ah", "Ac", "Ad", "7s", "4c"],
      holeHighlight: ["As"],
      boardHighlight: ["Ah", "Ac", "Ad"],
    },
    {
      name: "straight flush",
      hole: ["9s", "2d"],
      board: ["8s", "7s", "6s", "5s", "Kc"],
      holeHighlight: ["9s"],
      boardHighlight: ["8s", "7s", "6s", "5s"],
    },
    {
      name: "wheel",
      hole: ["As", "Kd"],
      board: ["2h", "3c", "4s", "5d", "9c"],
      holeHighlight: ["As"],
      boardHighlight: ["2h", "3c", "4s", "5d"],
    },
    {
      name: "six-card flush",
      hole: ["As", "3s"],
      board: ["Ks", "Qs", "Js", "9s", "2d"],
      holeHighlight: ["As"],
      boardHighlight: ["Ks", "Qs", "Js", "9s"],
    },
    {
      name: "equal straight prefers the complete board",
      hole: ["9s", "2d"],
      board: ["9h", "8c", "7s", "6d", "5c"],
      holeHighlight: [],
      boardHighlight: ["9h", "8c", "7s", "6d", "5c"],
    },
  ];

  try {
    cases.forEach((entry, index) => {
      const dom = resultTestDocument();
      const controller = loadController("alice", { document: dom.document });
      const state = controller._test.normalizeSnapshot({
        phase: "river",
        version: index + 1,
        handId: `combo-${index}`,
        ownerNick: "alice",
        seats: [
          { seat: 0, nick: "alice", stack: 10000, inHand: true, cardCount: 2 },
        ],
        viewer: { seat: 0, cards: entry.hole },
        board: entry.board,
      }, index + 1);
      controller._test.setState(state);
      controller._test.renderSeats();
      controller._test.renderBoard();

      assert.deepEqual(
        renderedCodesWithClass(dom.elements["holdem-seats"].innerHTML, "is-hero-made-hand-card"),
        [],
        `${entry.name} hole highlight waits for card opening`
      );
      assert.deepEqual(
        renderedCodesWithClass(dom.elements["holdem-board"].innerHTML, "is-hero-made-hand-card"),
        [],
        `${entry.name} board highlight waits for card opening`
      );

      now += controller._test.constants.communityRiverFlipMs + 600;
      controller._test.renderSeats();
      controller._test.renderBoard();

      assert.deepEqual(
        renderedCodesWithClass(dom.elements["holdem-seats"].innerHTML, "is-hero-made-hand-card"),
        entry.holeHighlight.slice().sort(),
        `${entry.name} hole highlight`
      );
      assert.deepEqual(
        renderedCodesWithClass(dom.elements["holdem-board"].innerHTML, "is-hero-made-hand-card"),
        entry.boardHighlight.slice().sort(),
        `${entry.name} board highlight`
      );
    });
  } finally {
    Date.now = originalNow;
  }
});

test("result highlighting dims the unused side when the best cards are only in hole or board", () => {
  const cases = [
    {
      name: "hole-only high card",
      hole: ["As", "Kd"],
      board: ["9h", "7c", "4s", "3d", "2c"],
      winningHole: ["As"],
      mutedHole: ["Kd"],
      winningBoard: [],
      mutedBoard: ["9h", "7c", "4s", "3d", "2c"],
    },
    {
      name: "board-only straight",
      hole: ["As", "Kd"],
      board: ["9h", "8c", "7s", "6d", "5c"],
      winningHole: [],
      mutedHole: ["As", "Kd"],
      winningBoard: ["9h", "8c", "7s", "6d", "5c"],
      mutedBoard: [],
    },
  ];

  cases.forEach((entry, index) => {
    const dom = resultTestDocument();
    const controller = loadController("alice", { document: dom.document });
    const state = controller._test.normalizeSnapshot({
      phase: "hand_end",
      version: 40 + index,
      handId: `result-combo-${index}`,
      handNo: index + 1,
      ownerNick: "alice",
      seats: [
        {
          seat: 0,
          nick: "alice",
          stack: 11000,
          inHand: true,
          cardCount: 2,
          winner: true,
          winAmount: 1000,
        },
      ],
      viewer: { seat: 0, cards: entry.hole },
      board: entry.board,
      pot: 1000,
      pots: [{ amount: 1000, winners: [0] }],
      winners: ["alice"],
      showdown: [{ seat: 0, nick: "alice", cards: entry.hole, winner: true }],
    }, 40 + index);
    controller._test.setState(state);
    controller._test.renderSeats();
    controller._test.renderBoard();

    assert.match(dom.elements["holdem-seats"].innerHTML, /is-winning-combo-review/, entry.name);
    assert.deepEqual(
      renderedCodesWithClass(dom.elements["holdem-seats"].innerHTML, "is-winning-combo-card"),
      entry.winningHole.slice().sort(),
      `${entry.name} winning hole cards`
    );
    assert.deepEqual(
      renderedCodesWithClass(dom.elements["holdem-seats"].innerHTML, "is-winning-combo-muted"),
      entry.mutedHole.slice().sort(),
      `${entry.name} muted hole cards`
    );
    assert.deepEqual(
      renderedCodesWithClass(dom.elements["holdem-board"].innerHTML, "is-winning-combo-card"),
      entry.winningBoard.slice().sort(),
      `${entry.name} winning board cards`
    );
    assert.deepEqual(
      renderedCodesWithClass(dom.elements["holdem-board"].innerHTML, "is-winning-combo-muted"),
      entry.mutedBoard.slice().sort(),
      `${entry.name} muted board cards`
    );
  });
});

test("all-in runout waits for each community card to open before highlighting", () => {
  const originalNow = Date.now;
  let now = 2_000_000_000_000;
  Date.now = () => now;
  const dom = resultTestDocument();
  const controller = loadController("alice", { document: dom.document });
  const active = controller._test.normalizeSnapshot({
    phase: "preflop",
    version: 60,
    handId: "runout-combo",
    handNo: 1,
    ownerNick: "alice",
    seats: [
      { seat: 0, nick: "alice", stack: 0, inHand: true, allIn: true, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 0, inHand: true, allIn: true, cardCount: 2 },
    ],
    viewer: { seat: 0, cards: ["As", "Kd"] },
    board: [],
  }, 60);
  const completed = {
    phase: "hand_end",
    version: 61,
    handId: "runout-combo",
    handNo: 1,
    ownerNick: "alice",
    seats: [
      { seat: 0, nick: "alice", stack: 20000, inHand: true, winner: true, winAmount: 20000, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 0, inHand: true, cardCount: 2 },
    ],
    viewer: { seat: 0, cards: ["As", "Kd"] },
    board: ["Ah", "7s", "4c", "Ad", "Kc"],
    pot: 20000,
    pots: [{ amount: 20000, winners: [0] }],
    winners: ["alice"],
    showdown: [
      { seat: 0, nick: "alice", cards: ["As", "Kd"], winner: true },
      { seat: 1, nick: "bob", cards: ["Qs", "Qd"] },
    ],
  };

  function assertNoRunoutHighlight(visibleCount, label) {
    assert.equal(controller._test.resultStage(), "cards", `${label} result stage`);
    assert.equal(controller._test.resultBoardVisibleCount(), visibleCount, `${label} visible count`);
    assert.deepEqual(
      renderedCodesWithClass(dom.elements["holdem-seats"].innerHTML, "is-hero-made-hand-card"),
      [],
      `${label} hole highlight waits`
    );
    assert.deepEqual(
      renderedCodesWithClass(dom.elements["holdem-board"].innerHTML, "is-hero-made-hand-card"),
      [],
      `${label} board highlight waits`
    );
    assert.equal(renderedFaceCards(dom.elements["holdem-board"].innerHTML).length, visibleCount);
  }

  function assertRunout(expectedHole, expectedBoard, visibleCount, label) {
    assert.equal(controller._test.resultStage(), "cards", `${label} result stage`);
    assert.equal(controller._test.resultBoardVisibleCount(), visibleCount, `${label} visible count`);
    assert.deepEqual(
      renderedCodesWithClass(dom.elements["holdem-seats"].innerHTML, "is-hero-made-hand-card"),
      expectedHole.slice().sort(),
      `${label} hole highlight`
    );
    assert.deepEqual(
      renderedCodesWithClass(dom.elements["holdem-board"].innerHTML, "is-hero-made-hand-card"),
      expectedBoard.slice().sort(),
      `${label} board highlight`
    );
    assert.equal(renderedFaceCards(dom.elements["holdem-board"].innerHTML).length, visibleCount);
  }

  try {
    controller._test.setState(active);
    controller._test.setHasSnapshot(true);
    assert.equal(controller._test.applySnapshot(completed, 61), true);
    controller._test.renderSettlementAnimation();
    assertNoRunoutHighlight(3, "flop opening");

    now += controller._test.constants.communityCardFlipMs +
      (controller._test.constants.communityCardFlipStaggerMs * 2) + 1;
    controller._test.renderSettlementAnimation();
    assertRunout(["As"], ["Ah"], 3, "flop");

    now += controller._test.constants.resultBoardRevealStepMs -
      controller._test.constants.communityCardFlipMs -
      (controller._test.constants.communityCardFlipStaggerMs * 2) - 1;
    controller._test.renderSettlementAnimation();
    assertNoRunoutHighlight(4, "turn opening");

    now += controller._test.constants.communityCardFlipMs + 1;
    controller._test.renderSettlementAnimation();
    assertRunout(["As"], ["Ah", "Ad"], 4, "turn");

    now += controller._test.constants.resultBoardRevealStepMs - controller._test.constants.communityCardFlipMs - 1;
    controller._test.renderSettlementAnimation();
    assertNoRunoutHighlight(5, "river opening");

    now += controller._test.constants.communityRiverFlipMs + 1;
    controller._test.renderSettlementAnimation();
    assertRunout(["As", "Kd"], ["Ah", "Ad", "Kc"], 5, "river");
  } finally {
    controller.leave();
    Date.now = originalNow;
  }
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
      if (action === "snapshot") {
        return Promise.resolve({
          ok: true,
          version: 2,
          snapshot: {
            phase: "hand_end",
            mode: "ring",
            handId: "7",
            canRefill: false,
            viewer: { seat: 0 },
            seats: [{ seat: 0, nick: "alice", stack: 20000 }],
          },
        });
      }
      return Promise.resolve({
        ok: true,
        version: 2,
        snapshot: {
          phase: "hand_end",
          mode: "ring",
          handId: "7",
          canRefill: true,
          viewer: { seat: 0 },
          seats: [{ seat: 0, nick: "alice", stack: 0 }],
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

  const result = await controller._test.refillRingChips();

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.action), ["refill", "snapshot"]);
  assert.equal(calls[0].payload.expectedVersion, 1);
  assert.equal(controller.state.seats[0].stack, 20000);
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

test("room presence sync marks disconnected seats and notifies the server", async () => {
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      return Promise.resolve({
        ok: true,
        version: 2,
        snapshot: {
          phase: "waiting",
          version: 2,
          seats: [
            { seat: 0, nick: "alice", stack: 20000 },
            { seat: 1, nick: "bob", stack: 0, away: true },
          ],
        },
      });
    },
  };
  const controller = loadController("alice", { db });
  const state = controller._test.emptyState();
  state.phase = "hand_end";
  state.version = 1;
  state.heroSeat = 0;
  state.seats[0] = { seat: 0, nick: "alice", stack: 20000 };
  state.seats[1] = { seat: 1, nick: "bob", stack: 0 };
  controller._test.setState(state);
  controller._test.setActive(true);
  controller._test.setHasSnapshot(true);

  controller.onPresence([
    { nick: "alice" },
    { nick: "bob", away: true },
  ], { expiredNick: "bob" });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(controller.state.seats[1].away, true);
  assert.equal(calls[0].action, "presence");
  assert.deepEqual(Array.from(calls[0].payload.presentNicks), ["alice"]);
  assert.deepEqual(Array.from(calls[0].payload.awayNicks), ["bob"]);
});

test("presence received before the first table snapshot is synchronized afterward", async () => {
  const calls = [];
  const db = {
    holdemInvoke(_auth, action, payload) {
      calls.push({ action, payload });
      return Promise.resolve({
        ok: true,
        version: 2,
        snapshot: {
          phase: "hand_end",
          version: 2,
          canReady: true,
          seats: [
            { seat: 0, nick: "alice", stack: 20000, away: false, sittingOut: true },
            { seat: 1, nick: "bob", stack: 20000 },
          ],
          viewer: { seat: 0, cards: [] },
        },
      });
    },
  };
  const controller = loadController("alice", { db });

  try {
    controller._test.setActive(true);
    controller.onPresence([
      { nick: "alice" },
      { nick: "bob" },
    ]);
    assert.equal(calls.length, 0);

    controller._test.applySnapshot({
      phase: "hand_end",
      version: 1,
      canReady: false,
      seats: [
        { seat: 0, nick: "alice", stack: 20000, away: true, sittingOut: true },
        { seat: 1, nick: "bob", stack: 20000 },
      ],
      viewer: { seat: 0, cards: [] },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "presence");
    assert.deepEqual(Array.from(calls[0].payload.presentNicks), ["alice", "bob"]);
    assert.deepEqual(Array.from(calls[0].payload.awayNicks), []);
  } finally {
    controller.leave();
  }
});

test("presence changes during a sync replay the newest roster", async () => {
  const calls = [];
  let resolveFirst;
  const db = {
    holdemInvoke(_auth, action, payload) {
      calls.push({ action, payload });
      if (calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        version: 3,
        snapshot: {
          phase: "hand_end",
          version: 3,
          seats: [
            { seat: 0, nick: "alice", stack: 20000 },
            { seat: 1, nick: "bob", stack: 20000 },
          ],
          viewer: { seat: 0, cards: [] },
        },
      });
    },
  };
  const controller = loadController("alice", { db });
  const state = controller._test.emptyState();
  state.phase = "hand_end";
  state.version = 1;
  state.heroSeat = 0;
  state.seats[0] = { seat: 0, nick: "alice", stack: 20000 };
  state.seats[1] = { seat: 1, nick: "bob", stack: 20000 };

  try {
    controller._test.setState(state);
    controller._test.setActive(true);
    controller._test.setHasSnapshot(true);

    controller.onPresence([
      { nick: "alice" },
      { nick: "bob", away: true },
    ]);
    controller.onPresence([
      { nick: "alice" },
      { nick: "bob" },
    ]);
    assert.equal(calls.length, 1);

    resolveFirst({
      ok: true,
      version: 2,
      snapshot: {
        phase: "hand_end",
        version: 2,
        seats: [
          { seat: 0, nick: "alice", stack: 20000 },
          { seat: 1, nick: "bob", stack: 20000, away: true },
        ],
        viewer: { seat: 0, cards: [] },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls.length, 2);
    assert.equal(calls[1].action, "presence");
    assert.deepEqual(Array.from(calls[1].payload.presentNicks), ["alice", "bob"]);
    assert.deepEqual(Array.from(calls[1].payload.awayNicks), []);
  } finally {
    controller.leave();
  }
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
  assert.equal(calls[0].payload.leaveIntent, "spectate");
});

test("reserved spectating waits until the result review is complete", async () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  const calls = [];
  const db = {
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      return Promise.resolve({
        ok: true,
        version: 20 + calls.length,
        snapshot: calls.length === 1
          ? {
            phase: "flop",
            version: 21,
            handId: "spectate-after-result",
            heroSeat: 0,
            actingSeat: 1,
            seats: [
              { seat: 0, nick: "alice", stack: 5000, inHand: true, leaving: true, leaveIntent: "spectate", cardCount: 2 },
              { seat: 1, nick: "bob", stack: 5000, inHand: true, cardCount: 2 },
            ],
          }
          : { phase: "waiting", version: 22, heroSeat: -1, seats: [] },
      });
    },
  };
  const controller = loadController("alice", { db });
  controller._test.setActive(true);
  controller._test.setHasSnapshot(true);
  controller._test.setState(controller._test.normalizeSnapshot({
    phase: "flop",
    version: 20,
    handId: "spectate-after-result",
    heroSeat: 0,
    actingSeat: 1,
    seats: [
      { seat: 0, nick: "alice", stack: 5000, inHand: true, cardCount: 2 },
      { seat: 1, nick: "bob", stack: 5000, inHand: true, cardCount: 2 },
    ],
  }, 20));

  try {
    await controller._test.leaveTableForSpectate();
    assert.equal(calls.filter((call) => call.action === "leave").length, 1);

    controller._test.applySnapshot({
      phase: "hand_end",
      version: 23,
      handId: "spectate-after-result",
      heroSeat: 0,
      seats: [
        { seat: 0, nick: "alice", stack: 5000, inHand: true, leaving: true, leaveIntent: "spectate", cardCount: 2 },
        { seat: 1, nick: "bob", stack: 10000, winAmount: 5000 },
      ],
      pot: 5000,
      pots: [{ amount: 5000, winners: [1] }],
      winners: ["bob"],
    }, 23);
    assert.equal(calls.filter((call) => call.action === "leave").length, 1);

    now += 20_000;
    controller._test.renderSettlementAnimation();
    await Promise.resolve();
    await Promise.resolve();
    const leaveCalls = calls.filter((call) => call.action === "leave");
    assert.equal(leaveCalls.length, 2);
    assert.equal(leaveCalls[1].payload.leaveIntent, "spectate");
  } finally {
    Date.now = originalNow;
  }
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
      return Promise.resolve({
        ok: true,
        version: 2,
        snapshot: {
          phase: "hand_end",
          mode: "ring",
          viewer: { seat: 0 },
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
  controller._test.setBuyInValue(20000);
  const result = await controller._test.confirmBuyInDialog();

  assert.equal(result.ok, true);
  assert.equal(calls[0].action, "wallet");
  assert.equal(calls[1].action, "rebuy");
  assert.equal(calls[1].payload.amount, 20000);
  assert.equal(calls[2].action, "snapshot");
  assert.equal(controller.state.seats[0].stack, 20000);
  assert.equal(controller._test.getBuyInDialogState().open, false);
  controller.leave();
});

test("another player's profile loads total assets without ranking eligibility", async () => {
  const calls = [];
  const db = {
    getHoldemProfileAsset(auth, targetNick) {
      calls.push({ auth, targetNick });
      return Promise.resolve({
        ok: true,
        asset: { nickname: targetNick, totalAssets: 137500 },
      });
    },
    getHoldemAssetRankingDetail() {
      throw new Error("profile assets must not depend on ranking details");
    },
  };
  const controller = loadController("alice", { db });
  const state = controller._test.emptyState();
  state.heroSeat = 0;
  state.seats[0] = { seat: 0, nick: "alice", stack: 30000 };
  state.seats[1] = { seat: 1, nick: "bob", stack: 25000 };
  controller._test.setState(state);
  controller._test.setActive(true);

  controller._test.openProfileDialog(1);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetNick, "bob");
  assert.equal(calls[0].auth.nick, "alice");
  assert.equal(controller._test.getProfileAssetState().pending, false);
  assert.equal(controller._test.getProfileAssetState().nick, "bob");
  assert.equal(controller._test.getProfileAssetState().totalAssets, 137500);
  controller.leave();
});

test("your ring profile queues an in-hand top up and applies it before the next hand", async () => {
  const calls = [];
  const ui = profileTopUpTestDocument();
  let version = 3;
  let phase = "flop";
  let stack = 25000;
  const storageValues = new Map();
  const localStorage = {
    getItem(key) {
      return storageValues.has(key) ? storageValues.get(key) : null;
    },
    setItem(key, value) {
      storageValues.set(key, String(value));
    },
    removeItem(key) {
      storageValues.delete(key);
    },
  };
  const snapshot = () => ({
    phase,
    mode: "ring",
    version,
    viewer: { seat: 0 },
    seats: [
      { seat: 0, nick: "alice", stack, inHand: phase === "flop" },
      { seat: 1, nick: "bob", stack: 30000, inHand: phase === "flop" },
    ],
    buyInMin: 10000,
    buyInMax: 50000,
    buyInDefault: 30000,
  });
  const db = {
    getHoldemWallet(auth) {
      calls.push({ auth, action: "wallet", payload: {} });
      return Promise.resolve({
        ok: true,
        wallet: { balance: 60000, tableBalance: 0, totalAssets: 60000 },
      });
    },
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      if (action === "rebuy") {
        stack = payload.amount;
        version += 1;
      }
      return Promise.resolve({
        ok: true,
        version,
        snapshot: snapshot(),
      });
    },
  };
  const controller = loadController("alice", {
    db,
    localStorage,
    document: ui.document,
  });
  const state = controller._test.emptyState();
  state.mode = "ring";
  state.phase = phase;
  state.version = version;
  state.heroSeat = 0;
  state.seats[0] = { seat: 0, nick: "alice", stack, inHand: true };
  state.seats[1] = { seat: 1, nick: "bob", stack: 30000, inHand: true };
  state.buyInMin = 10000;
  state.buyInMax = 50000;
  state.buyInDefault = 30000;
  controller._test.setState(state);
  controller._test.setActive(true);
  controller._test.setHasSnapshot(true);

  controller._test.openProfileDialog(0);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controller._test.canShowProfileTopUpForSeat(1), false);
  assert.equal(controller._test.canShowProfileTopUpForSeat(0), true);
  assert.equal(ui.elements["holdem-profile-topup"].classList.contains("hidden"), false);
  assert.equal(ui.elements["holdem-profile-topup-current"].textContent, "25,000원");
  assert.equal(ui.elements["holdem-profile-topup-max"].textContent, "50,000원");
  assert.equal(ui.elements["holdem-profile-topup-confirm"].textContent, "충전 예약");
  assert.match(ui.elements["holdem-profile-topup-status"].textContent, /현재 핸드/);

  controller._test.setProfileTopUpValue(40000);
  const queued = await controller._test.submitProfileTopUp();
  assert.equal(queued.ok, true);
  assert.equal(queued.queued, true);
  assert.equal(controller._test.getProfileTopUpState().queuedAmount, 40000);
  assert.equal(ui.elements["holdem-profile-topup-confirm"].textContent, "예약 변경");
  assert.match(ui.elements["holdem-profile-topup-status"].textContent, /충전 예약 완료/);
  assert.deepEqual(calls.map((call) => call.action), ["wallet"]);

  phase = "hand_end";
  const completed = controller._test.emptyState();
  completed.mode = "ring";
  completed.phase = "complete";
  completed.version = version;
  completed.heroSeat = 0;
  completed.seats[0] = { seat: 0, nick: "alice", stack };
  completed.seats[1] = { seat: 1, nick: "bob", stack: 30000 };
  completed.buyInMin = 10000;
  completed.buyInMax = 50000;
  completed.buyInDefault = 30000;
  controller._test.setState(completed);

  const applied = await controller._test.applyQueuedProfileTopUp();
  assert.equal(applied.ok, true);
  assert.equal(calls.filter((call) => call.action === "rebuy").length, 1);
  assert.equal(calls.find((call) => call.action === "rebuy").payload.amount, 40000);
  assert.equal(controller.state.seats[0].stack, 40000);
  assert.equal(controller._test.getProfileTopUpState().queuedAmount, 0);
  assert.equal(storageValues.size, 0);
  controller.leave();
});

test("opening a ring rebuy picker pauses automatic next hand start", async () => {
  const calls = [];
  const timers = [];
  let stack = 2200;
  const db = {
    getHoldemWallet(auth) {
      calls.push({ auth, action: "wallet", payload: {} });
      return Promise.resolve({
        ok: true,
        wallet: { balance: 90000, tableBalance: 2200, totalAssets: 92200 },
      });
    },
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      if (action === "rebuy") {
        stack = 20000;
        return Promise.resolve({
          ok: true,
          version: 6,
          snapshot: {
            phase: "hand_end",
            mode: "ring",
            viewer: { seat: 0 },
            seats: [
              { seat: 0, nick: "alice", stack },
              { seat: 1, nick: "bob", stack: 20000 },
            ],
          },
        });
      }
      return Promise.resolve({
        ok: true,
        version: 6,
        snapshot: {
          phase: "hand_end",
          mode: "ring",
          viewer: { seat: 0 },
          seats: [
            { seat: 0, nick: "alice", stack },
            { seat: 1, nick: "bob", stack: 20000 },
          ],
        },
      });
    },
  };
  const controller = loadController("alice", {
    db,
    setTimeout(fn, delay) {
      const timer = { fn, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  });
  const state = controller._test.emptyState();
  state.mode = "ring";
  state.phase = "complete";
  state.version = 5;
  state.handId = "5";
  state.heroSeat = 0;
  state.ownerNick = "alice";
  state.canStart = true;
  state.canReady = true;
  state.seats[0] = { seat: 0, nick: "alice", stack: 2200 };
  state.seats[1] = { seat: 1, nick: "bob", stack: 20000 };
  state.buyInMin = 10000;
  state.buyInMax = 20000;
  state.buyInDefault = 15000;
  controller._test.setState(state);
  controller._test.setActive(true);

  controller._test.scheduleAutoNextHand();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].cleared, false);

  controller._test.openBuyInDialog("rebuy", 0);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timers[0].cleared, true);

  await timers[0].fn();
  assert.equal(
    calls.some((call) => call.action === "start"),
    false,
    "a stale auto-start callback must not start a hand while rebuy is open",
  );

  controller._test.setBuyInValue(20000);
  const result = await controller._test.confirmBuyInDialog();
  assert.equal(result.ok, true);
  assert.equal(controller.state.seats[0].stack, 20000);
  assert.equal(controller._test.getBuyInDialogState().open, false);
  assert.equal(calls.some((call) => call.action === "rebuy"), true);
  controller.leave();
});

test("a failed ring rebuy stays open and succeeds without leaving the room", async () => {
  const calls = [];
  let rebuyAttempts = 0;
  let stack = 0;
  let version = 1;
  const snapshot = () => ({
    phase: "hand_end",
    mode: "ring",
    viewer: { seat: 0 },
    seats: [{ seat: 0, nick: "alice", stack }],
  });
  const db = {
    getHoldemWallet(auth) {
      calls.push({ auth, action: "wallet", payload: {} });
      return Promise.resolve({
        ok: true,
        wallet: { balance: 40000, tableBalance: 0, totalAssets: 40000 },
      });
    },
    holdemInvoke(auth, action, payload) {
      calls.push({ auth, action, payload });
      if (action === "rebuy") {
        rebuyAttempts += 1;
        if (rebuyAttempts === 1) {
          return Promise.resolve({
            ok: false,
            reason: "conflict",
            version,
            snapshot: snapshot(),
          });
        }
        stack = 20000;
        version = 2;
      }
      return Promise.resolve({
        ok: true,
        version,
        snapshot: snapshot(),
      });
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
  controller._test.setHasSnapshot(true);

  controller._test.openBuyInDialog("rebuy", 0);
  await Promise.resolve();
  await Promise.resolve();
  controller._test.setBuyInValue(20000);

  const firstResult = await controller._test.confirmBuyInDialog();
  assert.equal(firstResult.ok, false);
  assert.equal(controller.state.seats[0].stack, 0);
  assert.equal(controller._test.getBuyInDialogState().open, true);
  assert.equal(controller._test.getBuyInDialogState().pending, false);

  const secondResult = await controller._test.confirmBuyInDialog();
  assert.equal(secondResult.ok, true);
  assert.equal(controller.state.seats[0].stack, 20000);
  assert.equal(controller._test.getBuyInDialogState().open, false);
  assert.deepEqual(
    calls.map((call) => call.action),
    ["wallet", "rebuy", "snapshot", "rebuy", "snapshot"],
  );
  controller.leave();
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
