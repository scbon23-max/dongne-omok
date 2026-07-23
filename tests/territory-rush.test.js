"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "territory-rush.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const windowObject = { __TERRITORY_RUSH_TEST__: true };
const context = vm.createContext({ window: windowObject, console, Date, Math, setTimeout, clearTimeout });
vm.runInContext(source, context, { filename: "territory-rush.js" });

const controller = windowObject.TerritoryRush;
const engine = controller._test;

test("movement speed is twenty percent faster", () => {
  assert.equal(engine.constants.speed, 8.88);
  const player = engine.makePlayer(0, "speed-check", false, 2);
  player.x = 20;
  player.y = 20;
  player.angle = 0;
  player.targetAngle = 0;
  player.lastCell = 20 * engine.constants.width + 20;
  const state = engine.freshState();
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();

  engine.advancePlayer(player, engine.constants.stepMs / 1000, Date.now());

  assert.ok(Math.abs(player.x - (20 + 8.88 * engine.constants.stepMs / 1000)) < 1e-9);
});

function fakeApi(nicks) {
  const sent = [];
  const people = nicks.map((nick, index) => ({ nick, joinTs: index + 1 }));
  const fixture = {
    sent,
    people,
    toasts: [],
    eligible: [],
    hostMode: true,
    connected: true,
    hostNick: nicks[0]
  };
  fixture.meNick = nicks[0];
  fixture.leaveCount = 0;
  fixture.api = {
      me() { return { nick: fixture.meNick, isAdmin: fixture.meNick === "구나" }; },
      roster() { return fixture.people.slice(); },
      isHost() { return fixture.hostMode; },
      host() { return fixture.hostNick; },
      isConnected() { return fixture.connected; },
      send(message) { sent.push(message); },
      setHostEligible(value) { fixture.eligible.push(value); },
      roomChanged() {},
      toast(message) { fixture.toasts.push(message); },
      leaveRoom() { fixture.leaveCount++; },
      playWarning() {}
  };
  return fixture;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

test("chat is open in the waiting and result screens but limited to spectators during play", () => {
  const fake = fakeApi(["host", "player", "spectator"]);
  engine.setApi(fake.api);
  const state = engine.freshState();
  engine.setState(state);

  assert.equal(controller.canChat("host"), true);
  assert.equal(controller.canChat("player"), true);

  state.phase = "playing";
  state.players = [
    engine.makePlayer(0, "host", false, 2),
    engine.makePlayer(1, "player", false, 2)
  ];
  state.spectators = ["spectator"];
  assert.equal(controller.canChat("host"), false);
  assert.equal(controller.canChat("player"), false);
  assert.equal(controller.canChat("spectator"), true);

  state.phase = "finished";
  assert.equal(controller.canChat("host"), true);
  assert.equal(controller.canChat("player"), true);
  assert.equal(controller.canChat("spectator"), true);
});

test("movement hotkeys do not consume chat input keystrokes", () => {
  const bindSource = source.match(/function bindDom\(\) \{([\s\S]*?)\n  \}\n\n  function startLoops/)[1];
  assert.match(bindSource, /function isEditableTarget\(target\)[\s\S]*tag === "INPUT"[\s\S]*target\.isContentEditable/);
  assert.match(bindSource, /state\.phase !== "playing" \|\| !keyVectors\[event\.code\] \|\| isEditableTarget\(event\.target\)/);
  assert.match(bindSource, /delete pressedKeys\[event\.code\];\s*if \(isEditableTarget\(event\.target\)\) return;/);
});

test("owner grid uses a compact lossless run-length encoding", () => {
  const grid = new Int8Array(engine.constants.cells);
  grid.fill(-1);
  grid.fill(0, 20, 90);
  grid.fill(3, 500, 790);
  grid.fill(1, 4300, 4325);

  const packed = engine.encodeOwner(grid);
  const decoded = engine.decodeOwner(packed, grid.length);

  assert.ok(decoded);
  assert.deepEqual(Array.from(decoded), Array.from(grid));
  assert.ok(packed.length < grid.length / 10);
  assert.equal(engine.decodeOwner("not-valid", grid.length), null);
});

test("closed territory is filled while the outside remains untouched", () => {
  const width = engine.constants.width;
  const grid = new Int8Array(engine.constants.cells);
  grid.fill(-1);
  const index = (x, y) => y * width + x;
  for (let x = 10; x <= 14; x++) {
    grid[index(x, 10)] = 0;
    grid[index(x, 14)] = 0;
  }
  for (let y = 10; y <= 14; y++) {
    grid[index(10, y)] = 0;
    grid[index(14, y)] = 0;
  }

  const gained = engine.captureInto(grid, [], 0);

  assert.equal(gained, 9);
  assert.equal(grid[index(12, 12)], 0);
  assert.equal(grid[index(8, 8)], -1);
});

test("capturing enemy land queues a small bounded local particle effect", () => {
  const previous = new Int8Array(24);
  previous.fill(-1);
  previous[4] = 1;
  previous[5] = 1;
  const next = previous.slice();
  next[4] = 0;
  next[5] = 0;
  next[6] = 0;

  const stolen = engine.sampleStolenCells(previous, next, engine.constants.maxCaptureBursts, seededRandom(7));
  assert.deepEqual(Array.from(stolen, (cell) => cell.key).sort((a, b) => a - b), [4, 5]);

  engine.clearCaptureParticles();
  const created = engine.queueCaptureParticles(previous, next, 1000, seededRandom(11));
  assert.equal(created, 2 * engine.constants.captureParticlesPerBurst);
  assert.equal(engine.getCaptureParticles().length, created);
  assert.ok(engine.getCaptureParticles().every((particle) => /^#[0-9a-f]{6}$/i.test(particle.color)));

  for (let index = 0; index < 20; index++) {
    engine.queueCaptureParticles(previous, next, 1100 + index, seededRandom(index + 20));
  }
  assert.equal(engine.getCaptureParticles().length, engine.constants.maxCaptureParticles);

  const neutralBefore = new Int8Array(24);
  neutralBefore.fill(-1);
  const neutralAfter = neutralBefore.slice();
  neutralAfter[8] = 0;
  engine.clearCaptureParticles();
  assert.equal(engine.queueCaptureParticles(neutralBefore, neutralAfter, 2000, seededRandom(3)), 0);
  assert.equal(engine.getCaptureParticles().length, 0);

  const captureSource = source.match(/function capturePlayer\(player, now\) \{([\s\S]*?)\n  \}\n\n  function eliminate/)[1];
  const applyFullSource = source.match(/function applyFull\(raw, sourceHost\) \{([\s\S]*?)\n  \}\n\n  function applyFrame/)[1];
  const paintSource = source.match(/function paint\(\) \{([\s\S]*?)\n  \}\n\n  function paintMinimap/)[1];
  assert.match(captureSource, /previousOwner = owner\.slice\(\)[\s\S]*queueCaptureParticles\(previousOwner, owner/);
  assert.match(applyFullSource, /queueCaptureParticles\(owner, parsed\.owner[\s\S]*owner\.set\(parsed\.owner\)/);
  assert.match(paintSource, /drawCaptureParticles\(view, now\)/);
});

test("direction input rejects a direct reversal", () => {
  const player = engine.makePlayer(0, "방향테스트", false, 2);
  player.dir = "right";

  assert.equal(engine.reverseDirection("right", "left"), true);
  assert.equal(engine.applyDirection(player, "left", 1), false);
  assert.equal(player.dir, "right");
  assert.equal(engine.applyDirection(player, "up", 2), true);
  assert.equal(player.dir, "up");
  player.away = true;
  assert.equal(engine.applyDirection(player, "right", 3), false);
});

test("analog input turns and moves naturally at an arbitrary angle", () => {
  const player = engine.makePlayer(0, "analog-player", false, 2);
  const startX = player.x;
  const startY = player.y;
  const startAngle = player.angle;
  const target = Math.PI / 4;
  engine.resetGrid();

  assert.equal(engine.applyDirection(player, target, 1), true);
  assert.ok(Math.abs(engine.angleDelta(player.targetAngle, target)) < 0.001);

  engine.advancePlayer(player, engine.constants.stepMs / 1000, Date.now());

  assert.ok(player.x > startX);
  assert.ok(player.y > startY);
  assert.ok(Math.abs(engine.angleDelta(player.angle, target)) < Math.abs(engine.angleDelta(startAngle, target)));
});

test("the arena edge contains players instead of eliminating them", () => {
  const inset = engine.constants.arenaInset;
  const cases = [
    { x: inset + 0.02, y: 45, angle: Math.PI },
    { x: engine.constants.width - inset - 0.02, y: 45, angle: 0 },
    { x: 30, y: inset + 0.02, angle: -Math.PI / 2 },
    { x: 30, y: engine.constants.height - inset - 0.02, angle: Math.PI / 2 }
  ];

  for (const edge of cases) {
    const player = engine.makePlayer(0, "edge-player", false, 2);
    player.x = edge.x;
    player.y = edge.y;
    player.angle = edge.angle;
    player.targetAngle = edge.angle;
    player.lastCell = Math.floor(edge.y) * engine.constants.width + Math.floor(edge.x);
    const state = engine.freshState();
    state.players = [player];
    engine.setState(state);
    engine.resetGrid();

    engine.advancePlayer(player, engine.constants.stepMs / 1000, Date.now());

    assert.equal(player.deadUntil, 0);
    assert.ok(player.x >= inset && player.x <= engine.constants.width - inset);
    assert.ok(player.y >= inset && player.y <= engine.constants.height - inset);
  }
});

test("an outward-facing player turns along the arena edge instead of parking", () => {
  const inset = engine.constants.arenaInset;
  const player = engine.makePlayer(0, "wall-slider", false, 2);
  player.x = engine.constants.width - inset - 0.01;
  player.y = 40;
  player.angle = Math.PI / 4;
  player.targetAngle = Math.PI / 4;
  player.lastCell = Math.floor(player.y) * engine.constants.width + Math.floor(player.x);
  const state = engine.freshState();
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();
  const startY = player.y;

  engine.advancePlayer(player, engine.constants.stepMs / 1000, Date.now());

  assert.equal(player.x, engine.constants.width - inset);
  assert.ok(player.y > startY);
  assert.equal(player.deadUntil, 0);

  player.angle = 0;
  player.targetAngle = 0;
  const trailLength = player.trail.length;
  const edgeY = player.y;
  for (let step = 0; step < 5; step++) engine.advancePlayer(player, engine.constants.stepMs / 1000, Date.now() + step);
  assert.ok(player.y !== edgeY);
  assert.ok(player.trail.length >= trailLength);
  assert.equal(player.deadUntil, 0);
});

test("turning along every arena edge does not collide with the attached trail", () => {
  const inset = engine.constants.arenaInset;
  const cases = [
    { x: 60, y: 54, angle: 0, turn: Math.PI / 2, edge: "x", value: engine.constants.width - inset },
    { x: 60, y: 54, angle: 0, turn: -Math.PI / 2, edge: "x", value: engine.constants.width - inset },
    { x: 12, y: 54, angle: Math.PI, turn: Math.PI / 2, edge: "x", value: inset },
    { x: 12, y: 54, angle: Math.PI, turn: -Math.PI / 2, edge: "x", value: inset },
    { x: 36, y: 12, angle: -Math.PI / 2, turn: 0, edge: "y", value: inset },
    { x: 36, y: 12, angle: -Math.PI / 2, turn: Math.PI, edge: "y", value: inset },
    { x: 36, y: 96, angle: Math.PI / 2, turn: 0, edge: "y", value: engine.constants.height - inset },
    { x: 36, y: 96, angle: Math.PI / 2, turn: Math.PI, edge: "y", value: engine.constants.height - inset }
  ];

  cases.forEach((edge, index) => {
    const player = engine.makePlayer(0, `edge-turn-${index}`, false, 1);
    player.x = edge.x;
    player.y = edge.y;
    player.spawnX = edge.x;
    player.spawnY = edge.y;
    player.angle = edge.angle;
    player.targetAngle = edge.angle;
    player.lastCell = Math.floor(player.y) * engine.constants.width + Math.floor(player.x);
    const state = engine.freshState();
    state.players = [player];
    engine.setState(state);
    engine.resetGrid();
    assert.equal(engine.createBase(player), true);

    for (let step = 0; step < 28; step++) {
      engine.advancePlayer(player, engine.constants.stepMs / 1000, 1000 + step);
      if (Math.abs(player[edge.edge] - edge.value) < 1e-9) break;
    }
    assert.ok(Math.abs(player[edge.edge] - edge.value) < 1e-9);
    assert.ok(player.trail.length > 0);
    assert.equal(player.deadUntil, 0);

    player.targetAngle = edge.turn;
    for (let step = 0; step < 4; step++) {
      engine.advancePlayer(player, engine.constants.stepMs / 1000, 2000 + step);
    }
    assert.equal(player.deadUntil, 0);
  });
});

test("diagonal movement keeps trail cells connected for territory capture", () => {
  const player = engine.makePlayer(0, "diagonal-player", false, 2);
  const width = engine.constants.width;
  player.x = 20.9;
  player.y = 20.9;
  player.angle = Math.PI / 4;
  player.targetAngle = Math.PI / 4;
  player.lastCell = 20 * width + 20;
  player.trail = [];
  engine.resetGrid();

  engine.advancePlayer(player, engine.constants.stepMs / 1000, Date.now());

  assert.equal(player.trail.length, 2);
  const cells = [20 * width + 20, ...player.trail];
  const start = { x: 20, y: 20 };
  const bridge = { x: cells[1] % width, y: Math.floor(cells[1] / width) };
  const end = { x: cells[2] % width, y: Math.floor(cells[2] / width) };
  assert.equal(Math.abs(start.x - bridge.x) + Math.abs(start.y - bridge.y), 1);
  assert.equal(Math.abs(bridge.x - end.x) + Math.abs(bridge.y - end.y), 1);
});

test("trail collision follows the visible diagonal instead of its bridge cell", () => {
  const diagonal = [{ x: 20, y: 20 }, { x: 24, y: 24 }];
  const radius = engine.constants.trailCollisionRadius;

  assert.equal(engine.movementHitsTrail(21.2, 20.2, 21.7, 20.7, diagonal, 0, radius), false);
  assert.equal(engine.movementHitsTrail(21.2, 20.95, 21.7, 21.45, diagonal, 0, radius), true);
});

test("trail collision uses the same width as the rendered path", () => {
  const trail = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
  const radius = engine.constants.trailCollisionRadius;

  assert.equal(radius, engine.constants.trailWidth / 2);
  assert.equal(engine.movementHitsTrail(0, 0.31, 4, 0.31, trail, 0, radius), true);
  assert.equal(engine.movementHitsTrail(0, 0.33, 4, 0.33, trail, 0, radius), false);
  assert.equal(engine.movementHitsTrail(2, -1, 2, 1, trail, 0, radius), true);
});

test("the attached trail head is safe but reversing into the settled trail still collides", () => {
  const trail = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
  const grace = engine.constants.trailHeadGrace;

  assert.ok(grace > engine.constants.trailCollisionRadius * Math.SQRT2);
  assert.equal(engine.movementHitsTrail(5, 0, 5.4, 0, trail, grace), false);
  assert.equal(engine.movementHitsTrail(5, 0, 4.6, 0, trail, grace), true);
});

test("capture bridge cells no longer act as whole-cell death zones", () => {
  const enterCellSource = source.match(/function enterPlayerCell\(player, key, now\) \{([\s\S]*?)\n  \}\n\n  function advancePlayer/)[1];
  const advanceSource = source.match(/function advancePlayer\(player, dt, now\) \{([\s\S]*?)\n  \}\n\n  function territoryCounts/)[1];

  assert.doesNotMatch(enterCellSource, /trailId|eliminate\(/);
  assert.doesNotMatch(enterCellSource, /else if \(trailOwner/);
  assert.match(advanceSource, /advancePlayers\(\[player\], dt, now\)/);
  assert.match(advanceSource, /resolveAdvanceCollisions\(proposals, now\)/);
});

test("network trail compression cannot create a false self-collision on a long curve", () => {
  const width = engine.constants.width;
  const curve = Array.from({ length: 200 }, (_unused, index) => ({
    x: 5 + (index % 20) * 3,
    y: 5 + Math.floor(index / 20) * 5 + (index % 2) * 1.5
  }));
  const compact = engine.decodeVisualTrail(engine.encodeVisualTrail(curve));
  const fromX = 17;
  const fromY = 36.1;
  const toY = fromY + engine.constants.speed * engine.constants.stepMs / 1000;

  assert.ok(curve.length > engine.constants.maxVisualTrailPoints);
  assert.equal(compact.length, engine.constants.maxVisualTrailPoints);
  assert.equal(engine.movementHitsTrail(fromX, fromY, fromX, toY, curve, engine.constants.trailHeadGrace), false);
  assert.equal(engine.movementHitsTrail(fromX, fromY, fromX, toY, compact, engine.constants.trailHeadGrace), true);

  const player = engine.makePlayer(0, "long-curve-collision", false, 2);
  player.x = fromX;
  player.y = fromY;
  player.angle = Math.PI / 2;
  player.targetAngle = Math.PI / 2;
  player.lastCell = Math.floor(fromY) * width + Math.floor(fromX);
  player.trail = curve.map((point) => Math.floor(point.y) * width + Math.floor(point.x));
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "long-curve-separation";
  state.players = [player];
  engine.setState(state);
  engine.resetGrid();

  const visualCache = engine.syncVisualTrail(player);
  const collisionCache = engine.syncCollisionTrail(player);
  visualCache.points = curve.map((point) => ({ ...point }));
  collisionCache.points = curve.map((point) => ({ ...point }));

  const frame = engine.snapshot(false);
  assert.equal(frame.players[0].path.length, engine.constants.maxVisualTrailPoints * 2);
  assert.equal(visualCache.points.length, curve.length);
  assert.equal(collisionCache.points.length, curve.length);

  engine.advancePlayer(player, engine.constants.stepMs / 1000, 1000);
  assert.equal(player.deadUntil, 0);
});

test("simultaneous trail cuts have the same result regardless of player array order", () => {
  function run(reverse, suffix) {
    const width = engine.constants.width;
    const a = engine.makePlayer(0, `cross-a-${suffix}`, false, 2);
    const b = engine.makePlayer(1, `cross-b-${suffix}`, false, 2);
    a.x = 20;
    a.y = 19.8;
    a.angle = Math.PI / 2;
    a.targetAngle = Math.PI / 2;
    a.lastCell = 19 * width + 20;
    a.trail = [15 * width + 20, 19 * width + 20];
    a.path = engine.encodeVisualTrail([{ x: 20, y: 15 }, { x: 20, y: 19.8 }]);
    b.x = 19.8;
    b.y = 20;
    b.angle = 0;
    b.targetAngle = 0;
    b.lastCell = 20 * width + 19;
    b.trail = [20 * width + 15, 20 * width + 19];
    b.path = engine.encodeVisualTrail([{ x: 15, y: 20 }, { x: 19.8, y: 20 }]);

    const state = engine.freshState();
    state.phase = "playing";
    state.matchId = `simultaneous-cross-${suffix}`;
    state.players = reverse ? [b, a] : [a, b];
    engine.setState(state);
    engine.resetGrid();
    engine.advancePlayers(state.players, engine.constants.stepMs / 1000, 1000);
    return {
      aDead: a.deadUntil > 1000,
      bDead: b.deadUntil > 1000,
      aKills: a.kills,
      bKills: b.kills
    };
  }

  const forward = run(false, "forward");
  const reversed = run(true, "reversed");
  assert.deepEqual(forward, { aDead: true, bDead: true, aKills: 1, bKills: 1 });
  assert.deepEqual(reversed, forward);
});

test("continuous visual trails stay straight without rewriting their settled prefix", () => {
  const points = [];
  for (let step = 0; step <= 40; step++) {
    const x = step * 0.25;
    engine.appendVisualTrailPoint(points, x, x * 0.5);
  }

  assert.equal(points.length, 2);
  assert.equal(points[0].x, 0);
  assert.equal(points[0].y, 0);
  assert.equal(points[1].x, 10);
  assert.equal(points[1].y, 5);
});

test("continuous visual trails preserve even a short deliberate corner", () => {
  const points = [];
  for (let step = 0; step <= 4; step++) engine.appendVisualTrailPoint(points, step * 0.25, 0);
  for (let step = 1; step <= 4; step++) engine.appendVisualTrailPoint(points, 1, step * 0.25);

  assert.equal(points.length, 3);
  assert.equal(points[1].x, 1);
  assert.equal(points[1].y, 0);
  assert.equal(points[2].x, 1);
  assert.equal(points[2].y, 1);
});

test("a lagging visual player never draws a trail ahead and back again", () => {
  const settled = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];

  const halfway = engine.visibleTrailPoints(settled, { x: 4, y: 2 });
  assert.equal(halfway.length, 3);
  assert.equal(halfway.at(-1).x, 4);
  assert.equal(halfway.at(-1).y, 2);
  assert.equal(halfway.some((point) => point.x === 4 && point.y === 4), false);

  const beforeTurn = engine.visibleTrailPoints(settled, { x: 2, y: 0 });
  assert.equal(beforeTurn.length, 2);
  assert.equal(beforeTurn.at(-1).x, 2);
  assert.equal(beforeTurn.at(-1).y, 0);
});

test("a backgrounded visual player can safely catch up across the full path", () => {
  const settled = Array.from({ length: 61 }, (_, x) => ({ x, y: 0 }));
  const visible = engine.visibleTrailPoints(settled, { x: 5, y: 0 });

  assert.equal(visible.at(-1).x, 5);
  assert.ok(visible.every((point) => point.x <= 5));
});

test("short reconstructed trails keep collision-cell corners", () => {
  const width = engine.constants.width;
  const keys = [10 * width + 10, 10 * width + 11, 11 * width + 11];
  const rebuilt = engine.rebuiltVisualTrailPoints(keys);

  assert.equal(rebuilt.length, 3);
  assert.equal(rebuilt[1].x, 11.5);
  assert.equal(rebuilt[1].y, 10.5);
});

test("compact visual paths preserve arbitrary straight lines across a reconnect", () => {
  const points = [];
  for (let step = 0; step <= 80; step++) {
    const x = 5 + step * 0.2;
    engine.appendVisualTrailPoint(points, x, 8 + (x - 5) * 0.25);
  }

  const packed = engine.encodeVisualTrail(points);
  const restored = engine.decodeVisualTrail(packed);

  assert.equal(points.length, 2);
  assert.equal(packed.length, 4);
  assert.equal(restored.length, 2);
  assert.ok(Math.abs(restored[0].x - 5) <= 0.05);
  assert.ok(Math.abs(restored.at(-1).y - 12) <= 0.05);
});

test("incoming visual paths are bounded before entering room state", () => {
  const oversized = Array.from({ length: engine.constants.maxVisualTrailPoints * 4 + 3 }, (_, index) => index % 2 ? 999999 : -999999);
  const safe = engine.sanitizeVisualTrail(oversized);

  assert.equal(safe.length, engine.constants.maxVisualTrailPoints * 2);
  assert.equal(safe.length % 2, 0);
  assert.ok(safe.every((value) => Number.isInteger(value) && value >= 0));
});

test("initial spawns are randomized while keeping every player well separated", () => {
  const first = Array.from(engine.allocateInitialSpawns(engine.constants.maxPlayers, seededRandom(11)));
  const second = Array.from(engine.allocateInitialSpawns(engine.constants.maxPlayers, seededRandom(29)));

  assert.equal(first.length, engine.constants.maxPlayers);
  assert.notDeepEqual(first.map(({ x, y }) => `${x},${y}`), second.map(({ x, y }) => `${x},${y}`));
  first.forEach(({ x, y }) => {
    assert.ok(x >= engine.constants.spawnMargin && x < engine.constants.width - engine.constants.spawnMargin);
    assert.ok(y >= engine.constants.spawnMargin && y < engine.constants.height - engine.constants.spawnMargin);
  });
  for (let i = 0; i < first.length; i++) {
    for (let j = i + 1; j < first.length; j++) {
      const distance = Math.hypot(first[i].x - first[j].x, first[i].y - first[j].y);
      assert.ok(distance >= engine.constants.initialSpawnMinDistance, `${i} and ${j} are only ${distance} cells apart`);
    }
  }
});

test("respawn selection avoids other players, their territory, and their trails", () => {
  engine.resetGrid();
  const state = engine.freshState();
  const player = engine.makePlayer(0, "respawning", false, 2);
  const other = engine.makePlayer(1, "active", false, 2);
  engine.applyPlayerSpawn(other, { x: 36, y: 54, dir: "right" });
  state.phase = "playing";
  state.players = [player, other];
  engine.setState(state);

  const width = engine.constants.width;
  const owner = engine.getOwner();
  const trailOwner = engine.getTrailOwner();
  for (let y = 38; y <= 70; y++) {
    for (let x = 22; x <= 50; x++) owner[y * width + x] = other.id;
  }
  for (let y = 20; y <= 88; y++) trailOwner[y * width + 58] = other.id;

  const spawn = engine.findRespawnSpot(player, seededRandom(7));
  assert.ok(spawn);
  assert.ok(Math.hypot(spawn.x - other.x, spawn.y - other.y) >= engine.constants.respawnPlayerDistance);

  const radius = engine.constants.baseRadius + engine.constants.spawnClearance;
  for (let y = spawn.y - radius; y <= spawn.y + radius; y++) {
    for (let x = spawn.x - radius; x <= spawn.x + radius; x++) {
      const key = y * width + x;
      assert.notEqual(owner[key], other.id);
      assert.notEqual(trailOwner[key], other.id);
    }
  }
  engine.resetGrid();
});

test("respawn selection still sees an overlapping trail after its shared owner cell is cleared", () => {
  engine.resetGrid();
  const state = engine.freshState();
  const player = engine.makePlayer(0, "respawning", false, 2);
  const other = engine.makePlayer(1, "trail owner", false, 2, { x: 60, y: 90, dir: "left" });
  const width = engine.constants.width;
  const centerX = 20;
  const centerY = 20;
  const center = centerY * width + centerX;
  state.phase = "playing";
  state.players = [player, other];
  other.trail = [center];
  engine.setState(state);

  engine.getOwner().fill(other.id);
  for (let y = centerY - 6; y <= centerY + 6; y++) {
    for (let x = centerX - 6; x <= centerX + 6; x++) engine.getOwner()[y * width + x] = -1;
  }
  engine.getTrailOwner()[center] = -1;

  assert.equal(engine.findRespawnSpot(player, seededRandom(3)), null);
  engine.resetGrid();
});

test("respawn waits instead of overwriting territory when no safe position exists", () => {
  engine.resetGrid();
  const state = engine.freshState();
  const player = engine.makePlayer(0, "blocked", false, 2);
  const now = Date.now();
  player.deadUntil = now - 1;
  state.phase = "playing";
  state.players = [player];
  engine.setState(state);
  engine.getOwner().fill(1);

  const before = { x: player.x, y: player.y };
  engine.respawn(player, now);

  assert.equal(player.deadUntil, now + 1000);
  assert.equal(player.x, before.x);
  assert.equal(player.y, before.y);
  assert.ok(Array.from(engine.getOwner()).every((id) => id === 1));
  engine.resetGrid();
});

test("a successful respawn updates its position and creates a fresh base", () => {
  engine.resetGrid();
  const state = engine.freshState();
  const player = engine.makePlayer(0, "respawning", false, 1);
  const now = Date.now();
  player.deadUntil = now - 1;
  state.phase = "playing";
  state.players = [player];
  engine.setState(state);

  engine.respawn(player, now);

  assert.equal(player.deadUntil, 0);
  assert.equal(player.x, player.spawnX);
  assert.equal(player.y, player.spawnY);
  assert.equal(engine.getOwner()[Math.floor(player.y) * engine.constants.width + Math.floor(player.x)], player.id);
  assert.equal(state.ownerRev, 1);
  engine.resetGrid();
});

test("a recall respawns inside preserved territory without granting a free new base", () => {
  engine.resetGrid();
  const state = engine.freshState();
  const player = engine.makePlayer(0, "recalled", false, 1, { x: 30, y: 40, dir: "right" });
  const now = Date.now();
  state.phase = "playing";
  state.players = [player];
  engine.setState(state);
  engine.createBase(player);
  const before = Array.from(engine.getOwner()).filter((id) => id === player.id).length;
  player.deadUntil = now - 1;

  engine.respawn(player, now);

  assert.equal(player.deadUntil, 0);
  assert.equal(engine.getOwner()[Math.floor(player.y) * engine.constants.width + Math.floor(player.x)], player.id);
  assert.equal(Array.from(engine.getOwner()).filter((id) => id === player.id).length, before);
  assert.equal(state.ownerRev, 0);
  engine.resetGrid();
});

test("an unsafe leftover territory fragment falls back to a fresh safe base", () => {
  engine.resetGrid();
  const state = engine.freshState();
  const player = engine.makePlayer(0, "fragmented", false, 2, { x: 20, y: 20, dir: "right" });
  const other = engine.makePlayer(1, "nearby trail", false, 2, { x: 60, y: 90, dir: "left" });
  const now = Date.now();
  const oldCenter = 20 * engine.constants.width + 20;
  const blockingTrail = 20 * engine.constants.width + 21;
  player.deadUntil = now - 1;
  other.trail = [blockingTrail];
  state.phase = "playing";
  state.players = [player, other];
  engine.setState(state);
  engine.getOwner()[oldCenter] = player.id;
  engine.getTrailOwner()[blockingTrail] = other.id;

  engine.respawn(player, now);
  assert.equal(player.deadUntil, now + 1000);
  assert.equal(engine.getOwner()[oldCenter], player.id);

  engine.respawn(player, now + 1000);
  assert.equal(player.deadUntil, 0);
  assert.equal(engine.getOwner()[oldCenter], -1);
  assert.equal(engine.getOwner()[Math.floor(player.y) * engine.constants.width + Math.floor(player.x)], player.id);
  engine.resetGrid();
});

test("players respawning together receive separate safe positions", () => {
  engine.resetGrid();
  const state = engine.freshState();
  const first = engine.makePlayer(0, "first", false, 2);
  const second = engine.makePlayer(1, "second", false, 2);
  const now = Date.now();
  first.deadUntil = now - 1;
  second.deadUntil = now - 1;
  state.phase = "playing";
  state.players = [first, second];
  engine.setState(state);

  engine.respawn(first, now);
  engine.respawn(second, now);

  assert.equal(first.deadUntil, 0);
  assert.equal(second.deadUntil, 0);
  assert.ok(Math.hypot(first.x - second.x, first.y - second.y) >= engine.constants.respawnPlayerDistance);
  engine.resetGrid();
});

test("a returning player retries automatically when safe space becomes available", () => {
  engine.resetGrid();
  const fake = fakeApi(["returning"]);
  const state = engine.freshState();
  const player = engine.makePlayer(0, "returning", false, 1);
  player.retired = true;
  state.phase = "playing";
  state.deadline = Date.now() + 60000;
  state.players = [player];
  engine.setApi(fake.api);
  engine.setState(state);
  engine.getOwner().fill(1);

  controller.onPresence(fake.people, {});
  assert.equal(player.retired, true);
  assert.ok(player.returnRetryAt > Date.now());

  const width = engine.constants.width;
  for (let y = 14; y <= 26; y++) {
    for (let x = 14; x <= 26; x++) engine.getOwner()[y * width + x] = -1;
  }
  assert.equal(engine.retryReturningPlayers(player.returnRetryAt), true);
  assert.equal(player.retired, false);
  assert.equal(player.away, false);
  assert.equal(player.returnRetryAt, undefined);
  assert.equal(engine.getOwner()[Math.floor(player.spawnY) * width + Math.floor(player.spawnX)], player.id);
  engine.resetGrid();
});

test("an away player returns inside preserved territory without gaining extra area", () => {
  engine.resetGrid();
  const fake = fakeApi(["away player"]);
  const state = engine.freshState();
  const player = engine.makePlayer(0, "away player", false, 1, { x: 30, y: 40, dir: "right" });
  state.phase = "playing";
  state.deadline = Date.now() + 60000;
  state.players = [player];
  engine.setApi(fake.api);
  engine.setState(state);
  engine.createBase(player);
  player.away = true;
  const before = Array.from(engine.getOwner()).filter((id) => id === player.id).length;

  controller.onPresence(fake.people, {});

  assert.equal(player.away, false);
  assert.equal(engine.getOwner()[Math.floor(player.y) * engine.constants.width + Math.floor(player.x)], player.id);
  assert.equal(Array.from(engine.getOwner()).filter((id) => id === player.id).length, before);
  engine.resetGrid();
});

test("creating a base never paints over another player's existing territory", () => {
  engine.resetGrid();
  const player = engine.makePlayer(0, "new base", false, 2, { x: 30, y: 40, dir: "right" });
  const center = 40 * engine.constants.width + 30;
  engine.getOwner()[center] = 1;

  assert.equal(engine.createBase(player), true);
  assert.equal(engine.getOwner()[center], 1);
  assert.ok(Array.from(engine.getOwner()).some((id) => id === player.id));
  engine.resetGrid();
});

test("a solo host starts a 90-second match with three local bots", () => {
  const fake = fakeApi(["구나"]);
  engine.setApi(fake.api);
  engine.setState(engine.freshState());
  engine.resetGrid();

  assert.equal(engine.hostStart(), true);
  const state = engine.getState();

  assert.equal(state.phase, "playing");
  assert.equal(state.players.length, 4);
  assert.equal(state.players.filter((player) => player.bot).length, 3);
  assert.ok(state.deadline > Date.now() + 85000);
  for (let i = 0; i < state.players.length; i++) {
    for (let j = i + 1; j < state.players.length; j++) {
      assert.ok(Math.hypot(
        state.players[i].spawnX - state.players[j].spawnX,
        state.players[i].spawnY - state.players[j].spawnY
      ) >= engine.constants.initialSpawnMinDistance);
    }
  }
  assert.equal(fake.sent.at(-1).t, "tr_state");
  assert.equal(typeof fake.sent.at(-1).state.owner, "string");
});

test("multiplayer start waits for every non-host participant to be ready", () => {
  const fake = fakeApi(["구나", "민서", "서준"]);
  engine.setApi(fake.api);
  engine.setState(engine.freshState());
  engine.resetGrid();

  assert.equal(engine.hostStart(), false);
  assert.equal(engine.hostSetReady("민서", true), true);
  assert.equal(engine.hostStart(), false);
  assert.equal(engine.hostSetReady("서준", true), true);
  assert.equal(engine.hostStart(), true);
  assert.equal(engine.getState().players.length, 3);
  assert.equal(engine.getState().players.some((player) => player.bot), false);
});

test("a host cannot strand the room as a spectator or start while spectating", () => {
  const fake = fakeApi(["구나", "민서"]);
  engine.setApi(fake.api);
  const state = engine.freshState();
  engine.setState(state);

  fake.people = fake.people.slice(0, 1);
  assert.equal(engine.hostSetSpectator("구나", true), false);
  assert.equal(fake.toasts.at(-1), "다른 참가자가 한 명 이상 있어야 관전할 수 있어요");

  fake.people = [
    { nick: "구나", joinTs: 1 },
    { nick: "민서", joinTs: 2 }
  ];
  assert.equal(engine.hostSetSpectator("구나", true), true);
  engine.getState().ready = ["민서"];
  assert.equal(engine.hostStart(), false);
});

test("the same room can run consecutive matches after guests ready again", () => {
  const fake = fakeApi(["구나", "민서", "서준"]);
  engine.setApi(fake.api);
  engine.setState(engine.freshState());
  engine.resetGrid();

  assert.equal(engine.hostSetReady("민서", true), true);
  assert.equal(engine.hostSetReady("서준", true), true);
  assert.equal(engine.hostStart(), true);
  const firstMatchId = engine.getState().matchId;
  const firstOwnerRevision = engine.getState().ownerRev;

  engine.getState().phase = "finished";
  engine.getState().deadline = 0;
  engine.getState().winner = "민서";
  assert.equal(engine.hostSetSpectator("서준", true), true);
  assert.equal(engine.hostSetSpectator("서준", false), true);
  assert.equal(engine.hostSetReady("민서", true), true);
  assert.equal(engine.hostSetReady("서준", true), true);
  assert.equal(engine.hostStart(), true);

  assert.equal(engine.getState().phase, "playing");
  assert.notEqual(engine.getState().matchId, firstMatchId);
  assert.ok(engine.getState().ownerRev > firstOwnerRevision);
  assert.equal(engine.getState().winner, "");
  assert.deepEqual(Array.from(engine.getState().ready), []);
  assert.deepEqual(Array.from(engine.getState().players, (player) => player.nick), ["구나", "민서", "서준"]);
  assert.equal(fake.leaveCount, 0);
});

test("a remote rematch clears prior-round visual and input state", () => {
  const applyFullSource = source.match(/function applyFull\(raw, sourceHost\) \{([\s\S]*?)\n  \}\n\n  function applyFrame/)[1];
  assert.match(applyFullSource, /if \(matchChanged\) \{[\s\S]*lastInputAt = 0;[\s\S]*pressedKeys = Object\.create\(null\);/);
  assert.match(applyFullSource, /if \(matchChanged\) \{[\s\S]*visualPlayers = Object\.create\(null\);[\s\S]*visualTrails = Object\.create\(null\);[\s\S]*spectatorFocusNick = "";[\s\S]*swipe = null;/);
});

test("the result screen exposes the next-round roster, role switch, and ready/start action", () => {
  assert.match(indexSource, /id="territory-next-round-status"/);
  assert.match(indexSource, /id="territory-finished-participants"/);
  assert.match(indexSource, /id="territory-finished-spectators"/);
  assert.match(indexSource, /id="territory-finished-role-btn"[\s\S]*id="territory-again-btn"/);
  assert.match(source, /renderRoleLists\("territory-finished-participants", "territory-finished-spectators"\)/);
  assert.match(source, /\$\("territory-finished-role-btn"\)\.addEventListener\("click", toggleRole\)/);
  assert.match(source, /setHidden\(again, state\.phase !== "finished" \|\| spectator\)/);
  assert.match(styles, /\.territory-finished-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("a ten-member room keeps eight active slots and places the last two in spectator mode", () => {
  const nicks = ["구나", "참가1", "참가2", "참가3", "참가4", "참가5", "참가6", "참가7", "참가8", "참가9"];
  const fake = fakeApi(nicks);
  engine.setApi(fake.api);
  engine.setState(engine.freshState());

  controller.onPresence(fake.people, { forceFull: true });

  assert.deepEqual(Array.from(engine.getState().spectators), ["참가8", "참가9"]);
  assert.equal(engine.hostSetSpectator("참가8", false), false);
  assert.equal(fake.toasts.at(-1), "동시 플레이는 8명까지 가능해요");
});

test("only spectators can select a ranked active player for camera focus", () => {
  const fake = fakeApi(["viewer", "alpha", "beta"]);
  fake.meNick = "viewer";
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "spectator-focus";
  state.deadline = Date.now() + 60000;
  state.spectators = ["viewer"];
  state.players = [
    engine.makePlayer(0, "alpha", false, 2),
    engine.makePlayer(1, "beta", false, 2)
  ];
  engine.setApi(fake.api);
  engine.setState(state);

  assert.equal(engine.selectSpectatorFocus("beta"), true);
  assert.equal(engine.cameraFocusPlayer().nick, "beta");

  state.players[1].away = true;
  assert.equal(engine.selectSpectatorFocus("beta"), false);
  assert.equal(engine.cameraFocusPlayer().nick, "alpha");

  fake.meNick = "alpha";
  state.spectators = [];
  state.players[1].away = false;
  assert.equal(engine.selectSpectatorFocus("beta"), false);
  assert.equal(engine.cameraFocusPlayer().nick, "alpha");
});

test("the spectator scoreboard exposes focus controls and the camera follows their selection", () => {
  const scoreboardSource = source.match(/function renderScoreboard\(\) \{([\s\S]*?)\n  \}\n\n  function renderFinished/)[1];
  const viewSource = source.match(/function viewInfo\(\) \{([\s\S]*?)\n  \}\n  function screenX/)[1];
  assert.match(scoreboardSource, /data-tr-focus/);
  assert.match(scoreboardSource, /is-focused/);
  assert.match(scoreboardSource, /aria-pressed/);
  assert.match(viewSource, /cameraFocusPlayer\(\)/);
  assert.match(styles, /\.territory-rank\.is-focused\s*\{[^}]*background:/);
  assert.match(styles, /\.territory-rank-focus:focus-visible/);
});

test("a simultaneous eleventh arrival is sent back to the lobby", async () => {
  const nicks = ["구나", "참가1", "참가2", "참가3", "참가4", "참가5", "참가6", "참가7", "참가8", "참가9", "참가10"];
  const fake = fakeApi(nicks);
  engine.setApi(fake.api);
  engine.setState(engine.freshState());

  controller.onPresence(fake.people, { forceFull: true });
  const rejection = fake.sent.find((message) => message.t === "tr_room_full");
  assert.ok(rejection);
  assert.equal(rejection.to, "참가10");

  fake.hostMode = false;
  fake.meNick = "참가10";
  controller.onMessage(rejection);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fake.leaveCount, 1);
  assert.equal(fake.toasts.at(-1), "땅따먹기 방은 10명까지 들어올 수 있어요");
});

test("runtime constants keep realtime traffic below the room broadcast cap", () => {
  assert.equal(engine.constants.stepMs, 50);
  assert.equal(engine.constants.frameMs, 400);
  assert.equal(engine.constants.fullMinMs, 400);
  assert.equal(engine.constants.inputSendMs, 150);
  assert.equal(engine.constants.inputSendMaxMs, 260);
  assert.equal(engine.constants.maxPlayers, 8);
  assert.equal(engine.constants.maxRoomMembers, 10);
  assert.ok(engine.constants.maxTrail <= 360);
  assert.equal(engine.constants.cells, 72 * 108);
  assert.match(source, /api\.sendHostInput\(message\)/);
  assert.match(source, /if \(hostChanged && !matchChanged\) queueDesiredInputForNewHost\(\)/);
  assert.match(source, /pendingInputTimer = setTimeout\(flushPendingInput, inputIntervalMs\(\)\)/);
  assert.match(source, /t: "tr_frame"/);
  assert.match(source, /t: "tr_sync_req"/);
  for (let players = 1; players <= engine.constants.maxPlayers; players++) {
    const stateMessagesPerSecond = 1000 / engine.frameIntervalMs(players) * (engine.constants.maxRoomMembers + 1);
    const inputMessagesPerSecond = 1000 / engine.inputIntervalMs(players) * Math.max(0, players - 1) * 2;
    assert.ok(stateMessagesPerSecond + inputMessagesPerSecond < 90, `${players} players exceed the realtime safety budget`);
  }
  assert.doesNotMatch(source, /setInterval\([^,]+,\s*(?:1\d\d|[1-9]\d)\)/);
});

test("Territory Rush loops its match BGM and derives the CatchMind death cue from synced state", async () => {
  const audio = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.paused = true;
      this.currentTime = 0;
      this.playCount = 0;
      audio.push(this);
    }
    setAttribute() {}
    pause() { this.paused = true; }
    play() {
      this.paused = false;
      this.playCount++;
      return Promise.resolve();
    }
  }
  context.Audio = FakeAudio;
  context.localStorage = { getItem() { return null; } };

  const fake = fakeApi(["구나", "민서"]);
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "audio-match";
  state.deadline = Date.now() + 60000;
  const player = engine.makePlayer(0, "구나", false, 2);
  state.players = [player];
  engine.setApi(fake.api);
  engine.setState(state);

  engine.syncAudio();
  await Promise.resolve();
  const bgm = audio.find((item) => item.src === engine.constants.gameBgmSrc);
  assert.ok(bgm);
  assert.equal(bgm.loop, true);
  assert.equal(bgm.volume, engine.constants.gameBgmVolume);
  assert.equal(bgm.playCount, 1);
  engine.syncAudio();
  assert.equal(bgm.playCount, 1);

  engine.eliminate(player, null, Date.now());
  const death = audio.find((item) => item.src === engine.constants.deathSfxSrc);
  assert.ok(death);
  assert.equal(death.volume, 1);
  assert.equal(death.playCount, 1);
  assert.equal(fake.sent.some((message) => message.t === "tr_death"), false);

  const remoteState = engine.freshState();
  remoteState.phase = "playing";
  remoteState.matchId = "remote-audio-match";
  remoteState.deadline = Date.now() + 60000;
  remoteState.players = [engine.makePlayer(0, "민서", false, 2)];
  engine.setState(remoteState);
  const frame = engine.snapshot(false);
  frame.frameSeq = 1;
  frame.players[0].deadUntil = Date.now() + 1800;
  frame.players[0].deathSeq = 1;
  engine.applyFrame(frame, "구나");
  assert.equal(death.playCount, 2);
  const duplicate = engine.snapshot(false);
  duplicate.frameSeq = 2;
  duplicate.players[0].deadUntil += 1000;
  engine.applyFrame(duplicate, "구나");
  assert.equal(death.playCount, 2);

  engine.getState().phase = "finished";
  engine.syncAudio();
  assert.equal(bgm.paused, true);
  assert.equal(bgm.currentTime, 0);
});

test("territories and trails render as bright flat colors without outlines", () => {
  const paletteMatch = source.match(/var TERRITORY_COLORS = \[(.*?)\];/);
  assert.ok(paletteMatch);
  const palette = Array.from(paletteMatch[1].matchAll(/#[0-9a-f]{6}/gi), (match) => match[0]);
  assert.equal(palette.length, engine.constants.maxPlayers);
  palette.forEach((hex) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    assert.ok(Math.max(...channels) >= 204, `${hex} should stay bright and lively`);
  });

  const territoryLayerSource = source.match(/function rebuildTerritoryLayer\(\) \{([\s\S]*?)\n  \}\n\n  function drawTerritories/)[1];
  assert.match(territoryLayerSource, /territoryCtx\.globalAlpha = 1/);
  assert.match(territoryLayerSource, /territoryCtx\.fillStyle = TERRITORY_COLORS/);
  assert.match(territoryLayerSource, /fillRect\(startX \* s, y \* s, \(x - startX\) \* s, s\)/);
  assert.doesNotMatch(territoryLayerSource, /s \+ \.5/);
  assert.doesNotMatch(territoryLayerSource, /stroke|shadow/i);

  const drawTerritoriesSource = source.match(/function drawTerritories\(view\) \{([\s\S]*?)\n  \}\n\n  function pointDistanceToSegmentSquared/)[1];
  assert.match(drawTerritoriesSource, /ctx\.imageSmoothingEnabled = false/);
  assert.doesNotMatch(drawTerritoriesSource, /imageSmoothingQuality/);

  const boundarySource = source.match(/function drawArenaBoundary\(view\) \{([\s\S]*?)\n  \}\n\n  function pointDistanceToSegmentSquared/)[1];
  assert.match(boundarySource, /var movement = view\.movement \|\| arenaMovementBounds\(\)/);
  assert.match(boundarySource, /screenX\(movement\.left, view\)/);
  assert.match(boundarySource, /screenX\(movement\.right, view\)/);
  assert.match(boundarySource, /ctx\.strokeStyle = "#31576a"/);
  assert.match(boundarySource, /ctx\.strokeRect\(left, top, right - left, bottom - top\)/);

  const paintSource = source.match(/function paint\(\) \{([\s\S]*?)\n  \}\n\n  function paintMinimap/)[1];
  assert.match(paintSource, /drawTerritories\(view\);\s*drawArenaBoundary\(view\);/);

  const trailSource = source.match(/function drawTrail\(player, view\) \{([\s\S]*?)\n  \}\n\n  function drawPlayer/)[1];
  assert.match(trailSource, /ctx\.strokeStyle = TERRITORY_COLORS\[player\.id\]/);
  assert.equal((trailSource.match(/ctx\.stroke\(\);/g) || []).length, 1);
  assert.doesNotMatch(trailSource, /rgba\(|shadow|outline/i);
  assert.doesNotMatch(trailSource, /quadraticCurveTo/);
  assert.match(trailSource, /ctx\.lineTo/);

  const minimapSource = source.match(/function paintMinimap\(\) \{([\s\S]*?)\n  \}\n\n  function renderLoop/)[1];
  assert.match(minimapSource, /miniCtx\.globalAlpha = 1;\s*miniCtx\.imageSmoothingEnabled = false;\s*miniCtx\.drawImage\(\s*territoryLayer/);
  assert.doesNotMatch(minimapSource, /imageSmoothingQuality/);
});

test("worst-case territory and trail snapshots stay compact", () => {
  const grid = new Int8Array(engine.constants.cells);
  for (let i = 0; i < grid.length; i++) grid[i] = i % engine.constants.maxPlayers;
  assert.ok(Buffer.byteLength(engine.encodeOwner(grid)) < 50000);

  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "payload-test";
  state.players = Array.from({ length: engine.constants.maxPlayers }, (_, id) => {
    const player = engine.makePlayer(id, "참가자" + id, false, engine.constants.maxPlayers);
    player.trail = Array.from({ length: engine.constants.maxTrail }, (_unused, step) => (step + id * 17) % engine.constants.cells);
    return player;
  });
  engine.setState(state);

  const frame = engine.snapshot(false);
  assert.ok(frame.players.every((player) => player.path.length <= engine.constants.maxVisualTrailPoints * 2));
  assert.ok(Buffer.byteLength(JSON.stringify(frame)) < 100000);

  engine.getOwner().set(grid);
  assert.ok(Buffer.byteLength(JSON.stringify(engine.snapshot(true))) < 100000);
  engine.resetGrid();
});

test("a disconnected host yields instead of broadcasting stale state", () => {
  const fake = fakeApi(["구나", "민서"]);
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "reconnect-test";
  state.deadline = Date.now() + 60000;
  state.players = [
    engine.makePlayer(0, "구나", false, 2),
    engine.makePlayer(1, "민서", false, 2)
  ];
  engine.setApi(fake.api);
  engine.setState(state);
  engine.setSyncState(0, false);

  controller.onConnection(false);
  assert.equal(fake.eligible.at(-1), false);

  fake.sent.length = 0;
  controller.onReady();
  assert.equal(fake.sent.at(-1).t, "tr_hello");
  assert.equal(fake.sent.some((message) => message.t === "tr_state"), false);

  fake.sent.length = 0;
  controller.onPresence(fake.people, { becameHost: false });
  assert.equal(fake.sent.some((message) => message.t === "tr_state"), false);
});

test("away grace preserves territory until the common roster expires the player", () => {
  const fake = fakeApi(["구나"]);
  engine.setApi(fake.api);
  engine.setState(engine.freshState());
  engine.setSyncState(0, false);
  engine.resetGrid();
  assert.equal(engine.hostStart(), true);

  const player = engine.getState().players[0];
  const before = Array.from(engine.getOwner()).filter((value) => value === player.id).length;
  assert.ok(before > 0);

  fake.people[0].away = true;
  controller.onPresence(fake.people, {});
  assert.equal(player.away, true);
  assert.equal(player.retired, false);
  assert.equal(Array.from(engine.getOwner()).filter((value) => value === player.id).length, before);

  const grid = engine.getOwner();
  for (let index = 0; index < grid.length; index++) if (grid[index] === player.id) grid[index] = 1;
  fake.people[0].away = false;
  controller.onPresence(fake.people, {});
  const spawnKey = Math.floor(player.spawnY) * engine.constants.width + Math.floor(player.spawnX);
  assert.equal(player.away, false);
  assert.equal(grid[spawnKey], player.id);

  fake.people[0].away = true;
  controller.onPresence(fake.people, {});
  fake.people.length = 0;
  controller.onPresence([], { expiredNick: "구나" });
  assert.equal(player.retired, true);
  assert.equal(Array.from(engine.getOwner()).filter((value) => value === player.id).length, 0);
});

test("a missing owner revision blocks host election until a full sync arrives", () => {
  const fake = fakeApi(["구나", "민서"]);
  fake.hostMode = false;
  fake.hostNick = "민서";
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "owner-sync-test";
  state.frameSeq = 4;
  state.ownerRev = 2;
  state.deadline = Date.now() + 60000;
  state.players = [engine.makePlayer(0, "구나", false, 2), engine.makePlayer(1, "민서", false, 2)];
  engine.setApi(fake.api);
  engine.setState(state);
  engine.setSyncState(2, false);

  const frame = engine.snapshot(false);
  frame.frameSeq = 5;
  frame.ownerRev = 3;
  controller.onMessage({ t: "tr_frame", by: "민서", state: frame });

  assert.equal(fake.eligible.at(-1), false);
  assert.equal(fake.sent.at(-1).t, "tr_sync_req");
});

test("a yielded former host accepts the replacement host snapshot even after a small rollback", () => {
  const fake = fakeApi(["구나", "민서"]);
  fake.hostMode = false;
  fake.hostNick = "민서";
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "host-handoff-test";
  state.rev = 9;
  state.ownerRev = 3;
  state.deadline = Date.now() + 60000;
  state.players = [engine.makePlayer(0, "구나", false, 2), engine.makePlayer(1, "민서", false, 2)];
  engine.setApi(fake.api);
  engine.setState(state);
  engine.setSyncState(3, true);

  const replacement = engine.snapshot(true);
  replacement.rev = 8;
  controller.onMessage({ t: "tr_state", by: "민서", state: replacement });

  assert.equal(engine.getState().rev, 8);
  assert.equal(fake.eligible.at(-1), true);
});

test("a fallback host can recover from an owner snapshot lost during handoff", () => {
  const fake = fakeApi(["구나", "민서"]);
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "lost-owner-test";
  state.rev = 6;
  state.ownerRev = 2;
  state.deadline = Date.now() + 60000;
  state.players = [engine.makePlayer(0, "구나", false, 2), engine.makePlayer(1, "민서", false, 2)];
  engine.setApi(fake.api);
  engine.setState(state);
  engine.setSyncState(3, false, Date.now() - 2000);

  assert.equal(engine.recoverMissingOwner(), true);
  assert.equal(engine.getState().rev, 7);
  assert.equal(fake.sent.at(-1).t, "tr_state");
  assert.equal(fake.sent.at(-1).state.ownerRev, 2);
  assert.equal(fake.eligible.at(-1), true);
});

test("a same-session reconnect hello does not rewind the host input sequence", () => {
  const fake = fakeApi(["구나", "민서"]);
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "input-reconnect-test";
  state.deadline = Date.now() + 60000;
  state.players = [engine.makePlayer(0, "구나", false, 2), engine.makePlayer(1, "민서", false, 2)];
  engine.setApi(fake.api);
  engine.setState(state);
  engine.setSyncState(0, false);

  const remote = state.players[1];
  assert.equal(engine.applyDirection(remote, "left", 5), true);
  controller.onMessage({ t: "tr_hello", by: "민서" });
  assert.equal(engine.applyDirection(remote, "up", 1), false);
});

test("a guest retries its reconnect hello after presence catches up", () => {
  const fake = fakeApi(["구나", "민서"]);
  fake.hostMode = false;
  fake.hostNick = "민서";
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "hello-race-test";
  state.deadline = Date.now() + 60000;
  state.players = [engine.makePlayer(0, "구나", false, 2), engine.makePlayer(1, "민서", false, 2)];
  engine.setApi(fake.api);
  engine.setState(state);
  engine.setSyncState(0, false);
  engine.setAuthoritativeHost("민서");

  controller.onConnection(false);
  assert.equal(fake.eligible.at(-1), false);
  controller.onConnection(true);
  assert.equal(fake.eligible.at(-1), false);
  controller.onReady();
  assert.equal(fake.sent.at(-1).t, "tr_hello");
  fake.sent.length = 0;
  controller.onPresence(fake.people, {});
  assert.equal(fake.sent.at(-1).t, "tr_hello");

  const synced = engine.snapshot(true);
  controller.onMessage({ t: "tr_state", by: "민서", to: "구나", state: synced });
  assert.equal(fake.eligible.at(-1), true);
});

test("the first snapshot from a newly elected host resets stale revision counters", () => {
  const fake = fakeApi(["구나", "민서", "서준"]);
  fake.hostMode = false;
  fake.hostNick = "서준";
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "new-host-revision-test";
  state.rev = 10;
  state.frameSeq = 12;
  state.ownerRev = 4;
  state.deadline = Date.now() + 60000;
  state.players = [
    engine.makePlayer(0, "구나", false, 3),
    engine.makePlayer(1, "민서", false, 3),
    engine.makePlayer(2, "서준", false, 3)
  ];
  engine.setApi(fake.api);
  engine.setState(state);
  engine.setSyncState(4, false);
  engine.setAuthoritativeHost("민서");

  const firstFromNewHost = engine.snapshot(true);
  firstFromNewHost.rev = 9;
  firstFromNewHost.frameSeq = 3;
  controller.onMessage({ t: "tr_state", by: "서준", state: firstFromNewHost });
  assert.equal(engine.getState().rev, 9);
  assert.equal(engine.getState().frameSeq, 3);
  assert.equal(engine.getAuthoritativeHost(), "서준");

  const staleFromSameHost = engine.snapshot(true);
  staleFromSameHost.rev = 8;
  staleFromSameHost.frameSeq = 2;
  controller.onMessage({ t: "tr_state", by: "서준", state: staleFromSameHost });
  assert.equal(engine.getState().rev, 9);
  assert.equal(engine.getState().frameSeq, 3);
});

test("incoming duplicate or invalid player ids are reassigned uniquely", () => {
  const parsed = engine.sanitizeState({
    phase: "idle",
    players: [
      { id: "invalid", nick: "alpha" },
      { id: 0, nick: "beta" },
      { id: 0, nick: "gamma" }
    ]
  }, false);
  const ids = Array.from(parsed.state.players, (player) => player.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => Number.isInteger(id) && id >= 0 && id < engine.constants.maxPlayers));
});

test("visual prediction is bounded and never mutates the authoritative player", () => {
  const player = engine.makePlayer(0, "predict", false, 2);
  player.x = 30;
  player.y = 40;
  player.angle = 0;
  player.targetAngle = Math.PI / 2;
  const before = { x: player.x, y: player.y, angle: player.angle };

  const pose = engine.predictedPlayerPose(player, 500, player.targetAngle);

  assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.angle));
  assert.ok(pose.x >= engine.constants.arenaInset && pose.x <= engine.constants.width - engine.constants.arenaInset);
  assert.ok(pose.y >= engine.constants.arenaInset && pose.y <= engine.constants.height - engine.constants.arenaInset);
  assert.ok(Math.hypot(pose.x - player.x, pose.y - player.y) <= engine.constants.speed * 0.5 + 1e-9);
  assert.deepEqual({ x: player.x, y: player.y, angle: player.angle }, before);
});

test("emergency respawn keeps clear of a temporarily away player", () => {
  const state = engine.freshState();
  state.matchId = "away-emergency-spacing";
  const respawning = engine.makePlayer(0, "respawning", false, 2);
  const away = engine.makePlayer(1, "away", false, 2);
  away.x = 7;
  away.y = 7;
  away.away = true;
  state.players = [respawning, away];
  engine.setState(state);
  engine.resetGrid();

  const spot = engine.findEmergencyRespawnSpot(respawning, () => 0.5);
  assert.ok(spot);
  assert.ok(Math.hypot(spot.x - away.x, spot.y - away.y) > 9);
});

test("a promoted host rebuilds collision geometry from lossless trail cells", () => {
  const fake = fakeApi(["host"]);
  engine.setApi(fake.api);
  const state = engine.freshState();
  state.matchId = "handoff-collision-path";
  const player = engine.makePlayer(0, "handoff", false, 1);
  player.trail = [];
  for (let x = 10; x <= 34; x++) player.trail.push(20 * engine.constants.width + x);
  player.x = 34.5;
  player.y = 20.5;
  player.path = engine.encodeVisualTrail([{ x: 10.5, y: 20.5 }, { x: 34.5, y: 35.5 }]);
  state.players = [player];
  engine.setState(state);

  const cache = engine.syncCollisionTrail(player);
  assert.equal(cache.points.length, player.trail.length);
  assert.equal(cache.points[0].x, 10.5);
  assert.equal(cache.points[0].y, 20.5);
  assert.equal(cache.points.at(-1).x, 34.5);
  assert.equal(cache.points.at(-1).y, 20.5);
});

test("guest direction packets retry through the room until the host acknowledges them", () => {
  const flushSource = source.match(/function flushPendingInput\(\) \{([\s\S]*?)\n  \}\n\n  function queueDesiredInputForNewHost/)[1];
  const retrySource = source.match(/function scheduleInputRetry\(\) \{([\s\S]*?)\n  \}\n\n  function flushPendingInput/)[1];
  assert.match(flushSource, /unackedInput = \{ message: message, attempts: 1 \}/);
  assert.match(flushSource, /sendInitialInput\(message\);\s*scheduleInputRetry\(\);/);
  assert.match(retrySource, /sendRoomInput\(pending\.message\)/);
  assert.match(source, /player\.inputAck = seq;/);
  assert.match(source, /mergeVisualPlayers\([^)]*\);\s*acknowledgeLocalInput\(\);/);
});
