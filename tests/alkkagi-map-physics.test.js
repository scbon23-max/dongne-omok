const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadAlkkagi() {
  function FakeImage() {
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
  }
  const sandbox = {
    window: {},
    Image: FakeImage,
    requestAnimationFrame: (fn) => fn(),
    cancelAnimationFrame: () => {},
    performance: { now: () => 0 },
    console
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "alkkagi-maps.js"), "utf8"), sandbox);
  sandbox.AlkkagiMaps = sandbox.window.AlkkagiMaps;
  vm.runInNewContext(fs.readFileSync(path.join(root, "alkkagi.js"), "utf8"), sandbox);
  return sandbox.window.Alkkagi;
}

function oneStone(game, x = 60, y = 220) {
  game.setStones([{ x, y, c: "b", alive: true }]);
}

function simulateOn(game, mapId, objects, vx, vy, x, y) {
  game.setMapState(mapId, objects || []);
  oneStone(game, x, y);
  return game.simulate(0, vx, vy);
}

test("ice keeps a moving stone sliding farther than the base board", () => {
  const game = loadAlkkagi();
  const base = simulateOn(game, "base", [], 4, 0, 60, 220);
  const ice = simulateOn(game, "ice", [], 4, 0, 60, 220);

  assert.equal(base.stones[0].alive, true);
  assert.equal(ice.stones[0].alive, true);
  assert.ok(ice.stones[0].x > base.stones[0].x + 70);
});

test("magnet and wind fields bend a moving stone", () => {
  const game = loadAlkkagi();
  const magnet = simulateOn(game, "magnet", [
    { type: "magnet", x: 150, y: 150, radius: 25, rotation: 0 }
  ], 4, 0, 60, 220);
  const wind = simulateOn(game, "wind", [
    { type: "wind", x: 170, y: 54, radius: 42, rotation: Math.PI / 2 }
  ], 4, 0, 60, 220);

  assert.ok(magnet.stones[0].y < 218);
  assert.ok(wind.stones[0].y > 222);
});

test("swamp drag stops a stone sooner than the base board", () => {
  const game = loadAlkkagi();
  const base = simulateOn(game, "base", [], 5, 0, 60, 220);
  const swamp = simulateOn(game, "swamp", [
    { type: "swamp", x: 115, y: 220, radius: 40, rotation: 0 }
  ], 5, 0, 60, 220);

  assert.ok(swamp.stones[0].x < base.stones[0].x - 25);
  assert.ok(swamp.stones[0].x > 95);
});

test("black holes remove stones and obstacles bounce them back", () => {
  const game = loadAlkkagi();
  const blackhole = simulateOn(game, "blackhole", [
    { type: "blackhole", x: 120, y: 220, radius: 24, rotation: 0 }
  ], 5, 0, 60, 220);
  const obstacle = simulateOn(game, "obstacle", [
    { type: "obstacle", variant: 0, x: 125, y: 220, radius: 25, rotation: 0 }
  ], 5, 0, 60, 220);

  assert.equal(blackhole.stones[0].alive, false);
  assert.equal(obstacle.stones[0].alive, true);
  assert.ok(obstacle.stones[0].x < 100);
});

test("paired portals teleport stones while preserving their motion", () => {
  const game = loadAlkkagi();
  const result = simulateOn(game, "portal", [
    { type: "portal", variant: 0, pair: 0, x: 115, y: 220, radius: 28, rotation: 0 },
    { type: "portal", variant: 1, pair: 0, x: 245, y: 220, radius: 28, rotation: 0 }
  ], 3.2, 0, 60, 220);

  assert.equal(result.stones[0].alive, true);
  assert.ok(result.stones[0].x > 260);
});

test("mines detonate once and persist as inactive map state", () => {
  const game = loadAlkkagi();
  const result = simulateOn(game, "minefield", [
    { type: "minefield", x: 115, y: 220, radius: 22, rotation: 0, active: true }
  ], 4, 0, 60, 220);

  assert.equal(result.mapObjects[0].active, false);
  assert.ok(result.stones[0].x > 150 || result.stones[0].alive === false);
});

test("wind direction advances to a different compass step each turn", () => {
  const game = loadAlkkagi();
  game.setMapState("wind", [{ type: "wind", x: 170, y: 54, radius: 42, rotation: 0 }]);
  const next = game.advanceMapTurn("turn-2");

  assert.equal(next.length, 1);
  assert.notEqual(next[0].rotation, 0);
  assert.equal(next[0].rotation % (Math.PI / 4), 0);
});

test("wind direction image is anchored at the exact board center", () => {
  const game = loadAlkkagi();
  game.setMap("wind", "center-check");
  const indicator = game.getMapObjects()[0];

  assert.equal(indicator.x, 170);
  assert.equal(indicator.y, 220);
});
