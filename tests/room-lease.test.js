"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "202607190001_room_leases.sql"), "utf8");
const edge = fs.readFileSync(path.join(root, "supabase", "functions", "room-lease", "index.ts"), "utf8");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");

test("room leases atomically limit each account to one owned room", () => {
  assert.match(migration, /nickname text primary key/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\(p_nickname\)\)/);
  assert.match(migration, /expires_at <= now\(\)/);
  assert.match(migration, /create or replace function public\.claim_room_lease/);
  assert.match(migration, /create or replace function public\.renew_room_lease/);
  assert.match(migration, /create or replace function public\.release_room_lease/);
  assert.match(migration, /revoke all on public\.room_leases from public, anon, authenticated/);
  assert.match(edge, /verifyAccount/);
  assert.match(edge, /body\.action === "claim"/);
  assert.match(edge, /body\.action === "renew"/);
  assert.match(edge, /body\.action === "release"/);
});

test("room creation claims, renews, and releases the account lease", () => {
  assert.match(game, /await Db\.claimRoomLease\(roomLeaseAuth\(\), lease\)/);
  assert.match(game, /setInterval\(renewOwnedRoomLease, 15000\)/);
  assert.match(game, /releaseOwnedRoomLease\(leavingId\)/);
  assert.match(game, /reason === "already_owned"/);
});

test("database room lease calls include account proof and lease identity", async () => {
  const calls = [];
  const context = {
    window: {
      SB: {
        functions: {
          invoke(name, options) {
            calls.push({ name, body: options.body });
            return Promise.resolve({ data: { ok: true }, error: null });
          }
        }
      }
    },
    console,
    crypto: { subtle: {} },
    TextEncoder
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "db.js"), "utf8"), context, { filename: "db.js" });
  const auth = { nick: "A", hash: "a".repeat(64) };
  const lease = { roomId: "room-1", roomName: "A의 방", game: "omok", token: "b".repeat(32) };

  await context.window.Db.claimRoomLease(auth, lease);
  await context.window.Db.renewRoomLease(auth, lease);
  await context.window.Db.releaseRoomLease(auth, lease);

  assert.deepEqual(calls.map(call => call.name), ["room-lease", "room-lease", "room-lease"]);
  assert.deepEqual(calls.map(call => call.body.action), ["claim", "renew", "release"]);
  assert.equal(calls[0].body.auth.hash, auth.hash);
  assert.equal(calls[0].body.roomId, lease.roomId);
  assert.equal(calls[0].body.token, lease.token);
  assert.equal(calls[0].body.roomName, lease.roomName);
  assert.equal(calls[0].body.game, lease.game);
});
