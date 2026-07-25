"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "territory-rush.js"), "utf8");

function fakeClock(startAt = 2000) {
  let now = startAt;
  let nextTimerId = 1;
  const timers = new Map();

  function setTimeoutFake(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, {
      callback,
      at: now + Math.max(0, Number(delay) || 0)
    });
    return id;
  }

  function clearTimeoutFake(id) {
    timers.delete(id);
  }

  function advance(ms) {
    const end = now + Math.max(0, Number(ms) || 0);
    while (true) {
      let selectedId = 0;
      let selected = null;
      for (const [id, timer] of timers) {
        if (timer.at > end) continue;
        if (!selected || timer.at < selected.at || (timer.at === selected.at && id < selectedId)) {
          selectedId = id;
          selected = timer;
        }
      }
      if (!selected) break;
      now = selected.at;
      timers.delete(selectedId);
      selected.callback();
    }
    now = end;
  }

  return {
    now() { return now; },
    set(value) { now = Number(value); },
    advance,
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake
  };
}

function loadEngine(startAt = 2000) {
  const clock = fakeClock(startAt);
  const windowObject = { __TERRITORY_RUSH_TEST__: true };
  vm.runInNewContext(source, {
    window: windowObject,
    console,
    Date: { now: clock.now },
    Math,
    Promise,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  }, { filename: "territory-rush.js" });
  return {
    engine: windowObject.TerritoryRush._test,
    clock
  };
}

function fakeGuestApi() {
  const sent = [];
  return {
    sent,
    api: {
      me() {
        return { nick: "guest", clientSessionId: "guest-session" };
      },
      roster() {
        return [
          { nick: "host", clientSessionId: "host-session", presenceSessionIds: ["host-session"] },
          { nick: "guest", clientSessionId: "guest-session", presenceSessionIds: ["guest-session"] }
        ];
      },
      isHost() { return false; },
      host() { return "host"; },
      hostSessionId() { return "host-session"; },
      isNet() { return true; },
      isConnected() { return true; },
      setHostEligible() {},
      syncHostInputs() {},
      roomChanged() {},
      toast() {},
      playWarning() {},
      send(message) { sent.push(message); },
      sendWithResult(message) {
        sent.push(message);
        return Promise.resolve({ ok: true, status: "ok" });
      },
      sendHostInputWithResult() {
        return Promise.resolve({ ok: true, status: "ok" });
      }
    }
  };
}

function installGuestMatch(engine, matchId) {
  const fixture = fakeGuestApi();
  engine.setApi(fixture.api);
  engine.setAuthoritativeHost("host");

  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = matchId;
  state.rev = 4;
  state.frameSeq = 12;
  state.ownerRev = 3;
  state.startAt = 500;
  state.deadline = 90500;
  state.arena = engine.arenaForPlayerCount(1);

  const player = engine.makePlayer(0, "guest", false, 1);
  player.x = 30;
  player.y = 42;
  player.angle = 0;
  player.targetAngle = 0;
  player.dir = "right";
  player.inputAck = 0;
  state.players = [player];

  engine.setState(state);
  engine.resetGrid();
  return { fixture, state, player };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertPointClose(actual, expected, message) {
  assert.ok(actual, `${message}: point is missing`);
  assert.ok(
    Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-9,
    `${message}: expected (${expected.x}, ${expected.y}), got (${actual.x}, ${actual.y})`
  );
}

function hasSegment(points, predicate) {
  for (let index = 1; index < points.length; index++) {
    const dx = points[index].x - points[index - 1].x;
    const dy = points[index].y - points[index - 1].y;
    if (predicate(dx, dy)) return true;
  }
  return false;
}

function attachAuthoritativeTrail(engine, player) {
  const width = engine.constants.width;
  player.trail = [
    42 * width + 26,
    42 * width + 30
  ];
  player.lastCell = player.trail[player.trail.length - 1];
  player.path = engine.encodeVisualTrail([
    { x: 26, y: 42 },
    { x: 30, y: 42 }
  ]);
}

test("two unacknowledged turns produce a curved local prediction polyline", () => {
  const { engine } = loadEngine(1750);
  const { state, player } = installGuestMatch(engine, "predicted-two-turns");
  engine.setLastAuthoritativeAt(1000);
  engine.setLocalInputHistory([
    { id: 1, seq: 1, at: 1200, angle: Math.PI / 2, matchId: state.matchId },
    { id: 2, seq: 2, at: 1450, angle: Math.PI, matchId: state.matchId }
  ]);

  const replay = engine.replayLocalPrediction(player, 1750, true);
  const points = plain(replay.points);

  assert.ok(replay && replay.pose, "prediction returns a final pose");
  assert.ok(points.length >= 6, "prediction keeps enough samples to render both turns");
  assertPointClose(points[0], player, "polyline starts at the authoritative pose");
  assertPointClose(points.at(-1), replay.pose, "polyline ends at the predicted pose");
  assert.ok(
    hasSegment(points, (dx, dy) => dx > 0.25 && Math.abs(dy) < 0.05),
    "the acknowledged heading is replayed before the first turn"
  );
  assert.ok(
    hasSegment(points, (dx, dy) => dy > 0.25 && Math.abs(dx) < 0.05),
    "the first input creates a downward section"
  );
  assert.ok(
    hasSegment(points, (dx, dy) => dx < -0.25 && Math.abs(dy) < 0.05),
    "the second input creates a leftward section"
  );
  assert.ok(
    replay.pose.x < Math.max(...points.map((point) => point.x)) - 0.25,
    "the final section bends back from the first turn's furthest x position"
  );
});

test("predicted trail composition never mutates the authoritative visual cache", () => {
  const { engine } = loadEngine(1650);
  const { state, player } = installGuestMatch(engine, "prediction-cache-immutable");
  attachAuthoritativeTrail(engine, player);
  engine.setLastAuthoritativeAt(1000);
  engine.setLocalInputHistory([
    { id: 1, seq: 1, at: 1200, angle: Math.PI / 2, matchId: state.matchId },
    { id: 2, seq: 2, at: 1400, angle: Math.PI, matchId: state.matchId }
  ]);

  const cache = engine.syncVisualTrail(player);
  const authoritativeArray = cache.points;
  const authoritativeBefore = plain(cache.points);
  const networkPathBefore = Array.from(player.path);
  const predicted = engine.replayLocalPrediction(player, 1650, true);
  const composed = engine.localPredictedTrailPoints(player, predicted.pose, 1650);

  assert.notEqual(composed, authoritativeArray, "render composition uses its own point array");
  assert.ok(composed.length > authoritativeBefore.length, "the render-only result includes a predicted tail");
  assertPointClose(composed.at(-1), predicted.pose, "render-only tail follows the local visual endpoint");
  assert.equal(cache.points, authoritativeArray, "the authoritative cache array is retained");
  assert.deepEqual(plain(cache.points), authoritativeBefore);
  assert.deepEqual(Array.from(player.path), networkPathBefore);
});

test("a compressed 241-point U trail remaps its cursor by source order", () => {
  const { engine } = loadEngine();
  const oldPoints = [];
  for (let index = 0; index <= 80; index++) {
    oldPoints.push({ x: 24, y: 36 + index * 0.3 });
  }
  for (let index = 1; index <= 80; index++) {
    oldPoints.push({ x: 24 + index * 0.3, y: 60 });
  }
  for (let index = 1; index <= 80; index++) {
    oldPoints.push({ x: 48, y: 60 - index * 0.3 });
  }

  const compactPoints = engine.simplifyTrailPoints(oldPoints, 0.01);
  assert.equal(oldPoints.length, 241);
  assert.ok(oldPoints.length > engine.constants.maxVisualTrailPoints);
  assert.equal(compactPoints.length, 4);
  assert.equal(compactPoints[0], oldPoints[0]);
  assert.equal(compactPoints[1], oldPoints[80]);
  assert.equal(compactPoints[2], oldPoints[160]);
  assert.equal(compactPoints[3], oldPoints[240]);

  const mapped = [
    engine.remapVisualTrailCursor(oldPoints, compactPoints, 40),
    engine.remapVisualTrailCursor(oldPoints, compactPoints, 120),
    engine.remapVisualTrailCursor(oldPoints, compactPoints, 220)
  ];

  assert.deepEqual(mapped, [0, 1, 2]);
  assert.ok(mapped[0] <= mapped[1] && mapped[1] <= mapped[2], "cursor progress never rewinds after compaction");
});

test("a visual endpoint behind the authority anchor does not synthesize a backwards tail", () => {
  const { engine } = loadEngine(1450);
  const { state, player } = installGuestMatch(engine, "visual-behind-anchor");
  attachAuthoritativeTrail(engine, player);
  engine.setLastAuthoritativeAt(1000);
  engine.setLocalInputHistory([
    { id: 1, seq: 1, at: 1200, angle: Math.PI / 2, matchId: state.matchId }
  ]);
  engine.syncVisualTrail(player);

  const visual = { x: 28, y: 42, angle: 0 };
  const points = plain(engine.localPredictedTrailPoints(player, visual, 1450));

  assert.ok(points.length >= 2, "the settled authoritative prefix remains visible");
  assertPointClose(points.at(-1), visual, "the fallback ends at the lagging visual endpoint");
  assert.ok(
    points.every((point) => point.x <= visual.x + 1e-9),
    "the path never passes through the authority anchor and then reverses"
  );
  for (let index = 1; index < points.length; index++) {
    assert.ok(points[index].x + 1e-9 >= points[index - 1].x, "fallback prefix keeps forward source order");
    assert.ok(Math.abs(points[index].y - visual.y) < 1e-9, "fallback stays on the settled segment");
  }
});
