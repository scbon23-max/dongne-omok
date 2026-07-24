"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadDb(existingRows, selectError) {
  const inserted = [];
  const sb = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        like() { return Promise.resolve({ data: existingRows || [], error: selectError || null }); },
        insert(rows) {
          inserted.push(rows);
          return Promise.resolve({ data: rows, error: null });
        }
      };
    }
  };
  const context = { window: { SB: sb }, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8"), context, { filename: "db.js" });
  return { db: context.window.Db, inserted };
}

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

const results = [
  { nick: "A", score: 9, points: 10, maxPoints: 10, correct: 1, drawCorrect: 0 },
  { nick: "B", score: 2, points: 3, maxPoints: 10, correct: 0, drawCorrect: 1 }
];

test("catchmind retry inserts only missing player records", async () => {
  const loaded = loadDb([{ black: "A", white: "cm:match-1:10:10:1:0" }]);
  await loaded.db.recordCatchmindMatch("match-1", results);

  assert.equal(loaded.inserted.length, 1);
  assert.equal(loaded.inserted[0].length, 1);
  assert.equal(loaded.inserted[0][0].black, "B");
  assert.equal(loaded.inserted[0][0].white, "cm:match-1:3:10:0:1:2");
});

test("catchmind retry is a no-op when every player is already saved", async () => {
  const loaded = loadDb([
    { black: "A", white: "cm:match-1:10:10:1:0" },
    { black: "B", white: "cm:match-1:3:10:0:1" }
  ]);
  const response = await loaded.db.recordCatchmindMatch("match-1", results);

  assert.equal(loaded.inserted.length, 0);
  assert.equal(response.error, null);
});

test("catchmind does not insert when duplicate lookup fails", async () => {
  const lookupError = { message: "temporary lookup failure" };
  const loaded = loadDb([], lookupError);
  const response = await loaded.db.recordCatchmindMatch("match-1", results);

  assert.equal(loaded.inserted.length, 0);
  assert.equal(response.error, lookupError);
});

test("catchmind records without a match score remain backward compatible", async () => {
  const loaded = loadDb([]);
  await loaded.db.recordCatchmindMatch("match-old", [
    { nick: "A", points: 10, maxPoints: 10, correct: 1, drawCorrect: 0 }
  ]);

  assert.equal(loaded.inserted[0][0].white, "cm:match-old:10:10:1:0:10");
});

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
  assert.equal(loaded.invocations.length, 0);
});
