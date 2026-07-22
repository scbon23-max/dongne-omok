"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "territory-rush.js"), "utf8");

function loadTerritory() {
  let now = 100000;
  const windowObject = { __TERRITORY_RUSH_TEST__: true };
  const context = vm.createContext({
    window: windowObject,
    console,
    Date: { now() { return now; } },
    Math,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(source, context, { filename: "territory-rush.js" });
  return {
    controller: windowObject.TerritoryRush,
    engine: windowObject.TerritoryRush._test,
    advance(ms = 100) { now += ms; }
  };
}

function transport(nick, sessionId, lane, seq) {
  return {
    v: 1,
    senderNick: nick,
    sessionId,
    lane,
    seq,
    sentAt: 100000,
    roomId: "room-network-test"
  };
}

function hostFixture(phase = "playing") {
  const loaded = loadTerritory();
  const { controller, engine } = loaded;
  const sent = [];
  const people = [
    {
      nick: "host",
      joinTs: 1,
      clientSessionId: "host-primary",
      presenceSessionIds: ["host-primary"]
    },
    {
      nick: "guest",
      joinTs: 2,
      clientSessionId: "guest-primary",
      presenceSessionIds: ["guest-primary", "guest-secondary"],
      presenceCount: 2
    }
  ];
  const api = {
    me() { return { nick: "host", clientSessionId: "host-primary" }; },
    roster() { return people.slice(); },
    isHost() { return true; },
    host() { return "host"; },
    hostSessionId() { return "host-primary"; },
    isNet() { return true; },
    isConnected() { return true; },
    send(message) { sent.push(message); },
    setHostEligible() {},
    syncHostInputs() {},
    roomChanged() {},
    toast() {},
    playWarning() {}
  };
  const state = engine.freshState();
  state.phase = phase;
  state.matchId = "network-session-test";
  state.deadline = 200000;
  state.players = [
    engine.makePlayer(0, "host", false, 2),
    engine.makePlayer(1, "guest", false, 2)
  ];
  engine.setApi(api);
  engine.setState(state);
  engine.resetGrid();
  return { ...loaded, sent, people, state, guest: state.players[1] };
}

function inputMessage(seq, angle, matchId = "network-session-test") {
  return {
    t: "tr_input",
    by: "guest",
    nick: "guest",
    matchId,
    seq,
    angle
  };
}

test("a secondary tab cannot send input or reset the primary tab with hello", () => {
  const fixture = hostFixture("playing");
  const { controller, engine, guest } = fixture;
  guest.inputAck = 280;

  controller.onMessage(
    { t: "tr_hello", by: "guest" },
    transport("guest", "guest-primary", "room", 1)
  );
  const firstAngle = engine.normalizeAngle(guest.targetAngle + 0.7);
  controller.onMessage(
    inputMessage(281, firstAngle),
    transport("guest", "guest-primary", "direct", 1)
  );
  assert.equal(guest.inputAck, 281);
  assert.ok(Math.abs(engine.angleDelta(guest.targetAngle, firstAngle)) < 1e-9);

  fixture.advance();
  controller.onMessage(
    { t: "tr_hello", by: "guest" },
    transport("guest", "guest-secondary", "room", 1)
  );
  const secondaryAngle = engine.normalizeAngle(firstAngle + 0.7);
  controller.onMessage(
    inputMessage(1, secondaryAngle),
    transport("guest", "guest-secondary", "direct", 1)
  );
  assert.equal(guest.inputAck, 281);
  assert.ok(Math.abs(engine.angleDelta(guest.targetAngle, firstAngle)) < 1e-9);

  fixture.advance();
  const nextPrimaryAngle = engine.normalizeAngle(firstAngle + 1.4);
  controller.onMessage(
    inputMessage(282, nextPrimaryAngle),
    transport("guest", "guest-primary", "direct", 2)
  );
  assert.equal(guest.inputAck, 282);
  assert.ok(Math.abs(engine.angleDelta(guest.targetAngle, nextPrimaryAngle)) < 1e-9);
});

test("a secondary tab cannot change ready or participant role state", () => {
  const fixture = hostFixture("idle");
  const { controller, state } = fixture;

  controller.onMessage(
    { t: "tr_ready_req", by: "guest", nick: "guest", ready: true },
    transport("guest", "guest-secondary", "room", 1)
  );
  controller.onMessage(
    { t: "tr_role_req", by: "guest", nick: "guest", spectator: true },
    transport("guest", "guest-secondary", "room", 2)
  );
  assert.deepEqual(Array.from(state.ready), []);
  assert.deepEqual(Array.from(state.spectators), []);

  controller.onMessage(
    { t: "tr_ready_req", by: "guest", nick: "guest", ready: true },
    transport("guest", "guest-primary", "room", 1)
  );
  assert.deepEqual(Array.from(state.ready), ["guest"]);

  controller.onMessage(
    { t: "tr_role_req", by: "guest", nick: "guest", spectator: true },
    transport("guest", "guest-primary", "room", 2)
  );
  assert.deepEqual(Array.from(state.ready), []);
  assert.deepEqual(Array.from(state.spectators), ["guest"]);
});

test("hello from the same primary session preserves a high application input sequence", () => {
  const fixture = hostFixture("playing");
  const { controller, engine, guest } = fixture;
  guest.inputAck = 280;

  controller.onMessage(
    { t: "tr_hello", by: "guest" },
    transport("guest", "guest-primary", "room", 1)
  );
  const firstAngle = engine.normalizeAngle(guest.targetAngle + 0.7);
  controller.onMessage(
    inputMessage(281, firstAngle),
    transport("guest", "guest-primary", "direct", 1)
  );
  assert.equal(guest.inputAck, 281);

  fixture.advance();
  controller.onMessage(
    { t: "tr_hello", by: "guest" },
    transport("guest", "guest-primary", "room", 2)
  );
  const secondAngle = engine.normalizeAngle(firstAngle + 0.7);
  controller.onMessage(
    inputMessage(282, secondAngle),
    transport("guest", "guest-primary", "direct", 2)
  );
  assert.equal(guest.inputAck, 282);
  assert.ok(Math.abs(engine.angleDelta(guest.targetAngle, secondAngle)) < 1e-9);
});

test("a promoted replacement session takes over cleanly from application sequence one", () => {
  const fixture = hostFixture("playing");
  const { controller, engine, guest, people } = fixture;
  guest.inputAck = 40;

  controller.onMessage(
    { t: "tr_hello", by: "guest" },
    transport("guest", "guest-primary", "room", 1)
  );
  const primaryAngle = engine.normalizeAngle(guest.targetAngle + 0.7);
  controller.onMessage(
    inputMessage(41, primaryAngle),
    transport("guest", "guest-primary", "direct", 1)
  );
  assert.equal(guest.inputAck, 41);

  people[1].clientSessionId = "guest-secondary";
  people[1].presenceSessionIds = ["guest-secondary"];
  people[1].presenceCount = 1;
  fixture.advance();
  controller.onMessage(
    { t: "tr_hello", by: "guest" },
    transport("guest", "guest-secondary", "room", 1)
  );
  const replacementAngle = engine.normalizeAngle(primaryAngle + 0.7);
  controller.onMessage(
    inputMessage(1, replacementAngle),
    transport("guest", "guest-secondary", "direct", 1)
  );

  assert.equal(guest.inputAck, 1);
  assert.ok(Math.abs(engine.angleDelta(guest.targetAngle, replacementAngle)) < 1e-9);
});

test("guest countdowns use the authoritative host clock instead of the device clock", () => {
  const fixture = loadTerritory();
  fixture.engine.setApi({ isHost() { return false; } });

  fixture.engine.syncAuthorityClock({ sessionId: "host-primary", sentAt: 25000 });
  assert.equal(fixture.engine.gameNow(), 25000);

  fixture.advance(400);
  assert.equal(fixture.engine.gameNow(), 25400);
});
