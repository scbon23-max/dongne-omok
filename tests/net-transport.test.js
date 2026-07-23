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
    track(meta) { this.meta = meta; }
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

test("direct input reports an unready channel immediately and later sends only the latest queued packet", async () => {
  const fixture = loadNet({ autoSubscribe: false, sessionId: "direct-tab" });
  fixture.Net.init("room-2", { nick: "민서" }, {});
  const room = fixture.channels.find((channel) => channel.topic === "room:room-2");
  room.status("SUBSCRIBED");
  fixture.Net.syncDirectInputs(["민서"], "민서", false);
  const direct = fixture.channels.find((channel) => channel.topic.startsWith("room-input:"));

  assertResult(await fixture.Net.sendDirectInputWithResult({ t: "tr_input", seq: 10 }), false, "queued");
  assertResult(await fixture.Net.sendDirectInputWithResult({ t: "tr_input", seq: 11 }), false, "queued");
  assert.equal(direct.sent.length, 0);

  direct.status("SUBSCRIBED");
  assert.equal(direct.sent.length, 1);
  assert.equal(direct.sent[0].payload.seq, 11);

  const meta = fixture.Net.transportMetaOf(direct.sent[0].payload);
  assert.equal(meta.sessionId, fixture.Net.clientSessionId);
  assert.equal(meta.seq, 2);
  assert.equal(meta.lane, "direct");
  assert.equal(meta.roomId, "room-2");
  assert.equal(fixture.Net.transportMetaOf({ _transport: { v: 1, seq: Infinity } }), null);
  fixture.Net.leaveRoom();
});
