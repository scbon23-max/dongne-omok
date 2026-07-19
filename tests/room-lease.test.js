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

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source block: ${start}`);
  return source.slice(from, to);
}

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

test("a refresh restores the same owned room instead of leaving an invisible lease", () => {
  assert.match(game, /ROOM_LEASE_STORAGE_KEY = "dongne_owned_room_lease_v1"/);
  assert.match(game, /sessionStorage\.setItem\(ROOM_LEASE_STORAGE_KEY/);
  assert.match(game, /async function restoreOwnedRoomLease\(\)/);
  assert.match(game, /claimed = await Db\.claimRoomLease\(roomLeaseAuth\(\), lease\)/);
  assert.match(game, /enterRoom\(lease\.roomId, lease\.game, lease\.roomName\)/);
  assert.match(game, /toast\("새로고침 전 방으로 돌아왔어요"/);
  assert.match(game, /function showLobby\(\)[\s\S]*?restoreOwnedRoomLease\(\)/);
  assert.match(game, /clearStoredRoomLease\(roomId\)/);
});

test("stored room ownership survives refresh only for the same account and room", () => {
  const source = between(game, 'var ROOM_LEASE_STORAGE_KEY = "dongne_owned_room_lease_v1";', "function roomLeaseAuth()");
  const values = new Map();
  const context = {
    me: { nick: "구나" },
    roomCreatedTs: 1234,
    sessionStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); }
    },
    JSON,
    String,
    Number,
    Math,
    Date
  };
  vm.runInNewContext(`${source}
    this.storeLease = storeRoomLease;
    this.readLease = readStoredRoomLease;
    this.clearLease = clearStoredRoomLease;
  `, context);

  context.storeLease({
    roomId: "room-1",
    roomName: "구나의 방",
    game: "catchmind",
    token: "a".repeat(32),
    createdTs: 4567
  });
  const restored = context.readLease();
  assert.equal(restored.roomId, "room-1");
  assert.equal(restored.game, "catchmind");
  assert.equal(restored.createdTs, 4567);

  context.clearLease("another-room");
  assert.ok(context.readLease());
  context.clearLease("room-1");
  assert.equal(context.readLease(), null);
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
