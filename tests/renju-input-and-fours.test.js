"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Renju = require("../renju.js");

for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
  test(`two distinct fours on one line are forbidden (${dr},${dc})`, () => {
    const board = Renju.emptyBoard();
    for (const offset of [-4, -2, -1, 2]) board[7 + dr * offset][7 + dc * offset] = 1;
    const before = JSON.stringify(board);
    assert.equal(Renju.analyzeBlack(board, 7, 7).fours, 2);
    assert.deepEqual(Renju.checkMove(board, 7, 7, 1), { legal: false, win: false, reason: "double_four" });
    assert.equal(Renju.blackForbiddenReason(board, 7, 7), "double_four");
    assert.ok(Renju.forbiddenPoints(board).some(p => p.r === 7 && p.c === 7 && p.reason === "double_four"));
    assert.equal(JSON.stringify(board), before);
  });
}

test("both winning ends of a single open four count only once", () => {
  const board = Renju.emptyBoard();
  for (const c of [4, 5, 6]) board[7][c] = 1;
  assert.equal(Renju.analyzeBlack(board, 7, 7).fours, 1);
  assert.equal(Renju.checkMove(board, 7, 7, 1).legal, true);
  board[7][3] = 1;
  for (const r of [3, 5, 6, 9]) board[r][7] = 1;
  assert.deepEqual(Renju.checkMove(board, 7, 7, 1), { legal: true, win: true, reason: null });
});

test("fractional, nonfinite, string and out-of-range moves cannot crash or alter the board", () => {
  const board = Renju.emptyBoard();
  const before = JSON.stringify(board);
  for (const coord of [0.5, -1, 15, NaN, Infinity, "7", null, undefined]) {
    for (const [r, c] of [[coord, 7], [7, coord]]) {
      assert.deepEqual(Renju.checkMove(board, r, c, 1), { legal: false, win: false, reason: "invalid" });
      assert.equal(Renju.blackForbiddenReason(board, r, c), null);
      assert.equal(Renju.analyzeBlack(board, r, c).fours, 0);
    }
  }
  assert.equal(Renju.checkMove(board, 7, 7, 3).legal, false);
  assert.equal(JSON.stringify(board), before);
});

test("malformed board snapshots are rejected including sparse arrays", () => {
  const sparse = Renju.emptyBoard();
  delete sparse[7][7];
  for (const board of [null, {}, [], new Array(15), [[], ...Renju.emptyBoard().slice(1)], sparse]) {
    assert.equal(Renju.isValidBoard(board), false);
    assert.deepEqual(Renju.forbiddenPoints(board), []);
    assert.equal(Renju.checkMove(board, 7, 7, 1).legal, false);
  }
  const invalidCell = Renju.emptyBoard();
  invalidCell[0][0] = "1";
  assert.equal(Renju.isValidBoard(invalidCell), false);
});
