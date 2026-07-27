"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const Engine = require("../holdem-engine.js");
const AI = require("../holdem-ai.js");

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffledDeck(seed) {
  const random = seededRandom(seed);
  const deck = Engine.makeDeck();
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function observation(options = {}) {
  const heroCards = options.heroCards || ["Ah", "Kd"];
  const board = options.board || [];
  const phase = options.phase || (
    board.length === 3 ? "flop" :
      board.length === 4 ? "turn" :
        board.length === 5 ? "river" : "preflop"
  );
  const opponentCount = options.opponentCount == null ? 1 : options.opponentCount;
  const legal = Object.assign({
    actions: ["fold", "call", "raise", "allin"],
    callAmount: 50,
    minBet: null,
    minRaiseTo: 200,
    maxRaiseTo: 10000,
    pot: 150,
    currentBet: 100,
    streetBet: 50,
    stack: 9950,
  }, options.legal || {});
  const botPersonality = options.botPersonality || "tight_aggressive";
  const seats = [{
    seat: 0,
    nick: "hero-bot",
    botPersonality,
    stack: legal.stack,
    inHand: true,
    folded: false,
    allIn: false,
    streetBet: legal.streetBet,
    totalBet: legal.streetBet,
    lastAction: "",
  }];
  for (let seat = 1; seat <= opponentCount; seat += 1) {
    seats.push({
      seat,
      nick: `opponent-${seat}`,
      stack: 10000 - seat * 100,
      inHand: true,
      folded: false,
      allIn: false,
      streetBet: legal.currentBet,
      totalBet: legal.currentBet,
      lastAction: seat % 3 === 0 ? "raise" : "call",
    });
  }
  while (seats.length < 6) seats.push(null);

  return {
    botPersonality,
    phase,
    board,
    seats,
    actorSeat: 0,
    buttonSeat: options.buttonSeat == null ? Math.min(1, opponentCount) : options.buttonSeat,
    smallBlindSeat: 0,
    bigBlindSeat: Math.min(1, opponentCount),
    pot: legal.pot,
    currentBet: legal.currentBet,
    settings: {
      smallBlind: 100,
      bigBlind: 200,
    },
    actionHistory: options.actionHistory || [],
    viewer: {
      seat: 0,
      cards: heroCards,
      legalActions: legal,
    },
  };
}

function assertLegalDecision(decision, legal, context) {
  assert.equal(
    legal.actions.includes(decision.action),
    true,
    `${context}: ${decision.action} is not one of ${legal.actions.join(", ")}`,
  );
  if (decision.action === "bet") {
    assert.equal(Number.isInteger(decision.amount), true, `${context}: bet amount is an integer`);
    assert.ok(decision.amount >= legal.minBet, `${context}: bet is at least the minimum`);
    assert.ok(decision.amount <= legal.maxRaiseTo, `${context}: bet is at most the stack cap`);
  } else if (decision.action === "raise") {
    assert.equal(Number.isInteger(decision.amount), true, `${context}: raise amount is an integer`);
    assert.ok(decision.amount >= legal.minRaiseTo, `${context}: raise is at least the minimum`);
    assert.ok(decision.amount <= legal.maxRaiseTo, `${context}: raise is at most the stack cap`);
  } else {
    assert.equal(
      Object.hasOwn(decision, "amount"),
      false,
      `${context}: ${decision.action} should not carry a betting amount`,
    );
  }
}

test("the information firewall ignores deck, burn cards, and every opponent-card field", () => {
  const clean = observation({
    heroCards: ["As", "Qd"],
    board: ["2c", "7h", "Jd"],
    phase: "flop",
    legal: {
      actions: ["check", "bet", "allin"],
      callAmount: 0,
      minBet: 100,
      minRaiseTo: null,
      maxRaiseTo: 9950,
      pot: 600,
      currentBet: 0,
      streetBet: 0,
      stack: 9950,
    },
  });
  const poisoned = structuredClone(clean);
  poisoned.deck = ["Ac", "Ad", "Kc"];
  poisoned.burn = ["Kh", "Ks"];
  poisoned.burnCards = ["Qc"];
  poisoned.seats[1].cards = ["Jh", "Js"];
  poisoned.seats[1].holeCards = ["Th", "Ts"];
  poisoned.seats[1].privateCards = ["9h", "9s"];

  const cleanSanitized = AI.sanitizeObservation(clean);
  const poisonedSanitized = AI.sanitizeObservation(poisoned);
  assert.deepEqual(poisonedSanitized, cleanSanitized);
  assert.equal(Object.hasOwn(poisonedSanitized, "deck"), false);
  assert.equal(Object.hasOwn(poisonedSanitized, "burn"), false);
  assert.equal(Object.hasOwn(poisonedSanitized.seats[1], "cards"), false);
  ["Ac", "Ad", "Kc", "Kh", "Ks", "Jh", "Js", "Th", "Ts", "9h", "9s"].forEach((card) => {
    assert.equal(JSON.stringify(poisonedSanitized).includes(`"${card}"`), false);
  });

  const optionsA = { simulations: 64, random: seededRandom(90210) };
  const optionsB = { simulations: 64, random: seededRandom(90210) };
  assert.deepEqual(AI.decide(poisoned, optionsA), AI.decide(clean, optionsB));
});

test("pot odds exclude chips in a side pot the short-stacked hero cannot win", () => {
  const snapshot = observation({
    heroCards: ["Ah", "Qd"],
    board: ["2c", "7h", "Jd", "9s"],
    phase: "turn",
    opponentCount: 2,
    legal: {
      actions: ["fold", "call", "allin"],
      callAmount: 100,
      minBet: null,
      minRaiseTo: null,
      maxRaiseTo: 100,
      pot: 10300,
      currentBet: 100,
      streetBet: 0,
      stack: 100,
    },
  });
  snapshot.seats[0].totalBet = 100;
  snapshot.seats[1].totalBet = 200;
  snapshot.seats[2].totalBet = 10000;
  snapshot.seats[2].folded = true;

  assert.equal(AI.contestablePot(snapshot), 500);
  assert.notEqual(AI.contestablePot(snapshot), snapshot.pot);
});

test("a fresh seeded random stream reproduces equity estimates and decisions exactly", () => {
  const snapshot = observation({
    heroCards: ["Tc", "9c"],
    board: ["8c", "7d", "2s"],
    phase: "flop",
    opponentCount: 3,
    legal: {
      actions: ["fold", "call", "raise", "allin"],
      callAmount: 300,
      minBet: null,
      minRaiseTo: 900,
      maxRaiseTo: 9800,
      pot: 1200,
      currentBet: 500,
      streetBet: 200,
      stack: 9800,
    },
  });
  const equityA = AI.estimateEquity(snapshot, {
    simulations: 96,
    random: seededRandom(4444),
  });
  const equityB = AI.estimateEquity(snapshot, {
    simulations: 96,
    random: seededRandom(4444),
  });
  assert.equal(equityA, equityB);

  const decisionA = AI.decide(snapshot, {
    simulations: 96,
    random: seededRandom(7717),
  });
  const decisionB = AI.decide(snapshot, {
    simulations: 96,
    random: seededRandom(7717),
  });
  assert.deepEqual(decisionA, decisionB);
});

test("one strong engine exposes the four exact personality names without mistake settings", () => {
  assert.equal(AI.PROFILE.samples, 192);
  assert.equal(Object.hasOwn(AI.PROFILE, "noise"), false);
  assert.equal(Object.hasOwn(AI.PROFILE, "mistakeRate"), false);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(AI.PERSONALITIES).map(([id, personality]) => [id, personality.label]),
    ),
    {
      tight_passive: "타이트 패시브",
      tight_aggressive: "타이트 어그레시브",
      loose_passive: "루즈 패시브",
      loose_aggressive: "루즈 어그레시브",
    },
  );
  Object.values(AI.PERSONALITIES).forEach((personality) => {
    assert.equal(Object.hasOwn(personality, "samples"), false);
    assert.equal(Object.hasOwn(personality, "noise"), false);
    assert.equal(Object.hasOwn(personality, "mistakeRate"), false);
    assert.ok(personality.bluffMultiplier > 0);
  });
});

test("the single AI always returns legal actions and bounded betting amounts", () => {
  const scenarios = [
    observation({
      heroCards: ["Ah", "Ad"],
      opponentCount: 5,
      legal: {
        actions: ["fold", "call", "raise", "allin"],
        callAmount: 200,
        minBet: null,
        minRaiseTo: 600,
        maxRaiseTo: 9500,
        pot: 900,
        currentBet: 300,
        streetBet: 100,
        stack: 9500,
      },
    }),
    observation({
      heroCards: ["Ah", "Kh"],
      board: ["Qh", "Jh", "2c"],
      phase: "flop",
      opponentCount: 2,
      legal: {
        actions: ["check", "bet", "allin"],
        callAmount: 0,
        minBet: 100,
        minRaiseTo: null,
        maxRaiseTo: 9900,
        pot: 800,
        currentBet: 0,
        streetBet: 0,
        stack: 9900,
      },
    }),
    observation({
      heroCards: ["7c", "2d"],
      board: ["Ah", "Ks", "Qh", "Jc", "9s"],
      phase: "river",
      legal: {
        actions: ["fold", "call", "allin"],
        callAmount: 1200,
        minBet: null,
        minRaiseTo: null,
        maxRaiseTo: 4000,
        pot: 1800,
        currentBet: 1200,
        streetBet: 0,
        stack: 4000,
      },
    }),
    observation({
      heroCards: ["4c", "4d"],
      board: ["As", "Kd", "Qh", "2c"],
      phase: "turn",
      legal: {
        actions: ["check"],
        callAmount: 0,
        minBet: null,
        minRaiseTo: null,
        maxRaiseTo: 0,
        pot: 500,
        currentBet: 0,
        streetBet: 0,
        stack: 0,
      },
    }),
  ];

  scenarios.forEach((snapshot, scenarioIndex) => {
    const decision = AI.decide(snapshot, {
      simulations: 32,
      random: seededRandom(1000 + scenarioIndex),
    });
    assertLegalDecision(
      decision,
      snapshot.viewer.legalActions,
      `single AI scenario ${scenarioIndex}`,
    );
  });
});

test("preflop strength clearly ranks pocket aces above seven-deuce offsuit", () => {
  const aces = AI.preflopStrength(["Ah", "Ad"]);
  const sevenDeuce = AI.preflopStrength(["7c", "2d"]);
  assert.ok(aces > 0.9, `pocket aces score was ${aces}`);
  assert.ok(sevenDeuce < 0.25, `seven-deuce score was ${sevenDeuce}`);
  assert.ok(aces - sevenDeuce > 0.65);
});

test("Monte Carlo equity recognizes a locked royal flush and a weak river holding", () => {
  const nuts = observation({
    heroCards: ["Ah", "Kh"],
    board: ["Qh", "Jh", "Th", "2c", "3d"],
    phase: "river",
    opponentCount: 5,
  });
  const weak = observation({
    heroCards: ["2c", "3d"],
    board: ["Ah", "Kh", "Qh", "Jh", "9s"],
    phase: "river",
    opponentCount: 3,
  });
  const nutsEquity = AI.estimateEquity(nuts, {
    simulations: 128,
    random: seededRandom(11),
  });
  const weakEquity = AI.estimateEquity(weak, {
    simulations: 256,
    random: seededRandom(12),
  });

  assert.ok(nutsEquity > 0.95, `locked-nuts equity was ${nutsEquity}`);
  assert.ok(weakEquity >= 0 && weakEquity < 0.2, `weak equity was ${weakEquity}`);
  assert.ok(nutsEquity > weakEquity);
});

test("generated observations never produce an illegal or out-of-range action", { timeout: 15000 }, () => {
  const phases = [
    { name: "preflop", boardCount: 0 },
    { name: "flop", boardCount: 3 },
    { name: "turn", boardCount: 4 },
    { name: "river", boardCount: 5 },
  ];
  const legalPatterns = [
    {
      actions: ["check", "bet", "allin"],
      callAmount: 0,
      minBet: 100,
      minRaiseTo: null,
      maxRaiseTo: 7000,
      pot: 500,
      currentBet: 0,
      streetBet: 0,
      stack: 7000,
    },
    {
      actions: ["fold", "call", "raise", "allin"],
      callAmount: 250,
      minBet: null,
      minRaiseTo: 800,
      maxRaiseTo: 7000,
      pot: 1100,
      currentBet: 500,
      streetBet: 250,
      stack: 7000,
    },
    {
      actions: ["fold", "call", "allin"],
      callAmount: 900,
      minBet: null,
      minRaiseTo: null,
      maxRaiseTo: 1400,
      pot: 700,
      currentBet: 900,
      streetBet: 0,
      stack: 1400,
    },
    {
      actions: ["check"],
      callAmount: 0,
      minBet: null,
      minRaiseTo: null,
      maxRaiseTo: 0,
      pot: 400,
      currentBet: 0,
      streetBet: 0,
      stack: 0,
    },
  ];
  const personalities = Object.keys(AI.PERSONALITIES);

  for (let index = 0; index < 96; index += 1) {
    const phase = phases[index % phases.length];
    const deck = shuffledDeck(50000 + index);
    const legal = structuredClone(legalPatterns[index % legalPatterns.length]);
    const snapshot = observation({
      heroCards: deck.slice(0, 2),
      board: deck.slice(2, 2 + phase.boardCount),
      phase: phase.name,
      botPersonality: personalities[index % personalities.length],
      opponentCount: 1 + (index % 5),
      buttonSeat: index % (2 + (index % 5)),
      legal,
      actionHistory: [
        {
          seq: index,
          street: phase.name,
          seat: 1,
          action: index % 3 === 0 ? "raise" : "call",
          amount: 100 + index,
          potBefore: Math.max(0, legal.pot - 100),
          currentBetBefore: legal.currentBet,
        },
      ],
    });
    const decision = AI.decide(snapshot, {
      simulations: 8,
      random: seededRandom(index * 31 + 1),
    });
    assertLegalDecision(
      decision,
      legal,
      `${personalities[index % personalities.length]} generated case ${index}`,
    );
  }
});

test("a maximum-sample six-player equity calculation stays within a generous CPU ceiling", {
  timeout: 10000,
}, () => {
  const snapshot = observation({
    heroCards: ["As", "Ks"],
    board: [],
    phase: "preflop",
    opponentCount: 5,
  });
  const started = performance.now();
  const equity = AI.estimateEquity(snapshot, {
    simulations: 512,
    random: seededRandom(987654321),
  });
  const elapsedMs = performance.now() - started;

  assert.ok(equity >= 0 && equity <= 1);
  assert.ok(elapsedMs < 4000, `512-sample six-player equity took ${elapsedMs.toFixed(1)} ms`);
});
