"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const Renju = require(path.join(root, "renju.js"));
const source = fs.readFileSync(path.join(root, "rapfi-worker.js"), "utf8");
const messages = [];
const context = {
  self: { Renju, postMessage(message) { messages.push(message); } },
  importScripts() {},
  Promise,
  Date,
  Number,
  String,
  Array,
  Object,
  Math,
  RegExp,
  Error
};
context.self.self = context.self;
vm.createContext(context);
vm.runInContext(source, context);

function boardWith(stones) {
  const board = Renju.emptyBoard();
  for (const stone of stones) board[stone.r][stone.c] = stone.color;
  return board;
}

test("Rapfi BOARD uses x,y coordinates and AI-relative side flags", () => {
  const history = [{ r: 7, c: 7, color: Renju.BLACK }];
  const command = context.boardCommand({
    board: boardWith(history),
    history,
    color: Renju.WHITE
  });
  assert.equal(command, "BOARD\n7,7,2\nDONE");
});

test("Rapfi BOARD reconstructs timer skips as protocol pass moves", () => {
  assert.equal(context.boardCommand({
    board: Renju.emptyBoard(),
    history: [],
    color: Renju.WHITE
  }), "BOARD\n-1,-1,2\nDONE");

  const history = [{ r: 7, c: 7, color: Renju.BLACK }];
  assert.equal(context.boardCommand({
    board: boardWith(history),
    history,
    color: Renju.BLACK
  }), "BOARD\n7,7,1\n-1,-1,2\nDONE");
});

test("Rapfi output coordinates convert back to board row and column", () => {
  context.activeSearch = { move: null, output: [], errors: [] };
  context.receiveStdout("7,4");
  assert.deepEqual(Array.from(context.activeSearch.move), [4, 7]);
  context.activeSearch = null;
});

test("timed searches use the current deadline and unlimited searches end on depth", () => {
  const commands = [];
  const module = { sendCommand(command) { commands.push(command); } };
  const budget = context.configureSearch(module, {
    timerSec: 30,
    deadlineMs: Date.now() + 30000
  });
  assert.ok(budget >= 28000 && budget <= 28900);
  assert.deepEqual(commands.slice(0, 4), [
    "INFO max_depth 99",
    "INFO timeout_turn " + budget,
    "INFO timeout_match " + budget,
    "INFO time_left " + budget
  ]);

  commands.length = 0;
  assert.equal(context.configureSearch(module, { timerSec: 0, maxDepth: 12 }), 0);
  assert.deepEqual(commands, [
    "INFO max_depth 12",
    "INFO timeout_match 0",
    "INFO timeout_turn 0"
  ]);
});
