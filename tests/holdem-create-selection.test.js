"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const game = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");

test("Hold'em create room starts without a selected buy-in", () => {
  assert.match(game, /HOLDEM_CREATE_SELECTION_STORAGE_PREFIX = "dongne_holdem_create_selection:"/);
  assert.match(game, /function readStoredHoldemCreateSelection\(\)/);
  assert.match(game, /function storeHoldemCreateSelection\(mode, speed, buyIn\)/);
  assert.match(game, /function restoreHoldemCreateSelection\(\)/);
  assert.match(game, /var createHoldemBuyIn = 0/);
  assert.match(game, /function selectedCreateHoldemBuyIn\(\)/);
  assert.doesNotMatch(game, /var initialHoldemSelection = restoreHoldemCreateSelection\(\) \|\| \{\}/);
  assert.match(game, /confirm\.disabled = mode === "ring" && \(!canBuyIn \|\| !selectedBuyInAvailable \|\| holdemWalletPending\)/);
  assert.match(game, /toast\("참가비용을 먼저 선택하세요"\)/);
  assert.match(game, /storeHoldemCreateSelection\(createHoldemMode, createHoldemSpeed, createHoldemBuyIn\)/);
});
