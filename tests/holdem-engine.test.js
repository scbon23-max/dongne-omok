"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../holdem-engine.js");

function context(now = 1) {
  return { now, randomInt: () => 0 };
}

function apply(state, command, now = 1) {
  const result = Engine.command(state, command, context(now));
  assert.equal(result.ok, true, result.reason);
  return result.state;
}

function tableWithPlayers(names, options = {}) {
  let state = Engine.createTable(Object.assign({
    roomId: "room-test",
    ownerNick: names[0],
  }, options));
  names.forEach((nick, index) => {
    state = apply(state, {
      type: "join",
      nick,
      requestId: `join:${index}`,
    }, index + 1);
  });
  return state;
}

function readyAndStart(state, names, now = 100) {
  names.forEach((nick, index) => {
    state = apply(state, {
      type: "ready",
      nick,
      ready: true,
      requestId: `ready:${index}:${now}`,
    }, now + index);
  });
  return apply(state, {
    type: "start",
    nick: names[0],
    requestId: `start:${now}`,
  }, now + names.length);
}

test("a deck contains 52 unique standard cards and deterministic shuffle preserves them", () => {
  const deck = Engine.makeDeck();
  const shuffled = Engine.shuffleDeck(() => 0);
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
  assert.equal(shuffled.length, 52);
  assert.deepEqual([...shuffled].sort(), [...deck].sort());
});

test("five-of-seven evaluation handles every rank family, kickers, and the wheel", () => {
  const cases = [
    [["Ah", "Kh", "Qh", "Jh", "Th", "2c", "3d"], 8, "로열 플러시"],
    [["9c", "9d", "9h", "9s", "Ac", "2d", "3h"], 7, "포카드"],
    [["Kh", "Kd", "Ks", "2c", "2d", "9s", "8h"], 6, "풀하우스"],
    [["Ah", "Jh", "8h", "4h", "2h", "Ks", "Qd"], 5, "플러시"],
    [["9c", "8d", "7h", "6s", "5c", "Ad", "2h"], 4, "스트레이트"],
    [["Qc", "Qd", "Qh", "As", "9c", "4d", "2h"], 3, "트리플"],
    [["Jc", "Jd", "8h", "8s", "Ac", "4d", "2h"], 2, "투페어"],
    [["Tc", "Td", "Ah", "Ks", "8c", "4d", "2h"], 1, "원페어"],
    [["Ac", "Kd", "9h", "7s", "4c", "3d", "2h"], 0, "하이카드"],
  ];
  cases.forEach(([cards, category, name]) => {
    const result = Engine.evaluateSeven(cards);
    assert.equal(result.category, category);
    assert.equal(result.name, name);
  });
  const wheel = Engine.evaluateSeven(["Ac", "2d", "3h", "4s", "5c", "Kd", "Qh"]);
  const sixHigh = Engine.evaluateSeven(["2c", "3d", "4h", "5s", "6c", "Kd", "Qh"]);
  assert.deepEqual(wheel.tiebreak, [5]);
  assert.equal(Engine.compareEvaluations(sixHigh, wheel), 1);
});

test("heads-up uses the button as small blind and swaps pre/post-flop action", () => {
  const names = ["alice", "bob"];
  let state = tableWithPlayers(names);
  state = readyAndStart(state, names);

  assert.equal(state.buttonSeat, 0);
  assert.equal(state.smallBlindSeat, 0);
  assert.equal(state.bigBlindSeat, 1);
  assert.equal(state.actorSeat, 0);
  assert.equal(state.seats[0].streetBet, 50);
  assert.equal(state.seats[1].streetBet, 100);

  state = apply(state, { type: "act", nick: "alice", action: "call" }, 110);
  assert.equal(state.actorSeat, 1);
  state = apply(state, { type: "act", nick: "bob", action: "check" }, 111);
  assert.equal(state.phase, "flop");
  assert.equal(state.board.length, 3);
  assert.equal(state.actorSeat, 1, "big blind acts first after the flop");
});

test("any two ready players can start while unready seats safely sit out", () => {
  const names = ["owner", "guest", "away"];
  let state = tableWithPlayers(names);
  state = apply(state, {
    type: "ready",
    nick: "owner",
    ready: true,
  }, 20);
  state = apply(state, {
    type: "ready",
    nick: "guest",
    ready: true,
  }, 21);

  assert.equal(Engine.view(state, "guest").canStart, true);
  assert.equal(Engine.view(state, "away").canStart, false);
  state = apply(state, {
    type: "start",
    nick: "guest",
  }, 22);

  assert.equal(state.phase, "preflop");
  assert.equal(state.seats[0].inHand, true);
  assert.equal(state.seats[1].inHand, true);
  assert.equal(state.seats[2].inHand, false);
  assert.equal(state.seats[2].waiting, true);
});

test("a full raise sets the minimum and cumulative short all-ins reopen action", () => {
  const names = ["d", "b", "c", "a"];
  let state = tableWithPlayers(names);
  state.seats[0].stack = 2000;
  state.seats[1].stack = 400;
  state.seats[2].stack = 500;
  state.seats[3].stack = 2000;
  state = readyAndStart(state, names);

  assert.equal(state.actorSeat, 3);
  state = apply(state, { type: "act", nick: "a", action: "raise", amount: 300 }, 110);
  assert.equal(state.lastFullRaiseSize, 200);
  state = apply(state, { type: "act", nick: "d", action: "call" }, 111);
  state = apply(state, { type: "act", nick: "b", action: "allin" }, 112);
  assert.equal(state.currentBet, 400);

  const singleShort = apply(state, { type: "act", nick: "c", action: "call" }, 113);
  assert.equal(singleShort.actorSeat, 3);
  const notReopened = Engine.legalActions(singleShort, "a").actions;
  assert.equal(notReopened.includes("raise"), false);
  assert.equal(notReopened.includes("allin"), false);

  state = apply(state, { type: "act", nick: "c", action: "allin" }, 113);
  assert.equal(state.currentBet, 500);
  assert.equal(state.actorSeat, 3);
  const reopened = Engine.legalActions(state, "a");
  assert.equal(reopened.actions.includes("raise"), true);
  assert.equal(reopened.minRaiseTo, 700);
});

test("side pots keep folded chips, return uncalled excess, and split layers independently", () => {
  const layers = Engine.buildSidePots([
    { seat: 0, nick: "a", committed: 100, folded: false },
    { seat: 1, nick: "b", committed: 300, folded: false },
    { seat: 2, nick: "c", committed: 500, folded: true },
  ]);
  assert.deepEqual(layers.pots.map((pot) => pot.amount), [300, 400]);
  assert.deepEqual(layers.pots[0].eligible, [0, 1]);
  assert.deepEqual(layers.pots[1].eligible, [1]);
  assert.deepEqual(layers.refunds, [{ seat: 2, nick: "c", amount: 200 }]);

  assert.deepEqual(Engine.clockwiseWinnerOrder([0, 2, 4], 1, 6), [2, 4, 0]);
});

test("personalized views never contain the deck, burns, or unrevealed opponent cards", () => {
  const names = ["alice", "bob", "carol"];
  let state = tableWithPlayers(names);
  state = readyAndStart(state, names);
  const view = Engine.view(state, "alice");
  const alice = view.seats.find((player) => player && player.nick === "alice");
  const bob = view.seats.find((player) => player && player.nick === "bob");

  assert.equal(alice.cards.length, 2);
  assert.equal(Object.hasOwn(bob, "cards"), false);
  assert.equal(bob.cardCount, 2);
  assert.equal(Object.hasOwn(view, "deck"), false);
  assert.equal(Object.hasOwn(view, "burn"), false);
  const serialized = JSON.stringify(view);
  state.seats.find((player) => player && player.nick === "bob").cards.forEach((card) => {
    assert.equal(serialized.includes(`"${card}"`), false);
  });
});

test("check/call play reaches showdown and conserves every chip", () => {
  const names = ["a", "b", "c", "d", "e", "f"];
  let state = tableWithPlayers(names);
  state = readyAndStart(state, names);
  const startingTotal = names.length * 10000;
  let guard = 0;
  while (["preflop", "flop", "turn", "river"].includes(state.phase)) {
    assert.ok(guard++ < 80, "betting loop terminated");
    const actor = state.seats[state.actorSeat];
    const legal = Engine.legalActions(state, actor.nick);
    const action = legal.actions.includes("check") ? "check" : "call";
    state = apply(state, { type: "act", nick: actor.nick, action }, 200 + guard);
  }
  assert.equal(state.phase, "hand_end");
  assert.equal(state.board.length, 5);
  assert.equal(state.showdown.length, 6);
  assert.equal(state.seats.reduce((sum, player) => sum + (player ? player.stack : 0), 0), startingTotal);
});

test("completed hands reveal every AI player's cards", () => {
  let state = Engine.createTable({ roomId: "ai-reveal", ownerNick: "alice" });
  state = apply(state, { type: "join", nick: "alice" }, 10);
  state = apply(state, { type: "add_bot", nick: "alice" }, 11);
  state = apply(state, { type: "add_bot", nick: "alice" }, 12);
  state = apply(state, { type: "ready", nick: "alice", ready: true }, 13);
  state = apply(state, { type: "start", nick: "alice" }, 14);

  const aiSeats = state.seats.filter((player) => player && player.isBot).map((player) => player.seat);
  assert.equal(aiSeats.length, 2);
  aiSeats.forEach((seat, index) => {
    state.seats[seat].folded = index === 0;
  });
  state.phase = "hand_end";

  const view = Engine.view(state, "alice");
  aiSeats.forEach((seat) => {
    const entry = view.showdown.find((row) => row.seat === seat);
    assert.ok(entry, `AI seat ${seat} is in showdown`);
    assert.equal(entry.cards.length, 2);
  });
});

test("expired turns auto-check when free and otherwise auto-fold", () => {
  const names = ["a", "b"];
  let state = tableWithPlayers(names, { actionMs: 5000 });
  state = readyAndStart(state, names, 1000);
  const deadline = state.actionDeadline;
  state = apply(state, { type: "tick", nick: "b" }, deadline);
  assert.equal(state.phase, "hand_end");
  assert.equal(state.lastEvent.reason, "folds");
  assert.equal(state.seats.reduce((sum, player) => sum + (player ? player.stack : 0), 0), 20000);
});

test("request ids make retried mutations idempotent", () => {
  let state = Engine.createTable({ roomId: "dedupe", ownerNick: "a" });
  const first = Engine.command(state, {
    type: "join",
    nick: "a",
    requestId: "a:req:1",
  }, context(1));
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  const second = Engine.command(first.state, {
    type: "join",
    nick: "a",
    requestId: "a:req:1",
  }, context(2));
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.reason, "duplicate");
  assert.equal(second.state.seats.filter(Boolean).length, 1);
});

test("join can claim a requested empty seat", () => {
  let state = Engine.createTable({ roomId: "seat-choice", ownerNick: "a" });
  let result = Engine.command(state, {
    type: "join",
    nick: "a",
    seat: 3,
    requestId: "join:a:seat3",
  }, context(1));
  assert.equal(result.ok, true);
  assert.equal(result.state.seats[3].nick, "a");

  state = result.state;
  result = Engine.command(state, {
    type: "join",
    nick: "b",
    seat: 3,
    requestId: "join:b:seat3",
  }, context(2));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "seat_taken");
  assert.equal(result.state.seats.filter(Boolean).length, 1);
});

test("only the owner can add and remove a disclosed AI seat before the first hand", () => {
  let state = tableWithPlayers(["owner"]);
  let result = Engine.command(state, {
    type: "add_bot",
    nick: "guest",
  }, context(10));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "owner");

  result = Engine.command(state, {
    type: "add_bot",
    nick: "owner",
    botPersonality: "loose_aggressive",
  }, context(11));
  assert.equal(result.ok, true, result.reason);
  state = result.state;

  const bot = state.seats.find((player) => player && player.isBot);
  assert.ok(bot);
  assert.match(bot.botId, /^bot-\d+$/);
  assert.equal(bot.botPersonality, "tight_passive");
  assert.equal(Object.hasOwn(bot, "botDifficulty"), false);
  assert.equal(bot.ready, true);
  assert.match(bot.displayName, /AI/);

  const ownerView = Engine.view(state, "owner");
  const guestView = Engine.view(state, "guest");
  const publicBot = ownerView.seats[bot.seat];
  assert.equal(ownerView.canManageBots, true);
  assert.equal(guestView.canManageBots, false);
  assert.equal(publicBot.isBot, true);
  assert.equal(publicBot.botId, bot.botId);
  assert.equal(publicBot.botPersonality, "tight_passive");
  assert.equal(Object.hasOwn(publicBot, "botDifficulty"), false);
  assert.equal(Object.hasOwn(publicBot, "cards"), false);

  result = Engine.command(state, {
    type: "remove_bot",
    nick: "guest",
    botId: bot.botId,
  }, context(12));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "owner");

  result = Engine.command(state, {
    type: "remove_bot",
    nick: "owner",
    botId: bot.botId,
  }, context(13));
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.state.seats[bot.seat], null);
});

test("the server randomly assigns fixed personalities and deals all four before repeats", () => {
  let state = tableWithPlayers(["owner"]);
  const expected = [
    "loose_aggressive",
    "loose_passive",
    "tight_aggressive",
    "tight_passive",
  ];
  expected.forEach((personality, index) => {
    const result = Engine.command(state, {
      type: "add_bot",
      nick: "owner",
      botPersonality: "tight_passive",
      requestId: `personality:${index}`,
    }, {
      now: 20 + index,
      randomInt: (max) => max - 1,
    });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.event.botPersonality, personality);
    state = result.state;
  });

  const bots = state.seats.filter((player) => player && player.isBot);
  assert.deepEqual(bots.map((player) => player.botPersonality), expected);
  assert.equal(new Set(expected).size, 4);
  const before = bots.map((player) => player.botPersonality);
  state = apply(state, {
    type: "ready",
    nick: "owner",
    ready: true,
  }, 30);
  assert.deepEqual(
    state.seats.filter((player) => player && player.isBot)
      .map((player) => player.botPersonality),
    before,
  );
});

test("legacy bot metadata receives a stable personality without keeping difficulty state", () => {
  let state = tableWithPlayers(["owner"]);
  state = apply(state, {
    type: "add_bot",
    nick: "owner",
  }, 10);
  const botSeat = state.seats.findIndex((player) => player && player.isBot);
  delete state.seats[botSeat].botPersonality;
  state.seats[botSeat].botDifficulty = "easy";
  state.seats[botSeat].displayName = "초급 AI 1";

  state = apply(state, {
    type: "ready",
    nick: "owner",
    ready: true,
  }, 11);

  assert.equal(state.seats[botSeat].botPersonality, "tight_passive");
  assert.equal(Object.hasOwn(state.seats[botSeat], "botDifficulty"), false);
  assert.equal(state.seats[botSeat].displayName, "AI 1");
});

test("AI identity cannot be used by a human command or viewer to steal its cards", () => {
  let state = tableWithPlayers(["owner"]);
  state = apply(state, {
    type: "add_bot",
    nick: "owner",
  }, 10);
  const bot = state.seats.find((player) => player && player.isBot);

  const forgedView = Engine.view(state, bot.nick);
  assert.deepEqual(forgedView.heroCards, []);
  assert.equal(forgedView.viewer.seat, null);

  const ready = Engine.command(state, {
    type: "ready",
    nick: bot.nick,
    ready: false,
  }, context(11));
  assert.equal(ready.ok, false);
  assert.equal(ready.reason, "not_joined");

  const join = Engine.command(state, {
    type: "join",
    nick: bot.nick,
  }, context(12));
  assert.equal(join.ok, false);
  assert.equal(join.reason, "nick_reserved");
});

test("a folded AI reveals its cards through the completed-hand showdown only", () => {
  let state = tableWithPlayers(["owner"]);
  state = apply(state, {
    type: "add_bot",
    nick: "owner",
  }, 10);
  state = apply(state, {
    type: "ready",
    nick: "owner",
    ready: true,
  }, 11);
  state = apply(state, {
    type: "start",
    nick: "owner",
  }, 12);
  const bot = state.seats.find((player) => player && player.isBot);
  const botCards = bot.cards.slice();
  const activeView = Engine.view(state, "owner");
  const activeSerialized = JSON.stringify(activeView);
  assert.deepEqual(activeView.showdown, []);
  botCards.forEach((card) => assert.equal(activeSerialized.includes(`"${card}"`), false));

  const owner = state.seats[state.actorSeat];
  assert.equal(owner.nick, "owner");
  const ownerLegal = Engine.legalActions(state, owner.nick);
  assert.equal(ownerLegal.actions.includes("raise"), true);
  state = apply(state, {
    type: "act",
    nick: owner.nick,
    action: "raise",
    amount: ownerLegal.minRaiseTo,
  }, 13);
  assert.equal(state.seats[state.actorSeat].botId, bot.botId);

  const folded = Engine.command(state, {
    type: "bot_act",
    botId: bot.botId,
    action: "fold",
  }, {
    now: state.botDueAt,
    randomInt: () => 0,
    internalBot: true,
  });
  assert.equal(folded.ok, true, folded.reason);
  state = folded.state;
  assert.equal(state.phase, "hand_end");

  const completedView = Engine.view(state, "owner");
  const revealedBot = completedView.showdown.find((entry) => entry.seat === bot.seat);
  assert.deepEqual(revealedBot.cards, botCards);
  assert.equal(revealedBot.folded, true);
  assert.equal(revealedBot.testReveal, true);
  assert.equal(completedView.showdown.some((entry) => entry.nick === "owner"), false);
});

test("an AI that wins without showdown reveals its cards after the hand", () => {
  let state = tableWithPlayers(["owner"]);
  state = apply(state, {
    type: "add_bot",
    nick: "owner",
  }, 10);
  state = apply(state, {
    type: "ready",
    nick: "owner",
    ready: true,
  }, 11);
  state = apply(state, {
    type: "start",
    nick: "owner",
  }, 12);
  const bot = state.seats.find((player) => player && player.isBot);
  const botCards = bot.cards.slice();
  const owner = state.seats[state.actorSeat];
  assert.equal(owner.nick, "owner");

  state = apply(state, {
    type: "act",
    nick: owner.nick,
    action: "fold",
  }, 13);
  assert.equal(state.phase, "hand_end");
  assert.equal(state.showdown.length, 0);

  const completedView = Engine.view(state, "owner");
  const revealedBot = completedView.showdown.find((entry) => entry.seat === bot.seat);
  assert.deepEqual(revealedBot.cards, botCards);
  assert.equal(revealedBot.folded, false);
  assert.equal(revealedBot.testReveal, true);
});

test("botView reveals only that bot's cards and internal bot actions remain authoritative", () => {
  let state = tableWithPlayers(["owner"]);
  state = apply(state, {
    type: "add_bot",
    nick: "owner",
  }, 10);
  state = apply(state, {
    type: "ready",
    nick: "owner",
    ready: true,
  }, 11);
  state = apply(state, {
    type: "start",
    nick: "owner",
  }, 12);
  const bot = state.seats.find((player) => player && player.isBot);
  const snapshot = Engine.botView(state, bot.botId);
  const opponent = snapshot.seats.find((player) => player && !player.isBot);

  assert.equal(snapshot.heroCards.length, 2);
  assert.equal(Object.hasOwn(snapshot, "deck"), false);
  assert.equal(Object.hasOwn(snapshot, "burn"), false);
  assert.equal(Object.hasOwn(opponent, "cards"), false);
  assert.equal(snapshot.actorIsBot, state.actorSeat === bot.seat);

  let guard = 0;
  while (["preflop", "flop", "turn", "river"].includes(state.phase)) {
    assert.ok(guard++ < 40, "bot hand terminated");
    const actor = state.seats[state.actorSeat];
    if (actor.isBot) {
      const botSnapshot = Engine.botView(state, actor.botId);
      const legal = botSnapshot.legalActions;
      const action = legal.actions.includes("check") ? "check" : "call";
      const publicAttempt = Engine.command(state, {
        type: "bot_act",
        botId: actor.botId,
        action,
      }, context(state.botDueAt || 1000));
      assert.equal(publicAttempt.ok, false);
      assert.equal(publicAttempt.reason, "internal");
      const internal = Engine.command(state, {
        type: "bot_act",
        botId: actor.botId,
        action,
      }, {
        now: state.botDueAt || 1000,
        randomInt: () => 0,
        internalBot: true,
      });
      assert.equal(internal.ok, true, internal.reason);
      state = internal.state;
    } else {
      const legal = Engine.legalActions(state, actor.nick);
      const action = legal.actions.includes("check") ? "check" : "call";
      state = apply(state, { type: "act", nick: actor.nick, action }, 2000 + guard);
    }
  }

  const finishedBot = state.seats.find((player) => player && player.isBot);
  const finishedOwner = state.seats.find((player) => player && player.nick === "owner");
  assert.equal(finishedOwner.ready, finishedOwner.stack > 0);
  assert.equal(finishedBot.ready, finishedBot.stack > 0);
  assert.equal(
    state.seats.reduce((sum, player) => sum + (player ? player.stack : 0), 0),
    20000,
  );
  assert.ok(state.actionHistory.length > 0);
  const finishedView = Engine.view(state, "owner");
  assert.equal(JSON.stringify(finishedView).includes('"deck"'), false);
  assert.equal(
    finishedView.showdown.filter((entry) => entry.seat === finishedBot.seat).length,
    1,
  );
});

test("a bot action arriving after its deadline becomes the standard timeout action", () => {
  let state = tableWithPlayers(["owner"]);
  state = apply(state, {
    type: "add_bot",
    nick: "owner",
  }, 10);
  state = apply(state, {
    type: "ready",
    nick: "owner",
    ready: true,
  }, 11);
  state = apply(state, {
    type: "start",
    nick: "owner",
  }, 12);

  const human = state.seats[state.actorSeat];
  assert.equal(human.isBot, false);
  const humanLegal = Engine.legalActions(state, human.nick);
  state = apply(state, {
    type: "act",
    nick: human.nick,
    action: humanLegal.actions.includes("check") ? "check" : "call",
  }, 13);

  const bot = state.seats[state.actorSeat];
  assert.equal(bot.isBot, true);
  const expired = Engine.command(state, {
    type: "bot_act",
    botId: bot.botId,
    action: "allin",
  }, {
    now: state.actionDeadline + 1,
    randomInt: () => 0,
    internalBot: true,
  });

  assert.equal(expired.ok, true, expired.reason);
  assert.equal(expired.changed, true);
  assert.equal(expired.state.lastEvent.timeout, true);
  assert.equal(expired.state.lastEvent.action, "check");
});

test("AI seats count toward the six-player cap and configuration locks after play begins", () => {
  let state = tableWithPlayers(["owner"]);
  for (let botIndex = 0; botIndex < 5; botIndex += 1) {
    state = apply(state, {
      type: "add_bot",
      nick: "owner",
    }, 20 + state.seats.filter(Boolean).length);
  }
  assert.equal(state.seats.filter(Boolean).length, 6);
  const botPersonalities = state.seats
    .filter((player) => player && player.isBot)
    .map((player) => player.botPersonality);
  assert.deepEqual(
    botPersonalities.slice(0, 4),
    ["tight_passive", "tight_aggressive", "loose_passive", "loose_aggressive"],
  );
  assert.equal(new Set(botPersonalities.slice(0, 4)).size, 4);
  assert.equal(botPersonalities[4], "tight_passive");
  const full = Engine.command(state, {
    type: "add_bot",
    nick: "owner",
  }, context(30));
  assert.equal(full.ok, false);
  assert.equal(full.reason, "table_full");

  state = apply(state, {
    type: "ready",
    nick: "owner",
    ready: true,
  }, 31);
  state = apply(state, {
    type: "start",
    nick: "owner",
  }, 32);
  const locked = Engine.command(state, {
    type: "remove_bot",
    nick: "owner",
    botId: state.seats.find((player) => player && player.isBot).botId,
  }, context(33));
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, "bots_locked");
});

test("normal and turbo tournaments raise blinds on their server-timed schedules", () => {
  const names = ["owner", "guest"];
  const startAt = 1_800_000_000_000;

  let normal = tableWithPlayers(names, {
    mode: "tournament",
    tournamentSpeed: "normal",
  });
  normal = readyAndStart(normal, names, startAt);
  assert.equal(normal.settings.smallBlind, 50);
  assert.equal(normal.settings.bigBlind, 100);
  assert.equal(normal.settings.blindLevelMs, 10 * 60 * 1000);
  assert.equal(normal.blindLevel, 0);

  let turbo = tableWithPlayers(names, {
    mode: "tournament",
    tournamentSpeed: "turbo",
  });
  turbo = readyAndStart(turbo, names, startAt);
  assert.equal(turbo.settings.blindLevelMs, 5 * 60 * 1000);
  assert.equal(turbo.settings.actionMs, 15000);

  const actor = turbo.seats[turbo.actorSeat];
  turbo = apply(turbo, {
    type: "act",
    nick: actor.nick,
    action: "fold",
  }, startAt + 1);
  assert.equal(turbo.phase, "hand_end");
  turbo = apply(turbo, {
    type: "start",
    nick: names[0],
  }, startAt + 5 * 60 * 1000 + names.length + 1);
  assert.equal(turbo.blindLevel, 1);
  assert.equal(turbo.settings.smallBlind, 75);
  assert.equal(turbo.settings.bigBlind, 150);
});

test("100-chip tournaments use distinct whole-chip blind levels", () => {
  const names = ["owner", "guest"];
  const startAt = 1_800_000_000_000;
  let state = tableWithPlayers(names, {
    mode: "tournament",
    tournamentSpeed: "turbo",
    chipUnit: 100,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
  });
  state = readyAndStart(state, names, startAt);
  let actor = state.seats[state.actorSeat];
  state = apply(state, {
    type: "act",
    nick: actor.nick,
    action: "fold",
  }, startAt + 1);
  state = apply(state, {
    type: "start",
    nick: names[0],
  }, startAt + 5 * 60 * 1000 + names.length + 1);
  assert.equal(state.blindLevel, 1);
  assert.equal(state.settings.smallBlind, 200);
  assert.equal(state.settings.bigBlind, 400);

  actor = state.seats[state.actorSeat];
  state = apply(state, {
    type: "act",
    nick: actor.nick,
    action: "fold",
  }, startAt + 5 * 60 * 1000 + 2);
  state = apply(state, {
    type: "start",
    nick: names[0],
  }, startAt + 10 * 60 * 1000 + names.length + 1);
  assert.equal(state.blindLevel, 2);
  assert.equal(state.settings.smallBlind, 300);
  assert.equal(state.settings.bigBlind, 600);
});

test("ring games keep one blind level, fixed entry chips, and server-only bust refills", () => {
  const names = ["owner", "guest"];
  let state = tableWithPlayers(names, {
    mode: "ring",
    assetBacked: true,
    startingStack: 10000,
    smallBlind: 50,
    bigBlind: 100,
    refillAmount: 10000,
    dailyRefillLimit: 3,
  });
  assert.deepEqual(
    state.seats.filter(Boolean).map((player) => player.stack),
    [10000, 10000],
  );
  state = readyAndStart(state, names, 1000);
  const bustedSeat = state.actorSeat;
  const bustedNick = state.seats[bustedSeat].nick;
  state.seats[bustedSeat].stack = 0;
  state = apply(state, {
    type: "act",
    nick: bustedNick,
    action: "fold",
  }, 1001);

  assert.equal(state.phase, "hand_end", "ring tables do not become tournament_end");
  assert.equal(state.settings.smallBlind, 50);
  assert.equal(state.settings.bigBlind, 100);
  assert.equal(state.nextBlindAt, null);
  assert.equal(Engine.view(state, bustedNick).canRefill, true);

  const browserAttempt = Engine.command(state, {
    type: "refill",
    nick: bustedNick,
    requestId: "refill:browser",
  }, context(1002));
  assert.equal(browserAttempt.ok, false);
  assert.equal(browserAttempt.reason, "internal");

  const refill = Engine.command(state, {
    type: "refill",
    nick: bustedNick,
    requestId: "refill:server",
  }, {
    now: 1003,
    randomInt: () => 0,
    internalRefill: true,
  });
  assert.equal(refill.ok, true, refill.reason);
  assert.equal(refill.state.seats[bustedSeat].stack, 10000);
  assert.equal(refill.state.seats[bustedSeat].ready, true);

  let rejoinState = refill.state;
  rejoinState.seats[bustedSeat].stack = 0;
  rejoinState = apply(rejoinState, {
    type: "leave",
    nick: bustedNick,
    requestId: "leave:busted",
  }, 1004);
  assert.equal(rejoinState.seats[bustedSeat], null);
  rejoinState = apply(rejoinState, {
    type: "join",
    nick: bustedNick,
    seat: bustedSeat,
    requestId: "join:busted",
  }, 1005);
  assert.equal(rejoinState.seats[bustedSeat].stack, 10000);
  assert.deepEqual(
    rejoinState.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [{ nickname: bustedNick, delta: -10000 }],
    "rejoining uses a new asset-backed buy-in rather than a free refill",
  );
});

test("100-chip ring tables debit buy-ins, cash out exits, and reject odd bet sizes", () => {
  const options = {
    mode: "ring",
    assetBacked: true,
    chipUnit: 100,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
    refillAmount: 20000,
    dailyRefillLimit: 3,
  };
  let state = Engine.createTable({
    roomId: "wallet-ring",
    ownerNick: "owner",
    ...options,
  });
  let joined = Engine.command(state, {
    type: "join",
    nick: "owner",
    requestId: "wallet:join",
  }, context(1));
  assert.equal(joined.ok, true);
  assert.equal(joined.state.economyVersion, 2);
  assert.equal(joined.state.settings.chipUnit, 100);
  assert.equal(joined.state.settings.smallBlind, 100);
  assert.equal(joined.state.settings.bigBlind, 200);
  assert.deepEqual(
    joined.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [{ nickname: "owner", delta: -20000 }],
  );

  const left = Engine.command(joined.state, {
    type: "leave",
    nick: "owner",
    requestId: "wallet:leave",
  }, context(2));
  assert.equal(left.ok, true);
  assert.deepEqual(
    left.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [{ nickname: "owner", delta: 20000 }],
  );

  state = tableWithPlayers(["owner", "guest"], options);
  state = readyAndStart(state, ["owner", "guest"], 1000);
  const actor = state.seats[state.actorSeat];
  const legal = Engine.legalActions(state, actor.nick);
  assert.equal(legal.step, 100);
  const oddRaise = Engine.command(state, {
    type: "act",
    nick: actor.nick,
    action: "raise",
    amount: 450,
    requestId: "wallet:odd-raise",
  }, context(1001));
  assert.equal(oddRaise.ok, false);
  assert.equal(oddRaise.reason, "chip_unit");
});

test("a 200 BB ring room keeps the free bust refill at 20,000 chips", () => {
  let state = tableWithPlayers(["owner", "guest"], {
    mode: "ring",
    assetBacked: true,
    chipUnit: 100,
    startingStack: 40000,
    smallBlind: 100,
    bigBlind: 200,
    refillAmount: 20000,
    dailyRefillLimit: 3,
  });
  state.seats[0].stack = 0;
  state.ringStacks.owner = 0;
  const refill = Engine.command(state, {
    type: "refill",
    nick: "owner",
    requestId: "wallet:fixed-refill",
  }, {
    now: 10,
    randomInt: () => 0,
    internalRefill: true,
  });
  assert.equal(refill.ok, true);
  assert.equal(refill.state.settings.startingStack, 40000);
  assert.equal(refill.state.settings.refillAmount, 20000);
  assert.equal(refill.state.seats[0].stack, 20000);
});

test("legacy ring tables do not mint wallet credits during the asset migration", () => {
  let state = Engine.createTable({
    roomId: "legacy-ring",
    ownerNick: "owner",
    mode: "ring",
    chipUnit: 100,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
  });
  const joined = Engine.command(state, {
    type: "join",
    nick: "owner",
    requestId: "legacy:join",
  }, context(1));
  assert.equal(joined.ok, true);
  assert.equal(joined.state.settings.assetBacked, false);
  assert.deepEqual(joined.state.walletAdjustments, []);

  const left = Engine.command(joined.state, {
    type: "leave",
    nick: "owner",
    requestId: "legacy:leave",
  }, context(2));
  assert.equal(left.ok, true);
  assert.deepEqual(left.state.walletAdjustments, []);
});

test("AI practice ring tables use temporary chips and stay solo-only", () => {
  const assetOptions = {
    mode: "ring",
    assetBacked: true,
    chipUnit: 100,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
    refillAmount: 20000,
    dailyRefillLimit: 3,
  };
  let state = Engine.createTable({
    roomId: "ai-practice-ring",
    ownerNick: "owner",
    ...assetOptions,
  });
  let joined = Engine.command(state, {
    type: "join",
    nick: "owner",
    requestId: "practice:join",
  }, context(1));
  assert.equal(joined.ok, true);
  assert.deepEqual(
    joined.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [{ nickname: "owner", delta: -20000 }],
  );
  joined.state.walletAdjustments = [];

  const botAdded = Engine.command(joined.state, {
    type: "add_bot",
    nick: "owner",
    requestId: "practice:add-bot",
  }, context(2));
  assert.equal(botAdded.ok, true, botAdded.reason);
  assert.equal(botAdded.state.settings.assetBacked, false);
  assert.equal(botAdded.state.settings.practice, true);
  assert.deepEqual(
    botAdded.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [{ nickname: "owner", delta: 20000 }],
    "adding AI refunds any asset-backed buy-in before practice starts",
  );

  const guestJoin = Engine.command(botAdded.state, {
    type: "join",
    nick: "guest",
    requestId: "practice:guest",
  }, context(3));
  assert.equal(guestJoin.ok, false);
  assert.equal(guestJoin.reason, "practice_ai_only");

  state = tableWithPlayers(["owner", "guest"], assetOptions);
  const botWithGuest = Engine.command(state, {
    type: "add_bot",
    nick: "owner",
    requestId: "practice:blocked",
  }, context(4));
  assert.equal(botWithGuest.ok, false);
  assert.equal(botWithGuest.reason, "bots_solo_only");
});

test("ring tables switch to asset-backed chips only when a second human joins", () => {
  let state = Engine.createTable({
    roomId: "deferred-asset-ring",
    ownerNick: "owner",
    mode: "ring",
    assetBacked: false,
    chipUnit: 100,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
    refillAmount: 20000,
    dailyRefillLimit: 3,
  });
  let joined = Engine.command(state, {
    type: "join",
    nick: "owner",
    requestId: "deferred:owner",
  }, context(1));
  assert.equal(joined.ok, true);
  assert.equal(joined.state.settings.assetBacked, false);
  assert.deepEqual(joined.state.walletAdjustments, []);

  const guestJoined = Engine.command(joined.state, {
    type: "join",
    nick: "guest",
    requestId: "deferred:guest",
  }, context(2));
  assert.equal(guestJoined.ok, true, guestJoined.reason);
  assert.equal(guestJoined.state.settings.assetBacked, true);
  assert.deepEqual(
    guestJoined.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [
      { nickname: "owner", delta: -20000 },
      { nickname: "guest", delta: -20000 },
    ],
  );
});
