"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Renju = require("../renju.js");
const ProHintExplain = require("../pro-hint-explain.js");

function boardWith(stones) {
  const board = Renju.emptyBoard();
  stones.forEach(([r, c, color]) => { board[r][c] = color; });
  return board;
}

test("a winning recommendation is explained as an immediate finish", () => {
  const board = boardWith([
    [7, 3, Renju.WHITE],
    [7, 4, Renju.WHITE],
    [7, 5, Renju.WHITE],
    [7, 6, Renju.WHITE]
  ]);
  const explanation = ProHintExplain.explain(board, 7, 7, Renju.WHITE, Renju);

  assert.equal(explanation.category, "win");
  assert.equal(explanation.metrics.immediateWin, true);
  assert.match(explanation.summary, /승리수/);
  assert.match(explanation.reasons.join(" "), /다섯 돌.*즉시 승리/);
});

test("an urgent block identifies the opponent's immediate win", () => {
  const board = boardWith([
    [7, 2, Renju.BLACK],
    [7, 3, Renju.WHITE],
    [7, 4, Renju.WHITE],
    [7, 5, Renju.WHITE],
    [7, 6, Renju.WHITE]
  ]);
  const explanation = ProHintExplain.explain(board, 7, 7, Renju.BLACK, Renju);

  assert.equal(explanation.category, "block");
  assert.equal(explanation.metrics.blocksImmediateWin, true);
  assert.match(explanation.summary, /먼저 막아야/);
  assert.match(explanation.reasons.join(" "), /상대.*바로 오목/);
});

test("an open-four recommendation explains its two winning replies", () => {
  const board = boardWith([
    [7, 5, Renju.WHITE],
    [7, 6, Renju.WHITE],
    [7, 8, Renju.WHITE]
  ]);
  const explanation = ProHintExplain.explain(board, 7, 7, Renju.WHITE, Renju);

  assert.equal(explanation.category, "double-threat");
  assert.equal(explanation.metrics.winningReplies, 2);
  assert.match(explanation.summary, /두 갈래.*겹공격/);
  assert.match(explanation.reasons.join(" "), /완성할 자리.*2곳/);
});

test("taking the opponent's fork point is explained as prevention", () => {
  const board = boardWith([
    [7, 5, Renju.WHITE],
    [7, 6, Renju.WHITE],
    [7, 8, Renju.WHITE]
  ]);
  const explanation = ProHintExplain.explain(board, 7, 7, Renju.BLACK, Renju);

  assert.equal(explanation.category, "prevention");
  assert.equal(explanation.metrics.preventedWinningReplies, 2);
  assert.match(explanation.summary, /상대의 큰 공격 자리/);
  assert.match(explanation.reasons.join(" "), /상대.*승리점.*2곳/);
});

test("a quiet center move gets a positional explanation without inventing tactics", () => {
  const board = Renju.emptyBoard();
  const before = board.map((row) => row.slice());
  const explanation = ProHintExplain.explain(board, 7, 7, Renju.BLACK, Renju);

  assert.equal(explanation.category, "positional");
  assert.equal(explanation.metrics.immediateWin, false);
  assert.equal(explanation.metrics.blocksImmediateWin, false);
  assert.equal(explanation.metrics.winningReplies, 0);
  assert.equal(explanation.metrics.openDirections, 4);
  assert.ok(explanation.reasons.length >= 2);
  assert.match(explanation.reasons.join(" "), /여러 공격|중앙/);
  assert.deepEqual(board, before);
});
