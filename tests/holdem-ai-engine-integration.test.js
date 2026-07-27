"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../holdem-engine.js");
const AI = require("../holdem-ai.js");

function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function randomIntGenerator(seed) {
  const random = randomGenerator(seed);
  return (max) => Math.floor(random() * max);
}

function requireCommand(state, command, context) {
  const result = Engine.command(state, command, context);
  assert.equal(result.ok, true, `${command.type}: ${result.reason}`);
  return result.state;
}

test("a real six-seat table can run consecutive strong-AI hands across all personalities", {
  timeout: 20000,
}, () => {
  const totalChips = 60000;
  let now = 1000;
  let state = Engine.createTable({
    roomId: "ai-engine-soak",
    ownerNick: "owner",
    startingStack: 10000,
    smallBlind: 100,
    bigBlind: 200,
    actionMs: 5000,
  });
  state = requireCommand(state, {
    type: "join",
    nick: "owner",
    requestId: "join:owner",
  }, { now: now++, randomInt: randomIntGenerator(1) });

  Array.from({ length: 5 }).forEach((_, index) => {
    state = requireCommand(state, {
      type: "add_bot",
      nick: "owner",
      requestId: `add:${index}`,
    }, { now: now++, randomInt: randomIntGenerator(10 + index) });
  });
  const assignedPersonalities = state.seats
    .filter((player) => player && player.isBot)
    .map((player) => player.botPersonality);
  assert.equal(new Set(assignedPersonalities).size, 4);
  assignedPersonalities.forEach((personality) => {
    assert.ok(Object.hasOwn(AI.PERSONALITIES, personality));
  });
  state = requireCommand(state, {
    type: "ready",
    nick: "owner",
    ready: true,
    requestId: "ready:owner:0",
  }, { now: now++, randomInt: randomIntGenerator(20) });
  const deckRandom = randomIntGenerator(20260725);
  state = requireCommand(state, {
    type: "start",
    nick: "owner",
    requestId: "start:0",
  }, { now: now++, randomInt: deckRandom });

  const actedPersonalities = new Set();
  let completedHands = 0;
  let actionGuard = 0;
  while (completedHands < 12 && state.phase !== "tournament_end") {
    if (["preflop", "flop", "turn", "river"].includes(state.phase)) {
      assert.ok(actionGuard++ < 2500, "the AI action loop terminated");
      const actor = state.seats[state.actorSeat];
      assert.ok(actor && actor.inHand && !actor.folded);
      if (actor.isBot) {
        const observation = Engine.botView(state, actor.botId);
        const serialized = JSON.stringify(observation);
        assert.equal(serialized.includes('"deck"'), false);
        assert.equal(serialized.includes('"burn"'), false);
        observation.seats.forEach((seat) => {
          if (seat && seat.seat !== actor.seat && !observation.showdown.length) {
            assert.equal(Object.hasOwn(seat, "cards"), false);
          }
        });
        const random = randomGenerator(
          Math.imul(state.handNo + 1, 1009) ^ Math.imul(state.actionSeq + 1, 9176) ^ actor.seat,
        );
        const decision = AI.decide(observation, {
          simulations: 8,
          random,
        });
        assert.equal(observation.legalActions.actions.includes(decision.action), true);
        actedPersonalities.add(actor.botPersonality);
        now = Math.max(now + 1, state.botDueAt || 0);
        state = requireCommand(state, {
          type: "bot_act",
          botId: actor.botId,
          action: decision.action,
          amount: decision.amount,
          requestId: `bot:${state.handNo}:${state.actionSeq}:${actor.botId}`,
        }, { now, randomInt: deckRandom, internalBot: true });
      } else {
        const legal = Engine.legalActions(state, actor.nick);
        const action = legal.actions.includes("check") ? "check" : "call";
        state = requireCommand(state, {
          type: "act",
          nick: actor.nick,
          action,
          requestId: `human:${state.handNo}:${state.actionSeq}`,
        }, { now: ++now, randomInt: deckRandom });
      }
      continue;
    }

    assert.equal(state.phase, "hand_end");
    completedHands += 1;
    assert.equal(
      state.seats.reduce((sum, player) => sum + (player ? player.stack : 0), 0),
      totalChips,
    );
    if (completedHands >= 12) break;
    const owner = state.seats.find((player) => player && player.nick === "owner");
    if (owner && owner.stack > 0) {
      state = requireCommand(state, {
        type: "ready",
        nick: "owner",
        ready: true,
        requestId: `ready:owner:${completedHands}`,
      }, { now: ++now, randomInt: deckRandom });
    }
    const eligible = state.seats.filter((player) => player && player.stack > 0 && player.ready);
    if (eligible.length < 2) break;
    state = requireCommand(state, {
      type: "start",
      nick: "owner",
      requestId: `start:${completedHands}`,
    }, { now: ++now, randomInt: deckRandom });
  }

  assert.equal(completedHands, 12);
  assert.deepEqual(
    [...actedPersonalities].sort(),
    Object.keys(AI.PERSONALITIES).sort(),
  );
  assert.equal(
    state.seats.reduce((sum, player) => sum + (player ? player.stack : 0), 0),
    totalChips,
  );
});
