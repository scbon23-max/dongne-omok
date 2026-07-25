"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "territory-rush.js"), "utf8");

function loadGuest(startAt = 100000) {
  let now = startAt;
  const windowObject = { __TERRITORY_RUSH_TEST__: true };
  vm.runInNewContext(source, {
    window: windowObject,
    console,
    Date: { now: () => now },
    Math,
    Promise,
    setTimeout,
    clearTimeout
  }, { filename: "territory-rush.js" });

  const sent = [];
  const roster = [
    {
      nick: "host",
      joinTs: 1,
      clientSessionId: "host-session",
      presenceSessionIds: ["host-session"],
      presenceCount: 1
    },
    {
      nick: "guest",
      joinTs: 2,
      clientSessionId: "guest-session",
      presenceSessionIds: ["guest-session"],
      presenceCount: 1
    }
  ];
  const api = {
    me() { return { nick: "guest", clientSessionId: "guest-session" }; },
    roster() { return roster.slice(); },
    isHost() { return false; },
    host() { return "host"; },
    hostSessionId() { return roster[0].clientSessionId; },
    isConnected() { return true; },
    isNet() { return true; },
    setHostEligible() {},
    syncHostInputs() {},
    roomChanged() {},
    toast() {},
    playWarning() {},
    send(message) { sent.push(message); }
  };

  const controller = windowObject.TerritoryRush;
  const engine = controller._test;
  const state = engine.freshState();
  state.phase = "playing";
  state.matchId = "presence-heartbeat-match";
  state.ownerRev = 3;
  state.deadline = now + 90000;
  state.players = [
    engine.makePlayer(0, "host", false, 2),
    engine.makePlayer(1, "guest", false, 2)
  ];
  engine.setApi(api);
  engine.setState(state);
  engine.setAuthoritativeHost("host");
  engine.setSyncState(state.ownerRev, false, 0, false);

  return {
    controller,
    roster,
    sent,
    advance(ms) { now += ms; }
  };
}

test("unchanged presence heartbeats do not request repeated full territory snapshots", () => {
  const fixture = loadGuest();

  fixture.controller.onPresence(fixture.roster, {});
  assert.equal(fixture.sent.filter((message) => message.t === "tr_sync_req").length, 1);

  fixture.sent.length = 0;
  fixture.advance(15000);
  fixture.controller.onPresence(fixture.roster, {});
  assert.equal(fixture.sent.filter((message) => message.t === "tr_sync_req").length, 0);

  fixture.sent.length = 0;
  fixture.advance(1500);
  fixture.roster[0].clientSessionId = "replacement-host-session";
  fixture.roster[0].presenceSessionIds = ["replacement-host-session"];
  fixture.controller.onPresence(fixture.roster, {});
  assert.equal(fixture.sent.filter((message) => message.t === "tr_sync_req").length, 1);
});
