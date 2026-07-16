"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

test("Pro recommendation control is created only for the named admin", () => {
  assert.doesNotMatch(index, /pro-hint-(?:row|btn)/);
  assert.match(game, /return me\.isAdmin === true && me\.nick === ADMIN;/);

  const control = between("function ensureProHintControl()", "function updateProHintControl()");
  assert.match(control, /if \(!isGunaAdmin\(\)\)/);
  assert.match(control, /document\.createElement\("button"\)/);
  assert.match(control, /button\.addEventListener\("click", requestProHint\)/);
});

test("Pro recommendation analysis stays local and evaluates the human side", () => {
  const request = between("function requestProHint()", "function cancelAiSearch()");
  assert.match(request, /if \(!isGunaAdmin\(\)\) return;/);
  assert.match(request, /var color = G\.turn;/);
  assert.match(request, /ensureAiWorker\("god"\)/);
  assert.match(request, /type: "search"/);
  assert.doesNotMatch(request, /Net\.send|broadcastState|addChatTo|Db\./);
  assert.match(game, /proHintContext\.position === proHintPositionKey\(\)/);
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
