"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const source = fs.readFileSync(path.join(__dirname, "..", "supabase/functions/holdem-table/index.ts"), "utf8");
const context = vm.createContext({ Deno: { serve() {} }, console });
vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, "")), context);

function clientFor(tables, cap = 37, failTable = null) {
  const calls = [];
  return { calls, rpc(name) {
    assert.equal(name, "holdem_completed_hand_counts");
    const counts = {};
    for (const row of tables.holdem_hand_results || []) counts[row.nickname] = (counts[row.nickname] || 0) + 1;
    return Promise.resolve({ data: counts, error: null });
  }, from(table) {
    let key, cursor = null, limit;
    const filters = [];
    return {
      select() { return this; },
      eq(field, value) { filters.push(row => row[field] === value); return this; },
      gte(field, value) { filters.push(row => row[field] >= value); return this; },
      order(field) { key = field; return this; },
      limit(count) { limit = count; return this; },
      gt(field, value) { assert.equal(field, key); cursor = value; return this; },
      then(resolve, reject) {
        calls.push({ table, key, cursor, limit });
        if (table === failTable && cursor !== null) return Promise.resolve({ error: { message: "offline" }, data: null }).then(resolve, reject);
        const data = tables[table].filter(row => filters.every(filter => filter(row))).filter(row => cursor === null || row[key] > cursor)
          .sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0).slice(0, Math.min(limit, cap));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
    };
  } };
}

test("ranking counts beyond 500 wallets and 10000 hands even with a smaller backend page size", async () => {
  const wallets = Array.from({ length: 602 }, (_, i) => ({ nickname: `p${String(i).padStart(4, "0")}`, balance: 10000, updated_at: "2026-09-08" }));
  const hands = Array.from({ length: 10005 }, (_, i) => ({ id: i + 1, nickname: i < 10000 ? "p0000" : "p0600" }));
  const tables = Array.from({ length: 501 }, (_, i) => ({ room_id: `r${String(i).padStart(4, "0")}`, state: null }));
  tables[500].state = { settings: { mode: "ring", assetBacked: true }, phase: "flop", seats: [
    { nick: "p0600", stack: 20000, totalBet: 1000 }, { nick: "bot", stack: 99000, totalBet: 0, isBot: true }
  ] };
  const accounts = [...Array.from({ length: 500 }, (_, i) => ({ nickname: `a${String(i).padStart(4, "0")}`, is_admin: true })),
    { nickname: "p0601", is_admin: true }];
  const client = clientFor({ holdem_wallets: wallets, holdem_tables: tables, accounts, holdem_hand_results: hands });
  const result = await context.assetRankingRows(client);
  assert.equal(result.length, 3);
  assert.equal(result[0].nickname, "p0600");
  assert.equal(result[0].totalAssets, 31000);
  assert.equal(result[0].handCount, 5);
  assert.equal(result.find(row => row.nickname === "p0000").handCount, 10000);
  assert.equal(result.find(row => row.nickname === "p0601").rank, 2);
  assert.equal(result.find(row => row.nickname === "p0000").rank, 2);
  assert.ok(client.calls.every(call => call.limit === 500));
  assert.ok(client.calls.filter(call => call.table === "holdem_wallets").length > 2);
});

test("a later page failure rejects the ranking instead of publishing incomplete results", async () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ nickname: `p${String(i).padStart(2, "0")}` }));
  const client = clientFor({ holdem_wallets: rows }, 37, "holdem_wallets");
  await assert.rejects(context.allRankingRows(() => client.from("holdem_wallets").select("nickname"), "nickname"), /ranking_lookup/);
});

test("a stalled page cursor fails instead of looping indefinitely", async () => {
  const query = () => ({ order() { return this; }, limit() { return this; }, gt() { return this; },
    then(resolve) { return Promise.resolve({ data: [{ id: 1 }], error: null }).then(resolve); } });
  await assert.rejects(context.allRankingRows(query, "id"), /ranking_cursor/);
});
