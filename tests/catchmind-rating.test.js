"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
const start = source.indexOf("  function catchmindRatingDeltas(players, kFactor) {");
const end = source.indexOf("\n  function aggregateCatchmind(games)", start);
assert.ok(start >= 0 && end > start);
const calculate = vm.runInNewContext("(" + source.slice(start, end).trim() + ")");

function player(nick, score, elo) {
  return { row: { nick, score }, elo };
}

test("CatchMind rating follows final match score order", () => {
  const deltas = calculate([
    player("A", 30, 1000),
    player("B", 20, 1000),
    player("C", 10, 1000)
  ], 32);

  assert.ok(deltas.A > deltas.B);
  assert.ok(deltas.B > deltas.C);
  assert.ok(deltas.A > 0);
});

test("a sole CatchMind winner always gains at least one rating point", () => {
  const deltas = calculate([
    player("favorite", 30, 3000),
    player("runner-up", 20, 1000),
    player("last", 10, 1000)
  ], 32);

  assert.equal(deltas.favorite, 1);
  assert.ok(deltas.last < 0);
});

test("equal final scores are treated as a tie", () => {
  const deltas = calculate([
    player("veteran", 30, 1200),
    player("newcomer", 30, 1000)
  ], 32);

  assert.ok(deltas.veteran < 0);
  assert.ok(deltas.newcomer > 0);
});
