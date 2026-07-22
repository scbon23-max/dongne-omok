"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "territory-rush.js"), "utf8");

function loadEngine(startAt = 1000) {
  const clock = { now: startAt };
  const windowObject = { __TERRITORY_RUSH_TEST__: true };
  const fakeDate = { now() { return clock.now; } };
  const context = vm.createContext({ window: windowObject, console, Date: fakeDate, Math, setTimeout, clearTimeout });
  vm.runInContext(source, context, { filename: "territory-rush.js" });
  return { controller: windowObject.TerritoryRush, engine: windowObject.TerritoryRush._test, clock };
}

function apiFixture(hostMode) {
  const sent = [];
  return {
    sent,
    api: {
      me() { return { nick: hostMode ? "host" : "guest" }; },
      roster() { return [{ nick: "host" }, { nick: "guest" }]; },
      isHost() { return hostMode; },
      host() { return "host"; },
      isConnected() { return true; },
      send(message) { sent.push(message); },
      setHostEligible() {},
      roomChanged() {},
      playWarning() {}
    }
  };
}

test("small matches use faster frames while eight players retain the safe ceiling", () => {
  const { engine } = loadEngine();
  assert.deepEqual([1, 4, 5, 6, 7, 8, 10].map(engine.frameIntervalMs), [200, 200, 250, 300, 350, 400, 400]);
  for (let players = 1; players <= engine.constants.maxPlayers; players++) {
    const stateTraffic = 1000 / engine.frameIntervalMs(players) * (engine.constants.maxRoomMembers + 1);
    const inputTraffic = 1000 / engine.constants.inputSendMs * Math.max(0, players - 1) * 2;
    assert.ok(stateTraffic + inputTraffic < 80, `${players} players exceed the realtime safety budget`);
  }
});

test("prediction continues through two missing 400ms frames and then stays bounded", () => {
  const { engine } = loadEngine();
  const player = engine.makePlayer(0, "guest", false, 2);
  player.x = 20;
  player.y = 30;
  player.angle = 0;
  player.targetAngle = 0;

  const at500 = engine.predictedPlayerPose(player, 500, 0);
  const at1200 = engine.predictedPlayerPose(player, 1200, 0);
  const afterLimit = engine.predictedPlayerPose(player, 1800, 0);

  assert.ok(at1200.x > at500.x + engine.constants.speed * 0.69);
  assert.ok(Math.abs(at1200.x - (player.x + engine.constants.speed * 1.2)) < 1e-9);
  assert.deepEqual(afterLimit, at1200);
});

test("large reconciliation errors are corrected without a one-frame teleport", () => {
  const { engine } = loadEngine();
  const dx = 20;
  const dy = 0;
  const frameDelta = 32;
  const blend = 1 - Math.pow(0.76, frameDelta / 32);
  const appliedBlend = engine.visualPositionBlend(dx, dy, blend, frameDelta);
  const correctedDistance = Math.hypot(dx * appliedBlend, dy * appliedBlend);
  const cap = engine.constants.speed * frameDelta / 1000 * engine.constants.visualCatchupSpeedMultiplier;

  assert.ok(correctedDistance > 0);
  assert.ok(correctedDistance <= cap + 1e-9);
  assert.ok(correctedDistance < Math.hypot(dx, dy));
});

test("sender time preserves excess delivery jitter instead of resetting prediction age to zero", () => {
  const { engine, clock } = loadEngine(1000);
  const fixture = apiFixture(false);
  engine.setApi(fixture.api);

  engine.syncAuthorityClock({ sessionId: "host-session", sentAt: 900 });
  assert.equal(engine.authoritativeTimelineAt({ sessionId: "host-session", sentAt: 900 }), 1000);

  clock.now = 1400;
  engine.syncAuthorityClock({ sessionId: "host-session", sentAt: 1000 });
  const timelineAt = engine.authoritativeTimelineAt({ sessionId: "host-session", sentAt: 1000 });
  assert.equal(timelineAt, 1115);
  assert.equal(clock.now - timelineAt, 285);
});

test("a targeted recovery snapshot does not postpone the public frame clock", () => {
  const { engine, clock } = loadEngine(5000);
  const fixture = apiFixture(true);
  engine.setApi(fixture.api);
  engine.setBroadcastTimes(1000, 2000);

  engine.broadcastFull("guest");
  let times = engine.getBroadcastTimes();
  assert.equal(times.frame, 1000);
  assert.equal(times.full, 2000);

  clock.now = 5100;
  engine.broadcastFull();
  times = engine.getBroadcastTimes();
  assert.equal(times.frame, 5100);
  assert.equal(times.full, 5100);
});

test("same-revision stale full snapshots cannot rewind a guest player", () => {
  const { engine } = loadEngine();
  const fixture = apiFixture(false);
  engine.setApi(fixture.api);
  engine.setAuthoritativeHost("host");
  engine.resetGrid();

  const current = engine.freshState();
  current.phase = "playing";
  current.matchId = "jitter-match";
  current.rev = 7;
  current.frameSeq = 12;
  current.players = [engine.makePlayer(0, "guest", false, 2)];
  current.players[0].x = 40;
  engine.setState(current);

  const stale = engine.snapshot(true);
  stale.frameSeq = 11;
  stale.players[0].x = 10;
  assert.equal(engine.applyFull(stale, "host"), false);
  assert.equal(engine.getState().frameSeq, 12);
  assert.equal(engine.getState().players[0].x, 40);

  stale.ownerRev = 1;
  assert.equal(engine.applyFull(stale, "host"), true);
  assert.equal(engine.getState().ownerRev, 1);
  assert.equal(engine.getState().frameSeq, 12);
  assert.equal(engine.getState().players[0].x, 40);
});
