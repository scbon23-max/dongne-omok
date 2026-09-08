"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const E = require("../holdem-engine.js");
const root = path.join(__dirname, "..");
let sequence = 0;
let now = Date.now();
function apply(state, cmd, context = {}) {
  const r = E.command(state, { ...cmd, requestId: `audit:${++sequence}` }, { now: ++now, randomInt: () => 0, ...context });
  assert.equal(r.ok, true, `${cmd.type}: ${r.reason}`);
  return r.state;
}
function clearEffects(state) {
  state.walletAdjustments = []; state.economyEvents = []; state.handResults = [];
  return state;
}
function table(n, prefix = "회원") {
  let s = E.createTable({ roomId: "audit-room", ownerNick: `${prefix}0`, mode: "ring", assetBacked: true, startingStack: 40000, smallBlind: 200, bigBlind: 400, chipUnit: 100 });
  for (let i = 0; i < n; i++) s = clearEffects(apply(s, { type: "join", nick: `${prefix}${i}`, buyIn: 30000 }));
  return s;
}
function loadEdge() {
  let handler;
  const context = vm.createContext({ console: { ...console, error() {} }, TextEncoder, TextDecoder, Date, Intl, Deno: { serve(fn) { handler = fn; }, env: { get: () => "local-test" } }, Response, Request, crypto: require("node:crypto").webcrypto, HoldemEngine: E });
  const source = fs.readFileSync(path.join(root, "supabase/functions/holdem-table/index.ts"), "utf8");
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, "")), context);
  return { context, invoke: (body) => handler(new Request("https://local.invalid/holdem-table", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })) };
}
function endpoint(edge, initial, options = {}) {
  let stored = structuredClone(initial), version = 100, writes = 0, attempts = 0, walletReads = 0;
  edge.context.createClient = () => ({
    from(name) {
      let nickname;
      const q = { select() { return q; }, eq(key, value) { if (key === "nickname") nickname = value; return q; }, in() { walletReads++; return Promise.resolve({ data: [{ nickname: "회원0", balance: walletReads === 1 ? 50000 : 1000 }], error: null }); }, maybeSingle() { return Promise.resolve({ data: name === "accounts" ? { nickname, is_admin: false } : name === "holdem_tables" ? { room_id: "audit-room", state: stored, version, owner_nickname: stored.ownerNick } : { used_count: 0 }, error: null }); } };
      return q;
    },
    async rpc(name, body) {
      assert.equal(name, "holdem_ring_table_v4_compare_and_swap");
      attempts++;
      assert.ok(body.p_hand_results.length <= 8);
      if (options.walletRace && attempts === 1) return { data: [{ applied: false, reason: "wallet_insufficient", current_state: stored, current_version: version, current_owner_nickname: stored.ownerNick }], error: null };
      stored = structuredClone(body.p_state); version++; writes++;
      return { data: [{ applied: true, current_state: stored, current_version: version, current_owner_nickname: stored.ownerNick }], error: null };
    },
  });
  return {
    async send(cmd) {
      const response = await edge.invoke({ action: cmd.type, move: cmd.action, amount: cmd.amount, roomId: "audit-room", requestId: `endpoint:${++sequence}`, expectedVersion: version, handId: String(stored.handNo), auth: { nick: cmd.nick, hash: "a".repeat(64) } });
      return { status: response.status, body: await response.json() };
    },
    get stored() { return stored; }, get writes() { return writes; }, get attempts() { return attempts; }, get walletReads() { return walletReads; },
  };
}

for (const count of [7, 8]) test(`${count} player final folds persist every participant result`, async () => {
  let s = apply(table(count), { type: "start", nick: "회원0" });
  while (true) {
    const cmd = { type: "act", nick: s.seats[s.actorSeat].nick, action: "fold" };
    const next = apply(s, cmd);
    if (next.phase === "hand_end") {
      const edge = loadEdge();
      assert.equal(edge.context.takeHandResults(structuredClone(next)).length, count);
      const api = endpoint(edge, s);
      const result = await api.send(cmd);
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);
      assert.equal(api.writes, 1);
      assert.equal(api.stored.phase, "hand_end");
      break;
    }
    s = next;
  }
});

test("twenty long Korean hand histories fit the response and preserve stored history", async () => {
  let s = table(6, "동네운동회원"), last;
  for (let h = 1; h <= 20; h++) {
    s = clearEffects(apply(s, { type: "start", nick: "동네운동회원0" }));
    const streets = {};
    while (["preflop", "flop", "turn", "river"].includes(s.phase)) {
      const phase = s.phase, count = streets[phase] || 0, nick = s.seats[s.actorSeat].nick, legal = E.legalActions(s, nick);
      let action = legal.actions.includes("check") ? "check" : "call", amount;
      if (count === 0 && legal.actions.includes("bet")) { action = "bet"; amount = legal.minBet; }
      else if (count <= 2 && legal.actions.includes("raise")) { action = "raise"; amount = legal.minRaiseTo; }
      const cmd = { type: "act", nick, action, amount }, before = structuredClone(s);
      s = clearEffects(apply(s, cmd)); streets[phase] = count + 1;
      if (h === 20 && s.phase === "hand_end") last = { before, cmd };
    }
  }
  const edge = loadEdge(), original = JSON.stringify(s), raw = E.view(s, "동네운동회원0");
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) > 65536);
  const snapshot = edge.context.sanitizedSnapshot(E, s, "동네운동회원0");
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 65536);
  assert.equal(snapshot.historyTruncated, true);
  assert.equal(JSON.stringify(snapshot.handHistory.at(-1)), JSON.stringify(raw.handHistory.at(-1)));
  assert.equal(JSON.stringify(s), original);
  const api = endpoint(edge, last.before), result = await api.send(last.cmd);
  assert.equal(result.status, 200); assert.equal(result.body.ok, true); assert.equal(api.writes, 1);
});

test("snapshot failures return a structured response instead of rejecting the handler", async () => {
  const edge = loadEdge(), s = table(2);
  edge.context.HoldemEngine = { ...E, view() { throw new Error("snapshot failed"); } };
  const api = endpoint(edge, s), result = await api.send({ type: "snapshot", nick: "회원0" });
  assert.equal(result.status, 500); assert.equal(result.body.reason, "server");
});

test("late human moves are rejected at the deadline and tick still applies the timeout", () => {
  const s = apply(table(3), { type: "start", nick: "회원0" });
  const cmd = { type: "act", nick: s.seats[s.actorSeat].nick, action: "call" };
  assert.equal(E.command(s, cmd, { now: s.actionDeadline - 1 }).ok, true);
  for (const time of [s.actionDeadline, s.actionDeadline + 60000]) {
    const late = E.command(s, cmd, { now: time });
    assert.equal(late.ok, false); assert.equal(late.reason, "turn_expired");
    assert.equal(late.state.actionHistory.length, s.actionHistory.length);
  }
  const tick = E.command(s, { type: "tick", nick: cmd.nick }, { now: s.actionDeadline + 60000 });
  assert.equal(tick.ok, true); assert.equal(tick.state.actionHistory.at(-1).action, "fold");
});

test("unfunded offline top-ups expire without blocking the other players", () => {
  let s = table(3); s.seats[0].stack = 5000; s.seats[0].away = true;
  s = apply(s, { type: "reserve_rebuy", nick: "회원0", amount: 40000 });
  s.seats[0].away = true;
  const next = apply(s, { type: "start", nick: "회원1" }, { topUpBalances: { "회원0": 15000 } });
  assert.equal(next.phase, "preflop"); assert.equal(next.seats[0].topUpReserved, false);
  assert.equal(next.seats[0].stack, 5000); assert.equal(next.seats[0].topUpSkippedHandNo, next.handNo);
  assert.equal(next.walletAdjustments.length, 0);
  const funded = apply(s, { type: "start", nick: "회원1" }, { topUpBalances: { "회원0": 35000 } });
  assert.equal(funded.walletAdjustments[0].delta, -35000);
  assert.equal(funded.seats[0].topUpAppliedHandNo, funded.handNo);
});

test("concurrent wallet spending retries the next hand with fresh balances", async () => {
  let s = table(3); s.seats[0].stack = 5000;
  s = apply(s, { type: "reserve_rebuy", nick: "회원0", amount: 40000 });
  const api = endpoint(loadEdge(), s, { walletRace: true });
  const result = await api.send({ type: "start", nick: "회원0" });
  assert.equal(result.status, 200); assert.equal(result.body.ok, true);
  assert.equal(api.attempts, 2); assert.equal(api.writes, 1); assert.equal(api.walletReads, 2);
  assert.equal(api.stored.seats[0].topUpReserved, false);
  assert.equal(api.stored.seats[0].topUpSkippedHandNo, api.stored.handNo);
});

test("asset and daily-net reads use complete aggregate results and surface lookup failures", async () => {
  const edge = loadEdge().context, calls = [];
  const client = { async rpc(name, args) { calls.push({ name, args }); return { data: name === "holdem_profile_asset" ? { nickname: "회원0", totalAssets: 30000 } : { "회원0": 100100 }, error: null }; } };
  assert.equal((await edge.profileAsset(client, "회원0")).totalAssets, 30000);
  const totals = await edge.todayNetByNickname(client, ["회원0", "회원0", "회원1"]);
  assert.equal(totals.get("회원0"), 100100); assert.equal(totals.get("회원1"), 0);
  assert.equal(calls[1].args.p_nicknames.length, 2);
  const failed = { rpc: async () => ({ data: null, error: { message: "failed" } }) };
  await assert.rejects(edge.profileAsset(failed, "회원0"), /profile_asset_lookup/);
  await assert.rejects(edge.todayNetByNickname(failed, ["회원0"]), /ranking_lookup/);
  assert.equal(await edge.profileAsset({ rpc: async () => ({ data: null, error: null }) }, "missing"), null);
});

function controller(db, nick = "회원0") {
  const window = { __HOLDEM_TEST__: true, HoldemEngine: E, Db: db };
  const context = vm.createContext({ window, Db: db, console, Date, Intl, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} });
  const source = fs.readFileSync(path.join(root, "holdem.js"), "utf8").replace("emptyState: emptyState,", "emptyState: emptyState, auditQueue: storeQueuedProfileTopUp, auditReserve: reserveQueuedProfileTopUp,");
  vm.runInContext(source, context);
  const ui = window.TexasHoldem, api = ui._test;
  api.setApi({ me: () => ({ nick }), roomId: () => "audit-room", galleryAuth: () => ({ nick, hash: "a".repeat(64) }) });
  api.setActive(true); api.setHasSnapshot(true);
  return ui;
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

test("Korean presence changes and repeat returns produce distinct server requests", async () => {
  let s = table(2), version = 1;
  const ids = [];
  const ui = controller({ async holdemInvoke(_auth, action, body) {
    if (action === "presence") { ids.push(body.requestId); s = apply(s, { type: "presence", nick: "회원0", ...body }); }
    return { ok: true, version: ++version, snapshot: E.view(s, "회원0") };
  } });
  ui._test.setState(ui._test.normalizeSnapshot(E.view(s, "회원0"), version));
  for (const away of [true, false, true, false]) {
    ui.onPresence([{ nick: "회원0" }, { nick: "회원1", away }]); await flush();
    assert.equal(s.seats[1].away, away);
  }
  assert.equal(ids.length, 4); assert.equal(new Set(ids).size, 4);
  ui.leave();
});

test("changed and overlapping reservation amounts reach the server once per target", async () => {
  let s = apply(table(3), { type: "start", nick: "회원0" }), version = 1, release;
  s = apply(s, { type: "reserve_rebuy", nick: "회원0", amount: 35000 });
  const amounts = [];
  const ui = controller({ async holdemInvoke(_auth, action, body) {
    if (action === "reserve_rebuy") {
      amounts.push(body.amount);
      if (amounts.length === 1) await new Promise(resolve => { release = resolve; });
      s = apply(s, { type: "reserve_rebuy", nick: "회원0", amount: body.amount });
    }
    return { ok: true, version: ++version, snapshot: E.view(s, "회원0") };
  } });
  ui._test.setState(ui._test.normalizeSnapshot(E.view(s, "회원0"), version));
  ui._test.auditQueue(40000);
  const pending = ui._test.auditReserve(); await flush();
  ui._test.auditQueue(35000); ui._test.auditReserve(); release(); await pending; await flush();
  assert.deepEqual(amounts, [40000, 35000]);
  assert.equal(s.seats[0].topUpTargetAmount, 35000);
  await ui._test.auditReserve(); assert.equal(amounts.length, 2);
  ui.leave();
});

test("a cancelled server reservation clears the local queued top-up", () => {
  const ui = controller({ holdemInvoke: async () => ({ ok: true }) });
  let s = table(3); s.seats[0].stack = 5000;
  s = apply(s, { type: "reserve_rebuy", nick: "회원0", amount: 40000 });
  ui._test.setState(ui._test.normalizeSnapshot(E.view(s, "회원0"), 1)); ui._test.auditQueue(40000);
  s = apply(s, { type: "start", nick: "회원0" }, { topUpBalances: { "회원0": 1000 } });
  ui._test.applySnapshot(E.view(s, "회원0"), 2);
  assert.equal(ui._test.getProfileTopUpState().queuedAmount, 0);
  ui.leave();
});

test("join rejection remains a failure after a successful snapshot refresh", async () => {
  const snapshot = E.view(table(0), "회원0");
  const ui = controller({ async holdemInvoke(_auth, action) { return { ok: action !== "join", reason: action === "join" ? "seat_taken" : undefined, version: 1, snapshot }; } });
  const result = await ui._test.joinTable(0, 30000);
  assert.equal(result.ok, false); assert.equal(result.response.reason, "seat_taken");
  assert.equal(result.refresh.ok, true); assert.equal(ui.state.heroSeat, -1);
  ui.leave();
});
