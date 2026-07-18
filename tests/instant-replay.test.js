"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source block: ${start}`);
  return source.slice(from, to);
}

test("the Omok result overlay offers an in-place replay control", () => {
  assert.match(index, /id="omok-again"[\s\S]*id="omok-instant-replay"[^>]*>복기<[\s\S]*id="omok-win-rank"/);
  assert.match(index, /id="instant-replay-controls"[\s\S]*id="instant-replay-first"[\s\S]*id="instant-replay-prev"[\s\S]*id="instant-replay-next"[\s\S]*id="instant-replay-last"[\s\S]*id="instant-replay-close"/);
  assert.match(styles, /\.win-actions \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.win-actions #omok-again \{[^}]*grid-column: 1 \/ -1/);
  assert.match(styles, /\.instant-replay-actions \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
});

test("instant replay is local-only and expires with the room or next game", () => {
  const snapshot = between(game, "function snapshot()", "function broadcastState()");
  const start = between(game, "function startInstantReplay()", "function closeInstantReplay()");
  assert.doesNotMatch(snapshot, /instantReplay/);
  assert.doesNotMatch(start, /Net\.|Db\.|localStorage|sessionStorage|netMode|omokAI/);
  assert.match(game, /function resetRoomGameState\(\) \{\s*cancelAiSearch\(\);\s*discardInstantReplay\(\);/);
  assert.match(game, /function leaveRoomToLobby\(\) \{\s*discardInstantReplay\(\);/);
  assert.match(game, /function beginGame\(by\)[\s\S]*?discardInstantReplay\(\);[\s\S]*?G\.history = \[\];/);
  assert.match(game, /instantReplay\.gameSeq !== G\.gameSeq\) discardInstantReplay\(\)/);
});

test("instant replay paints copied moves on the live board without mutating it", () => {
  const position = between(game, "function instantReplayPosition()", "function discardInstantReplay()");
  const render = between(game, "function render()", "function setStoneShadow(color)");
  assert.match(position, /var board = Renju\.emptyBoard\(\), lastMove = null/);
  assert.match(position, /board\[move\.r\]\[move\.c\] = move\.color/);
  assert.doesNotMatch(position, /G\.board\[[^\]]+\]\[[^\]]+\]\s*=/);
  assert.match(render, /var position = instantReplayPosition\(\), board = position\.board/);
  assert.match(render, /if \(board\[sr\]\[sc\]\) drawStoneShadow/);
  assert.match(render, /if \(position\.lastMove\) drawLastMoveMarker\(position\.lastMove, board\)/);
  assert.match(render, /drawMoveCount\(position\.moveCount\)/);
});

test("instant replay reconstructs the requested move without changing the final board", () => {
  const helpers = between(game, "function copyInstantReplayMoves(moves)", "function discardInstantReplay()");
  const emptyBoard = () => Array.from({ length: 15 }, () => Array(15).fill(0));
  const finalBoard = emptyBoard();
  finalBoard[7][7] = 1;
  finalBoard[7][8] = 2;
  finalBoard[8][7] = 1;
  const context = {
    SIZE: 15,
    BLACK: 1,
    WHITE: 2,
    G: { board: finalBoard, lastMove: { r: 8, c: 7 } },
    instantReplay: null,
    Renju: { emptyBoard }
  };
  vm.runInNewContext(`${helpers}
    instantReplay = {
      moves: copyInstantReplayMoves([
        { r: 7, c: 7, color: BLACK },
        { r: 7, c: 8, color: WHITE },
        { r: 8, c: 7, color: BLACK }
      ]),
      index: 2
    };
    this.replayPosition = instantReplayPosition();
  `, context);

  assert.equal(context.replayPosition.board[7][7], 1);
  assert.equal(context.replayPosition.board[7][8], 2);
  assert.equal(context.replayPosition.board[8][7], 0);
  assert.equal(context.replayPosition.lastMove.r, 7);
  assert.equal(context.replayPosition.lastMove.c, 8);
  assert.equal(context.replayPosition.moveCount, 2);
  assert.equal(finalBoard[8][7], 1);
});

test("instant replay controls are bound and work for AI games through shared history", () => {
  assert.match(game, /\$\("omok-instant-replay"\)\.addEventListener\("click", startInstantReplay\)/);
  assert.match(game, /\$\("instant-replay-close"\)\.addEventListener\("click", closeInstantReplay\)/);
  assert.match(game, /function beginAiGameNow[\s\S]*?beginGame\(me\.nick\)/);
  assert.match(game, /var moves = copyInstantReplayMoves\(G\.history\)/);
});
