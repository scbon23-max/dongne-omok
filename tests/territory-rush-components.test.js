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

function paintRect(map, width, id, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) map[key(width, x, y)] = id;
  }
}

function rectangleTrail(width, x0, y0, x1, y1, omittedKey) {
  const trail = [];
  for (let x = x0; x <= x1; x++) {
    for (const y of [y0, y1]) {
      const cell = key(width, x, y);
      if (cell !== omittedKey) trail.push(cell);
    }
  }
  for (let y = y0 + 1; y < y1; y++) {
    for (const x of [x0, x1]) {
      const cell = key(width, x, y);
      if (cell !== omittedKey) trail.push(cell);
    }
  }
  return trail;
}

function ownedCells(map, id) {
  return Array.from(map).reduce((total, owner) => total + (owner === id ? 1 : 0), 0);
}

test("disconnected territory keeps only the component containing the player", () => {
  const engine = loadEngine();
  const width = engine.constants.width;
  const player = engine.makePlayer(0, "anchor", false, 1);
  player.x = 6.5;
  player.y = 6.5;
  const state = engine.freshState();
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();
  const owner = engine.getOwner();
  paintRect(owner, width, player.id, 5, 5, 7, 7);
  paintRect(owner, width, player.id, 20, 20, 25, 25);

  const removed = engine.pruneDisconnectedTerritories(owner);

  assert.equal(removed, 36);
  assert.equal(ownedCells(owner, player.id), 9);
  assert.equal(owner[key(width, 6, 6)], player.id);
  assert.equal(owner[key(width, 22, 22)], -1);
});

test("a player outside their land keeps the nearest component with deterministic ties", () => {
  const engine = loadEngine();
  const width = engine.constants.width;
  const player = engine.makePlayer(0, "outside", false, 1);
  player.x = 10.5;
  player.y = 10.5;
  const state = engine.freshState();
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();
  const owner = engine.getOwner();
  owner[key(width, 8, 10)] = player.id;
  owner[key(width, 12, 10)] = player.id;
  owner[key(width, 13, 10)] = player.id;

  engine.pruneDisconnectedTerritories(owner);

  assert.equal(owner[key(width, 8, 10)], -1);
  assert.equal(owner[key(width, 12, 10)], player.id);
  assert.equal(owner[key(width, 13, 10)], player.id);
});

function runBridgeCut(reversePlayers) {
  const engine = loadEngine();
  const width = engine.constants.width;
  const attacker = engine.makePlayer(0, "cutter", false, 2);
  const victim = engine.makePlayer(1, "split", false, 2);
  const home = key(width, 14, 15);
  attacker.x = 13.8;
  attacker.y = 15.5;
  attacker.angle = 0;
  attacker.targetAngle = 0;
  attacker.lastCell = key(width, 13, 15);
  attacker.trail = rectangleTrail(width, 14, 5, 16, 25, home);
  victim.x = 11.5;
  victim.y = 15.5;
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = reversePlayers ? "split-reverse" : "split-forward";
  state.players = reversePlayers ? [victim, attacker] : [attacker, victim];
  engine.setState(state);
  engine.resetGrid();
  const owner = engine.getOwner();
  paintRect(owner, width, victim.id, 9, 9, 21, 21);
  owner[home] = attacker.id;
  engine.syncCollisionTrail(attacker).points = [
    { x: 13.7, y: 15.5 },
    { x: 13.8, y: 15.5 }
  ];

  engine.advancePlayers([attacker], engine.constants.stepMs / 1000, 1000);

  return {
    owner: Array.from(owner),
    victimDead: victim.deadUntil > 0,
    victimCells: ownedCells(owner, victim.id),
    left: owner[key(width, 11, 15)],
    cut: owner[key(width, 15, 15)],
    right: owner[key(width, 19, 15)]
  };
}

test("cutting through the middle removes the island without the player", () => {
  const forward = runBridgeCut(false);
  const reversed = runBridgeCut(true);

  assert.deepEqual(reversed.owner, forward.owner);
  assert.equal(forward.victimDead, false);
  assert.ok(forward.victimCells > 0);
  assert.equal(forward.left, 1);
  assert.equal(forward.cut, 0);
  assert.equal(forward.right, -1);
});
