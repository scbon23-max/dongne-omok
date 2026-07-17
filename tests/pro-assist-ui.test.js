"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function between(start, end) {
  const from = game.indexOf(start);
  const to = game.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source block: ${start}`);
  return game.slice(from, to);
}

test("Pro recommendation has no dedicated control and uses the AI seat", () => {
  assert.doesNotMatch(index, /pro-hint-(?:row|btn)/);
  assert.doesNotMatch(index, /pro-hint-explain-modal/);
  assert.doesNotMatch(styles, /\.pro-hint-(?:row|btn)/);
  assert.match(game, /return me\.isAdmin === true && me\.nick === ADMIN;/);
  assert.doesNotMatch(game, /ensureProHintControl|updateProHintControl/);
  assert.ok(
    index.indexOf('{ src: "pro-hint-explain.js" }') < index.indexOf('{ src: "game.js" }'),
    "the local explanation helper must load before game.js"
  );

  const seatTap = between("function onSeatChipTap(color)", "function bind()");
  assert.match(seatTap, /G\.seats\[color\] === AI_NICK/);
  assert.match(seatTap, /isGunaAdmin\(\)/);
  assert.match(seatTap, /proHintSessionActive\(\)/);
  assert.match(seatTap, /requestProHint\(\)/);
  assert.match(seatTap, /toggleProHintExplanation\(\)/);
  assert.match(game, /"chip-black"\)\.addEventListener\("click", function \(\) \{ onSeatChipTap\("black"\)/);
  assert.match(game, /"chip-white"\)\.addEventListener\("click", function \(\) \{ onSeatChipTap\("white"\)/);
});

test("Pro recommendation analysis stays local and evaluates the human side", () => {
  const request = between("function requestProHint()", "function clearAiMoveGuard()");
  assert.match(request, /if \(!isGunaAdmin\(\)\) return;/);
  assert.match(request, /if \(proHintPending\)/);
  assert.match(request, /var color = G\.turn;/);
  assert.match(request, /ensureAiWorker\("god"\)/);
  assert.match(request, /type: "search"/);
  assert.doesNotMatch(request, /Net\.send|broadcastState|addChatTo|Db\./);
  assert.match(game, /proHintContext\.position === proHintPositionKey\(\)/);
});

test("Pro principal variation is computed and displayed locally", () => {
  const explanation = between("function hasCurrentProHint()", "function clearProHint");
  assert.match(explanation, /if \(!isGunaAdmin\(\) \|\| !proHintSessionActive\(\) \|\| !hasCurrentProHint\(\)\) return;/);
  assert.match(explanation, /window\.ProHintExplain\.explainLine/);
  assert.match(explanation, /proHintVariation = explanation\.steps\.slice\(0, PRO_HINT_PV_LIMIT\)/);
  assert.match(explanation, /panel\.classList\.remove\("hidden"\)/);
  assert.match(explanation, /function showProHintThinking\(\)/);
  assert.match(explanation, /if \(proHintPending\) clearProHint\(true\)/);
  assert.match(explanation, /boardWrap\.parentNode\.insertBefore\(panel, boardWrap\.nextSibling\)/);
  assert.match(explanation, /document\.createElement\("li"\)/);
  assert.doesNotMatch(explanation, /Net\.send|broadcastState|addChatTo|Db\./);
  assert.match(styles, /\.pro-hint-analysis \{/);
  assert.match(styles, /\.pro-hint-analysis-close \{/);
  assert.match(styles, /\.pro-hint-analysis\.thinking/);
  assert.doesNotMatch(styles, /\.pro-hint-explain-modal/);
});

test("only the admin's active Pro AI seat tap requests or explains a recommendation", () => {
  const seatTap = between("function onSeatChipTap(color)", "function bind()");

  function run(admin, active, hasHint) {
    const calls = { hint: 0, explanation: 0, seat: 0 };
    const context = {
      G: { seats: { black: "구나", white: "AI" }, started: true, over: false },
      AI_NICK: "AI",
      me: { nick: "구나" },
      netMode: true,
      isGunaAdmin: () => admin,
      proHintSessionActive: () => active,
      hasCurrentProHint: () => hasHint,
      requestProHint: () => { calls.hint++; },
      toggleProHintExplanation: () => { calls.explanation++; },
      requestSeat: () => { calls.seat++; },
      $: () => ({ classList: { remove() {} } })
    };
    vm.runInNewContext(`${seatTap}; this.tap = onSeatChipTap;`, context);
    context.tap("white");
    return calls;
  }

  assert.deepEqual(run(true, true, false), { hint: 1, explanation: 0, seat: 0 });
  assert.deepEqual(run(true, true, true), { hint: 0, explanation: 1, seat: 0 });
  assert.deepEqual(run(false, true, true), { hint: 0, explanation: 0, seat: 0 });
  assert.deepEqual(run(true, false, true), { hint: 0, explanation: 0, seat: 0 });
});

test("Pro continuation reuses the engine PV and never enters shared room state", () => {
  const helpers = between("function normalizeProHintAnalysis", "function requestProHint()");
  const request = between("function requestProHint()", "function clearAiMoveGuard()");
  const render = between("function drawProHintVariation()", "function render()");

  assert.match(helpers, /analysis\.pv\.slice\(1\)/);
  assert.match(helpers, /proHintSeed = \{\s*position: proHintPositionKey\(\)/);
  assert.match(request, /if \(useProHintSeed\(\)\) return;/);
  assert.match(request, /data\.stats && data\.stats\.analysis/);
  assert.match(request, /options: rapfiHintSearchOptions\(\)/);
  assert.match(request, /showProHintThinking\(\)/);
  assert.match(render, /drawStone\(x, y, step\.color\)/);
  assert.match(render, /strokeText\(String\(step\.number\)/);
  assert.doesNotMatch(helpers + request, /Net\.send|broadcastState|addChatTo|Db\./);
});

test("the cached continuation shifts past the AI move and starts with the human reply", () => {
  const helpers = between("function normalizeProHintAnalysis", "function requestProHint()");
  const board = Array.from({ length: 15 }, () => Array(15).fill(0));
  board[7][7] = 1;
  const context = {
    SIZE: 15,
    BLACK: 1,
    WHITE: 2,
    PRO_HINT_PV_LIMIT: 5,
    G: { board, turn: 2 },
    omokAI: { color: 1 },
    proHintSeed: null,
    Renju: require("../renju.js"),
    proHintSessionActive: () => true,
    proHintPositionKey: () => "current-position"
  };
  vm.runInNewContext(`${helpers}
    rememberProHintContinuation([7, 7], {
      depth: 16,
      selectiveDepth: 11,
      evaluation: "120",
      timeMs: 900,
      pv: [[7, 7], [7, 8], [8, 7], [8, 8], [9, 7], [9, 8]]
    });
    this.cached = proHintSeed;
  `, context);

  assert.equal(context.cached.position, "current-position");
  assert.equal(context.cached.color, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(context.cached.analysis.pv)), [
    [7, 8], [8, 7], [8, 8], [9, 7], [9, 8]
  ]);
});

test("timed hint analysis keeps a reserve for the player's actual move", () => {
  const options = between("function rapfiHintSearchOptions()", "function afterBoardPaint");
  assert.match(options, /Math\.min\(8000, Math\.max\(1200, G\.timerSec \* 80\)\)/);
  assert.match(options, /Math\.max\(5000, Math\.min\(15000, G\.timerSec \* 1000 \* 0\.2\)\)/);
  assert.match(options, /deadlineMs: now \+ budget \+ 1200/);
});

test("PV overlays expire on board interaction and every shared move cleanup", () => {
  const boardTap = between("function onBoardTap(ev)", "function confirmPlace()");
  const clear = between("function clearProHint(terminateWorker)", "function syncProHintState()");
  const applyMove = between("function hostApplyMove(nick, r, c)", "function endGame()");

  assert.match(boardTap, /if \(proHintPending\) clearProHint\(true\)/);
  assert.match(boardTap, /else if \(proHintLineVisible\) hideProHintExplanation\(\)/);
  assert.match(clear, /proHintSeed = null/);
  assert.match(clear, /hideProHintExplanation\(\)/);
  assert.match(applyMove, /clearProHint\(true\)/);
});

test("Pro download progress remains separate from timed toasts until ready", () => {
  assert.match(game, /function showProLoadProgress\(percent, phase\)/);
  assert.match(game, /if \(data\.type === "progress"\) \{\s*showProLoadProgress\(data\.percent, data\.phase\)/);
  assert.match(game, /finishProLoadProgress\(\);\s*beginAiGameNow/);
  assert.doesNotMatch(game, /toast\("프로 AI 준비 중\.\.\."\)/);
});

test("Pro download progress uses the orange status treatment", () => {
  const from = styles.indexOf(".pro-load-progress {");
  const to = styles.indexOf("/* ── 로비 ── */", from);
  assert.ok(from >= 0 && to > from, "missing Pro download progress styles");
  const progressStyles = styles.slice(from, to);
  assert.match(progressStyles, /background: var\(--orange\)/);
  assert.match(progressStyles, /\.pro-load-track > span[^}]*background: #fff/);
  assert.doesNotMatch(progressStyles, /background: var\(--teal\)/);
});
