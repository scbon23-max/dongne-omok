"use strict";

importScripts("renju.js?v=rapfi-pro-v1-20260716");

var RAPFI_REVISION = "3aedf3a2ab0ab710a9f3d00e57d5287ceb864894";
var RAPFI_ASSET_ROOT = "assets/rapfi/";
var rapfiModule = null;
var rapfiPromise = null;
var loaderImported = false;
var activeSearch = null;

function assetUrl(name) {
  return RAPFI_ASSET_ROOT + name + "?v=" + RAPFI_REVISION.slice(0, 8);
}

function errorText(error) {
  return error && error.message ? error.message : String(error);
}

function keepLine(list, line) {
  if (!line) return;
  list.push(String(line));
  if (list.length > 12) list.shift();
}

function receiveStdout(line) {
  if (!activeSearch) return;
  var text = String(line || "").trim();
  keepLine(activeSearch.output, text);
  var match = /^(\d{1,2}),(\d{1,2})$/.exec(text);
  if (match) activeSearch.move = [Number(match[2]), Number(match[1])];
}

function receiveStderr(line) {
  if (activeSearch) keepLine(activeSearch.errors, String(line || "").trim());
}

function ensureRapfi() {
  if (rapfiPromise) return rapfiPromise;
  rapfiPromise = Promise.resolve().then(function () {
    if (!loaderImported) {
      importScripts(assetUrl("rapfi-single-simd128.js"));
      loaderImported = true;
    }
    if (typeof self.Rapfi !== "function") throw new Error("Rapfi loader is unavailable");
    return self.Rapfi({
      locateFile: function (name) { return assetUrl(name); },
      onReceiveStdout: receiveStdout,
      onReceiveStderr: receiveStderr,
      onExit: function () { rapfiModule = null; },
      setStatus: function () {}
    });
  }).then(function (module) {
    rapfiModule = module;
    module.sendCommand("INFO rule 4");
    module.sendCommand("START 15");
    module.sendCommand("INFO show_detail 0");
    return module;
  }).catch(function (error) {
    rapfiModule = null;
    rapfiPromise = null;
    throw error;
  });
  return rapfiPromise;
}

function otherColor(color) {
  return color === self.Renju.BLACK ? self.Renju.WHITE : self.Renju.BLACK;
}

function boardStoneCount(board) {
  var count = 0;
  for (var r = 0; r < self.Renju.SIZE; r++) {
    for (var c = 0; c < self.Renju.SIZE; c++) {
      if (board[r][c] === self.Renju.BLACK || board[r][c] === self.Renju.WHITE) count++;
    }
  }
  return count;
}

function historySequence(board, history) {
  if (!Array.isArray(history)) return null;
  var sequence = [];
  var seen = Object.create(null);
  for (var i = 0; i < history.length; i++) {
    var move = history[i] || {};
    var r = Number(move.r), c = Number(move.c), color = Number(move.color);
    var key = r + ":" + c;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= self.Renju.SIZE ||
        c < 0 || c >= self.Renju.SIZE || seen[key] || board[r][c] !== color ||
        (color !== self.Renju.BLACK && color !== self.Renju.WHITE)) return null;
    seen[key] = true;
    sequence.push({ r: r, c: c, color: color });
  }
  return sequence.length === boardStoneCount(board) ? sequence : null;
}

function boardSequence(board) {
  var byColor = {};
  byColor[self.Renju.BLACK] = [];
  byColor[self.Renju.WHITE] = [];
  for (var r = 0; r < self.Renju.SIZE; r++) {
    for (var c = 0; c < self.Renju.SIZE; c++) {
      var color = board[r][c];
      if (byColor[color]) byColor[color].push({ r: r, c: c, color: color });
    }
  }
  var sequence = [], expected = self.Renju.BLACK;
  while (byColor[self.Renju.BLACK].length || byColor[self.Renju.WHITE].length) {
    if (byColor[expected].length) {
      sequence.push(byColor[expected].shift());
      expected = otherColor(expected);
    } else {
      expected = otherColor(expected);
    }
  }
  return sequence;
}

function sequenceWithPasses(sequence, sideToMove) {
  var events = [], expected = self.Renju.BLACK;
  for (var i = 0; i < sequence.length; i++) {
    var move = sequence[i];
    if (move.color !== expected) {
      events.push({ pass: true, color: expected });
      expected = otherColor(expected);
    }
    if (move.color !== expected) throw new Error("Invalid move color sequence");
    events.push(move);
    expected = otherColor(expected);
  }
  if (expected !== sideToMove) {
    events.push({ pass: true, color: expected });
    expected = otherColor(expected);
  }
  if (expected !== sideToMove) throw new Error("Unable to reconstruct side to move");
  return events;
}

function boardCommand(data) {
  var board = data.board;
  if (!Array.isArray(board) || board.length !== self.Renju.SIZE) throw new Error("Invalid board");
  var sequence = historySequence(board, data.history) || boardSequence(board);
  var events = sequenceWithPasses(sequence, data.color);
  var lines = ["BOARD"];
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    var side = event.color === data.color ? 1 : 2;
    lines.push((event.pass ? "-1,-1" : event.c + "," + event.r) + "," + side);
  }
  lines.push("DONE");
  return lines.join("\n");
}

function configureSearch(module, options) {
  options = options || {};
  var deadline = Number(options.deadlineMs) || 0;
  if (deadline > 0 && Number(options.timerSec) > 0) {
    var budget = Math.max(250, Math.floor(deadline - Date.now() - 1200));
    module.sendCommand("INFO max_depth 99");
    module.sendCommand("INFO timeout_turn " + budget);
    module.sendCommand("INFO timeout_match " + budget);
    module.sendCommand("INFO time_left " + budget);
    return budget;
  }

  var maxDepth = Math.max(8, Math.min(16, Number(options.maxDepth) || 12));
  module.sendCommand("INFO max_depth " + maxDepth);
  module.sendCommand("INFO timeout_match 0");
  module.sendCommand("INFO timeout_turn 0");
  return 0;
}

function search(data) {
  ensureRapfi().then(function (module) {
    var command = boardCommand(data);
    var budget = configureSearch(module, data.options);
    var startedAt = Date.now();
    var state = { move: null, output: [], errors: [] };
    activeSearch = state;
    try {
      module.sendCommand(command);
    } finally {
      activeSearch = null;
    }

    if (!state.move) {
      throw new Error(state.errors[state.errors.length - 1] || "Rapfi returned no move");
    }
    var legal = self.Renju.checkMove(data.board, state.move[0], state.move[1], data.color);
    if (!legal.legal) throw new Error("Rapfi returned an incompatible move: " + legal.reason);
    self.postMessage({
      id: data.id,
      move: state.move,
      stats: {
        engine: "Rapfi",
        revision: RAPFI_REVISION.slice(0, 8),
        searchMs: Date.now() - startedAt,
        budgetMs: budget,
        output: state.output
      }
    });
  }).catch(function (error) {
    self.postMessage({ id: data.id, move: null, error: errorText(error) });
  });
}

self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type === "init") {
    ensureRapfi().then(function () {
      self.postMessage({ type: "ready" });
    }).catch(function (error) {
      self.postMessage({ type: "error", error: errorText(error) });
    });
    return;
  }
  if (data.type === "search") search(data);
};
