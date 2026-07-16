"use strict";

var assert = require("assert");
var path = require("path");

global.self = global;
global.importScripts = function () {
  for (var i = 0; i < arguments.length; i++) {
    var file = String(arguments[i]).split("?")[0];
    require(path.join(__dirname, "..", file));
  }
};

var posted = null;
self.postMessage = function (message) { posted = message; };
require("../omok-ai-worker.js");

var board = self.Renju.emptyBoard();
board[7][7] = self.Renju.BLACK;
self.onmessage({
  data: {
    id: 17,
    board: board,
    color: self.Renju.WHITE,
    level: "master",
    options: { maxDepth: 2 }
  }
});

assert.strictEqual(posted.id, 17);
assert.strictEqual(Array.isArray(posted.move), true);
assert.strictEqual(posted.move.length, 2);
assert.strictEqual(posted.error, undefined);
assert.strictEqual(posted.stats.depth, 2);

console.log("omok-ai-worker tests passed");
