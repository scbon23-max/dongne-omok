"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadDbWithInvoke(result) {
  const invocations = [];
  const sb = {
    functions: {
      invoke(name, options) {
        invocations.push({ name, options });
        return Promise.resolve(result);
      },
    },
  };
  const context = { window: { SB: sb }, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8"), context, { filename: "db.js" });
  return { db: context.window.Db, invocations };
}

test("holdemInvoke preserves structured edge-function error reasons", async () => {
  const loaded = loadDbWithInvoke({
    data: { ok: false, reason: "server_config", version: 0, snapshot: null },
    error: { message: "Edge Function returned a non-2xx status code" },
  });

  const response = await loaded.db.holdemInvoke(
    { nick: "alice", hash: "a".repeat(64) },
    "join",
    { roomId: "room-1", requestId: "join:1" }
  );

  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    ok: false,
    msg: "Edge Function returned a non-2xx status code",
    reason: "server_config",
    version: 0,
    snapshot: null,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.invocations[0])), {
    name: "holdem-table",
    options: {
      body: {
        roomId: "room-1",
        requestId: "join:1",
        action: "join",
        auth: { nick: "alice", hash: "a".repeat(64) },
      },
    },
  });
});
