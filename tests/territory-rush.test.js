"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "territory-rush.js"), "utf8");
const windowObject = { __TERRITORY_RUSH_TEST__: true };
const context = vm.createContext({ window: windowObject, console, Date, Math, setTimeout, clearTimeout });
vm.runInContext(source, context, { filename: "territory-rush.js" });

const controller = windowObject.TerritoryRush;
const engine = controller._test;

function fakeApi(nicks) {
  const sent = [];
  const people = nicks.map((nick, index) => ({ nick, joinTs: index + 1 }));
  const fixture = {
    sent,
    people,
    eligible: [],
    hostMode: true,
    connected: true,
    hostNick: nicks[0]
  };
  fixture.api = {
      me() { return { nick: nicks[0], isAdmin: true }; },
      roster() { return fixture.people.slice(); },
      isHost() { return fixture.hostMode; },
      host() { return fixture.hostNick; },
      isConnected() { return fixture.connected; },
      send(message) { sent.push(message); },
      setHostEligible(value) { fixture.eligible.push(value); },
      roomChanged() {},
      toast() {},
      playWarning() {}
  };
  return fixture;
}

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

test("runtime constants keep realtime traffic below the room broadcast cap", () => {
  assert.equal(engine.constants.stepMs, 50);
  assert.equal(engine.constants.frameMs, 250);
  assert.equal(engine.constants.maxPlayers, 8);
  assert.ok(engine.constants.maxTrail <= 360);
  assert.equal(engine.constants.cells, 72 * 108);
  assert.match(source, /t: "tr_input"/);
  assert.match(source, /t: "tr_frame"/);
  assert.match(source, /t: "tr_sync_req"/);
  assert.match(source, /now - lastInputAt < 90/);
  assert.doesNotMatch(source, /setInterval\([^,]+,\s*(?:1\d\d|[1-9]\d)\)/);
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

  assert.ok(Buffer.byteLength(JSON.stringify(engine.snapshot(false))) < 100000);
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

test("a reconnect hello resets the host input sequence even when a full reply is throttled", () => {
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
  assert.equal(engine.applyDirection(remote, "up", 1), true);
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
