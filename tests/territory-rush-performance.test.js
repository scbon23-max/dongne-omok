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

function referenceTrailWithoutHead(points, excludedLength) {
  let remaining = Math.max(0, Number(excludedLength) || 0);
  for (let index = points.length - 1; index > 0; index--) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= remaining + 1e-9) {
      remaining -= length;
      continue;
    }
    const keptRatio = (length - remaining) / length;
    return [
      ...points.slice(0, index),
      { x: start.x + dx * keptRatio, y: start.y + dy * keptRatio }
    ];
  }
  return [];
}

function referenceMovementHitsTrail(engine, movement, points, headGrace, radius) {
  const trimmed = referenceTrailWithoutHead(points, headGrace);
  if (trimmed.length < 2) return false;
  const start = { x: movement.fromX, y: movement.fromY };
  const end = { x: movement.toX, y: movement.toY };
  const radiusSquared = radius * radius;
  for (let index = 1; index < trimmed.length; index++) {
    if (engine.segmentDistanceSquared(start, end, trimmed[index - 1], trimmed[index]) <= radiusSquared) {
      return true;
    }
  }
  return false;
}

test("collision head trimming keeps a zero-copy view and matches the previous geometry", () => {
  const engine = loadEngine();
  const points = [
    { x: 2, y: 2 },
    { x: 8, y: 2 },
    { x: 8, y: 8 },
    { x: 14, y: 8 }
  ];
  points.slice = () => {
    throw new Error("the production collision path must not copy the trail");
  };

  const view = engine.trailWithoutHead(points, 1.25);
  assert.equal(view.points, points);
  assert.equal(view.lastPointIndex, 2);
  assert.deepEqual(
    { x: view.endPoint.x, y: view.endPoint.y },
    { x: 12.75, y: 8 }
  );

  const radius = engine.constants.trailCollisionRadius;
  const movements = [
    { fromX: 4, fromY: 1.7, toX: 4.5, toY: 1.7 },
    { fromX: 8.31, fromY: 4, toX: 8.31, toY: 4.5 },
    { fromX: 11, fromY: 8.31, toX: 11.5, toY: 8.31 },
    { fromX: 14, fromY: 8, toX: 14.4, toY: 8 },
    { fromX: 14, fromY: 8, toX: 13.6, toY: 8 }
  ];
  for (const headGrace of [0, 0.25, engine.constants.trailHeadGrace, 3, 30]) {
    for (const movement of movements) {
      const expected = referenceMovementHitsTrail(
        engine,
        movement,
        Array.from(points),
        headGrace,
        radius
      );
      assert.equal(
        engine.movementHitsTrail(
          movement.fromX,
          movement.fromY,
          movement.toX,
          movement.toY,
          points,
          headGrace,
          radius
        ),
        expected,
        `head grace ${headGrace} at ${JSON.stringify(movement)}`
      );
    }
  }
});

test("eight long straight collision trails retain only their exact segment endpoints", () => {
  const engine = loadEngine();
  let totalPoints = 0;

  for (let playerId = 0; playerId < engine.constants.maxPlayers; playerId++) {
    const points = [];
    const y = 8 + playerId * 4;
    for (let sample = 0; sample <= 800; sample++) {
      engine.appendCollisionTrailPoint(points, 4 + sample * 0.05, y);
    }
    assert.equal(points.length, 2, `player ${playerId} straight prefix`);

    for (let sample = 1; sample <= 100; sample++) {
      engine.appendCollisionTrailPoint(points, 44, y + sample * 0.05);
    }
    assert.equal(points.length, 3, `player ${playerId} keeps one deliberate corner`);
    totalPoints += points.length;

    const radius = engine.constants.trailCollisionRadius;
    assert.equal(engine.movementHitsTrail(20, y + 0.31, 20.4, y + 0.31, points, 0, radius), true);
    assert.equal(engine.movementHitsTrail(20, y + 0.33, 20.4, y + 0.33, points, 0, radius), false);
    assert.equal(engine.movementHitsTrail(44.31, y + 2, 44.31, y + 2.4, points, 0, radius), true);
  }

  assert.equal(totalPoints, engine.constants.maxPlayers * 3);
});

test("collision bounds reject a far long trail before any segment distance checks", () => {
  const engine = loadEngine();
  const points = Array.from({ length: 800 }, (_unused, index) => ({
    x: 4 + index % 2,
    y: 5 + index % 11
  }));
  const bounds = engine.trailCollisionBounds(points);
  const stats = {};

  assert.equal(
    engine.movementHitsTrail(
      60,
      90,
      61,
      90,
      points,
      0,
      engine.constants.trailCollisionRadius,
      bounds,
      stats
    ),
    false
  );
  assert.equal(stats.trailBoundsRejected, 1);
  assert.equal(stats.segmentCandidates || 0, 0);
  assert.equal(stats.segmentChecks || 0, 0);
});

test("a no-cross movement proposal does not clone the player's long trail", () => {
  const engine = loadEngine();
  const rawTrail = Array.from({ length: engine.constants.maxTrail }, (_unused, index) => index);
  const trail = new Proxy(rawTrail, {
    get(target, property, receiver) {
      if (property === "slice") throw new Error("no-cross proposal cloned its trail");
      return Reflect.get(target, property, receiver);
    }
  });
  const player = { id: 0, lastCell: 10, trail };
  const proposal = { player, crossedEvents: [] };
  const ownerAtStart = new Int8Array(engine.constants.cells);
  ownerAtStart.fill(-1);

  assert.doesNotThrow(() => engine.analyzeProposalTerritory(proposal, ownerAtStart));
  assert.equal(proposal.closeIndex, -1);
  assert.equal(proposal.captureTrail, null);
  assert.equal(proposal.limitIndex, -1);
});

test("an all-no-cross simulation tick does not clone the owner grid", () => {
  const engine = loadEngine();
  const width = engine.constants.width;
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "no-cross-owner-copy";
  const player = engine.makePlayer(0, "no-cross", false, 1);
  player.x = 10.1;
  player.y = 20.5;
  player.angle = 0;
  player.targetAngle = 0;
  player.lastCell = 20 * width + 10;
  player.trail = [];
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();
  Object.defineProperty(engine.getOwner(), "slice", {
    configurable: true,
    value() {
      throw new Error("an all-no-cross tick cloned the owner grid");
    }
  });

  assert.doesNotThrow(() => {
    engine.advancePlayers(state.players, engine.constants.stepMs / 1000, 1000);
  });
  assert.ok(player.x > 10.1 && player.x < 11);
});

test("the multiplayer collision resolver shares cached point arrays and supplies broad-phase bounds", () => {
  const resolveSource = source.match(
    /function resolveAdvanceCollisions\(proposals, now\) \{([\s\S]*?)\n  \}\n\n  function territoryLossAttackers/
  )[1];
  const trimSource = source.match(
    /function trailWithoutHead\(points, excludedLength\) \{([\s\S]*?)\n  \}\n\n  function movementHitsTrail/
  )[1];
  const prepareSource = source.match(
    /function preparePlayerAdvance\(player, dt, now\) \{([\s\S]*?)\n  \}\n\n  function analyzeProposalTerritory/
  )[1];

  assert.doesNotMatch(resolveSource, /collisionTrailPoints\(player\)\.slice\(\)/);
  assert.match(resolveSource, /points: points, bounds: trailCollisionBounds\(points\)/);
  assert.match(resolveSource, /proposalHitsTrailBefore\([^)]*ownRow\.bounds/);
  assert.match(resolveSource, /proposalHitsTrailBefore\([^)]*row\.bounds/);
  assert.doesNotMatch(trimSource, /\.slice\(/);
  assert.doesNotMatch(prepareSource, /\bcrossed\s*:/);
});

test("respawn search collects safe candidates before sampling randomness once", () => {
  const engine = loadEngine();
  const state = engine.freshState();
  const player = engine.makePlayer(0, "respawn-search", false, 1);
  state.phase = "playing";
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();

  let randomCalls = 0;
  const spot = engine.findRespawnSpot(player, () => {
    randomCalls++;
    return 0.5;
  });

  assert.ok(spot);
  assert.equal(randomCalls, 1);
});
