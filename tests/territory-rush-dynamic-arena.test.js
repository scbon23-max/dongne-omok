"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "territory-rush.js"), "utf8");

function loadTerritory(random) {
  let now = 100000;
  const windowObject = { __TERRITORY_RUSH_TEST__: true };
  const sandboxMath = Object.create(Math);
  Object.defineProperty(sandboxMath, "random", {
    value: typeof random === "function" ? random : Math.random
  });
  vm.runInNewContext(source, {
    window: windowObject,
    console,
    Date: { now() { return now; } },
    Math: sandboxMath,
    setTimeout,
    clearTimeout
  }, { filename: "territory-rush.js" });
  return {
    controller: windowObject.TerritoryRush,
    engine: windowObject.TerritoryRush._test,
    advance(ms) { now += ms; }
  };
}

function plainArena(arena) {
  return {
    minX: Number(arena.minX),
    maxX: Number(arena.maxX),
    minY: Number(arena.minY),
    maxY: Number(arena.maxY)
  };
}

function dimensions(arena) {
  return [arena.maxX - arena.minX, arena.maxY - arena.minY];
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function arenaFixture(engine, count) {
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = `arena-${count}`;
  state.arena = engine.arenaForPlayerCount(count);
  state.players = Array.from({ length: count }, (_, index) =>
    engine.makePlayer(index, `player-${index}`, false, count)
  );
  engine.setState(state);
  engine.resetGrid();
  return state;
}

function guestApi() {
  return {
    me() { return { nick: "guest", clientSessionId: "guest-session" }; },
    roster() { return [{ nick: "host" }, { nick: "guest" }]; },
    isHost() { return false; },
    host() { return "host"; },
    hostSessionId() { return "host-session"; },
    isConnected() { return true; },
    setHostEligible() {},
    syncHostInputs() {},
    send() {},
    roomChanged() {},
    toast() {},
    playWarning() {}
  };
}

function hostStartFixture(humanCount) {
  const loaded = loadTerritory(() => 0.75);
  const nicks = Array.from({ length: humanCount }, (_, index) => `human-${index}`);
  const people = nicks.map((nick, index) => ({
    nick,
    joinTs: index + 1,
    clientSessionId: `session-${index}`,
    presenceSessionIds: [`session-${index}`]
  }));
  const api = {
    me() { return { nick: nicks[0], clientSessionId: "session-0" }; },
    roster() { return people.slice(); },
    isHost() { return true; },
    host() { return nicks[0]; },
    hostSessionId() { return "session-0"; },
    isConnected() { return true; },
    setHostEligible() {},
    syncHostInputs() {},
    send() {},
    roomChanged() {},
    toast() {},
    playWarning() {}
  };
  const state = loaded.engine.freshState();
  state.ready = nicks.slice();
  loaded.engine.setApi(api);
  loaded.engine.setState(state);
  assert.equal(loaded.engine.hostStart(), true);
  return loaded;
}

test("arena size follows the exact centered player-count curve", () => {
  const { engine } = loadTerritory();
  const expected = new Map([
    [1, [36, 54]],
    [2, [36, 54]],
    [3, [44, 66]],
    [4, [50, 76]],
    [5, [56, 84]],
    [6, [60, 92]],
    [7, [66, 100]],
    [8, [70, 106]]
  ]);

  for (const [count, size] of expected) {
    const arena = plainArena(engine.arenaForPlayerCount(count));
    assert.deepEqual(dimensions(arena), size, `${count} players`);
    assert.equal(arena.minX + arena.maxX, engine.constants.width, `${count} players centered on x`);
    assert.equal(arena.minY + arena.maxY, engine.constants.height, `${count} players centered on y`);
  }
});

test("the host locks the arena from the actual match entries, including solo bots", () => {
  const cases = [
    { humans: 1, players: 4, size: [50, 76] },
    { humans: 2, players: 2, size: [36, 54] },
    { humans: 3, players: 3, size: [44, 66] },
    { humans: 4, players: 4, size: [50, 76] },
    { humans: 8, players: 8, size: [70, 106] }
  ];

  for (const expected of cases) {
    const { engine } = hostStartFixture(expected.humans);
    assert.equal(engine.getState().players.length, expected.players, `${expected.humans} human room entries`);
    assert.deepEqual(dimensions(plainArena(engine.activeArena())), expected.size);
  }
});

test("arena metadata travels in full and frame snapshots without changing owner-grid dimensions", () => {
  const { engine } = loadTerritory();
  arenaFixture(engine, 4);
  const expected = plainArena(engine.arenaForPlayerCount(4));
  const full = engine.snapshot(true);
  const frame = engine.snapshot(false);

  assert.deepEqual(plainArena(full.arena), expected);
  assert.deepEqual(plainArena(frame.arena), expected);
  const decoded = engine.decodeOwner(full.owner, engine.constants.cells);
  assert.ok(decoded);
  assert.equal(decoded.length, engine.constants.width * engine.constants.height);

  const sanitized = engine.sanitizeState(full, true);
  assert.ok(sanitized);
  assert.deepEqual(plainArena(sanitized.state.arena), expected);
});

test("legacy snapshots without arena metadata safely use the original full arena", () => {
  const { engine } = loadTerritory();
  const legacy = engine.freshState();
  legacy.phase = "playing";
  legacy.matchId = "legacy";
  legacy.players = [engine.makePlayer(0, "legacy", false, 1)];
  legacy.owner = engine.encodeOwner(new Int8Array(engine.constants.cells).fill(-1));
  delete legacy.arena;

  const parsed = engine.sanitizeState(legacy, true);

  assert.ok(parsed);
  assert.deepEqual(dimensions(plainArena(parsed.state.arena)), [70, 106]);
});

test("same-match full and frame updates cannot resize an arena already in progress", () => {
  const { engine } = loadTerritory();
  const state = arenaFixture(engine, 4);
  state.rev = 4;
  state.frameSeq = 10;
  state.ownerRev = 2;
  engine.setApi(guestApi());
  engine.setAuthoritativeHost("host");
  const locked = plainArena(engine.activeArena());

  const frame = engine.snapshot(false);
  frame.frameSeq = 11;
  frame.arena = engine.arenaForPlayerCount(8);
  frame.players[0].x = 5;
  frame.players[0].y = 5;
  frame.players[0].spawnX = 5;
  frame.players[0].spawnY = 5;
  frame.players[0].trail = [5 * engine.constants.width + 5];
  engine.applyFrame(frame, "host");
  assert.deepEqual(plainArena(engine.activeArena()), locked);
  const movement = engine.arenaMovementBounds();
  for (const player of engine.getState().players) {
    assert.ok(player.x >= movement.left && player.x <= movement.right);
    assert.ok(player.y >= movement.top && player.y <= movement.bottom);
    assert.ok(engine.isPlayableCell(Math.floor(player.spawnX), Math.floor(player.spawnY)));
    assert.ok(player.trail.every((key) =>
      engine.isPlayableCell(key % engine.constants.width, Math.floor(key / engine.constants.width))
    ));
  }

  const full = engine.snapshot(true);
  full.frameSeq = 12;
  full.arena = engine.arenaForPlayerCount(8);
  const mismatchedOwner = new Int8Array(engine.constants.cells);
  mismatchedOwner.fill(-1);
  mismatchedOwner[5 * engine.constants.width + 5] = 0;
  full.owner = engine.encodeOwner(mismatchedOwner);
  engine.applyFull(full, "host");
  assert.deepEqual(plainArena(engine.activeArena()), locked);
  assert.equal(engine.getOwner()[5 * engine.constants.width + 5], -1);
});

test("changing the live player list does not resize the current match", () => {
  const { engine } = loadTerritory();
  const state = arenaFixture(engine, 4);
  const locked = plainArena(engine.activeArena());

  state.players.pop();
  state.players[0].retired = true;
  state.players[1].away = true;

  assert.deepEqual(plainArena(engine.activeArena()), locked);
  assert.equal(engine.playableCellCount(), 50 * 76);
});

test("the percentage denominator is the current arena and outside cells stay non-capturable", () => {
  const { engine } = loadTerritory();
  arenaFixture(engine, 4);
  const width = engine.constants.width;
  const height = engine.constants.height;
  const owner = engine.getOwner();
  owner.fill(0);

  engine.captureInto(owner, [], 0);

  let playable = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = owner[y * width + x];
      if (engine.isPlayableCell(x, y)) {
        playable++;
        assert.equal(id, 0);
      } else {
        assert.equal(id, -1);
      }
    }
  }
  assert.equal(playable, 50 * 76);
  assert.equal(engine.playableCellCount(), playable);
  assert.equal(engine.rankRows()[0].area, 100);
});

test("capture flood-fill closes land only inside the smaller arena", () => {
  const { engine } = loadTerritory();
  arenaFixture(engine, 2);
  const arena = plainArena(engine.activeArena());
  const width = engine.constants.width;
  const map = new Int8Array(engine.constants.cells);
  map.fill(-1);
  const x0 = arena.minX + 4;
  const y0 = arena.minY + 4;
  const x1 = x0 + 4;
  const y1 = y0 + 4;
  const trail = [];
  for (let x = x0; x <= x1; x++) {
    trail.push(y0 * width + x, y1 * width + x);
  }
  for (let y = y0 + 1; y < y1; y++) {
    trail.push(y * width + x0, y * width + x1);
  }

  assert.equal(engine.captureInto(map, trail, 0), 25);
  assert.equal(map[(y0 + 2) * width + x0 + 2], 0);
  assert.equal(map[(arena.minY - 1) * width + arena.minX], -1);
});

test("initial spawns and every respawn mode keep the complete base inside the active arena", () => {
  const { engine } = loadTerritory();
  const radius = engine.constants.baseRadius;

  function assertBaseInside(spawn, arena, label) {
    assert.ok(spawn, `${label} exists`);
    for (let y = Math.floor(spawn.y) - radius; y <= Math.floor(spawn.y) + radius; y++) {
      for (let x = Math.floor(spawn.x) - radius; x <= Math.floor(spawn.x) + radius; x++) {
        if ((x - Math.floor(spawn.x)) ** 2 + (y - Math.floor(spawn.y)) ** 2 <= radius ** 2) {
          assert.ok(
            x >= arena.minX && x < arena.maxX && y >= arena.minY && y < arena.maxY,
            `${label} base cell ${x},${y} is inside`
          );
        }
      }
    }
  }

  for (let count = 2; count <= engine.constants.maxPlayers; count++) {
    arenaFixture(engine, count);
    const arena = plainArena(engine.activeArena());
    for (let seed = 1; seed <= 12; seed++) {
      const initial = engine.allocateInitialSpawns(count, seededRandom(seed));
      assert.equal(initial.length, count);
      initial.forEach((spawn, index) => assertBaseInside(spawn, arena, `${count}p seed ${seed} initial ${index}`));
      for (let first = 0; first < initial.length; first++) {
        for (let second = first + 1; second < initial.length; second++) {
          const distance = Math.hypot(
            initial[first].x - initial[second].x,
            initial[first].y - initial[second].y
          );
          assert.ok(
            distance >= engine.constants.initialSpawnMinDistance,
            `${count}p seed ${seed}: ${first}/${second} are ${distance.toFixed(2)} cells apart`
          );
        }
      }
    }
  }

  const state = arenaFixture(engine, 2);
  const arena = plainArena(engine.activeArena());
  const initial = engine.allocateInitialSpawns(2, seededRandom(17));
  const respawning = state.players[0];
  const other = state.players[1];
  engine.applyPlayerSpawn(other, initial[1]);
  for (let seed = 1; seed <= 12; seed++) {
    assertBaseInside(engine.findRespawnSpot(respawning, seededRandom(seed)), arena, `respawn ${seed}`);
    assertBaseInside(engine.findEmergencyRespawnSpot(respawning, seededRandom(seed + 30)), arena, `emergency ${seed}`);
  }
});

test("authoritative and predicted movement clamp and slide on the dynamic wall", () => {
  const { engine } = loadTerritory(() => 0.99);
  const state = arenaFixture(engine, 2);
  const bounds = engine.arenaMovementBounds();
  const player = state.players[0];
  const startY = (bounds.top + bounds.bottom) / 2;
  const diagonalUpLeft = -Math.PI * 3 / 4;

  player.x = bounds.left + 0.01;
  player.y = startY;
  player.spawnX = player.x;
  player.spawnY = player.y;
  player.angle = diagonalUpLeft;
  player.targetAngle = diagonalUpLeft;
  player.dir = "left";
  player.lastCell = Math.floor(player.y) * engine.constants.width + Math.floor(player.x);
  engine.advancePlayer(player, 0.25, 100000);

  assert.ok(player.x >= bounds.left, "authoritative x stays inside the smaller wall");
  assert.ok(player.x <= bounds.left + 0.02, "authoritative x clamps at that wall");
  assert.ok(player.y < startY - 1, "authoritative motion slides along the wall");
  assert.equal(player.deadUntil, 0);

  const predictedStartY = startY + 5;
  const predicted = engine.predictedPlayerPose({
    x: bounds.left + 0.01,
    y: predictedStartY,
    angle: diagonalUpLeft,
    targetAngle: diagonalUpLeft,
    dir: "left",
    deadUntil: 0,
    retired: false,
    away: false
  }, 250);

  assert.ok(predicted.x >= bounds.left, "guest prediction stays inside the smaller wall");
  assert.ok(predicted.x <= bounds.left + 0.02, "guest prediction clamps at that wall");
  assert.ok(predicted.y < predictedStartY - 1, "guest prediction slides along the wall");
});

test("bots near a dynamic wall steer toward the dynamic arena center", () => {
  const { engine } = loadTerritory(() => 0.99);
  const state = arenaFixture(engine, 2);
  const bounds = engine.arenaMovementBounds();
  const player = state.players[0];
  player.bot = true;
  player.x = bounds.left + 1;
  player.y = (bounds.top + bounds.bottom) / 2;
  player.angle = Math.PI;
  player.targetAngle = Math.PI;
  player.dir = "left";
  player.decisionAt = 0;

  engine.chooseBotDirection(player, 100000);

  assert.ok(Math.cos(player.targetAngle) > 0.99, "bot turns right toward the active center");
  assert.ok(Math.abs(Math.sin(player.targetAngle)) < 0.01);
});
