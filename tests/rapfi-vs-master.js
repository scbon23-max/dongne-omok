"use strict";

var path = require("path");
global.window = global;
global.Renju = require("../renju.js");
require("../omok-ai.js");
require("../omok-ai-v2.js");
delete global.window;

var base = path.join(__dirname, "..", "assets", "rapfi");
var Rapfi = require(path.join(base, "rapfi-single-simd128.js"));
var BLACK = Renju.BLACK, WHITE = Renju.WHITE;
var RAPFI_DEPTH = Math.max(8, Number(process.argv[2]) || 12);
var MASTER_DEPTH = Math.max(2, Number(process.argv[3]) || 6);
var MASTER_TIME_MS = Math.max(250, Number(process.argv[4]) || 1500);
var MAX_MOVES = 70;
var rapfi = null;
var rapfiMoveText = null;
var metrics = {
  rapfi: { moves: 0, ms: 0 },
  master: { moves: 0, ms: 0 }
};

var opening = [
  { r: 7, c: 7, color: BLACK },
  { r: 7, c: 8, color: WHITE },
  { r: 8, c: 8, color: BLACK },
  { r: 6, c: 6, color: WHITE }
];

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
  rapfi.sendCommand("INFO max_depth " + RAPFI_DEPTH);
  rapfi.sendCommand("INFO timeout_match 0");
  rapfi.sendCommand("INFO timeout_turn 0");
}

function chooseRapfi(board, history, color) {
  rapfiMoveText = null;
  var startedAt = Date.now();
  rapfi.sendCommand(positionCommand(history, color));
  var elapsed = Date.now() - startedAt;
  metrics.rapfi.moves++;
  metrics.rapfi.ms += elapsed;
  if (!rapfiMoveText) return null;
  var parts = rapfiMoveText.split(",").map(Number);
  return [parts[1], parts[0]];
}

function chooseMaster(board, color) {
  var startedAt = Date.now();
  var move = OmokAI.bestMove(board, color, "master", {
    maxDepth: MASTER_DEPTH,
    softTimeMs: MASTER_TIME_MS
  });
  metrics.master.moves++;
  metrics.master.ms += Date.now() - startedAt;
  return move;
}

function play(rapfiColor) {
  var board = Renju.emptyBoard();
  var history = opening.map(function (move) {
    board[move.r][move.c] = move.color;
    return { r: move.r, c: move.c, color: move.color };
  });
  var turn = BLACK;
  for (var ply = history.length; ply < MAX_MOVES; ply++) {
    var move = turn === rapfiColor
      ? chooseRapfi(board, history, turn)
      : chooseMaster(board, turn);
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

(async function () {
  await initRapfi();
  var asBlack = play(BLACK);
  var asWhite = play(WHITE);
  function name(result, rapfiColor) {
    if (!result.winner) return "draw";
    return result.winner === rapfiColor ? "rapfi" : "master";
  }
  var summary = {
    rapfiDepth: RAPFI_DEPTH,
    masterDepth: MASTER_DEPTH,
    masterTimeMs: MASTER_TIME_MS,
    games: [
      { rapfiColor: "black", winner: name(asBlack, BLACK), moves: asBlack.moves, reason: asBlack.reason },
      { rapfiColor: "white", winner: name(asWhite, WHITE), moves: asWhite.moves, reason: asWhite.reason }
    ],
    averageMs: {
      rapfi: metrics.rapfi.moves ? Math.round(metrics.rapfi.ms / metrics.rapfi.moves) : 0,
      master: metrics.master.moves ? Math.round(metrics.master.ms / metrics.master.moves) : 0
    }
  };
  console.log("RAPFI_MATCH " + JSON.stringify(summary));
})().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
