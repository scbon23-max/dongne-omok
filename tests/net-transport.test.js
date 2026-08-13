"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "net.js"), "utf8");

function loadNet(options = {}) {
  const channels = [];
  const removed = [];
  const sessionId = options.sessionId || "session-a";

  class FakeChannel {
    constructor(topic, channelOptions) {
      this.topic = topic;
      this.options = channelOptions;
      this.handlers = [];
      this.sent = [];
      this.state = {};
      channels.push(this);
    }
    on(type, filter, handler) {
      this.handlers.push({ type, filter, handler });
      return this;
    }
    subscribe(handler) {
      this.subscribeHandler = handler;
      if (options.autoSubscribe !== false) handler("SUBSCRIBED");
      return this;
    }
    send(message) {
      this.sent.push(message);
      if (options.send) return options.send(this, message);
      return Promise.resolve("ok");
    }
    track(meta) {
      this.meta = meta;
      this.trackCalls = (this.trackCalls || 0) + 1;
      if (options.track) return options.track(this, meta);
      return Promise.resolve("ok");
    }
    presenceState() { return this.state; }
    status(value) { this.subscribeHandler(value); }
    emit(type, event, payload) {
      const match = this.handlers.find((entry) => entry.type === type && entry.filter.event === event);
      if (match) match.handler(payload);
    }
  }

  const window = {
    crypto: { randomUUID() { return sessionId; } },
    OMOK_CONFIG: { ROOM: "main" },
    SB: {
      channel(topic, channelOptions) { return new FakeChannel(topic, channelOptions); },
      removeChannel(channel) { removed.push(channel); }
    }
  };
  const context = vm.createContext({
    window,
    console,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    encodeURIComponent
  });
  vm.runInContext(source, context, { filename: "net.js" });
  return { Net: window.Net, channels, removed };
}

function assertResult(actual, ok, status) {
  assert.equal(actual.ok, ok);
  assert.equal(actual.status, status);
}

test("each browser tab exposes a stable client session and tracks it in presence", () => {
  const first = loadNet({ sessionId: "tab-one" });
  const second = loadNet({ sessionId: "tab-two" });

  first.Net.init("room-1", { nick: "민서", joinTs: 1 }, {});
  second.Net.init("room-1", { nick: "민서", joinTs: 1 }, {});

  const firstRoom = first.channels.find((channel) => channel.topic === "room:room-1");
  const secondRoom = second.channels.find((channel) => channel.topic === "room:room-1");
  assert.equal(first.Net.clientSessionId, "c-tab-one");
  assert.equal(second.Net.clientSessionId, "c-tab-two");
  assert.notEqual(firstRoom.options.config.presence.key, secondRoom.options.config.presence.key);
  assert.equal(firstRoom.meta.clientSessionId, first.Net.clientSessionId);
  assert.equal(secondRoom.meta.clientSessionId, second.Net.clientSessionId);

  first.Net.leaveRoom();
  second.Net.leaveRoom();
});

test("presence keeps the compatible nick roster while exposing duplicate sessions", () => {
  let roster = null;
  const fixture = loadNet({ sessionId: "tab-one" });
  fixture.Net.init("room-1", { nick: "민서", joinTs: 1 }, {
    onPresence(value) { roster = value; }
  });
  const room = fixture.channels.find((channel) => channel.topic === "room:room-1");
  room.state = {
    one: [{ nick: "민서", joinTs: 1, clientSessionId: fixture.Net.clientSessionId }],
    two: [{ nick: "민서", joinTs: 2, clientSessionId: "c-tab-two" }]
  };
  room.emit("presence", "sync");

  assert.equal(roster.length, 1);
  assert.equal(roster[0].nick, "민서");
  assert.equal(roster[0].joinTs, 1);
  assert.equal(roster[0].presenceCount, 2);
  assert.deepEqual(Array.from(roster[0].presenceSessionIds), [fixture.Net.clientSessionId, "c-tab-two"]);
  assert.equal(roster[0].hasCurrentSession, true);
  fixture.Net.leaveRoom();
});

test("lobby presence exposes synchronized members, sessions, and connection diagnostics", async () => {
  const updates = [];
  const statuses = [];
  const fixture = loadNet({ sessionId: "lobby-local" });
  fixture.Net.initLobby({ nick: "민서", joinTs: 1 }, {
    onStatus(value) { statuses.push(value); },
    onPresence(value, options) { updates.push({ value, options }); }
  });
  const lobby = fixture.channels.find((channel) => channel.topic === "lobby:main");
  await Promise.resolve();

  lobby.state = {
    local: [{ nick: "민서", joinTs: 1, clientSessionId: fixture.Net.clientSessionId }],
    remote: [
      { nick: "서준", joinTs: 2, clientSessionId: "c-remote-a", viewing: "room-1" },
      { nick: "서준", joinTs: 3, clientSessionId: "c-remote-b", viewing: null }
    ]
  };
  lobby.emit("presence", "sync");

  assert.deepEqual(statuses, ["CONNECTING", "SUBSCRIBED"]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].options.event, "sync");
  assert.equal(updates[0].value.length, 2);
  const remote = updates[0].value.find((member) => member.nick === "서준");
  assert.equal(remote.presenceCount, 2);
  assert.deepEqual(Array.from(remote.presenceViewings), ["room-1", ""]);

  const diagnostics = fixture.Net.lobbyDiagnostics();
  assert.equal(diagnostics.status, "SUBSCRIBED");
  assert.equal(diagnostics.ready, true);
  assert.equal(diagnostics.lastTrackStatus, "ok");
  assert.equal(diagnostics.memberCount, 2);
  assert.equal(diagnostics.sessionCount, 3);
  assert.ok(diagnostics.lastSyncAt > 0);

  await fixture.Net.trackLobby({ nick: "민서", joinTs: 1, viewing: "room-2" });
  assert.equal(lobby.meta.viewing, "room-2");
  assert.equal(fixture.Net.lobbyDiagnostics().lastTrackStatus, "ok");
});

test("lobby presence registration retries after a transient track timeout", async () => {
  const trackStatuses = ["timed out", "ok"];
  const fixture = loadNet({
    sessionId: "lobby-retry",
    track() { return Promise.resolve(trackStatuses.shift() || "ok"); }
  });
  fixture.Net.initLobby({ nick: "민서", joinTs: 1 }, {});
  const lobby = fixture.channels.find((channel) => channel.topic === "lobby:main");

  await new Promise((resolve) => setTimeout(resolve, 1150));

  assert.equal(lobby.trackCalls, 2);
  assert.equal(fixture.Net.lobbyDiagnostics().lastTrackStatus, "ok");
  assert.equal(fixture.Net.lobbyDiagnostics().trackRetries, 0);
});

test("identical room presence heartbeats are suppressed until meaningful metadata changes", () => {
  const rosters = [];
  const fixture = loadNet({ sessionId: "local" });
  fixture.Net.init("room-presence", {
    nick: "민서",
    isAdmin: false,
    joinTs: 1,
    viewing: null,
    hostEligible: true,
    nickColor: "#ff3366",
    catchBoardFrameId: "frame-a",
    catchLevel: 7
  }, {
    onPresence(value) { rosters.push(value); }
  });
  const room = fixture.channels.find((channel) => channel.topic === "room:room-presence");
  const localSession = fixture.Net.clientSessionId;
  room.state = {
    local: [{
      nick: "민서",
      isAdmin: false,
      joinTs: 1,
      viewing: null,
      hostEligible: true,
      clientSessionId: localSession,
      nickColor: "#ff3366",
      catchBoardFrameId: "frame-a",
      catchLevel: 7
    }]
  };

  room.emit("presence", "sync");
  fixture.Net.track({
    nick: "민서",
    isAdmin: false,
    joinTs: 1,
    viewing: null,
    hostEligible: true,
    nickColor: "#ff3366",
    catchBoardFrameId: "frame-a",
    catchLevel: 7
  });
  room.emit("presence", "sync");
  room.emit("presence", "join");
  room.emit("presence", "leave");
  assert.equal(rosters.length, 1);

  room.state.local[0] = Object.assign({}, room.state.local[0], {
    viewing: "catchmind",
    away: true,
    hostEligible: false,
    nickColor: "#2244ff",
    catchBoardFrameId: "frame-b",
    catchLevel: 8
  });
  room.emit("presence", "sync");
  assert.equal(rosters.length, 2);
  assert.equal(rosters[1][0].viewing, "catchmind");
  assert.equal(rosters[1][0].away, true);
  assert.equal(rosters[1][0].hostEligible, false);
  assert.equal(rosters[1][0].nickColor, "#2244ff");
  assert.equal(rosters[1][0].catchBoardFrameId, "frame-b");
  assert.equal(rosters[1][0].catchLevel, 8);
  fixture.Net.leaveRoom();
});

test("room presence forwards session and membership changes and resets after reopening", () => {
  const rosters = [];
  const fixture = loadNet({ sessionId: "local" });
  const handlers = { onPresence(value) { rosters.push(value); } };
  fixture.Net.init("room-reset", { nick: "민서", joinTs: 1 }, handlers);
  const firstRoom = fixture.channels.find((channel) => channel.topic === "room:room-reset");
  firstRoom.state = {
    local: [{ nick: "민서", joinTs: 1, clientSessionId: fixture.Net.clientSessionId }]
  };
  firstRoom.emit("presence", "sync");
  assert.equal(rosters.length, 1);

  firstRoom.state.remote = [{ nick: "서준", joinTs: 2, clientSessionId: "c-remote-a" }];
  firstRoom.emit("presence", "join");
  assert.equal(rosters.length, 2);
  assert.deepEqual(Array.from(rosters[1], (member) => member.nick).sort(), ["민서", "서준"].sort());

  firstRoom.state.remote.push({ nick: "서준", joinTs: 3, clientSessionId: "c-remote-b" });
  firstRoom.emit("presence", "sync");
  assert.equal(rosters.length, 3);
  const duplicate = rosters[2].find((member) => member.nick === "서준");
  assert.equal(duplicate.presenceCount, 2);
  assert.deepEqual(Array.from(duplicate.presenceSessionIds), ["c-remote-a", "c-remote-b"]);

  firstRoom.state.remote = [{ nick: "서준", joinTs: 3, clientSessionId: "c-remote-b" }];
  firstRoom.emit("presence", "leave");
  assert.equal(rosters.length, 4);
  assert.equal(rosters[3].find((member) => member.nick === "서준").clientSessionId, "c-remote-b");

  fixture.Net.leaveRoom();
  fixture.Net.init("room-reset", { nick: "민서", joinTs: 1 }, handlers);
  const secondRoom = fixture.channels.filter((channel) => channel.topic === "room:room-reset").at(-1);
  secondRoom.state = {
    local: [{ nick: "민서", joinTs: 1, clientSessionId: fixture.Net.clientSessionId }]
  };
  secondRoom.emit("presence", "sync");
  assert.equal(rosters.length, 5);
  fixture.Net.leaveRoom();
});

test("equal-time duplicate presence always elects the same primary session", () => {
  function selectedPrimary(state) {
    let roster = null;
    const fixture = loadNet({ sessionId: "local" });
    fixture.Net.init("room-tie", { nick: "player", joinTs: 7 }, {
      onPresence(value) { roster = value; }
    });
    const room = fixture.channels.find((channel) => channel.topic === "room:room-tie");
    room.state = state;
    room.emit("presence", "sync");
    const selected = roster[0].clientSessionId;
    fixture.Net.leaveRoom();
    return selected;
  }

  const a = [{ nick: "player", joinTs: 7, clientSessionId: "c-z-last" }];
  const b = [{ nick: "player", joinTs: 7, clientSessionId: "c-a-first" }];
  assert.equal(selectedPrimary({ first: a, second: b }), "c-a-first");
  assert.equal(selectedPrimary({ second: b, first: a }), "c-a-first");
});

test("room sends expose normalized delivery results and monotonic transport metadata", async () => {
  const statuses = ["ok", "timed out"];
  const fixture = loadNet({
    sessionId: "tab-one",
    send() { return Promise.resolve(statuses.shift()); }
  });
  fixture.Net.init("room-7", { nick: "민서", joinTs: 1 }, {});
  const room = fixture.channels.find((channel) => channel.topic === "room:room-7");
  const sourceMessage = { t: "hello" };

  assertResult(await fixture.Net.sendWithResult(sourceMessage), true, "ok");
  assertResult(await fixture.Net.sendWithResult({ t: "hello-again" }), false, "timed out");
  assert.equal(sourceMessage._transport, undefined);
  assert.equal(room.sent[0].payload._transport.sessionId, fixture.Net.clientSessionId);
  assert.equal(room.sent[0].payload._transport.seq, 1);
  assert.equal(room.sent[1].payload._transport.seq, 2);
  assert.equal(room.sent[1].payload._transport.lane, "room");
  assert.equal(room.sent[1].payload._transport.roomId, "room-7");
  assert.equal(room.sent[1].payload._transport.senderNick, "민서");
  fixture.Net.leaveRoom();
});

test("send results report rejected and synchronously thrown channel errors", async () => {
  let call = 0;
  const fixture = loadNet({
    send() {
      call++;
      if (call === 1) return Promise.reject(new Error("offline"));
      throw new Error("closed");
    }
  });
  fixture.Net.init("room-1", { nick: "민서" }, {});

  const rejected = await fixture.Net.sendWithResult({ t: "a" });
  const thrown = await fixture.Net.sendWithResult({ t: "b" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, "error");
  assert.match(rejected.error, /offline/);
  assert.equal(thrown.ok, false);
  assert.equal(thrown.status, "error");
  assert.match(thrown.error, /closed/);
  fixture.Net.leaveRoom();
});

test("queued result sends settle after subscribe and settle as cancelled on leave", async () => {
  const fixture = loadNet({ autoSubscribe: false });
  fixture.Net.init("room-1", { nick: "민서" }, {});
  const room = fixture.channels.find((channel) => channel.topic === "room:room-1");
  const delivered = fixture.Net.sendWithResult({ t: "queued" });
  assert.equal(room.sent.length, 0);
  room.status("SUBSCRIBED");
  assertResult(await delivered, true, "ok");

  room.status("CHANNEL_ERROR");
  const cancelled = fixture.Net.sendWithResult({ t: "cancel-me" });
  fixture.Net.leaveRoom();
  assertResult(await cancelled, false, "cancelled");
});

test("an unready direct input falls back once without a late queued send, then new input uses direct", async () => {
  const fixture = loadNet({ autoSubscribe: false, sessionId: "direct-tab" });
  fixture.Net.init("room-2", { nick: "민서" }, {});
  const room = fixture.channels.find((channel) => channel.topic === "room:room-2");
  room.status("SUBSCRIBED");
  fixture.Net.syncDirectInputs(["민서"], "민서", false);
  const direct = fixture.channels.find((channel) => channel.topic.startsWith("room-input:"));

  const first = { t: "tr_input", seq: 10 };
  const firstResult = await fixture.Net.sendDirectInputWithResult(first);
  assertResult(firstResult, false, "unavailable");
  if (!firstResult.ok) await fixture.Net.sendWithResult(first);
  assert.equal(room.sent.length, 1);
  assert.equal(room.sent[0].payload.seq, 10);
  assert.equal(direct.sent.length, 0);

  direct.status("SUBSCRIBED");
  assert.equal(direct.sent.length, 0);

  const secondResult = await fixture.Net.sendDirectInputWithResult({ t: "tr_input", seq: 11 });
  assertResult(secondResult, true, "ok");
  assert.equal(direct.sent.length, 1);
  assert.equal(direct.sent[0].payload.seq, 11);
  assert.equal(room.sent.length, 1);

  const meta = fixture.Net.transportMetaOf(direct.sent[0].payload);
  assert.equal(meta.sessionId, fixture.Net.clientSessionId);
  assert.equal(meta.seq, 1);
  assert.equal(meta.lane, "direct");
  assert.equal(meta.roomId, "room-2");
  assert.equal(fixture.Net.transportMetaOf({ _transport: { v: 1, seq: Infinity } }), null);
  fixture.Net.leaveRoom();
});
