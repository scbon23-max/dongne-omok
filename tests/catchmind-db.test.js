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

const results = [
  { nick: "A", points: 10, maxPoints: 10, correct: 1, drawCorrect: 0 },
  { nick: "B", points: 3, maxPoints: 10, correct: 0, drawCorrect: 1 }
];

test("catchmind retry inserts only missing player records", async () => {
  const loaded = loadDb([{ black: "A", white: "cm:match-1:10:10:1:0" }]);
  await loaded.db.recordCatchmindMatch("match-1", results);

  assert.equal(loaded.inserted.length, 1);
  assert.equal(loaded.inserted[0].length, 1);
  assert.equal(loaded.inserted[0][0].black, "B");
  assert.match(loaded.inserted[0][0].white, /^cm:match-1:/);
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
