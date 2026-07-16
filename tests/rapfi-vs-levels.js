"use strict";

var path = require("path");
global.window = global;
global.Renju = require("../renju.js");
require("../omok-ai.js");
require("../omok-ai-v2.js");
global.location = { pathname: "/" };

var base = path.join(__dirname, "..", "assets", "rapfi");
var Rapfi = require(path.join(base, "rapfi-single-simd128.js"));
var BLACK = Renju.BLACK, WHITE = Renju.WHITE;
var PRO_DEPTH = Math.max(8, Number(process.argv[2]) || 12);
var OPENING_COUNT = Math.max(1, Math.min(5, Number(process.argv[3]) || 5));
var MASTER_DEPTH = 6;
var MASTER_TIME_MS = 28800;
var MAX_MOVES = 90;
var rapfi = null;
var rapfiMoveText = null;

var levels = ["easy", "medium", "hard", "master"];
var levelNames = { easy: "초보", medium: "중수", hard: "고수", master: "초고수" };
var openings = [
  [[7, 7, BLACK], [7, 8, WHITE], [8, 8, BLACK], [6, 6, WHITE]],
  [[7, 7, BLACK], [6, 7, WHITE], [8, 7, BLACK], [7, 6, WHITE]],
  [[7, 7, BLACK], [8, 8, WHITE], [7, 9, BLACK], [6, 8, WHITE]],
  [[7, 7, BLACK], [8, 7, WHITE], [6, 8, BLACK], [8, 8, WHITE]],
  [[7, 7, BLACK], [6, 8, WHITE], [8, 6, BLACK], [7, 8, WHITE]]
].slice(0, OPENING_COUNT);

var metrics = {};
function metric(agent) {
  if (!metrics[agent]) metrics[agent] = { moves: 0, ms: 0, depths: 0, depthMoves: 0 };
  return metrics[agent];
}

function seededRandom(seed) {
  var value = seed >>> 0;
  Math.random = function () {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function other(color) {
  return color === BLACK ? WHITE : BLACK;
}

function positionCommand(history, selfColor) {
  var lines = ["BOARD"];
  for (var i = 0; i < history.length; i++) {
    var move = history[i];
    lines.push(move.c + "," + move.r + "," + (move.color === selfColor ? 1 : 2));
  }
  lines.push("DONE");
  return lines.join("\n");
}

async function initRapfi() {
  rapfi = await Rapfi({
    locateFile: function (name) { return path.join(base, name); },
    onReceiveStdout: function (line) {
      if (/^\d+,\d+$/.test(String(line))) rapfiMoveText = String(line);
    },
    onReceiveStderr: function () {},
    setStatus: function () {}
  });
  rapfi.sendCommand("INFO rule 4");
  rapfi.sendCommand("START 15");
  rapfi.sendCommand("INFO show_detail 0");
  rapfi.sendCommand("INFO max_depth " + PRO_DEPTH);
  rapfi.sendCommand("INFO timeout_match 0");
  rapfi.sendCommand("INFO timeout_turn 0");
}

function choose(agent, board, history, color) {
  var startedAt = Date.now(), move;
  if (agent === "pro") {
    rapfiMoveText = null;
    rapfi.sendCommand(positionCommand(history, color));
    if (rapfiMoveText) {
      var parts = rapfiMoveText.split(",").map(Number);
      move = [parts[1], parts[0]];
    }
  } else {
    var options = agent === "master"
      ? { maxDepth: MASTER_DEPTH, softTimeMs: MASTER_TIME_MS }
      : {};
    move = OmokAI.bestMove(board, color, agent, options);
  }

  var m = metric(agent);
  m.moves++;
  m.ms += Date.now() - startedAt;
  if (agent === "master") {
    var stats = OmokAI.getLastStats();
    if (stats) { m.depths += stats.depth || 0; m.depthMoves++; }
  }
  return move;
}

function initialPosition(opening) {
  var board = Renju.emptyBoard(), history = [];
  for (var i = 0; i < opening.length; i++) {
    var item = opening[i];
    var check = Renju.checkMove(board, item[0], item[1], item[2]);
    if (!check.legal || check.win) throw new Error("Invalid tournament opening");
    board[item[0]][item[1]] = item[2];
    history.push({ r: item[0], c: item[1], color: item[2] });
  }
  return { board: board, history: history };
}

function play(blackAgent, whiteAgent, opening, seed) {
  seededRandom(seed);
  var initial = initialPosition(opening);
  var board = initial.board, history = initial.history;
  var turn = history.length % 2 === 0 ? BLACK : WHITE;
  for (var ply = history.length; ply < MAX_MOVES; ply++) {
    var agent = turn === BLACK ? blackAgent : whiteAgent;
    var move = choose(agent, board, history, turn);
    if (!move) return { winner: other(turn), moves: ply, reason: "no_move" };
    var check = Renju.checkMove(board, move[0], move[1], turn);
    if (!check.legal) return { winner: other(turn), moves: ply, reason: "illegal_" + check.reason };
    board[move[0]][move[1]] = turn;
    history.push({ r: move[0], c: move[1], color: turn });
    if (check.win) return { winner: turn, moves: ply + 1, reason: "five" };
    turn = other(turn);
  }
  return { winner: 0, moves: MAX_MOVES, reason: "move_limit" };
}

function proResult(result, proColor) {
  if (!result.winner) return "draw";
  return result.winner === proColor ? "win" : "loss";
}

(async function () {
  await initRapfi();
  var summaries = [];
  for (var levelIndex = 0; levelIndex < levels.length; levelIndex++) {
    var level = levels[levelIndex];
    var summary = { level: level, name: levelNames[level], wins: 0, draws: 0, losses: 0, totalMoves: 0, games: [] };
    for (var openingIndex = 0; openingIndex < openings.length; openingIndex++) {
      var seed = 5000 + levelIndex * 100 + openingIndex * 2;
      var asBlack = play("pro", level, openings[openingIndex], seed);
      var blackResult = proResult(asBlack, BLACK);
      summary[blackResult + "s"]++;
      summary.totalMoves += asBlack.moves;
      summary.games.push({ proColor: "black", result: blackResult, moves: asBlack.moves, reason: asBlack.reason });
      console.log(levelNames[level] + " " + (openingIndex + 1) + "/" + openings.length + " 프로=흑 " + blackResult + " " + asBlack.moves + "수");

      var asWhite = play(level, "pro", openings[openingIndex], seed + 1);
      var whiteResult = proResult(asWhite, WHITE);
      summary[whiteResult + "s"]++;
      summary.totalMoves += asWhite.moves;
      summary.games.push({ proColor: "white", result: whiteResult, moves: asWhite.moves, reason: asWhite.reason });
      console.log(levelNames[level] + " " + (openingIndex + 1) + "/" + openings.length + " 프로=백 " + whiteResult + " " + asWhite.moves + "수");
    }
    summary.averageMoves = Math.round(summary.totalMoves / summary.games.length * 10) / 10;
    summaries.push(summary);
  }

  var metricSummary = {};
  Object.keys(metrics).forEach(function (agent) {
    var m = metrics[agent];
    metricSummary[agent] = {
      moves: m.moves,
      averageMs: m.moves ? Math.round(m.ms / m.moves) : 0,
      averageDepth: m.depthMoves ? Math.round(m.depths * 100 / m.depthMoves) / 100 : null
    };
  });
  console.log("RAPFI_LEVELS " + JSON.stringify({
    proDepth: PRO_DEPTH,
    masterDepth: MASTER_DEPTH,
    openings: openings.length,
    summaries: summaries,
    metrics: metricSummary
  }));
})().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
