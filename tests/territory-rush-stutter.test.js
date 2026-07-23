"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "territory-rush.js"), "utf8");

function fakeClock(startAt = 100000) {
  let now = startAt;
  let nextId = 1;
  const timers = new Map();

  function setTimeoutFake(callback, delay) {
    const id = nextId++;
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
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    advance,
    pendingCount() { return timers.size; }
  };
}

function loadTerritory(startAt = 100000) {
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
    controller: windowObject.TerritoryRush,
    engine: windowObject.TerritoryRush._test,
    clock
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function guestApi(sent, options = {}) {
  return {
    me() { return { nick: options.nick || "guest", clientSessionId: "guest-session" }; },
    roster() {
      return [
        { nick: "host", clientSessionId: "host-session", presenceSessionIds: ["host-session"] },
        { nick: options.nick || "guest", clientSessionId: "guest-session", presenceSessionIds: ["guest-session"] }
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
    send(message) { sent.push({ lane: "room", message }); },
    sendWithResult(message) {
      sent.push({ lane: "room-result", message });
      return Promise.resolve({ ok: true, status: "ok" });
    },
    sendHostInputWithResult(message) {
      if (options.direct) options.direct.push(message);
      return options.directResult || new Promise(() => {});
    }
  };
}

function makePlayingState(engine, count = 4, matchId = "stutter-match") {
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = matchId;
  state.rev = 3;
  state.frameSeq = 10;
  state.ownerRev = 2;
  state.startAt = 90000;
  state.deadline = 190000;
  state.arena = engine.arenaForPlayerCount(count);
  state.players = Array.from({ length: count }, (_, index) =>
    engine.makePlayer(index, index ? `player-${index}` : "guest", false, count)
  );
  return state;
}

function trailKeys(engine, count, yOffset = 8) {
  const arena = engine.activeArena();
  const width = engine.constants.width;
  const usableWidth = arena.maxX - arena.minX - 2;
  return Array.from({ length: count }, (_, index) => {
    const x = arena.minX + 1 + index % usableWidth;
    const y = arena.minY + yOffset + Math.floor(index / usableWidth);
    return y * width + x;
  });
}

function frameFor(engine, state, players) {
  return {
    frameV: 1,
    phase: state.phase,
    rev: state.rev,
    frameSeq: state.frameSeq + 1,
    ownerRev: state.ownerRev,
    matchId: state.matchId,
    startAt: state.startAt,
    deadline: state.deadline,
    arena: plain(state.arena),
    players
  };
}

test("a four-player maximum-trail pose frame stays below two kilobytes", () => {
  const { engine } = loadTerritory();
  const state = makePlayingState(engine, 4);
  engine.setState(state);
  const maxTrail = trailKeys(engine, engine.constants.maxTrail);
  state.players.forEach((player, index) => {
    player.trail = maxTrail.map((key) => key + index);
    player.path = Array.from({ length: engine.constants.maxVisualTrailPoints * 2 }, (_, value) => value);
  });

  const frame = {
    t: "tr_frame",
    by: "host",
    state: engine.frameSnapshot()
  };
  const bytes = Buffer.byteLength(JSON.stringify(frame), "utf8");

  assert.ok(bytes < 2048, `pose frame is ${bytes} bytes`);
  assert.equal(frame.state.players.length, 4);
  frame.state.players.forEach((player) => {
    assert.equal(player.trailTail.length, engine.constants.frameTrailTail);
    assert.equal(player.trailLength, engine.constants.maxTrail);
    assert.equal("trail" in player, false);
    assert.equal("path" in player, false);
  });

  const longNick = "\uac00".repeat(20);
  state.matchId = "m".repeat(80);
  state.players.forEach((player) => {
    player.deadUntil = 9999999999999;
    player.deathSeq = 9999;
    player.deathReason = "cut";
    player.deathBy = longNick;
    player.inputAck = 9999;
    player.kills = 999;
    player.retired = true;
    player.away = true;
  });
  const worstCaseBytes = Buffer.byteLength(JSON.stringify({
    t: "tr_frame",
    by: longNick,
    state: engine.frameSnapshot()
  }), "utf8");
  assert.ok(worstCaseBytes < 2048, `worst-case pose frame is ${worstCaseBytes} bytes`);
});

test("pose-frame merge preserves full static state and appends a valid trail tail delta", () => {
  const { engine } = loadTerritory();
  const sent = [];
  engine.setApi(guestApi(sent));
  engine.setAuthoritativeHost("host");
  const state = makePlayingState(engine, 1);
  const player = state.players[0];
  player.bot = true;
  player.path = [100, 200, 300, 400];
  player.respawnGiveUpAt = 177777;
  player.decisionAt = 1234;
  player.turnBackAt = 29;
  engine.setState(state);
  player.trail = trailKeys(engine, 20);

  const extended = trailKeys(engine, 22);
  const pose = engine.compactFramePlayer(player);
  pose.x += 2;
  pose.trailLength = extended.length;
  pose.trailTail = extended.slice(-engine.constants.frameTrailTail);
  const frame = frameFor(engine, state, [pose]);

  assert.equal(engine.applyFrame(frame, "host"), true);
  const merged = engine.getState().players[0];
  assert.deepEqual(Array.from(merged.trail), extended);
  assert.equal(merged.bot, true);
  assert.deepEqual(Array.from(merged.path), [100, 200, 300, 400]);
  assert.equal(merged.respawnGiveUpAt, 177777);
  assert.equal(merged.decisionAt, 1234);
  assert.equal(merged.turnBackAt, 29);
  assert.equal(merged.x, pose.x);
  assert.equal(sent.some(({ message }) => message.t === "tr_sync_req"), false);
});

test("a tail window recovers one lost frame while an out-of-window gap requests a full sync", () => {
  const { engine } = loadTerritory();
  const state = makePlayingState(engine, 1);
  engine.setState(state);
  const authoritative = trailKeys(engine, 48);
  const current = authoritative.slice(0, 10);

  const recovered = engine.mergeFrameTrail(
    current,
    14,
    authoritative.slice(0, 14),
    state.arena
  );
  assert.equal(recovered.gap, false);
  assert.deepEqual(Array.from(recovered.trail), authoritative.slice(0, 14));

  const missing = engine.mergeFrameTrail(
    current,
    40,
    authoritative.slice(40 - engine.constants.frameTrailTail, 40),
    state.arena
  );
  assert.equal(missing.gap, true);
  assert.deepEqual(Array.from(missing.trail), current);

  const sent = [];
  engine.setApi(guestApi(sent));
  engine.setAuthoritativeHost("host");
  state.players[0].trail = current.slice();
  const pose = engine.compactFramePlayer(state.players[0]);
  pose.trailLength = 40;
  pose.trailTail = authoritative.slice(40 - engine.constants.frameTrailTail, 40);

  assert.equal(engine.applyFrame(frameFor(engine, state, [pose]), "host"), true);
  assert.deepEqual(Array.from(engine.getState().players[0].trail), current);
  assert.equal(sent.filter(({ message }) => message.t === "tr_sync_req").length, 1);
});

test("a newer-revision stale full snapshot merges owner data without rewinding player pose", () => {
  const { engine } = loadTerritory();
  const sent = [];
  engine.setApi(guestApi(sent));
  engine.setAuthoritativeHost("host");
  const state = makePlayingState(engine, 1);
  const player = state.players[0];
  player.x = 40;
  player.y = 50;
  player.trail = trailKeys(engine, 12);
  player.path = [400, 500, 600, 700];
  engine.setState(state);
  engine.resetGrid();

  const incomingOwner = new Int8Array(engine.constants.cells);
  incomingOwner.fill(-1);
  const ownerKey = trailKeys(engine, 1, 12)[0];
  incomingOwner[ownerKey] = player.id;
  const stale = engine.snapshot(true);
  stale.rev = state.rev + 5;
  stale.frameSeq = state.frameSeq - 1;
  stale.ownerRev = state.ownerRev + 1;
  stale.players[0].x = 10;
  stale.players[0].y = 12;
  stale.players[0].trail = trailKeys(engine, 2);
  stale.owner = engine.encodeOwner(incomingOwner);

  assert.equal(engine.applyFull(stale, "host"), true);
  const after = engine.getState();
  assert.equal(after.frameSeq, 10);
  assert.equal(after.players[0].x, 40);
  assert.equal(after.players[0].y, 50);
  assert.deepEqual(Array.from(after.players[0].trail), Array.from(player.trail));
  assert.deepEqual(Array.from(after.players[0].path), [400, 500, 600, 700]);
  assert.equal(after.ownerRev, stale.ownerRev);
  assert.equal(after.rev, stale.rev);
  assert.equal(engine.getOwner()[ownerKey], player.id);
});

test("new local input is not applied retroactively to authoritative prediction time", () => {
  const { engine } = loadTerritory(1400);
  const sent = [];
  engine.setApi(guestApi(sent));
  const state = makePlayingState(engine, 1);
  const player = state.players[0];
  player.x = 20;
  player.y = 30;
  player.angle = 0;
  player.targetAngle = 0;
  player.dir = "right";
  state.startAt = 1000;
  engine.setState(state);
  engine.setLastAuthoritativeAt(1000);
  engine.setLocalInputHistory([{
    id: 1,
    seq: 0,
    at: 1300,
    angle: Math.PI / 2,
    matchId: state.matchId
  }]);

  const beforeInput = engine.predictedPlayerPose(player, 300, 0);
  const expected = engine.predictedPlayerPose(beforeInput, 100, Math.PI / 2);
  const retroactive = engine.predictedPlayerPose(player, 400, Math.PI / 2);
  const actual = engine.visualTargetFor(player, 1400);

  assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
  assert.ok(Math.abs(engine.angleDelta(actual.angle, expected.angle)) < 1e-9);
  assert.ok(Math.hypot(actual.x - retroactive.x, actual.y - retroactive.y) > 1);
});

test("continuous local input cannot starve the room fallback timer", () => {
  const { engine, clock } = loadTerritory(100000);
  const sent = [];
  const direct = [];
  engine.setApi(guestApi(sent, { direct }));
  const state = makePlayingState(engine, 1);
  state.players[0].targetAngle = 0;
  state.players[0].angle = 0;
  engine.setState(state);
  engine.setActive(true);

  assert.equal(engine.requestDirection(0.2), true);
  assert.equal(direct.length, 1);
  const firstFallbackDue = clock.now() + engine.constants.inputAckRetryMs;

  for (let step = 1; step <= 4; step++) {
    clock.advance(100);
    assert.equal(engine.requestDirection(0.2 + step * 0.2), true);
  }
  clock.advance(firstFallbackDue - clock.now());

  const fallback = sent.filter(({ lane, message }) =>
    lane === "room-result" && message.t === "tr_input"
  );
  assert.ok(fallback.length >= 1, "room fallback fired while new inputs kept arriving");
  assert.equal(clock.now(), firstFallbackDue);
  assert.ok(engine.getUnackedInput());
});

test("an unready direct channel immediately falls back to the room channel", async () => {
  const { engine } = loadTerritory();
  const sent = [];
  const direct = [];
  engine.setApi(guestApi(sent, {
    direct,
    directResult: Promise.resolve({ ok: false, status: "queued" })
  }));
  const state = makePlayingState(engine, 1);
  engine.setState(state);
  engine.setActive(true);

  assert.equal(engine.requestDirection(0.4), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(direct.length, 1);
  const fallback = sent.filter(({ lane, message }) =>
    lane === "room-result" && message.t === "tr_input"
  );
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].message.seq, direct[0].seq);
});

test("a rejected acknowledged input can be requested again after authority correction", () => {
  const { engine } = loadTerritory();
  const sent = [];
  const direct = [];
  engine.setApi(guestApi(sent, { direct }));
  engine.setAuthoritativeHost("host");
  const state = makePlayingState(engine, 1);
  state.players[0].angle = 0;
  state.players[0].targetAngle = 0;
  state.players[0].dir = "right";
  engine.setState(state);
  engine.setActive(true);

  assert.equal(engine.requestDirection(0.4), true);
  assert.equal(direct.length, 1);
  const pose = engine.compactFramePlayer(state.players[0]);
  pose.angle = 0;
  pose.targetAngle = 0;
  pose.dir = "right";
  pose.inputAck = direct[0].seq;
  assert.equal(engine.applyFrame(frameFor(engine, state, [pose]), "host"), true);

  assert.equal(engine.requestDirection(0.4), true);
});

test("the lightweight applyFrame path never invokes full-screen render work", () => {
  const body = source.match(
    /function applyFrame\(raw, sourceHost\) \{([\s\S]*?)\n  \}\n\n  function applyDirection/
  );
  assert.ok(body, "applyFrame source found");
  assert.doesNotMatch(body[1], /\brender\(\)/);
  assert.doesNotMatch(body[1], /\brenderRoles\(\)/);
  assert.doesNotMatch(body[1], /\brenderFinished\(\)/);
  assert.match(body[1], /lightFrame[\s\S]*sanitizeFrameSnapshot/);
});

test("slow frame delivery coalesces intermediate poses and keeps the newest one", async () => {
  const { engine } = loadTerritory();
  const sent = [];
  const pending = [];
  engine.setApi({
    me() { return { nick: "host", clientSessionId: "host-session" }; },
    isHost() { return true; },
    isNet() { return true; },
    send() {},
    sendWithResult(message) {
      sent.push(message);
      return new Promise((resolve) => pending.push(resolve));
    }
  });
  const state = makePlayingState(engine, 1);
  state.players[0].nick = "host";
  engine.setState(state);
  engine.resetFrameSendQueue();

  engine.broadcastFrame(1000);
  state.players[0].x += 1;
  engine.broadcastFrame(1200);
  state.players[0].x += 1;
  engine.broadcastFrame(1400);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].state.frameSeq, 11);
  state.players[0].x += 1;
  pending.shift()({ ok: true, status: "ok" });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sent.length, 2);
  assert.equal(sent[1].state.frameSeq, 13);
  assert.equal(sent[1].state.players[0].x, state.players[0].x);
  pending.shift()({ ok: true, status: "ok" });
  await Promise.resolve();
});

test("host tick catches up four fixed steps and caps a long stall at the same limit", () => {
  const { engine, clock } = loadTerritory(500000);
  const sent = [];
  engine.setApi({
    me() { return { nick: "host", clientSessionId: "host-session" }; },
    roster() {
      return [{
        nick: "host",
        clientSessionId: "host-session",
        presenceSessionIds: ["host-session"]
      }];
    },
    isHost() { return true; },
    host() { return "host"; },
    hostSessionId() { return "host-session"; },
    isNet() { return false; },
    isConnected() { return true; },
    setHostEligible() {},
    syncHostInputs() {},
    roomChanged() {},
    toast() {},
    playWarning() {},
    send(message) { sent.push(message); }
  });

  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "catchup-match";
  state.rev = 1;
  state.startAt = clock.now() - 1000;
  state.deadline = clock.now() + 100000;
  state.arena = engine.arenaForPlayerCount(1);
  const movement = engine.arenaMovementBounds(state.arena);
  const player = engine.makePlayer(0, "host", false, 1);
  player.x = (movement.left + movement.right) / 2;
  player.y = (movement.top + movement.bottom) / 2;
  player.spawnX = player.x;
  player.spawnY = player.y;
  player.dir = "right";
  player.angle = 0;
  player.targetAngle = 0;
  player.lastCell = Math.floor(player.y) * engine.constants.width + Math.floor(player.x);
  state.players = [player];

  engine.setState(state);
  engine.resetGrid();
  engine.setSyncState(0, false, 0, false);
  engine.setActive(true);
  engine.setBroadcastTimes(clock.now(), clock.now());
  engine.resetHostStepClock();

  engine.hostTick();
  const beforeRegularDelay = player.x;
  clock.advance(200);
  engine.hostTick();
  const fourStepDistance = engine.constants.speed
    * engine.constants.stepMs
    * engine.constants.hostMaxCatchupSteps / 1000;
  assert.ok(
    Math.abs(player.x - beforeRegularDelay - fourStepDistance) < 1e-9,
    "a 200ms delay advances exactly four 50ms simulation steps"
  );

  const beforeLongDelay = player.x;
  clock.advance(1000);
  engine.hostTick();
  assert.ok(
    Math.abs(player.x - beforeLongDelay - fourStepDistance) < 1e-9,
    "a 1000ms delay is capped at the configured four catch-up steps"
  );
  assert.ok(sent.some((message) => message.t === "tr_frame"));
});

test("canvas backing-store resize skips identical dimensions and updates changed dimensions once", () => {
  const { engine } = loadTerritory();
  const transforms = [];
  const target = {
    width: 0,
    height: 0,
    dataset: {}
  };
  const context = {
    setTransform(...args) { transforms.push(args); }
  };

  assert.equal(engine.resizeCanvasBackingStore(target, context, 320, 240, 1.5), true);
  assert.equal(target.width, 480);
  assert.equal(target.height, 360);
  assert.equal(target.dataset.logicalWidth, "320");
  assert.equal(target.dataset.logicalHeight, "240");
  assert.deepEqual(transforms, [[1.5, 0, 0, 1.5, 0, 0]]);

  assert.equal(engine.resizeCanvasBackingStore(target, context, 320, 240, 1.5), false);
  assert.equal(transforms.length, 1);

  assert.equal(engine.resizeCanvasBackingStore(target, context, 360, 260, 1.5), true);
  assert.equal(target.width, 540);
  assert.equal(target.height, 390);
  assert.equal(target.dataset.logicalWidth, "360");
  assert.equal(target.dataset.logicalHeight, "260");
  assert.equal(transforms.length, 2);
  assert.deepEqual(transforms[1], [1.5, 0, 0, 1.5, 0, 0]);
});
