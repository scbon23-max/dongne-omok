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
  context.activeSearch = { move: null, analysis: null, output: [], errors: [] };
  context.receiveStdout("7,4");
  assert.deepEqual(Array.from(context.activeSearch.move), [4, 7]);
  context.activeSearch = null;
});

test("Rapfi depth messages expose the completed principal variation", () => {
  const analysis = context.parseAnalysisLine(
    "MESSAGE Depth 12-11 | Eval +M13 | Time 148ms | G11 G8 F9 H9 F12"
  );
  assert.deepEqual(JSON.parse(JSON.stringify(analysis)), {
    depth: 12,
    selectiveDepth: 11,
    evaluation: "+M13",
    timeMs: 148,
    pv: [[10, 6], [7, 6], [8, 5], [8, 7], [11, 5]]
  });

  context.activeSearch = { move: null, analysis: null, output: [], errors: [] };
  context.receiveStdout("MESSAGE Depth 6-9 | Eval 1155 | Time 37ms | F9 H9 G11");
  context.receiveStdout("MESSAGE Depth 7-9 | Eval 1155 | Time 40ms | F9 H9 G11");
  assert.equal(context.activeSearch.analysis.depth, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(context.activeSearch.analysis.pv)), [
    [8, 5], [8, 7], [10, 6]
  ]);
  context.activeSearch = null;
});

test("principal variations stop before an occupied or illegal continuation", () => {
  const board = Renju.emptyBoard();
  const valid = context.validatePrincipalVariation(board, [
    [7, 7],
    [7, 8],
    [8, 7],
    [7, 8]
  ], Renju.BLACK);
  assert.deepEqual(JSON.parse(JSON.stringify(valid)), [
    [7, 7],
    [7, 8],
    [8, 7]
  ]);
  assert.deepEqual(board, Renju.emptyBoard());
});

test("a search response returns only a legal PV whose first move matches the recommendation", async () => {
  messages.length = 0;
  const module = {
    sendCommand(command) {
      if (!String(command).startsWith("BOARD")) return;
      context.receiveStdout("MESSAGE Depth 8-9 | Eval 321 | Time 40ms | H8 I8 H9");
      context.receiveStdout("7,7");
    }
  };
  context.ensureRapfi = () => Promise.resolve(module);
  context.search({
    id: "pv-test",
    board: Renju.emptyBoard(),
    history: [],
    color: Renju.BLACK,
    options: { timerSec: 0, maxDepth: 8 }
  });
  await new Promise((resolve) => setImmediate(resolve));

  const response = messages.find((message) => message.id === "pv-test");
  assert.deepEqual(JSON.parse(JSON.stringify(response.move)), [7, 7]);
  assert.deepEqual(JSON.parse(JSON.stringify(response.stats.analysis)), {
    depth: 8,
    selectiveDepth: 9,
    evaluation: "321",
    timeMs: 40,
    pv: [[7, 7], [7, 8], [8, 7]]
  });
});

test("Rapfi download status reports bundle progress through engine initialization", () => {
  messages.length = 0;
  context.lastProgressKey = "";
  context.receiveStatus("Downloading data...");
  context.receiveStatus("Downloading data... (9926580/19853161)");
  context.receiveStatus("Running...");
  context.reportProgress("ready", 100, context.RAPFI_BUNDLE_BYTES, context.RAPFI_BUNDLE_BYTES);

  assert.deepEqual(messages.map((message) => [message.type, message.phase, message.percent]), [
    ["progress", "download", 1],
    ["progress", "download", 47],
    ["progress", "initializing", 99],
    ["progress", "ready", 100]
  ]);
  assert.equal(messages[1].totalBytes, 21098292);
});

test("timed searches can stop on a completed target depth before their deadline", () => {
  const commands = [];
  const module = { sendCommand(command) { commands.push(command); } };
  const budget = context.configureSearch(module, {
    timerSec: 30,
    deadlineMs: Date.now() + 30000,
    maxDepth: 15,
    depthTarget: true
  });
  assert.ok(budget >= 28000 && budget <= 28900);
  assert.deepEqual(commands.slice(0, 4), [
    "INFO max_depth 15",
    "INFO timeout_turn " + budget,
    "INFO timeout_match 0",
    "INFO time_left 2147483647"
  ]);

  commands.length = 0;
  const hintBudget = context.configureSearch(module, {
    timerSec: 30,
    deadlineMs: Date.now() + 5000,
    maxDepth: 12
  });
  assert.ok(hintBudget >= 3800 && hintBudget <= 3900);
  assert.deepEqual(commands.slice(0, 4), [
    "INFO max_depth 99",
    "INFO timeout_turn " + hintBudget,
    "INFO timeout_match 0",
    "INFO time_left 2147483647"
  ]);

  commands.length = 0;
  assert.equal(context.configureSearch(module, { timerSec: 0, maxDepth: 21 }), 0);
  assert.deepEqual(commands, [
    "INFO max_depth 21",
    "INFO timeout_match 0",
    "INFO timeout_turn 0",
    "INFO time_left 2147483647"
  ]);
});
