"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");
const Renju = require("../renju.js");

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source block: ${start}`);
  return source.slice(from, to);
}

function boardWith(stones) {
  const board = Renju.emptyBoard();
  stones.forEach((stone) => { board[stone[0]][stone[1]] = stone[2]; });
  return board;
}

function loadFallbackHelpers(legacyMove) {
  const source = between(game, "function emergencyAiMove", "function rapfiSearchOptions");
  const context = {
    Renju,
    SIZE: Renju.SIZE,
    BLACK: Renju.BLACK,
    WHITE: Renju.WHITE,
    window: {
      OmokAI: {
        bestMoveLegacy() {
          if (legacyMove instanceof Error) throw legacyMove;
          return legacyMove;
        }
      }
    }
  };
  vm.runInNewContext(`${source}
    this.emergencyAiMove = emergencyAiMove;
    this.fallbackAiMove = fallbackAiMove;
  `, context);
  return context;
}

function plainMove(move) {
  return move ? [move[0], move[1]] : null;
}

test("emergency fallback takes a win and blocks an immediate loss", () => {
  const helpers = loadFallbackHelpers(new Error("worker failed"));
  const winningBoard = boardWith([
    [7, 2, Renju.BLACK],
    [7, 3, Renju.WHITE], [7, 4, Renju.WHITE],
    [7, 5, Renju.WHITE], [7, 6, Renju.WHITE]
  ]);
  assert.deepEqual(plainMove(helpers.fallbackAiMove(winningBoard, Renju.WHITE)), [7, 7]);

  const blockingBoard = boardWith([
    [5, 2, Renju.WHITE],
    [5, 3, Renju.BLACK], [5, 4, Renju.BLACK],
    [5, 5, Renju.BLACK], [5, 6, Renju.BLACK]
  ]);
  assert.deepEqual(plainMove(helpers.fallbackAiMove(blockingBoard, Renju.WHITE)), [5, 7]);
});

test("fallback rejects an invalid engine move and never chooses a black forbidden point", () => {
  const helpers = loadFallbackHelpers([7, 7]);
  const board = boardWith([
    [7, 6, Renju.BLACK], [7, 8, Renju.BLACK],
    [6, 7, Renju.BLACK], [8, 7, Renju.BLACK],
    [6, 6, Renju.WHITE], [8, 8, Renju.WHITE]
  ]);
  assert.equal(Renju.checkMove(board, 7, 7, Renju.BLACK).legal, false);
  const move = plainMove(helpers.fallbackAiMove(board, Renju.BLACK));
  assert.ok(move);
  assert.equal(Renju.checkMove(board, move[0], move[1], Renju.BLACK).legal, true);
  assert.notDeepEqual(move, [7, 7]);
});

test("AI search has deadline, failure, and stale-worker recovery paths", () => {
  const globals = between(game, "var aiPending", "function isGunaAdmin");
  const cancellation = between(game, "function clearAiMoveGuard", "function ensureAiWorker");
  const tick = between(game, "function aiTick()", "function onCenterBtn");
  const timer = between(game, "function startHostTimer()", "function stopHostTimer");

  assert.match(globals, /var aiMoveGuardId = null/);
  assert.match(cancellation, /clearAiMoveGuard\(\)/);
  assert.match(cancellation, /aiWorker\.terminate\(\)/);
  assert.match(tick, /AI_MOVE_DEADLINE_MARGIN_MS/);
  assert.match(tick, /worker\.terminate\(\)/);
  assert.match(tick, /finishWithFallback\(\)/);
  assert.match(tick, /data\.error \|\| !isLegalMove\(data\.move\)/);
  assert.doesNotMatch(tick, /OmokAI\.bestMove\(/);
  assert.match(timer, /G\.turn === omokAI\.color\) cancelAiSearch\(\)/);
});

test("a silent worker is terminated and replaced with a legal move at the turn deadline", () => {
  const tickSource = between(game, "function aiTick()", "function onCenterBtn");
  const timers = [];
  const worker = {
    terminated: false,
    postMessage(message) { this.message = message; },
    terminate() { this.terminated = true; }
  };
  const applied = [];
  const context = {
    G: {
      board: Renju.emptyBoard(),
      turn: Renju.WHITE,
      over: false,
      started: true,
      timerSec: 30,
      moveDeadline: 2000,
      gameSeq: 4,
      history: []
    },
    omokAI: { on: true, level: "hard", color: Renju.WHITE },
    aiPending: false,
    aiThinkSeq: 0,
    aiWorker: worker,
    aiWorkerKind: "classic",
    aiMoveGuardId: null,
    AI_THINK_DELAY_MS: 0,
    AI_MOVE_DEADLINE_MARGIN_MS: 900,
    Renju,
    Date: { now: () => 1000 },
    Math,
    setTimeout(fn, delay) {
      const timer = { fn, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cancelled = true;
    },
    clearAiMoveGuard() {
      if (context.aiMoveGuardId != null) {
        context.clearTimeout(context.aiMoveGuardId);
        context.aiMoveGuardId = null;
      }
    },
    afterBoardPaint(fn) { fn(); },
    fallbackAiMove() { return [7, 7]; },
    ensureAiWorker() { return worker; },
    aiSearchOptions() { return { maxDepth: 4 }; },
    rapfiSearchOptions() { return {}; },
    hostApplyMove(nick, r, c) { applied.push([nick, r, c]); },
    AI_NICK: "AI",
    toast() {},
    broadcastState() {},
    updateTurnUI() {},
    renderPresenceUI() {},
    broadcastRoomOpen() {}
  };

  vm.runInNewContext(`${tickSource}; this.runAiTick = aiTick;`, context);
  context.runAiTick();

  assert.equal(worker.message.level, "hard");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 100);
  timers[0].fn();

  assert.equal(worker.terminated, true);
  assert.deepEqual(applied, [["AI", 7, 7]]);
  assert.equal(context.aiPending, false);
  assert.equal(context.aiWorker, null);
});

test("a cancelled Pro search cannot downgrade the current game from a late worker error", () => {
  const tickSource = between(game, "function aiTick()", "function onCenterBtn");
  const worker = {
    terminated: false,
    postMessage(message) { this.message = message; },
    terminate() { this.terminated = true; }
  };
  const notices = [];
  const context = {
    G: {
      board: Renju.emptyBoard(),
      turn: Renju.WHITE,
      over: false,
      started: true,
      timerSec: 30,
      moveDeadline: 30000,
      gameSeq: 9,
      history: [],
      aiLevel: "god",
      rev: 1
    },
    omokAI: { on: true, level: "god", color: Renju.WHITE },
    aiPending: false,
    aiThinkSeq: 0,
    aiWorker: worker,
    aiWorkerKind: "rapfi",
    aiMoveGuardId: null,
    AI_THINK_DELAY_MS: 0,
    AI_MOVE_DEADLINE_MARGIN_MS: 900,
    Renju,
    Date: { now: () => 1000 },
    Math,
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    clearAiMoveGuard() {},
    afterBoardPaint(fn) { fn(); },
    fallbackAiMove() { return [7, 7]; },
    ensureAiWorker() { return worker; },
    aiSearchOptions() { return {}; },
    rapfiSearchOptions() { return {}; },
    hostApplyMove() {},
    AI_NICK: "AI",
    toast(message) { notices.push(message); },
    broadcastState() {},
    updateTurnUI() {},
    renderPresenceUI() {},
    broadcastRoomOpen() {}
  };

  vm.runInNewContext(`${tickSource}; this.runAiTick = aiTick;`, context);
  context.runAiTick();
  assert.equal(worker.message.type, "search");

  context.aiThinkSeq++;
  worker.onmessage({ data: { id: 1, move: null, error: "worker terminated" } });

  assert.equal(context.omokAI.level, "god");
  assert.equal(context.G.aiLevel, "god");
  assert.deepEqual(notices, []);
});
