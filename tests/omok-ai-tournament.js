"use strict";

global.window = global;
global.Renju = require("../renju.js");
require("../omok-ai.js");
require("../omok-ai-v2.js");

var BLACK = Renju.BLACK;
var WHITE = Renju.WHITE;
var NEW_DEPTH = Math.max(2, Number(process.argv[2]) || 4);
var OPENING_COUNT = Math.max(1, Number(process.argv[3]) || 2);
var ONLY = process.argv[4] || "";
var MAX_MOVES = 90;

var openings = [
  [[7, 7, BLACK], [7, 8, WHITE], [8, 8, BLACK], [6, 6, WHITE]],
  [[7, 7, BLACK], [6, 7, WHITE], [8, 7, BLACK], [7, 6, WHITE]],
  [[7, 7, BLACK], [8, 8, WHITE], [7, 9, BLACK], [6, 8, WHITE]],
  [[7, 7, BLACK], [8, 7, WHITE], [6, 8, BLACK], [8, 8, WHITE]],
  [[7, 7, BLACK], [6, 8, WHITE], [8, 6, BLACK], [7, 8, WHITE]]
].slice(0, OPENING_COUNT);

var metrics = {};
function metric(name) {
  if (!metrics[name]) metrics[name] = { moves: 0, ms: 0, nodes: 0, depths: 0, statsMoves: 0 };
  return metrics[name];
}

function seededRandom(seed) {
  var value = seed >>> 0;
  Math.random = function () {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function choose(agent, board, color) {
  var started = Date.now();
  var move;
  if (agent === "new-master") move = OmokAI.bestMove(board, color, "master", { maxDepth: NEW_DEPTH });
  else if (agent === "legacy-master") move = OmokAI.bestMoveLegacy(board, color, "master");
  else move = OmokAI.bestMoveLegacy(board, color, agent);
  var elapsed = Date.now() - started;
  var m = metric(agent);
  m.moves++;
  m.ms += elapsed;
  if (agent === "new-master") {
    var stats = OmokAI.getLastStats();
    if (stats) {
      m.nodes += (stats.nodes || 0) + (stats.qnodes || 0);
      m.depths += stats.depth || 0;
      m.statsMoves++;
    }
  }
  return move;
}

function initialBoard(opening) {
  var board = Renju.emptyBoard();
  for (var i = 0; i < opening.length; i++) {
    var move = opening[i];
    var result = Renju.checkMove(board, move[0], move[1], move[2]);
    if (!result.legal || result.win) throw new Error("Invalid tournament opening");
    board[move[0]][move[1]] = move[2];
  }
  return board;
}

function playGame(blackAgent, whiteAgent, opening, seed) {
  seededRandom(seed);
  var board = initialBoard(opening);
  var turn = opening.length % 2 === 0 ? BLACK : WHITE;
  for (var ply = opening.length; ply < MAX_MOVES; ply++) {
    var agent = turn === BLACK ? blackAgent : whiteAgent;
    var move = choose(agent, board, turn);
    if (!move || !Array.isArray(move)) {
      return { winner: other(turn), moves: ply, reason: "no_move" };
    }
    var result = Renju.checkMove(board, move[0], move[1], turn);
    if (!result.legal) {
      return { winner: other(turn), moves: ply, reason: "illegal_" + result.reason };
    }
    board[move[0]][move[1]] = turn;
    if (result.win) return { winner: turn, moves: ply + 1, reason: "five" };
    turn = other(turn);
  }
  return { winner: 0, moves: MAX_MOVES, reason: "move_limit" };
}

function other(color) {
  return color === BLACK ? WHITE : BLACK;
}

function resultName(result, newColor) {
  if (!result.winner) return "draw";
  return result.winner === newColor ? "new" : "opponent";
}

var opponents = ["easy", "medium", "hard", "legacy-master"];
if (ONLY) opponents = opponents.filter(function (name) { return name === ONLY; });
var summaries = [];

opponents.forEach(function (opponent, opponentIndex) {
  var summary = { opponent: opponent, wins: 0, draws: 0, losses: 0, games: [] };
  openings.forEach(function (opening, openingIndex) {
    var asBlack = playGame("new-master", opponent, opening, 1000 + opponentIndex * 100 + openingIndex * 2);
    var blackName = resultName(asBlack, BLACK);
    if (blackName === "new") summary.wins++;
    else if (blackName === "draw") summary.draws++;
    else summary.losses++;
    summary.games.push({ newColor: "black", result: blackName, moves: asBlack.moves, reason: asBlack.reason });
    console.log(opponent + " opening " + (openingIndex + 1) + " new=black " + blackName + " " + asBlack.moves + " moves");

    var asWhite = playGame(opponent, "new-master", opening, 1001 + opponentIndex * 100 + openingIndex * 2);
    var whiteName = resultName(asWhite, WHITE);
    if (whiteName === "new") summary.wins++;
    else if (whiteName === "draw") summary.draws++;
    else summary.losses++;
    summary.games.push({ newColor: "white", result: whiteName, moves: asWhite.moves, reason: asWhite.reason });
    console.log(opponent + " opening " + (openingIndex + 1) + " new=white " + whiteName + " " + asWhite.moves + " moves");
  });
  summaries.push(summary);
});

var metricSummary = {};
Object.keys(metrics).forEach(function (name) {
  var m = metrics[name];
  metricSummary[name] = {
    moves: m.moves,
    averageMs: m.moves ? Math.round(m.ms / m.moves) : 0,
    averageDepth: m.statsMoves ? Math.round(m.depths * 100 / m.statsMoves) / 100 : null,
    averageNodes: m.statsMoves ? Math.round(m.nodes / m.statsMoves) : null
  };
});

console.log("TOURNAMENT_JSON " + JSON.stringify({
  newDepth: NEW_DEPTH,
  openings: openings.length,
  summaries: summaries,
  metrics: metricSummary
}));
