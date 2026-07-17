"use strict";

var assert = require("assert");

global.window = global;
global.Renju = require("../renju.js");
require("../omok-ai.js");
var legacyCalls = [];
var rawLegacyBestMove = global.OmokAI.bestMove;
global.OmokAI.bestMove = function (board, color, level) {
  legacyCalls.push(level);
  return rawLegacyBestMove(board, color, level);
};
require("../omok-ai-v2.js");

var BLACK = Renju.BLACK;
var WHITE = Renju.WHITE;

function boardWith(stones) {
  var board = Renju.emptyBoard();
  stones.forEach(function (stone) { board[stone[0]][stone[1]] = stone[2]; });
  return board;
}

function master(board, color, depth) {
  return OmokAI.bestMove(board, color, "master", { maxDepth: depth || 2 });
}

function sameBoard(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

(function emptyBoardUsesCenter() {
  assert.deepStrictEqual(master(Renju.emptyBoard(), BLACK), [7, 7]);
})();

(function takesImmediateWin() {
  var board = boardWith([
    [7, 2, BLACK],
    [7, 3, WHITE], [7, 4, WHITE], [7, 5, WHITE], [7, 6, WHITE]
  ]);
  assert.deepStrictEqual(master(board, WHITE), [7, 7]);
})();

(function blocksImmediateLoss() {
  var board = boardWith([
    [5, 2, WHITE],
    [5, 3, BLACK], [5, 4, BLACK], [5, 5, BLACK], [5, 6, BLACK]
  ]);
  assert.deepStrictEqual(master(board, WHITE), [5, 7]);
})();

(function winsBeforeBlocking() {
  var board = boardWith([
    [5, 2, WHITE],
    [5, 3, BLACK], [5, 4, BLACK], [5, 5, BLACK], [5, 6, BLACK],
    [8, 2, BLACK],
    [8, 3, WHITE], [8, 4, WHITE], [8, 5, WHITE], [8, 6, WHITE]
  ]);
  assert.deepStrictEqual(master(board, WHITE), [8, 7]);
})();

(function findsDoubleOpenFour() {
  var board = boardWith([
    [7, 5, WHITE], [7, 6, WHITE], [7, 8, WHITE],
    [5, 7, WHITE], [6, 7, WHITE], [8, 7, WHITE],
    [4, 4, BLACK], [4, 5, BLACK], [9, 9, BLACK]
  ]);
  assert.deepStrictEqual(master(board, WHITE), [7, 7]);
})();

(function neverReturnsForbiddenBlackMove() {
  var board = boardWith([
    [7, 6, BLACK], [7, 8, BLACK], [6, 7, BLACK], [8, 7, BLACK],
    [6, 6, WHITE], [8, 8, WHITE], [5, 9, WHITE]
  ]);
  assert.strictEqual(Renju.checkMove(board, 7, 7, BLACK).legal, false);
  var move = master(board, BLACK, 4);
  assert.strictEqual(Renju.checkMove(board, move[0], move[1], BLACK).legal, true);
  assert.notDeepStrictEqual(move, [7, 7]);
})();

(function searchDoesNotMutateInput() {
  var board = boardWith([[7, 7, BLACK], [7, 8, WHITE], [8, 8, BLACK]]);
  var before = board.map(function (row) { return row.slice(); });
  master(board, WHITE, 4);
  assert.strictEqual(sameBoard(board, before), true);
})();

(function difficultiesUsePromotedEngines() {
  var board = boardWith([
    [7, 2, BLACK],
    [7, 3, WHITE], [7, 4, WHITE], [7, 5, WHITE], [7, 6, WHITE]
  ]);
  var expectedRoutes = [
    ["easy", "medium"],
    ["medium", "hard"]
  ];

  expectedRoutes.forEach(function (route) {
    legacyCalls.length = 0;
    assert.deepStrictEqual(OmokAI.bestMove(board, WHITE, route[0]), [7, 7]);
    assert.deepStrictEqual(legacyCalls, [route[1]]);
  });

  legacyCalls.length = 0;
  assert.deepStrictEqual(OmokAI.bestMove(board, WHITE, "hard", { maxDepth: 8 }), [7, 7]);
  assert.deepStrictEqual(legacyCalls, []);
  assert.ok(OmokAI.getLastStats());
  assert.ok(OmokAI.getLastStats().depth <= 4);

  legacyCalls.length = 0;
  assert.deepStrictEqual(master(board, WHITE), [7, 7]);
  assert.deepStrictEqual(legacyCalls, []);
})();

console.log("omok-ai-v2 tests passed");
