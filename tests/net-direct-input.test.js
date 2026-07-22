"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "net.js"), "utf8");

function loadNet() {
  const channels = [];
  const removed = [];
  class FakeChannel {
    constructor(topic, options) {
      this.topic = topic;
      this.options = options;
      this.handlers = [];
      this.sent = [];
      this.state = {};
      channels.push(this);
    }
    on(type, filter, handler) { this.handlers.push({ type, filter, handler }); return this; }
    subscribe(handler) { this.subscribeHandler = handler; handler("SUBSCRIBED"); return this; }
    send(message) { this.sent.push(message); }
    track(meta) { this.meta = meta; }
    presenceState() { return this.state; }
  }
  const window = {
    OMOK_CONFIG: { ROOM: "main" },
    SB: {
      channel(topic, options) { return new FakeChannel(topic, options); },
      removeChannel(channel) { removed.push(channel); }
    }
  };
  const context = vm.createContext({ window, console, setTimeout, clearTimeout, setInterval, clearInterval, encodeURIComponent });
  vm.runInContext(source, context, { filename: "net.js" });
  return { Net: window.Net, channels, removed };
}

test("Territory inputs use a self-excluding per-player channel received by the host only", () => {
  const fixture = loadNet();
  fixture.Net.init("room-1", { nick: "민서", joinTs: 2 }, {});
  fixture.Net.syncDirectInputs(["구나", "민서", "서준"], "민서", false);

  const direct = fixture.channels.find((channel) => channel.topic === "room-input:room-1:" + encodeURIComponent("민서"));
  assert.ok(direct);
  assert.equal(direct.options.config.broadcast.self, false);
  assert.equal(fixture.channels.some((channel) => channel.topic.includes(encodeURIComponent("서준"))), false);

  assert.equal(fixture.Net.sendDirectInput({ t: "tr_input", nick: "민서" }), true);
  assert.equal(direct.sent.length, 1);
  assert.equal(direct.sent[0].payload.t, "tr_input");
  fixture.Net.leaveRoom();
});

test("the elected host subscribes to each remote player's input channel and cleans them on leave", () => {
  const fixture = loadNet();
  fixture.Net.init("room-2", { nick: "구나", joinTs: 1 }, {});
  fixture.Net.syncDirectInputs(["구나", "민서", "서준"], "구나", true);

  const directTopics = fixture.channels.filter((channel) => channel.topic.startsWith("room-input:"))
    .map((channel) => channel.topic).sort();
  assert.deepEqual(directTopics, [
    "room-input:room-2:" + encodeURIComponent("민서"),
    "room-input:room-2:" + encodeURIComponent("서준")
  ].sort());

  fixture.Net.leaveRoom();
  assert.equal(fixture.removed.filter((channel) => channel.topic.startsWith("room-input:")).length, 2);
});
