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

test("AI games use the player's occupied seat as their stone color", () => {
  const match = game.match(/function aiHumanSeatColor\(seats, nick\) \{[\s\S]*?\n  \}/);
  assert.ok(match, "AI seat helper should exist");

  const context = {};
  vm.runInNewContext(match[0] + `
    this.black = aiHumanSeatColor({ black: "me", white: null }, "me");
    this.white = aiHumanSeatColor({ black: null, white: "me" }, "me");
    this.none = aiHumanSeatColor({ black: "other", white: null }, "me");
  `, context);

  assert.equal(context.black, "black");
  assert.equal(context.white, "white");
  assert.equal(context.none, null);
  assert.match(game, /var humanColor = aiHumanSeatColor\(G\.seats, me\.nick\)/);
  assert.match(game, /G\.seats\[aiSeat\] = AI_NICK/);
});

test("the AI difficulty panel no longer offers a second stone choice", () => {
  assert.doesNotMatch(index, /data-color="(?:black|white)"/);
  assert.doesNotMatch(index, />내 돌</);
  assert.doesNotMatch(styles, /\.ai-color-segment|\.colorbtn|\.ai-stone/);
  assert.doesNotMatch(game, /aiHumanColor/);
  assert.doesNotMatch(game, /omokAI\.human/);
  assert.match(game, /startAiGame\(this\.getAttribute\("data-ai"\)\)/);
  assert.match(game, /startAiGame\(omokAI\.level\)/);
});

test("Master uses the same neutral difficulty button style as the standard levels", () => {
  assert.match(index, /<button class="lvbtn" data-ai="master">초고수<\/button>/);
  assert.doesNotMatch(index, /class="lvbtn master"/);
  assert.doesNotMatch(styles, /\.lvbtn\.master/);
});

test("spectators receive the authoritative AI difficulty from room state", () => {
  const snapshot = between(game, "function snapshot()", "function broadcastState()");
  const applyState = between(game, "function applyState(s)", "// ---------- 착수 ----------");
  const labels = between(game, "function normalizeAiLevel(level)", "function seatDisplay(nick)");
  assert.match(snapshot, /history: G\.history, aiLevel: G\.aiLevel/);
  assert.match(applyState, /G\.aiLevel = hasAiSeat \? normalizeAiLevel\(s\.aiLevel\) : null/);
  assert.match(game, /if \(nick === AI_NICK\) return esc\(aiLevelName\(G\.aiLevel\)\)/);
  assert.match(game, /var aiLevel = \(black === AI_NICK \|\| white === AI_NICK\) \? G\.aiLevel : null/);
  assert.match(game, /G\.aiLevel = normalizeAiLevel\(level\)/);
  assert.doesNotMatch(game, /aiLevelName\(omokAI\.level\)/);

  const context = {};
  vm.runInNewContext(`${labels}
    this.master = aiLevelName("master");
    this.hard = aiLevelName("hard");
    this.missing = aiLevelName(null);
    this.invalid = normalizeAiLevel("unknown");
  `, context);
  assert.equal(context.master, "초고수");
  assert.equal(context.hard, "고수");
  assert.equal(context.missing, "AI");
  assert.equal(context.invalid, null);
});
