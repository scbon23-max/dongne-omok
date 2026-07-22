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

function rectangleTrail(width, x0, y0, x1, y1, omittedKey) {
  const trail = [];
  for (let x = x0; x <= x1; x++) {
    for (const y of [y0, y1]) {
      const key = y * width + x;
      if (key !== omittedKey) trail.push(key);
    }
  }
  for (let y = y0 + 1; y < y1; y++) {
    for (const x of [x0, x1]) {
      const key = y * width + x;
      if (key !== omittedKey) trail.push(key);
    }
  }
  return trail;
}

function territoryCount(engine, id) {
  return Array.from(engine.getOwner()).filter((owner) => owner === id).length;
}

test("entering owned territory first closes the trail before a later self-contact in the same tick", () => {
  const engine = loadEngine();
  const width = engine.constants.width;
  const player = engine.makePlayer(0, "paper-return", false, 1);
  player.x = 9.99;
  player.y = 9.98;
  player.angle = Math.PI / 4;
  player.targetAngle = Math.PI / 4;
  player.lastCell = 9 * width + 9;
  player.trail = [10 * width + 10, 10 * width + 11, 9 * width + 9];
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "paper-return-first";
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();
  engine.getOwner()[9 * width + 10] = player.id;

  const collision = engine.syncCollisionTrail(player);
  collision.points = [
    { x: 10.30, y: 10.29 }, { x: 10.50, y: 10.29 },
    { x: 20, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9.98 }, { x: 9.99, y: 9.98 }
  ];
  const distance = engine.constants.speed * engine.constants.stepMs / 1000;
  const toX = player.x + Math.cos(player.angle) * distance;
  const toY = player.y + Math.sin(player.angle) * distance;
  assert.equal(engine.movementHitsTrail(player.x, player.y, toX, toY, collision.points, engine.constants.trailHeadGrace), true);

  engine.advancePlayer(player, engine.constants.stepMs / 1000, 1000);

  assert.equal(player.deadUntil, 0);
  assert.equal(player.trail.length, 0);
  assert.ok(territoryCount(engine, player.id) > 0);
});

test("self-contact strictly before the owned-territory boundary still eliminates the player", () => {
  const engine = loadEngine();
  const width = engine.constants.width;
  const player = engine.makePlayer(0, "paper-hit-first", false, 1);
  player.x = 9.7;
  player.y = 10;
  player.angle = 0;
  player.targetAngle = 0;
  player.lastCell = 10 * width + 9;
  player.trail = [9 * width + 9, 11 * width + 9];
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "paper-hit-first";
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();
  engine.getOwner()[10 * width + 10] = player.id;
  const collision = engine.syncCollisionTrail(player);
  collision.points = [
    { x: 9.8, y: 9.6 }, { x: 9.8, y: 10.4 },
    { x: 5, y: 15 }, { x: 5, y: 10 }, { x: 9.7, y: 10 }
  ];

  engine.advancePlayer(player, engine.constants.stepMs / 1000, 1000);

  assert.ok(player.deadUntil > 1000);
  assert.equal(player.deathReason, "self");
});

function runSimultaneousCapture(reverse) {
  const engine = loadEngine();
  const width = engine.constants.width;
  const aHome = 10 * width + 17;
  const bHome = 12 * width + 5;
  const a = engine.makePlayer(0, "capture-a", false, 2);
  const b = engine.makePlayer(1, "capture-b", false, 2);
  a.x = 18.2;
  a.y = 10.5;
  a.angle = Math.PI;
  a.targetAngle = Math.PI;
  a.lastCell = 10 * width + 18;
  a.trail = rectangleTrail(width, 7, 7, 17, 17, aHome);
  b.x = 4.8;
  b.y = 12.5;
  b.angle = 0;
  b.targetAngle = 0;
  b.lastCell = 12 * width + 4;
  b.trail = rectangleTrail(width, 5, 5, 20, 20, bHome);
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = reverse ? "capture-reversed" : "capture-forward";
  state.players = reverse ? [b, a] : [a, b];
  engine.setState(state);
  engine.resetGrid();
  engine.getOwner()[aHome] = a.id;
  engine.getOwner()[bHome] = b.id;
  engine.syncCollisionTrail(a).points = [{ x: 18.3, y: 10.5 }, { x: 18.2, y: 10.5 }];
  engine.syncCollisionTrail(b).points = [{ x: 4.7, y: 12.5 }, { x: 4.8, y: 12.5 }];

  engine.advancePlayers(state.players, engine.constants.stepMs / 1000, 1000);

  return {
    aDead: a.deadUntil > 1000,
    bDead: b.deadUntil > 1000,
    aReason: a.deathReason,
    bReason: b.deathReason,
    aKills: a.kills,
    bKills: b.kills,
    aLand: territoryCount(engine, a.id),
    bLand: territoryCount(engine, b.id)
  };
}

test("simultaneous captures merge independently of the player array order", () => {
  const forward = runSimultaneousCapture(false);
  const reversed = runSimultaneousCapture(true);

  assert.deepEqual(reversed, forward);
  assert.equal(forward.aDead, true);
  assert.equal(forward.bDead, false);
  assert.equal(forward.aReason, "territory");
  assert.equal(forward.bKills, 1);
});

for (const waitingReason of ["limit", "waiting"]) {
  test(`${waitingReason} recall keeps its timer but credits the player who takes its last territory`, () => {
    const engine = loadEngine();
    const width = engine.constants.width;
    const attackerHome = 10 * width + 17;
    const victimHome = 12 * width + 10;
    const attacker = engine.makePlayer(0, `attacker-${waitingReason}`, false, 2);
    const victim = engine.makePlayer(1, `victim-${waitingReason}`, false, 2);
    attacker.x = 18.2;
    attacker.y = 10.5;
    attacker.angle = Math.PI;
    attacker.targetAngle = Math.PI;
    attacker.lastCell = 10 * width + 18;
    attacker.trail = rectangleTrail(width, 7, 7, 17, 17, attackerHome);
    victim.deadUntil = 5000;
    victim.deathReason = waitingReason;
    victim.deathSeq = 7;
    victim.respawnGiveUpAt = 8500;
    const state = engine.freshState();
    state.phase = "playing";
    state.matchId = `waiting-loss-${waitingReason}`;
    state.players = [attacker, victim];
    engine.setState(state);
    engine.resetGrid();
    engine.getOwner()[attackerHome] = attacker.id;
    engine.getOwner()[victimHome] = victim.id;
    engine.syncCollisionTrail(attacker).points = [{ x: 18.3, y: 10.5 }, { x: 18.2, y: 10.5 }];

    engine.advancePlayers(state.players, engine.constants.stepMs / 1000, 1000);

    assert.equal(territoryCount(engine, victim.id), 0);
    assert.equal(victim.deadUntil, 5000);
    assert.equal(victim.respawnGiveUpAt, 8500);
    assert.equal(victim.deathSeq, 7);
    assert.equal(victim.deathReason, "territory");
    assert.equal(victim.deathBy, attacker.nick);
    assert.equal(attacker.kills, 1);
  });
}
