"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "territory-rush.js"), "utf8");

function loadEngine() {
  const windowObject = { __TERRITORY_RUSH_TEST__: true };
  vm.runInNewContext(source, { window: windowObject, console, Date, Math, setTimeout, clearTimeout });
  return windowObject.TerritoryRush._test;
}

function key(width, x, y) {
  return y * width + x;
}

function rectangleTrail(width, x0, y0, x1, y1) {
  const trail = [];
  for (let x = x0; x <= x1; x++) {
    trail.push(key(width, x, y0), key(width, x, y1));
  }
  for (let y = y0 + 1; y < y1; y++) {
    trail.push(key(width, x0, y), key(width, x1, y));
  }
  return trail;
}

test("capture permanently reserves every cell outside the arena boundary", () => {
  const engine = loadEngine();
  const width = engine.constants.width;
  const height = engine.constants.height;
  const map = new Int8Array(engine.constants.cells);
  map.fill(-1);
  for (let x = 0; x < width; x++) {
    map[key(width, x, 0)] = 0;
    map[key(width, x, height - 1)] = 0;
  }
  for (let y = 0; y < height; y++) {
    map[key(width, 0, y)] = 0;
    map[key(width, width - 1, y)] = 0;
  }

  engine.captureInto(map, rectangleTrail(width, 2, 2, 6, 6), 0);

  assert.equal(map[key(width, 3, 3)], 0);
  for (let x = 0; x < width; x++) {
    assert.equal(map[key(width, x, 0)], -1);
    assert.equal(map[key(width, x, height - 1)], -1);
  }
  for (let y = 0; y < height; y++) {
    assert.equal(map[key(width, 0, y)], -1);
    assert.equal(map[key(width, width - 1, y)], -1);
  }
});

test("base creation cannot paint the reserved boundary ring", () => {
  const engine = loadEngine();
  const width = engine.constants.width;
  const height = engine.constants.height;
  const player = engine.makePlayer(0, "edge-base", false, 1);
  player.spawnX = 1.2;
  player.spawnY = 1.2;
  const state = engine.freshState();
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();

  engine.createBase(player, true);

  const owner = engine.getOwner();
  assert.equal(owner[key(width, 1, 1)], player.id);
  for (let x = 0; x < width; x++) {
    assert.equal(owner[key(width, x, 0)], -1);
    assert.equal(owner[key(width, x, height - 1)], -1);
  }
  for (let y = 0; y < height; y++) {
    assert.equal(owner[key(width, 0, y)], -1);
    assert.equal(owner[key(width, width - 1, y)], -1);
  }
});

test("playable land is the percentage denominator so a full arena reaches one hundred percent", () => {
  const engine = loadEngine();
  const width = engine.constants.width;
  const height = engine.constants.height;
  const player = engine.makePlayer(0, "full-owner", false, 1);
  const state = engine.freshState();
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();
  const owner = engine.getOwner();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (engine.isPlayableCell(x, y)) owner[key(width, x, y)] = player.id;
    }
  }

  assert.equal(engine.constants.playableCells, 70 * 106);
  assert.equal(engine.rankRows()[0].area, 100);
  assert.equal((source.match(/\/ PLAYABLE_CELL_COUNT \* 100/g) || []).length, 3);
});

test("the arena exterior is filled with the exact boundary-line color", () => {
  const engine = loadEngine();
  const calls = [];
  const fakeContext = {
    fillStyle: "",
    fillRect(x, y, width, height) {
      calls.push({ color: this.fillStyle, x, y, width, height });
    }
  };

  engine.fillArenaOutside(fakeContext, 10, 20, 90, 80, 100, 100);

  assert.deepEqual(calls, [
    { color: "#31576a", x: 0, y: 0, width: 100, height: 20 },
    { color: "#31576a", x: 0, y: 80, width: 100, height: 20 },
    { color: "#31576a", x: 0, y: 20, width: 10, height: 60 },
    { color: "#31576a", x: 90, y: 20, width: 10, height: 60 }
  ]);
  assert.match(source, /fillArenaOutside\(ctx, left, top, right, bottom, view\.width, view\.height\)/);
  assert.match(source, /fillArenaOutside\(miniCtx, miniLeft, miniTop, miniRight, miniBottom, width, height\)/);
});
