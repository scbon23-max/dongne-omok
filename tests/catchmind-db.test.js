"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadDbWithInvoke(result) {
  const invocations = [];
  const sb = {
    functions: {
      invoke(name, options) {
        invocations.push({ name, options });
        return Promise.resolve(result);
      }
    }
  };
  const context = { window: { SB: sb }, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8"), context, { filename: "db.js" });
  return { db: context.window.Db, invocations };
}

test("catchmind profile invokes the progression function with only nickname and hash auth", async () => {
  const payload = { ok: true, profile: { nickname: "A", level: 25 } };
  const loaded = loadDbWithInvoke({ data: payload, error: null });

  const response = await loaded.db.getCatchmindProfile({
    nick: "A",
    hash: "abc123",
    isAdmin: true,
    token: "must-not-be-forwarded"
  });

  assert.equal(response, payload);
  assert.equal(loaded.invocations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.invocations[0])), {
    name: "catchmind-progression",
    options: {
      body: {
        action: "profile",
        auth: { nick: "A", hash: "abc123" }
      }
    }
  });
});

test("catchmind reward equip forwards one sanitized reward selection and returns the function payload", async () => {
  const payload = {
    ok: true,
    profile: { equipped: { boardFrame: "frame-prism-glass" } }
  };
  const loaded = loadDbWithInvoke({ data: payload, error: null });

  const response = await loaded.db.equipCatchmindReward(
    { nick: "A", hash: "abc123", extra: "ignored" },
    "board_frame",
    "frame-prism-glass"
  );

  assert.equal(response, payload);
  assert.equal(loaded.invocations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.invocations[0])), {
    name: "catchmind-progression",
    options: {
      body: {
        kind: "board_frame",
        rewardId: "frame-prism-glass",
        action: "equip",
        auth: { nick: "A", hash: "abc123" }
      }
    }
  });
});

test("catchmind progression wrappers forward match XP and MVP actions", async () => {
  const loaded = loadDbWithInvoke({ data: { ok: true }, error: null });
  const auth = { nick: "A", hash: "abc123", ignored: true };

  await loaded.db.awardCatchmindXp(auth, "match-1", {
    eligibleRounds: 3,
    answerTimesMs: [12000, 48000]
  }, {
    humanPlayers: 3,
    roundsPlayed: 3,
    completed: true
  });
  await loaded.db.voteCatchmindMvp(auth, "match-1", "B");
  await loaded.db.getCatchmindMvpResult(auth, "match-1");

  assert.deepEqual(
    JSON.parse(JSON.stringify(loaded.invocations.map((entry) => entry.options.body))),
    [
      {
        matchId: "match-1",
        result: { eligibleRounds: 3, answerTimesMs: [12000, 48000] },
        context: { humanPlayers: 3, roundsPlayed: 3, completed: true },
        action: "award",
        auth: { nick: "A", hash: "abc123" }
      },
      {
        matchId: "match-1",
        nominee: "B",
        action: "mvp_vote",
        auth: { nick: "A", hash: "abc123" }
      },
      {
        matchId: "match-1",
        action: "mvp_result",
        auth: { nick: "A", hash: "abc123" }
      }
    ]
  );
});

test("catchmind progression wrappers reject missing auth before invoking the function", async () => {
  const loaded = loadDbWithInvoke({ data: { ok: true }, error: null });

  assert.deepEqual(
    JSON.parse(JSON.stringify(await loaded.db.getCatchmindProfile({ nick: "A" }))),
    { ok: false, reason: "auth" }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await loaded.db.equipCatchmindReward({}, "board_frame", "frame-color-pencil"))),
    { ok: false, reason: "auth" }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await loaded.db.awardCatchmindXp({}, "match-1", {}, {}))),
    { ok: false, reason: "auth" }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await loaded.db.voteCatchmindMvp({}, "match-1", "B"))),
    { ok: false, reason: "auth" }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await loaded.db.getCatchmindMvpResult({}, "match-1"))),
    { ok: false, reason: "auth" }
  );
  assert.equal(loaded.invocations.length, 0);
});
