"use strict";

var path = require("path");
var base = path.join(__dirname, "..", "assets", "rapfi");
var Rapfi = require(path.join(base, "rapfi-single-simd128.js"));
var maxDepth = Math.max(1, Number(process.argv[2]) || 4);
var timeMs = process.argv[3] === undefined ? 3000 : Math.max(0, Number(process.argv[3]) || 0);
var scenario = process.argv[4] || "opening";

(async function () {
  var stdout = [], stderr = [];
  var module = await Rapfi({
    locateFile: function (name) { return path.join(base, name); },
    onReceiveStdout: function (line) { if (line) stdout.push(String(line)); },
    onReceiveStderr: function (line) { if (line) stderr.push(String(line)); },
    setStatus: function () {}
  });

  module.sendCommand("INFO rule 4");
  module.sendCommand("START 15");
  module.sendCommand("INFO show_detail 0");
  module.sendCommand("INFO max_depth " + maxDepth);
  if (timeMs) {
    module.sendCommand("INFO timeout_turn " + timeMs);
    module.sendCommand("INFO timeout_match 0");
    module.sendCommand("INFO time_left 2147483647");
  } else {
    module.sendCommand("INFO timeout_match 0");
    module.sendCommand("INFO timeout_turn 0");
    module.sendCommand("INFO time_left 2147483647");
  }

  var startedAt = Date.now();
  var positions = {
    opening: "BOARD\n7,7,2\nDONE",
    midgame: "BOARD\n7,7,1\n8,7,2\n8,8,1\n6,6,2\n6,8,1\n8,6,2\n6,9,1\n9,5,2\nDONE",
    leadingPass: "BOARD\n-1,-1,2\nDONE",
    trailingPass: "BOARD\n7,7,1\n-1,-1,2\nDONE"
  };
  var position = positions[scenario] || positions.opening;
  module.sendCommand(position);
  var moves = stdout.filter(function (line) { return /^\d+,\d+$/.test(line); });
  var result = {
    move: moves.length ? moves[moves.length - 1] : null,
    maxDepth: maxDepth,
    timeMs: timeMs,
    scenario: scenario,
    elapsedMs: Date.now() - startedAt,
    stderr: stderr.slice(-5),
    stdout: stdout.slice(-8)
  };
  console.log("RAPFI_SMOKE " + JSON.stringify(result));
  if (!result.move) process.exitCode = 1;
})().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
