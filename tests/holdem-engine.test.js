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
  assert.equal(state.seats[0].streetBet, 100);
  assert.equal(state.seats[1].streetBet, 200);

  state = apply(state, { type: "act", nick: "alice", action: "call" }, 110);
  assert.equal(state.actorSeat, 1);
  state = apply(state, { type: "act", nick: "bob", action: "check" }, 111);
  assert.equal(state.phase, "flop");
  assert.equal(state.board.length, 3);
  assert.equal(state.actorSeat, 1, "big blind acts first after the flop");
});

test("any two seated players can start without a separate ready step", () => {
  const names = ["owner", "guest", "away"];
  let state = tableWithPlayers(names);
  state.seats[2].stack = 0;
  state.seats[2].ready = false;

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

test("leaving during an active hand reserves exit without folding immediately", () => {
  const names = ["alice", "bob"];
  let state = tableWithPlayers(names);
  state = readyAndStart(state, names);

  const actorSeat = state.actorSeat;
  const actorNick = state.seats[actorSeat].nick;
  const result = Engine.command(state, {
    type: "leave",
    nick: actorNick,
    requestId: "leave:reserve",
  }, context(120));

  assert.equal(result.ok, true, result.reason);
  state = result.state;
  assert.equal(state.seats[actorSeat].leaving, true);
  assert.equal(state.seats[actorSeat].folded, false);
  assert.equal(state.seats[actorSeat].inHand, true);
  assert.equal(state.actorSeat, actorSeat);
  assert.equal(state.lastEvent.type, "leave_requested");

  state = apply(state, { type: "act", nick: actorNick, action: "fold" }, 121);
  assert.ok(["hand_end", "tournament_end"].includes(state.phase));
  assert.equal(state.seats[actorSeat].leaving, true);
  assert.equal(state.seats[actorSeat].folded, true);
});

test("leaving again during an active hand cancels a reserved exit", () => {
  const names = ["alice", "bob"];
  let state = tableWithPlayers(names);
  state = readyAndStart(state, names);

  const actorSeat = state.actorSeat;
  const actorNick = state.seats[actorSeat].nick;
  state = apply(state, {
    type: "leave",
    nick: actorNick,
    requestId: "leave:reserve-cancel-a",
  }, 121);

  assert.equal(state.seats[actorSeat].leaving, true);
  assert.equal(state.seats[actorSeat].inHand, true);

  const result = Engine.command(state, {
    type: "leave",
    nick: actorNick,
    cancelLeave: true,
    requestId: "leave:reserve-cancel-b",
  }, context(122));

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.changed, true);
  assert.equal(result.state.seats[actorSeat].leaving, false);
  assert.equal(result.state.seats[actorSeat].leavingIntent, "");
  assert.equal(result.state.seats[actorSeat].inHand, true);
  assert.equal(result.state.lastEvent.type, "leave_cancelled");
});

test("a folded player stays reserved until the active hand is settled", () => {
  const names = ["alice", "bob", "carol"];
  let state = tableWithPlayers(names);
  state = readyAndStart(state, names);

  const actorSeat = state.actorSeat;
  const actorNick = state.seats[actorSeat].nick;
  state = apply(state, { type: "act", nick: actorNick, action: "fold" }, 121);
  assert.equal(state.phase, "preflop");
  assert.equal(state.seats[actorSeat].folded, true);
  assert.equal(state.seats[actorSeat].inHand, true);

  const result = Engine.command(state, {
    type: "leave",
    nick: actorNick,
    requestId: "leave:folded-reserve",
  }, context(122));

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.state.seats[actorSeat].leaving, true);
  assert.equal(result.state.seats[actorSeat].folded, true);
  assert.equal(result.state.lastEvent.type, "leave_requested");
});

test("a full raise sets the minimum and cumulative short all-ins reopen action", () => {
  const names = ["d", "b", "c", "a"];
  let state = tableWithPlayers(names);
  state.seats[0].stack = 4000;
  state.seats[1].stack = 800;
  state.seats[2].stack = 1000;
  state.seats[3].stack = 4000;
  state = readyAndStart(state, names);

  assert.equal(state.actorSeat, 3);
  state = apply(state, { type: "act", nick: "a", action: "raise", amount: 600 }, 110);
  assert.equal(state.lastFullRaiseSize, 400);
  state = apply(state, { type: "act", nick: "d", action: "call" }, 111);
  state = apply(state, { type: "act", nick: "b", action: "allin" }, 112);
  assert.equal(state.currentBet, 800);

  const singleShort = apply(state, { type: "act", nick: "c", action: "call" }, 113);
  assert.equal(singleShort.actorSeat, 3);
  const notReopened = Engine.legalActions(singleShort, "a").actions;
  assert.equal(notReopened.includes("raise"), false);
  assert.equal(notReopened.includes("allin"), false);

  state = apply(state, { type: "act", nick: "c", action: "allin" }, 113);
  assert.equal(state.currentBet, 1000);
  assert.equal(state.actorSeat, 3);
  const reopened = Engine.legalActions(state, "a");
  assert.equal(reopened.actions.includes("raise"), true);
  assert.equal(reopened.minRaiseTo, 1400);
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

test("completed hands do not fabricate AI cards outside server showdown", () => {
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
  assert.deepEqual(view.showdown, []);
  aiSeats.forEach((seat) => {
    const player = state.seats[seat];
    const serialized = JSON.stringify(view);
    player.cards.forEach((card) => assert.equal(serialized.includes(`"${card}"`), false));
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

test("two consecutive human turn timeouts sit the player out of the next hand", () => {
  const names = ["sleepy", "active-a", "active-b"];
  const playing = new Set(["preflop", "flop", "turn", "river"]);
  let state = tableWithPlayers(names, { actionMs: 5000 });
  state = readyAndStart(state, names, 1000);

  assert.equal(state.seats[state.actorSeat].nick, "sleepy");
  state = apply(state, {
    type: "tick",
    nick: "active-a",
    requestId: "timeout:first",
  }, state.actionDeadline);
  assert.equal(state.seats[0].timeoutStreak, 1);
  assert.equal(state.seats[0].sittingOut, false);

  let guard = 0;
  while (playing.has(state.phase)) {
    assert.ok(guard++ < 30, "first hand completed");
    const actor = state.seats[state.actorSeat];
    const legal = Engine.legalActions(state, actor.nick);
    const action = legal.actions.includes("check") ? "check" : "call";
    state = apply(state, {
      type: "act",
      nick: actor.nick,
      action,
      requestId: `first-hand:${guard}`,
    }, state.actionDeadline - 1);
  }

  state = apply(state, {
    type: "start",
    nick: "active-a",
    requestId: "start:second-timeout-hand",
  }, 20000);
  guard = 0;
  while (state.seats[state.actorSeat].nick !== "sleepy") {
    assert.ok(guard++ < 10, "sleepy received another turn");
    const actor = state.seats[state.actorSeat];
    const legal = Engine.legalActions(state, actor.nick);
    const action = legal.actions.includes("check") ? "check" : "call";
    state = apply(state, {
      type: "act",
      nick: actor.nick,
      action,
      requestId: `second-hand:${guard}`,
    }, state.actionDeadline - 1);
  }

  state = apply(state, {
    type: "tick",
    nick: "active-b",
    requestId: "timeout:second",
  }, state.actionDeadline);
  assert.equal(state.seats[0].timeoutStreak, 2);
  assert.equal(state.seats[0].sittingOut, true);
  assert.equal(Engine.view(state, "active-a").seats[0].sittingOut, true);

  guard = 0;
  while (playing.has(state.phase)) {
    assert.ok(guard++ < 30, "second hand completed");
    const actor = state.seats[state.actorSeat];
    if (actor.nick === "sleepy") {
      state = apply(state, {
        type: "tick",
        nick: "active-a",
        requestId: `finish-second-timeout:${guard}`,
      }, state.actionDeadline);
      continue;
    }
    const legal = Engine.legalActions(state, actor.nick);
    const action = legal.actions.includes("check") ? "check" : "call";
    state = apply(state, {
      type: "act",
      nick: actor.nick,
      action,
      requestId: `finish-second:${guard}`,
    }, state.actionDeadline - 1);
  }

  const sittingOutView = Engine.view(state, "sleepy");
  assert.equal(sittingOutView.canReady, true);
  assert.equal(sittingOutView.canStart, false);
  state = apply(state, {
    type: "start",
    nick: "active-a",
    requestId: "start:without-sleepy",
  }, 40000);
  assert.equal(state.seats[0].inHand, false);
  assert.equal(state.seats[0].waiting, true);
  assert.equal(state.seats[1].inHand, true);
  assert.equal(state.seats[2].inHand, true);
});

test("a valid action or ready command clears timeout sit-out state", () => {
  const names = ["alice", "bob", "carol"];
  let state = tableWithPlayers(names);
  state = readyAndStart(state, names, 1000);
  const actor = state.seats[state.actorSeat];
  actor.timeoutStreak = 2;
  actor.sittingOut = true;
  actor.ready = false;

  state = apply(state, {
    type: "act",
    nick: actor.nick,
    action: "call",
    requestId: "timeout:cleared-by-action",
  }, state.actionDeadline - 1);
  assert.equal(state.seats[actor.seat].timeoutStreak, 0);
  assert.equal(state.seats[actor.seat].sittingOut, false);

  state.phase = "hand_end";
  state.actorSeat = null;
  state.actionDeadline = null;
  state.pendingSeats = [];
  state.seats[actor.seat].sittingOut = true;
  state.seats[actor.seat].timeoutStreak = 2;
  state.seats[actor.seat].ready = false;

  state = apply(state, {
    type: "presence",
    nick: "bob",
    presentNicks: names,
    awayNicks: [],
    requestId: "timeout:presence-does-not-resume",
  }, 1999);
  assert.equal(state.seats[actor.seat].sittingOut, true);
  assert.equal(state.seats[actor.seat].ready, false);

  state = apply(state, {
    type: "ready",
    nick: actor.nick,
    ready: true,
    requestId: "timeout:resume",
  }, 2000);
  assert.equal(state.seats[actor.seat].timeoutStreak, 0);
  assert.equal(state.seats[actor.seat].sittingOut, false);
  assert.equal(state.seats[actor.seat].ready, true);
});

test("a sitting-out player can reserve the next hand while play continues", () => {
  const names = ["sleepy", "active-a", "active-b"];
  let state = tableWithPlayers(names);
  state.seats[0].sittingOut = true;
  state.seats[0].timeoutStreak = 2;
  state.seats[0].ready = false;

  state = apply(state, {
    type: "start",
    nick: "active-a",
    requestId: "start:without-sleepy",
  }, 1000);
  assert.equal(state.seats[0].inHand, false);
  assert.equal(Engine.view(state, "sleepy").canReady, true);

  state = apply(state, {
    type: "ready",
    nick: "sleepy",
    ready: true,
    requestId: "resume:during-hand",
  }, 1001);
  assert.equal(state.seats[0].sittingOut, false);
  assert.equal(state.seats[0].timeoutStreak, 0);
  assert.equal(state.seats[0].inHand, false);
  assert.equal(state.seats[0].ready, true);

  const actor = state.seats[state.actorSeat];
  state = apply(state, {
    type: "act",
    nick: actor.nick,
    action: "fold",
    requestId: "finish:active-hand",
  }, state.actionDeadline - 1);
  state = apply(state, {
    type: "start",
    nick: "active-a",
    requestId: "start:with-sleepy",
  }, state.actionDeadline == null ? 2000 : state.actionDeadline + 1);
  assert.equal(state.seats[0].inHand, true);
});

test("a heads-up table unlocks as soon as the sitting-out player resumes", () => {
  const names = ["sleepy", "active"];
  let state = tableWithPlayers(names, { mode: "ring" });
  state.phase = "hand_end";
  state.seats[0].sittingOut = true;
  state.seats[0].timeoutStreak = 2;
  state.seats[0].ready = false;

  assert.equal(Engine.view(state, "active").canStart, false);
  assert.equal(Engine.view(state, "sleepy").canReady, true);

  state = apply(state, {
    type: "ready",
    nick: "sleepy",
    ready: true,
    requestId: "resume:heads-up",
  }, 2000);
  assert.equal(Engine.view(state, "active").canStart, true);
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

test("a folded AI keeps its cards hidden when the hand ends by folds", () => {
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
  const ownerCards = owner.cards.slice();
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
  const completedSerialized = JSON.stringify(completedView);
  assert.equal(completedView.showdown.some((entry) => entry.seat === bot.seat), false);
  botCards.forEach((card) => assert.equal(completedSerialized.includes(`"${card}"`), false));

  assert.equal(state.showdown.some((entry) => entry.seat === owner.seat), false);
  const revealed = Engine.command(state, {
    type: "reveal_cards",
    nick: owner.nick,
    cards: [0, 1],
  }, context(14));
  assert.equal(revealed.ok, true, revealed.reason);
  const revealedRow = Engine.view(revealed.state, "owner").showdown
    .find((entry) => entry.seat === owner.seat);
  assert.ok(revealedRow);
  assert.equal(revealedRow.winner, true);
  assert.equal(revealedRow.folded, false);
  assert.deepEqual(revealedRow.cards, ownerCards);
});

test("AI betting turns wait between two and five seconds", () => {
  function makeBotTurn(randomInt) {
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
    const owner = state.seats[state.actorSeat];
    const legal = Engine.legalActions(state, owner.nick);
    const result = Engine.command(state, {
      type: "act",
      nick: owner.nick,
      action: "raise",
      amount: legal.minRaiseTo,
    }, {
      now: 13,
      randomInt,
    });
    assert.equal(result.ok, true, result.reason);
    return result.state;
  }

  const earliest = makeBotTurn(() => 0);
  assert.equal(earliest.seats[earliest.actorSeat].isBot, true);
  assert.equal(earliest.botDueAt, 2013);

  const latest = makeBotTurn((max) => max - 1);
  assert.equal(latest.seats[latest.actorSeat].isBot, true);
  assert.equal(latest.botDueAt, 5013);
});

test("folded card reveal reservations stay private until the hand ends", () => {
  const names = ["alice", "bob", "cara"];
  let state = readyAndStart(tableWithPlayers(names), names);
  const folder = state.seats[state.actorSeat];
  const foldedCards = folder.cards.slice();
  state = apply(state, {
    type: "act",
    nick: folder.nick,
    action: "fold",
  }, 130);
  assert.equal(state.phase !== "hand_end", true);
  state = apply(state, {
    type: "reveal_cards",
    nick: folder.nick,
    cards: [0],
  }, 131);

  const viewer = state.seats.find((player) => player && player.nick !== folder.nick && !player.folded);
  const activeView = Engine.view(state, viewer.nick);
  const folderView = Engine.view(state, folder.nick);
  assert.equal(activeView.revealedCards, undefined);
  assert.deepEqual(folderView.heroRevealCards, [0]);
  assert.equal(JSON.stringify(activeView).includes(`"${foldedCards[0]}"`), false);
  assert.equal(JSON.stringify(activeView).includes(`"${foldedCards[1]}"`), false);

  const nextActor = state.seats[state.actorSeat];
  state = apply(state, {
    type: "act",
    nick: nextActor.nick,
    action: "fold",
  }, 132);
  assert.equal(state.phase, "hand_end");

  const completedView = Engine.view(state, viewer.nick);
  const row = completedView.showdown.find((entry) => entry.seat === folder.seat);
  assert.ok(row);
  assert.deepEqual(row.cards, [foldedCards[0]]);
  assert.deepEqual(row.revealCards, [0]);
  assert.equal(JSON.stringify(completedView).includes(`"${foldedCards[1]}"`), false);
});

test("a reveal request that races the final action can update the completed showdown", () => {
  const names = ["alice", "bob"];
  let state = readyAndStart(tableWithPlayers(names), names);
  const folder = state.seats[state.actorSeat];
  const foldedCards = folder.cards.slice();

  state = apply(state, {
    type: "act",
    nick: folder.nick,
    action: "fold",
  }, 140);
  assert.equal(state.phase, "hand_end");

  state = apply(state, {
    type: "reveal_cards",
    nick: folder.nick,
    cards: [1],
  }, 141);
  const row = Engine.view(state, names[1]).showdown.find((entry) => entry.seat === folder.seat);
  assert.ok(row);
  assert.deepEqual(row.cards, [foldedCards[1]]);
  assert.deepEqual(row.revealCards, [1]);
  assert.equal(JSON.stringify(Engine.view(state, names[1])).includes(`"${foldedCards[0]}"`), false);

  state = apply(state, {
    type: "reveal_cards",
    nick: folder.nick,
    cards: [0],
  }, 142);
  const replacementRows = Engine.view(state, names[1]).showdown
    .filter((entry) => entry.seat === folder.seat && entry.folded);
  assert.equal(replacementRows.length, 1);
  assert.deepEqual(replacementRows[0].cards, [foldedCards[0]]);
  assert.deepEqual(replacementRows[0].revealCards, [0]);
});

test("a fold winner keeps its hand hidden until direct reveal", () => {
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
  const completedSerialized = JSON.stringify(completedView);
  const winnerRow = completedView.showdown.find((entry) => entry.seat === bot.seat);
  assert.equal(winnerRow, undefined);
  botCards.forEach((card) => assert.equal(completedSerialized.includes(`"${card}"`), false));
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
  assert.equal(normal.settings.smallBlind, 100);
  assert.equal(normal.settings.bigBlind, 200);
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
  assert.equal(turbo.settings.smallBlind, 200);
  assert.equal(turbo.settings.bigBlind, 400);
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
    smallBlind: 1,
    bigBlind: 1,
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
  assert.equal(state.settings.smallBlind, 100);
  assert.equal(state.settings.bigBlind, 200);
  assert.equal(state.nextBlindAt, null);
  assert.equal(Engine.view(state, bustedNick).canRefill, true);
  state.seats[bustedSeat].away = true;
  state.seats[bustedSeat].ready = false;

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
  assert.equal(refill.state.seats[bustedSeat].away, false);
  assert.equal(Engine.view(refill.state, bustedNick).canStart, true);
  const resumed = Engine.command(refill.state, {
    type: "start",
    nick: bustedNick,
    requestId: "start:after-refill",
  }, context(1004));
  assert.equal(resumed.ok, true, resumed.reason);
  assert.equal(resumed.state.phase, "preflop");
  assert.equal(
    resumed.state.seats.filter(Boolean).every((player) => player.inHand),
    true,
  );

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

test("rejoining a ring seat clears stale away and spectating state", () => {
  const names = ["owner", "guest"];
  let state = tableWithPlayers(names, {
    mode: "ring",
    assetBacked: true,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
    refillAmount: 20000,
  });
  state.phase = "hand_end";
  state.seats[0].away = true;
  state.seats[0].leaving = true;
  state.seats[0].leavingIntent = "spectate";
  state.seats[0].ready = false;

  const rejoined = Engine.command(state, {
    type: "join",
    nick: names[0],
    seat: 0,
    requestId: "join:resume-away-seat",
  }, context(1500));

  assert.equal(rejoined.ok, true, rejoined.reason);
  assert.equal(rejoined.state.seats[0].away, false);
  assert.equal(rejoined.state.seats[0].leaving, false);
  assert.equal(rejoined.state.seats[0].leavingIntent, "");
  assert.equal(rejoined.state.seats[0].ready, true);
  assert.equal(Engine.view(rejoined.state, names[0]).canStart, true);
});

test("away ring players do not block remaining players from the next hand", () => {
  const names = ["owner", "guest", "away"];
  let state = tableWithPlayers(names, {
    mode: "ring",
    assetBacked: true,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
    refillAmount: 20000,
  });
  state.phase = "hand_end";
  state.seats[2].stack = 0;
  state.ringStacks.away = 0;

  const syncedBusted = Engine.command(state, {
    type: "presence",
    nick: "owner",
    presentNicks: ["owner", "guest"],
    awayNicks: ["away"],
    requestId: "presence:away-busted",
  }, context(2000));
  assert.equal(syncedBusted.ok, true, syncedBusted.reason);
  assert.equal(syncedBusted.changed, true);
  assert.equal(syncedBusted.state.seats[2], null);
  assert.equal(Engine.view(syncedBusted.state, "owner").canStart, true);

  const startedAfterBust = Engine.command(syncedBusted.state, {
    type: "start",
    nick: "owner",
    requestId: "start:after-away-bust",
  }, context(2001));
  assert.equal(startedAfterBust.ok, true, startedAfterBust.reason);
  assert.equal(startedAfterBust.state.phase, "preflop");

  state = tableWithPlayers(names, {
    mode: "ring",
    assetBacked: true,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
    refillAmount: 20000,
  });
  state.phase = "hand_end";
  const syncedStacked = Engine.command(state, {
    type: "presence",
    nick: "owner",
    presentNicks: ["owner", "guest"],
    awayNicks: ["away"],
    requestId: "presence:away-stacked",
  }, context(2010));
  assert.equal(syncedStacked.ok, true, syncedStacked.reason);
  assert.equal(syncedStacked.state.seats[2].away, true);
  assert.equal(syncedStacked.state.seats[2].ready, false);
  assert.equal(Engine.view(syncedStacked.state, "owner").canStart, true);

  const startedWithAway = Engine.command(syncedStacked.state, {
    type: "start",
    nick: "owner",
    requestId: "start:with-away",
  }, context(2011));
  assert.equal(startedWithAway.ok, true, startedWithAway.reason);
  assert.equal(startedWithAway.state.seats[2].inHand, false);
  assert.equal(startedWithAway.state.seats[2].waiting, true);
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
  assert.equal(joined.state.economyVersion, 3);
  assert.equal(joined.state.settings.chipUnit, 100);
  assert.equal(joined.state.settings.smallBlind, 100);
  assert.equal(joined.state.settings.bigBlind, 200);
  assert.deepEqual(
    joined.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [{ nickname: "owner", delta: -15000 }],
  );

  const left = Engine.command(joined.state, {
    type: "leave",
    nick: "owner",
    requestId: "wallet:leave",
  }, context(2));
  assert.equal(left.ok, true);
  assert.deepEqual(
    left.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [{ nickname: "owner", delta: 15000 }],
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

test("ring rake uses no-flop-no-drop and rounds 2 percent down to 100 chips", () => {
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
  let state = tableWithPlayers(["owner", "guest"], options);
  state = readyAndStart(state, ["owner", "guest"], 1000);
  state = apply(state, {
    type: "act",
    nick: state.seats[state.actorSeat].nick,
    action: "fold",
  }, 1001);
  assert.equal(state.lastRake, 0);
  assert.deepEqual(state.economyEvents, []);
  assert.equal(
    state.seats.reduce((sum, player) => sum + (player ? player.stack : 0), 0),
    30000,
  );

  state = tableWithPlayers(["owner", "guest"], options);
  state = readyAndStart(state, ["owner", "guest"], 1500);
  state = apply(state, { type: "act", nick: "owner", action: "call" }, 1501);
  state = apply(state, { type: "act", nick: "guest", action: "check" }, 1502);
  state = apply(state, {
    type: "act",
    nick: "guest",
    action: "bet",
    amount: 6000,
  }, 1503);
  state = apply(state, { type: "act", nick: "owner", action: "fold" }, 1504);
  assert.equal(state.pots[0].amount, 400, "the uncalled 6,000 is returned");
  assert.equal(state.lastRake, 0, "uncalled chips are excluded from rake");
  assert.equal(
    state.seats.reduce((sum, player) => sum + (player ? player.stack : 0), 0),
    30000,
  );

  state = tableWithPlayers(["owner", "guest"], options);
  state = readyAndStart(state, ["owner", "guest"], 2000);
  state = apply(state, { type: "act", nick: "owner", action: "call" }, 2001);
  state = apply(state, { type: "act", nick: "guest", action: "check" }, 2002);
  assert.equal(state.phase, "flop");
  state = apply(state, {
    type: "act",
    nick: "guest",
    action: "bet",
    amount: 3000,
  }, 2003);
  state = apply(state, { type: "act", nick: "owner", action: "call" }, 2004);
  assert.equal(state.phase, "turn");
  state = apply(state, { type: "act", nick: "guest", action: "check" }, 2005);
  state = apply(state, { type: "act", nick: "owner", action: "fold" }, 2006);

  assert.equal(state.lastRake, 100, "2% of 6,400 rounds down to 100");
  assert.equal(state.pots[0].amount, 6300);
  assert.deepEqual(state.economyEvents, [{
    type: "rake",
    amount: -100,
    handNo: 1,
    at: 2006,
  }]);
  assert.equal(Engine.view(state, "owner").lastRake, 100);
  assert.equal(
    state.seats.reduce((sum, player) => sum + (player ? player.stack : 0), 0),
    29900,
  );
});

test("ring rake is capped at one big blind on an all-in showdown", () => {
  let state = tableWithPlayers(["owner", "guest"], {
    mode: "ring",
    assetBacked: true,
    chipUnit: 100,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
    refillAmount: 20000,
    dailyRefillLimit: 3,
  });
  state = readyAndStart(state, ["owner", "guest"], 3000);
  state.seats[0].cards = ["Ah", "Ad"];
  state.seats[1].cards = ["Kh", "Kd"];
  state.deck = ["Tc", "2c", "3d", "4h", "Jc", "5s", "Qc", "9c"];
  state = apply(state, { type: "act", nick: "owner", action: "allin" }, 3001);
  state = apply(state, { type: "act", nick: "guest", action: "call" }, 3002);

  assert.equal(state.phase, "hand_end");
  assert.equal(state.board.length, 5);
  assert.equal(state.lastRake, 200);
  assert.equal(state.economyEvents[0].amount, -200);
  const busted = state.seats.find((player) => player && player.stack === 0);
  assert.ok(busted);
  assert.equal(Engine.view(state, busted.nick).canRefill, true);
  assert.equal(
    state.seats.reduce((sum, player) => sum + (player ? player.stack : 0), 0),
    29800,
  );
});

test("AI practice all-ins do not pay rake", () => {
  let state = Engine.createTable({
    roomId: "practice-rake",
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
  state = apply(state, { type: "join", nick: "owner" }, 4000);
  state = apply(state, { type: "add_bot", nick: "owner" }, 4001);
  const startingTotal = state.seats.reduce(
    (sum, player) => sum + (player ? player.stack : 0),
    0,
  );
  state = apply(state, { type: "start", nick: "owner" }, 4002);
  state = apply(state, { type: "act", nick: "owner", action: "allin" }, 4003);
  const bot = state.seats[state.actorSeat];
  const botCall = Engine.command(state, {
    type: "bot_act",
    botId: bot.botId,
    action: "call",
  }, {
    now: state.botDueAt,
    randomInt: () => 0,
    internalBot: true,
  });
  assert.equal(botCall.ok, true, botCall.reason);
  state = botCall.state;

  assert.equal(state.phase, "hand_end");
  assert.equal(state.settings.assetBacked, false);
  assert.equal(state.lastRake, 0);
  assert.deepEqual(state.economyEvents, []);
  assert.equal(
    state.seats.reduce((sum, player) => sum + (player ? player.stack : 0), 0),
    startingTotal,
  );
});

test("ring joins and bust rebuys can choose an in-room buy-in amount", () => {
  const options = {
    mode: "ring",
    assetBacked: true,
    chipUnit: 100,
    startingStack: 40000,
    smallBlind: 200,
    bigBlind: 400,
    refillAmount: 20000,
    dailyRefillLimit: 3,
  };
  let state = Engine.createTable({
    roomId: "rebuy-ring",
    ownerNick: "owner",
    ...options,
  });
  let joined = Engine.command(state, {
    type: "join",
    nick: "owner",
    seat: 2,
    buyIn: 30000,
    requestId: "wallet:join-selected",
  }, context(1));
  assert.equal(joined.ok, true);
  assert.equal(joined.state.seats[2].stack, 30000);
  assert.deepEqual(
    joined.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [{ nickname: "owner", delta: -30000 }],
  );

  state = joined.state;
  state.walletAdjustments = [];
  state.seats[2].stack = 0;
  state.ringStacks.owner = 0;
  const rebuy = Engine.command(state, {
    type: "rebuy",
    nick: "owner",
    amount: 40000,
    requestId: "wallet:rebuy-selected",
  }, context(2));
  assert.equal(rebuy.ok, true, rebuy.reason);
  assert.equal(rebuy.state.seats[2].stack, 40000);
  assert.equal(rebuy.state.seats[2].ready, true);
  assert.deepEqual(
    rebuy.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [{ nickname: "owner", delta: -40000 }],
  );

  state = rebuy.state;
  state.walletAdjustments = [];
  state.seats[2].stack = 25000;
  state.ringStacks.owner = 25000;
  const topUp = Engine.command(state, {
    type: "rebuy",
    nick: "owner",
    amount: 40000,
    requestId: "wallet:rebuy-top-up",
  }, context(3));
  assert.equal(topUp.ok, true, topUp.reason);
  assert.equal(topUp.state.seats[2].stack, 40000);
  assert.equal(topUp.state.lastEvent.delta, 15000);
  assert.deepEqual(
    topUp.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [{ nickname: "owner", delta: -15000 }],
  );

  const view = Engine.view(rebuy.state, "owner");
  assert.equal(view.buyInMin, 20000);
  assert.equal(view.buyInMax, 40000);
  assert.equal(view.buyInDefault, 30000);
});

test("a standard ring room keeps the free bust refill at 20,000 chips", () => {
  let state = tableWithPlayers(["owner", "guest"], {
    mode: "ring",
    assetBacked: true,
    chipUnit: 100,
    startingStack: 40000,
    smallBlind: 200,
    bigBlind: 400,
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
    [{ nickname: "owner", delta: -15000 }],
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
    [{ nickname: "owner", delta: 15000 }],
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

test("accepting an AI practice request removes every bot and starts a human-only asset table", () => {
  let state = Engine.createTable({
    roomId: "ai-practice-join-request",
    ownerNick: "owner",
    mode: "ring",
    assetBacked: true,
    chipUnit: 100,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
    refillAmount: 20000,
    dailyRefillLimit: 3,
  });
  state = apply(state, { type: "join", nick: "owner", requestId: "request:owner" }, 1);
  state.walletAdjustments = [];
  for (let bot = 1; bot <= 5; bot += 1) {
    state = apply(state, {
      type: "add_bot",
      nick: "owner",
      requestId: `request:bot:${bot}`,
    }, 1 + bot);
  }
  state.walletAdjustments = [];
  assert.equal(state.seats.filter((player) => player && player.isBot).length, 5);

  const directJoin = Engine.command(state, {
    type: "join",
    nick: "guest",
    requestId: "request:direct",
  }, context(7));
  assert.equal(directJoin.ok, false);
  assert.equal(directJoin.reason, "practice_ai_only");

  state = apply(state, { type: "start", nick: "owner", requestId: "request:start" }, 8);
  assert.equal(state.phase, "preflop");

  let requested = Engine.command(state, {
    type: "join_request",
    nick: "guest",
    buyIn: 12000,
    requestId: "request:ask",
  }, context(9));
  assert.equal(requested.ok, true, requested.reason);
  assert.deepEqual(Engine.view(requested.state, "owner").pendingJoinRequests, [{
    nick: "guest",
    targetNick: "owner",
    buyIn: 12000,
    requestedAt: 9,
    expiresAt: 60009,
  }]);

  const accepted = Engine.command(requested.state, {
    type: "resolve_join_request",
    nick: "owner",
    requester: "guest",
    accepted: true,
    requestId: "request:accept",
  }, {
    now: 10,
    randomInt: (max) => max - 1,
  });
  assert.equal(accepted.ok, true, accepted.reason);
  const owner = accepted.state.seats.find((player) => player && player.nick === "owner");
  const guest = accepted.state.seats.find((player) => player && player.nick === "guest");
  assert.ok(owner);
  assert.ok(guest);
  assert.equal(guest.seat, 5);
  assert.equal(guest.ready, true);
  assert.equal(guest.waiting, true);
  assert.equal(guest.inHand, false);
  assert.deepEqual(guest.cards, []);
  assert.equal(owner.stack, 15000);
  assert.equal(guest.stack, 12000);
  assert.equal(accepted.state.phase, "waiting");
  assert.equal(accepted.state.handNo, 0);
  assert.deepEqual(accepted.state.board, []);
  assert.deepEqual(accepted.state.deck, []);
  assert.equal(accepted.state.actorSeat, null);
  assert.equal(accepted.state.botDueAt, null);
  assert.equal(accepted.state.seats.some((player) => player && player.isBot), false);
  assert.deepEqual(accepted.state.pendingJoinRequests, []);
  assert.equal(accepted.state.settings.assetBacked, true);
  assert.equal(accepted.state.settings.practice, false);
  assert.equal(accepted.state.newGameBuyInRequired, false);
  assert.deepEqual(
    accepted.state.walletAdjustments.map(({ nickname, delta }) => ({ nickname, delta })),
    [
      { nickname: "owner", delta: -15000 },
      { nickname: "guest", delta: -12000 },
    ],
  );
  const ownerView = Engine.view(accepted.state, "owner");
  assert.equal(ownerView.canStart, true);
  assert.equal(ownerView.newGameBuyInRequired, false);

  const botAfterAccept = Engine.command(accepted.state, {
    type: "add_bot",
    nick: "owner",
    requestId: "request:bot-after-accept",
  }, context(11));
  assert.equal(botAfterAccept.ok, false);
  assert.equal(botAfterAccept.reason, "bots_solo_only");

  const officialGame = Engine.command(accepted.state, {
    type: "start",
    nick: "owner",
    requestId: "request:official-start",
  }, context(12));
  assert.equal(officialGame.ok, true, officialGame.reason);
  assert.equal(officialGame.state.phase, "preflop");
  assert.equal(
    officialGame.state.seats.find((player) => player && player.nick === "owner").stack +
      officialGame.state.seats.find((player) => player && player.nick === "owner").totalBet,
    15000,
  );
  assert.equal(
    officialGame.state.seats.find((player) => player && player.nick === "guest").stack +
      officialGame.state.seats.find((player) => player && player.nick === "guest").totalBet,
    12000,
  );
});

test("legacy mixed human and AI tables are repaired before another command runs", () => {
  let state = Engine.createTable({
    roomId: "legacy-mixed-practice",
    ownerNick: "owner",
    mode: "ring",
    assetBacked: false,
    chipUnit: 100,
    startingStack: 20000,
    smallBlind: 100,
    bigBlind: 200,
  });
  state = apply(state, { type: "join", nick: "owner", requestId: "repair:owner" }, 1);
  state = apply(state, { type: "add_bot", nick: "owner", requestId: "repair:bot" }, 2);
  const guest = {
    ...state.seats[0],
    seat: 5,
    nick: "guest",
    displayName: "guest",
    isBot: false,
    botId: null,
    botPersonality: null,
  };
  state.seats[5] = guest;
  state.newGameBuyInRequired = true;

  const repaired = Engine.command(state, {
    type: "tick",
    nick: "owner",
    requestId: "repair:trigger",
  }, context(3));
  assert.equal(repaired.ok, true, repaired.reason);
  assert.equal(repaired.reason, "practice_repaired");
  assert.equal(repaired.state.phase, "waiting");
  assert.equal(repaired.state.seats.some((player) => player && player.isBot), false);
  assert.equal(repaired.state.seats.filter(Boolean).length, 2);
  assert.equal(repaired.state.settings.assetBacked, false);
  assert.equal(repaired.state.newGameBuyInRequired, true);
});

test("stale AI ring tables are forced back to practice before wallet changes", () => {
  let state = Engine.createTable({
    roomId: "stale-ai-practice-ring",
    ownerNick: "owner",
    mode: "ring",
    assetBacked: true,
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
    requestId: "stale:join",
  }, context(1));
  assert.equal(joined.ok, true);
  joined.state.walletAdjustments = [];

  let botAdded = Engine.command(joined.state, {
    type: "add_bot",
    nick: "owner",
    requestId: "stale:add-bot",
  }, context(2));
  assert.equal(botAdded.ok, true);
  state = botAdded.state;
  state.walletAdjustments = [];
  state.settings.assetBacked = true;
  state.settings.practice = false;

  const left = Engine.command(state, {
    type: "leave",
    nick: "owner",
    requestId: "stale:leave",
  }, context(3));
  assert.equal(left.ok, true, left.reason);
  assert.equal(left.state.settings.assetBacked, false);
  assert.equal(left.state.settings.practice, true);
  assert.deepEqual(
    left.state.walletAdjustments.map(({ nickname, delta, reason }) => ({ nickname, delta, reason })),
    [{ nickname: "owner", delta: 15000, reason: "practice_refund" }],
  );
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
      { nickname: "owner", delta: -15000 },
      { nickname: "guest", delta: -15000 },
    ],
  );
});

test("active hand leaves preserve whether the player reserved spectating or room exit", () => {
  const names = ["alice", "bob", "cara"];
  let state = tableWithPlayers(names);
  state = readyAndStart(state, names, 700);
  const seat = state.seats.findIndex((player, index) => player && player.inHand && index !== state.actorSeat);
  const nick = state.seats[seat].nick;
  const cards = state.seats[seat].cards.slice();
  const committed = state.seats[seat].totalBet;
  const actorSeat = state.actorSeat;
  const actionDeadline = state.actionDeadline;

  const reservedSpectate = Engine.command(state, {
    type: "leave",
    nick,
    leaveIntent: "spectate",
    requestId: "leave:spectate",
  }, context(800));

  assert.equal(reservedSpectate.ok, true, reservedSpectate.reason);
  assert.equal(reservedSpectate.state.seats[seat].leaving, true);
  assert.equal(reservedSpectate.state.seats[seat].leavingIntent, "spectate");
  assert.equal(reservedSpectate.state.seats[seat].folded, true);
  assert.equal(reservedSpectate.state.seats[seat].totalBet, committed);
  assert.deepEqual(reservedSpectate.state.seats[seat].cards, cards);
  assert.equal(reservedSpectate.state.actorSeat, actorSeat);
  assert.equal(reservedSpectate.state.actionDeadline, actionDeadline);
  assert.equal(Engine.view(reservedSpectate.state, "alice").seats[seat].leavingIntent, "spectate");
  const spectatingView = Engine.view(reservedSpectate.state, nick);
  assert.equal(spectatingView.viewer.seat, seat);
  assert.deepEqual(spectatingView.heroCards, []);
  assert.deepEqual(spectatingView.viewer.cards, []);
  assert.deepEqual(spectatingView.legalActions.actions, []);
  assert.equal(Object.hasOwn(spectatingView.seats[seat], "cards"), false);
  cards.forEach((card) => assert.equal(JSON.stringify(spectatingView).includes(`"${card}"`), false));

  state = readyAndStart(tableWithPlayers(names), names, 900);
  const exitSeat = state.seats.findIndex((player, index) => player && player.inHand && index !== state.actorSeat);
  const exitNick = state.seats[exitSeat].nick;
  const reservedExit = Engine.command(state, {
    type: "leave",
    nick: exitNick,
    leaveIntent: "leave",
    requestId: "leave:room",
  }, context(1000));

  assert.equal(reservedExit.ok, true, reservedExit.reason);
  assert.equal(reservedExit.state.seats[exitSeat].leavingIntent, "leave");
  assert.equal(reservedExit.state.seats[exitSeat].folded, false);
});

test("an acting player who switches to spectate folds and advances the turn", () => {
  const names = ["alice", "bob", "cara"];
  const state = readyAndStart(tableWithPlayers(names), names, 1020);
  const actorSeat = state.actorSeat;
  const actorNick = state.seats[actorSeat].nick;

  const result = Engine.command(state, {
    type: "leave",
    nick: actorNick,
    leaveIntent: "spectate",
    requestId: "leave:actor-spectate",
  }, context(1030));

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.state.seats[actorSeat].folded, true);
  assert.notEqual(result.state.actorSeat, actorSeat);
  assert.ok(result.state.actorSeat != null || result.state.phase === "hand_end");
});

test("all-in players who switch to spectate stay eligible but lose private card access", () => {
  const names = ["alice", "bob", "cara"];
  let state = readyAndStart(tableWithPlayers(names), names, 1050);
  const seat = state.seats.findIndex((player, index) => player && player.inHand && index !== state.actorSeat);
  const nick = state.seats[seat].nick;
  state.seats[seat].stack = 0;
  state.seats[seat].allIn = true;

  const result = Engine.command(state, {
    type: "leave",
    nick,
    leaveIntent: "spectate",
    requestId: "leave:allin-spectate",
  }, context(1060));

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.state.seats[seat].leaving, true);
  assert.equal(result.state.seats[seat].folded, false);
  assert.equal(result.state.seats[seat].allIn, true);
  const view = Engine.view(result.state, nick);
  assert.deepEqual(view.heroCards, []);
  assert.deepEqual(view.viewer.cards, []);
  assert.deepEqual(view.legalActions.actions, []);
  assert.equal(Object.hasOwn(view.seats[seat], "cards"), false);
});

test("reserved leaving players stay through results and are cleared before the next hand", () => {
  const names = ["alice", "bob", "cara"];
  let state = tableWithPlayers(names);
  state = readyAndStart(state, names, 1100);
  const leavingSeat = state.seats.findIndex((player, index) =>
    player && player.inHand && index !== state.actorSeat && player.nick !== "alice");
  const leavingNick = state.seats[leavingSeat].nick;

  state = apply(state, {
    type: "leave",
    nick: leavingNick,
    requestId: "leave:after-result",
  }, 1101);
  assert.equal(state.seats[leavingSeat].leaving, true);

  state.phase = "hand_end";
  state.seats.forEach((player) => {
    if (player && !player.leaving && player.stack > 0) player.ready = true;
  });
  assert.equal(Engine.view(state, "alice").seats[leavingSeat].leaving, true);

  const started = Engine.command(state, {
    type: "start",
    nick: "alice",
    requestId: "start:after-leaver",
  }, context(1102));

  assert.equal(started.ok, true, started.reason);
  assert.equal(started.state.seats[leavingSeat], null);
});
