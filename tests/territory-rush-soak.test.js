"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "territory-rush.js"), "utf8");

function seededRandom(seed) {
  let value = seed >>> 0;
  return function random() {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function loadEngine(seed) {
  const deterministicMath = Object.create(Math);
  deterministicMath.random = seededRandom(seed);
  const windowObject = { __TERRITORY_RUSH_TEST__: true };
  const context = vm.createContext({
    window: windowObject,
    console,
    Date,
    Math: deterministicMath,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(source, context, { filename: "territory-rush.js" });
  return windowObject.TerritoryRush._test;
}

function assertFiniteNumber(value, label) {
  assert.equal(Number.isFinite(value), true, `${label} must stay finite`);
}

function assertPlayerInvariants(engine, state, match, tick) {
  const prefix = `match ${match}, tick ${tick}`;
  assert.equal(state.players.length, engine.constants.maxPlayers, `${prefix}: player count`);

  const ids = state.players.map((player) => player.id);
  const nicks = state.players.map((player) => player.nick);
  assert.equal(new Set(ids).size, state.players.length, `${prefix}: duplicate player id`);
  assert.equal(new Set(nicks).size, state.players.length, `${prefix}: duplicate nickname`);

  for (const player of state.players) {
    assert.equal(Number.isInteger(player.id), true, `${prefix}: integer player id`);
    assert.ok(player.id >= 0 && player.id < engine.constants.maxPlayers, `${prefix}: player id range`);
    for (const field of ["x", "y", "spawnX", "spawnY", "angle", "targetAngle", "deadUntil", "kills"]) {
      assertFiniteNumber(player[field], `${prefix}: ${player.nick}.${field}`);
    }
    assert.ok(player.x >= engine.constants.arenaInset - 1e-9, `${prefix}: x below arena`);
    assert.ok(player.x <= engine.constants.width - engine.constants.arenaInset + 1e-9, `${prefix}: x above arena`);
    assert.ok(player.y >= engine.constants.arenaInset - 1e-9, `${prefix}: y below arena`);
    assert.ok(player.y <= engine.constants.height - engine.constants.arenaInset + 1e-9, `${prefix}: y above arena`);
    assert.ok(player.angle >= -Math.PI - 1e-9 && player.angle <= Math.PI + 1e-9, `${prefix}: angle range`);
    assert.ok(player.targetAngle >= -Math.PI - 1e-9 && player.targetAngle <= Math.PI + 1e-9, `${prefix}: target angle range`);
    assert.ok(player.trail.length <= engine.constants.maxTrail, `${prefix}: trail budget`);
    for (const key of player.trail) {
      assert.equal(Number.isInteger(key), true, `${prefix}: integer trail cell`);
      assert.ok(key >= 0 && key < engine.constants.cells, `${prefix}: trail cell range`);
    }
    assert.ok(player.lastCell === -1 || (Number.isInteger(player.lastCell)
      && player.lastCell >= 0 && player.lastCell < engine.constants.cells), `${prefix}: last cell range`);
  }
}

function assertGridInvariants(engine, state, match, tick) {
  const prefix = `match ${match}, tick ${tick}`;
  const validIds = new Set(state.players.map((player) => player.id));
  const owner = engine.getOwner();
  const trailOwner = engine.getTrailOwner();
  assert.equal(owner.length, engine.constants.cells, `${prefix}: owner size`);
  assert.equal(trailOwner.length, engine.constants.cells, `${prefix}: trail owner size`);

  for (let index = 0; index < engine.constants.cells; index++) {
    const ownerId = owner[index];
    const trailId = trailOwner[index];
    assert.ok(ownerId === -1 || validIds.has(ownerId), `${prefix}: invalid owner id at ${index}`);
    assert.ok(trailId === -1 || validIds.has(trailId), `${prefix}: invalid trail owner id at ${index}`);
  }

  for (const player of state.players) {
    const points = engine.collisionTrailPoints(player);
    for (const point of points) {
      assertFiniteNumber(point.x, `${prefix}: collision trail x`);
      assertFiniteNumber(point.y, `${prefix}: collision trail y`);
      assert.ok(point.x >= 0 && point.x <= engine.constants.width, `${prefix}: collision trail x range`);
      assert.ok(point.y >= 0 && point.y <= engine.constants.height, `${prefix}: collision trail y range`);
    }
  }
}

function assertSnapshotInvariants(engine, state, budget, match, tick) {
  const prefix = `match ${match}, tick ${tick}`;
  const frame = engine.snapshot(false);
  const full = engine.snapshot(true);
  const frameBytes = Buffer.byteLength(JSON.stringify(frame));
  const fullBytes = Buffer.byteLength(JSON.stringify(full));
  budget.maxFrame = Math.max(budget.maxFrame, frameBytes);
  budget.maxFull = Math.max(budget.maxFull, fullBytes);
  assert.ok(frameBytes < budget.limit, `${prefix}: frame snapshot ${frameBytes} bytes`);
  assert.ok(fullBytes < budget.limit, `${prefix}: full snapshot ${fullBytes} bytes`);
  assert.equal(frame.players.length, engine.constants.maxPlayers, `${prefix}: compact player count`);
  assert.ok(frame.players.every((player) => player.path.length <= engine.constants.maxVisualTrailPoints * 2),
    `${prefix}: compact path budget`);

  const decodedOwner = engine.decodeOwner(full.owner, engine.constants.cells);
  assert.ok(decodedOwner, `${prefix}: owner snapshot decodes`);
  assert.deepEqual(Array.from(decodedOwner), Array.from(engine.getOwner()), `${prefix}: owner snapshot round trip`);

  for (const player of frame.players) {
    for (const field of ["x", "y", "angle", "targetAngle", "deadUntil", "inputAck", "kills"]) {
      assertFiniteNumber(player[field], `${prefix}: snapshot ${player.nick}.${field}`);
    }
    assert.equal(player.path.length % 2, 0, `${prefix}: encoded path pairs`);
    for (const coordinate of player.path) assertFiniteNumber(coordinate, `${prefix}: encoded path coordinate`);
  }

  assert.equal(state.players.length, frame.players.length, `${prefix}: snapshot did not mutate state`);
}

test("eight-player deterministic multi-match soak preserves world and snapshot invariants", { timeout: 15000 }, () => {
  const engine = loadEngine(0x5eed1234);
  const matches = 2;
  const ticksPerMatch = Math.min(300, Math.floor(engine.constants.matchMs / engine.constants.stepMs));
  const dt = engine.constants.stepMs / 1000;
  const budget = { limit: 100000, maxFrame: 0, maxFull: 0 };
  let now = 100000;

  for (let match = 1; match <= matches; match++) {
    const state = engine.freshState();
    state.phase = "playing";
    state.matchId = `soak-${match}`;
    state.startAt = now;
    state.deadline = now + engine.constants.matchMs;
    state.players = Array.from({ length: engine.constants.maxPlayers }, (_unused, id) =>
      engine.makePlayer(id, `bot-${id}`, true, engine.constants.maxPlayers));
    engine.setState(state);
    engine.resetGrid();
    for (const player of state.players) engine.createBase(player);
    state.ownerRev++;

    assertPlayerInvariants(engine, state, match, 0);
    assertGridInvariants(engine, state, match, 0);
    assertSnapshotInvariants(engine, state, budget, match, 0);

    for (let tick = 1; tick <= ticksPerMatch; tick++) {
      now += engine.constants.stepMs;
      engine.advancePlayers(state.players, dt, now);
      if (tick % 20 === 0 || tick === ticksPerMatch) {
        assertPlayerInvariants(engine, state, match, tick);
        assertGridInvariants(engine, state, match, tick);
      }
      if (tick % 200 === 0 || tick === ticksPerMatch) {
        state.frameSeq++;
        assertSnapshotInvariants(engine, state, budget, match, tick);
      }
    }
  }

  assert.ok(budget.maxFrame > 0 && budget.maxFull > 0);
  assert.ok(budget.maxFrame < budget.limit);
  assert.ok(budget.maxFull < budget.limit);
});
