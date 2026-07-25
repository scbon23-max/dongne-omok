"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../holdem-engine.js");
const AI = require("../holdem-ai.js");

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function seededRandomInt(seed) {
  const random = seededRandom(seed);
  let chooseFirstButton = true;
  return (max) => {
    if (chooseFirstButton) {
      chooseFirstButton = false;
      return 0;
    }
    return Math.floor(random() * max);
  };
}

function apply(state, command, now, context = {}) {
  const result = Engine.command(state, command, {
    now,
    randomInt: context.randomInt,
    internalBot: context.internalBot,
  });
  assert.equal(result.ok, true, result.reason);
  return result.state;
}

/*
 * Build the observation through the real table engine and its bot-only view.
 * Individual tests then alter only public poker-state fields to create duplicate
 * decisions while preserving the engine's legal-action calculation and firewall.
 */
function startedSixMaxBotTable(seed = 1) {
  let state = Engine.createTable({
    roomId: `ai-match-${seed}`,
    ownerNick: "owner",
    startingStack: 10000,
    smallBlind: 50,
    bigBlind: 100,
  });
  const humans = [
    ["owner", 0],
    ["seat-1", 1],
    ["seat-2", 2],
    ["seat-4", 4],
    ["seat-5", 5],
  ];
  humans.forEach(([nick, seat], index) => {
    state = apply(state, {
      type: "join",
      nick,
      seat,
      requestId: `join:${seed}:${seat}`,
    }, 10 + index);
  });
  state = apply(state, {
    type: "add_bot",
    nick: "owner",
    seat: 3,
    requestId: `add-bot:${seed}`,
  }, 20);
  humans.forEach(([nick], index) => {
    state = apply(state, {
      type: "ready",
      nick,
      ready: true,
      requestId: `ready:${seed}:${index}`,
    }, 30 + index);
  });
  state = apply(state, {
    type: "start",
    nick: "owner",
    requestId: `start:${seed}`,
  }, 50, {
    randomInt: seededRandomInt(seed),
  });
  const bot = state.seats[3];
  assert.equal(bot && bot.isBot, true);
  return { state, botId: bot.botId, botSeat: bot.seat };
}

function duplicateBotSnapshot(base, options = {}) {
  const state = structuredClone(base.state);
  const hero = state.seats[base.botSeat];
  const phase = options.phase || "preflop";
  const board = options.board || [];
  const foldedSeats = new Set(options.foldedSeats || []);
  const activeOpponentSeat = options.activeOpponentSeat == null
    ? 4
    : options.activeOpponentSeat;

  state.phase = phase;
  state.board = board.slice();
  state.buttonSeat = options.buttonSeat == null ? 0 : options.buttonSeat;
  state.smallBlindSeat = options.smallBlindSeat == null ? 1 : options.smallBlindSeat;
  state.bigBlindSeat = options.bigBlindSeat == null ? 2 : options.bigBlindSeat;
  state.actorSeat = base.botSeat;
  state.currentBet = options.currentBet == null ? 0 : options.currentBet;
  state.lastFullRaiseSize = options.lastFullRaiseSize == null
    ? state.settings.bigBlind
    : options.lastFullRaiseSize;
  state.pendingSeats = [base.botSeat];
  state.actionHistory = [];
  state.pots = [];
  state.showdown = [];

  state.seats.forEach((seat, index) => {
    if (!seat) return;
    seat.inHand = true;
    seat.folded = foldedSeats.has(index);
    seat.allIn = false;
    seat.leaving = false;
    seat.stack = options.stack == null ? 9000 : options.stack;
    seat.streetBet = 0;
    seat.totalBet = options.defaultContribution == null
      ? 0
      : options.defaultContribution;
    seat.lastAction = seat.folded ? "fold" : "";
    seat.lastActionBet = null;
  });

  hero.cards = (options.heroCards || ["9c", "8c"]).slice();
  hero.botPersonality = options.botPersonality || hero.botPersonality;
  hero.folded = false;
  hero.streetBet = options.heroStreetBet == null ? 0 : options.heroStreetBet;
  hero.totalBet = options.heroContribution == null
    ? hero.totalBet
    : options.heroContribution;

  const opponent = state.seats[activeOpponentSeat];
  if (opponent) {
    opponent.streetBet = options.opponentStreetBet == null
      ? opponent.streetBet
      : options.opponentStreetBet;
    opponent.totalBet = options.opponentContribution == null
      ? opponent.totalBet
      : options.opponentContribution;
    opponent.lastAction = options.opponentLastAction || opponent.lastAction;
  }

  const snapshot = Engine.botView(state, base.botId);
  assert.ok(snapshot, "the real engine produced a bot view");
  assert.equal(snapshot.actorSeat, base.botSeat);
  assert.deepEqual(snapshot.viewer.cards, hero.cards);
  assert.ok(snapshot.viewer.legalActions.actions.length > 0);
  return snapshot;
}

function countActions(snapshot, seeds, simulations, predicate) {
  let count = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const decision = AI.decide(snapshot, {
      simulations,
      random: seededRandom(0x9e3779b9 ^ Math.imul(seed, 2654435761)),
    });
    assert.equal(
      snapshot.viewer.legalActions.actions.includes(decision.action),
      true,
      `single AI returned illegal ${decision.action}`,
    );
    if (predicate(decision)) count += 1;
  }
  return count;
}

function isAggressive(decision) {
  return decision.action === "bet" ||
    decision.action === "raise" ||
    decision.action === "allin";
}

test("all four personalities share the same strong profile and retain mixed play", () => {
  assert.equal(AI.PROFILE.samples, 192);
  assert.equal(Object.hasOwn(AI.PROFILE, "noise"), false);
  assert.equal(Object.hasOwn(AI.PROFILE, "mistakeRate"), false);
  assert.deepEqual(
    Object.keys(AI.PERSONALITIES),
    ["tight_passive", "tight_aggressive", "loose_passive", "loose_aggressive"],
  );
  Object.values(AI.PERSONALITIES).forEach((personality) => {
    assert.ok(personality.bluffMultiplier > 0);
    assert.ok(Math.abs(personality.rangeBias) <= 0.025);
    assert.ok(Math.abs(personality.aggressionBias) <= 0.05);
  });
});

test("seeded duplicate preflop decisions make the AI looser on the button than UTG", {
  timeout: 15000,
}, () => {
  const base = startedSixMaxBotTable(7001);
  const common = {
    phase: "preflop",
    heroCards: ["9c", "8c"],
    currentBet: 100,
    lastFullRaiseSize: 100,
    stack: 9900,
    defaultContribution: 0,
    heroContribution: 0,
    heroStreetBet: 0,
    opponentStreetBet: 100,
    opponentContribution: 100,
    opponentLastAction: "big_blind",
  };
  const utg = duplicateBotSnapshot(base, {
    ...common,
    buttonSeat: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    activeOpponentSeat: 2,
  });
  const button = duplicateBotSnapshot(base, {
    ...common,
    buttonSeat: 3,
    smallBlindSeat: 4,
    bigBlindSeat: 5,
    activeOpponentSeat: 5,
    foldedSeats: [0, 1, 2],
  });

  const runs = 80;
  const utgAggression = countActions(utg, runs, 8, isAggressive);
  const buttonAggression = countActions(button, runs, 8, isAggressive);

  assert.ok(
    buttonAggression >= utgAggression + Math.floor(runs * 0.35),
    `button aggression ${buttonAggression}/${runs}, UTG ${utgAggression}/${runs}`,
  );
});

test("loose personalities enter a wider marginal range without changing the strength core", {
  timeout: 15000,
}, () => {
  const base = startedSixMaxBotTable(7101);
  const common = {
    phase: "preflop",
    heroCards: ["Ac", "2c"],
    currentBet: 100,
    lastFullRaiseSize: 100,
    stack: 9900,
    defaultContribution: 0,
    heroContribution: 0,
    heroStreetBet: 0,
    opponentStreetBet: 100,
    opponentContribution: 100,
    opponentLastAction: "big_blind",
    buttonSeat: 3,
    smallBlindSeat: 4,
    bigBlindSeat: 5,
    activeOpponentSeat: 5,
    foldedSeats: [0, 1, 2],
  };
  const tight = duplicateBotSnapshot(base, {
    ...common,
    botPersonality: "tight_aggressive",
  });
  const loose = duplicateBotSnapshot(base, {
    ...common,
    botPersonality: "loose_aggressive",
  });
  assert.equal(tight.botPersonality, "tight_aggressive");
  assert.equal(loose.botPersonality, "loose_aggressive");

  const runs = 160;
  const tightAggression = countActions(tight, runs, 8, isAggressive);
  const looseAggression = countActions(loose, runs, 8, isAggressive);
  assert.ok(
    looseAggression >= tightAggression + Math.floor(runs * 0.45),
    `loose aggression ${looseAggression}/${runs}, tight ${tightAggression}/${runs}`,
  );
});

test("passive and aggressive personalities keep mixed betting but shift frequency and size", {
  timeout: 20000,
}, () => {
  const base = startedSixMaxBotTable(7201);
  const common = {
    phase: "river",
    heroCards: ["Ah", "Qd"],
    board: ["Qc", "9s", "7h", "4d", "2s"],
    buttonSeat: 3,
    smallBlindSeat: 4,
    bigBlindSeat: 3,
    foldedSeats: [0, 1, 2, 5],
    activeOpponentSeat: 4,
    currentBet: 0,
    stack: 5000,
    defaultContribution: 600,
    heroContribution: 600,
    opponentContribution: 600,
    opponentLastAction: "check",
  };
  const passive = duplicateBotSnapshot(base, {
    ...common,
    botPersonality: "tight_passive",
  });
  const aggressive = duplicateBotSnapshot(base, {
    ...common,
    botPersonality: "tight_aggressive",
  });
  const passiveSizes = [];
  const aggressiveSizes = [];
  const runs = 240;
  const passiveBets = countActions(passive, runs, 16, (decision) => {
    if (isAggressive(decision) && Number.isInteger(decision.amount)) {
      passiveSizes.push(decision.amount);
    }
    return isAggressive(decision);
  });
  const aggressiveBets = countActions(aggressive, runs, 16, (decision) => {
    if (isAggressive(decision) && Number.isInteger(decision.amount)) {
      aggressiveSizes.push(decision.amount);
    }
    return isAggressive(decision);
  });
  const passiveAverage = passiveSizes.reduce((sum, amount) => sum + amount, 0) /
    Math.max(1, passiveSizes.length);
  const aggressiveAverage = aggressiveSizes.reduce((sum, amount) => sum + amount, 0) /
    Math.max(1, aggressiveSizes.length);

  assert.ok(passiveBets > 0 && passiveBets < runs, `passive bets ${passiveBets}/${runs}`);
  assert.ok(aggressiveBets > 0 && aggressiveBets < runs, `aggressive bets ${aggressiveBets}/${runs}`);
  assert.ok(
    aggressiveBets >= passiveBets + Math.floor(runs * 0.04),
    `aggressive bets ${aggressiveBets}/${runs}, passive ${passiveBets}/${runs}`,
  );
  assert.ok(
    aggressiveAverage > passiveAverage * 1.15,
    `aggressive average ${aggressiveAverage}, passive ${passiveAverage}`,
  );
});

test("every style retains bounded bluffs and the strong core suppresses them multiway", {
  timeout: 20000,
}, () => {
  const base = startedSixMaxBotTable(7301);
  const common = {
    phase: "river",
    heroCards: ["3c", "2d"],
    board: ["Ah", "Kh", "Qh", "8s", "7c"],
    buttonSeat: 3,
    smallBlindSeat: 4,
    bigBlindSeat: 3,
    activeOpponentSeat: 4,
    currentBet: 0,
    stack: 5000,
    defaultContribution: 600,
    heroContribution: 600,
    opponentContribution: 600,
    opponentLastAction: "check",
  };
  const passiveHeadsUp = duplicateBotSnapshot(base, {
    ...common,
    foldedSeats: [0, 1, 2, 5],
    botPersonality: "loose_passive",
  });
  const aggressiveHeadsUp = duplicateBotSnapshot(base, {
    ...common,
    foldedSeats: [0, 1, 2, 5],
    botPersonality: "loose_aggressive",
  });
  const aggressiveMultiway = duplicateBotSnapshot(base, {
    ...common,
    foldedSeats: [],
    botPersonality: "loose_aggressive",
  });
  const runs = 240;
  const passiveBluffs = countActions(passiveHeadsUp, runs, 8, isAggressive);
  const aggressiveBluffs = countActions(aggressiveHeadsUp, runs, 8, isAggressive);
  const multiwayBluffs = countActions(aggressiveMultiway, runs, 8, isAggressive);

  assert.ok(passiveBluffs > 0, `passive bluffs ${passiveBluffs}/${runs}`);
  assert.ok(
    aggressiveBluffs > passiveBluffs,
    `aggressive bluffs ${aggressiveBluffs}/${runs}, passive ${passiveBluffs}/${runs}`,
  );
  assert.ok(
    aggressiveBluffs < Math.floor(runs * 0.2),
    `aggressive bluff rate stayed bounded at ${aggressiveBluffs}/${runs}`,
  );
  assert.ok(
    multiwayBluffs * 3 < aggressiveBluffs,
    `multiway bluffs ${multiwayBluffs}/${runs}, heads-up ${aggressiveBluffs}/${runs}`,
  );
});

test("the single profile captures clear value and a thin profitable call", {
  timeout: 20000,
}, () => {
  const base = startedSixMaxBotTable(8001);
  const onlyHeroAndSeat4 = [0, 1, 2, 5];

  // Ah-Kh is the unique royal flush. With action checked to the bot, this
  // curated scenario checks whether stronger profiles miss less value.
  const lockedNuts = duplicateBotSnapshot(base, {
    phase: "river",
    heroCards: ["Ah", "Kh"],
    board: ["Qh", "Jh", "Th", "2c", "3d"],
    buttonSeat: 3,
    smallBlindSeat: 4,
    bigBlindSeat: 3,
    foldedSeats: onlyHeroAndSeat4,
    activeOpponentSeat: 4,
    currentBet: 0,
    stack: 5000,
    defaultContribution: 600,
    heroContribution: 600,
    opponentContribution: 600,
    opponentLastAction: "check",
  });

  /*
   * This one-pair river has about 47% equity against an unknown legal holding.
   * Calling 100 into the 113-chip contestable pot needs 46.95%. It deliberately
   * sits near the boundary where more samples, exact pot odds, and the lower
   * strong-profile call margin matter instead of relying on whole-match variance.
   */
  const thinProfitableCall = duplicateBotSnapshot(base, {
    phase: "river",
    heroCards: ["Ah", "2d"],
    board: ["Qc", "9s", "7h", "4d", "2s"],
    buttonSeat: 3,
    smallBlindSeat: 4,
    bigBlindSeat: 3,
    foldedSeats: onlyHeroAndSeat4,
    activeOpponentSeat: 4,
    currentBet: 100,
    lastFullRaiseSize: 100,
    stack: 5000,
    defaultContribution: 0,
    heroContribution: 6,
    heroStreetBet: 0,
    opponentStreetBet: 100,
    opponentContribution: 107,
    opponentLastAction: "call",
  });
  assert.equal(thinProfitableCall.pot, 113);
  assert.equal(thinProfitableCall.viewer.legalActions.callAmount, 100);

  const valueBets = countActions(lockedNuts, 120, 8, isAggressive);
  const correctThinCalls = countActions(
    thinProfitableCall,
    80,
    64,
    (decision) => decision.action === "call",
  );

  assert.ok(valueBets >= 80, `value bets ${valueBets}/120`);
  assert.ok(correctThinCalls >= 35, `thin profitable calls ${correctThinCalls}/80`);
});
