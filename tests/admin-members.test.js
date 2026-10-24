"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");

function fixture(accounts = [], allowlist = []) {
  const state = { accounts, allowlist, calls: [], fail: null, reject: null, failRead: null };
  const sb = { from(table) {
    let operation = "read";
    const query = {
      select() { return query; },
      order() { return query; },
      range(from, to) {
        return Promise.resolve({ data: state[table].slice(from, to + 1), error: state.failRead === table ? { message: "read failed" } : null });
      },
      delete() { operation = "delete"; return query; },
      eq(column, nick) {
        assert.equal(column, "nickname");
        state.calls.push([table, operation, nick]);
        if (operation === "read") return Promise.resolve({ data: state[table].filter(row => row.nickname === nick), error: state.failRead === table ? {} : null });
        if (state.reject === table) return Promise.reject(new Error("network failed"));
        if (state.fail === table) return Promise.resolve({ error: { message: "write failed" } });
        state[table] = state[table].filter(row => row.nickname !== nick);
        return Promise.resolve({ error: null });
      }
    };
    return query;
  } };
  const context = { window: { SB: sb }, console };
  vm.runInNewContext(source, context);
  return { db: context.window.Db, state };
}

test("member list merges duplicates and retains account-only and invitation-only members", async () => {
  const { db } = fixture([
    { nickname: "가람", pw_hash: "hash" }, { nickname: "다솔", pw_hash: null }, { nickname: "구나", is_admin: true }
  ], [{ nickname: "가람" }, { nickname: "나래" }]);
  const rows = await db.listMembers();
  assert.equal(rows.length, 4);
  assert.equal(rows[0].nickname, "구나");
  assert.equal(rows.find(row => row.nickname === "가람").allowed, true);
  assert.equal(rows.find(row => row.nickname === "다솔").registered, true);
  assert.equal(rows.find(row => row.nickname === "다솔").allowed, false);
  assert.equal(rows.find(row => row.nickname === "다솔").needsPw, true);
  assert.equal(rows.find(row => row.nickname === "나래").registered, false);
});

test("member list loads every page instead of silently truncating large lists", async () => {
  const rows = Array.from({ length: 1005 }, (_, i) => ({ nickname: "회원" + i }));
  const { db } = fixture(rows, rows.concat({ nickname: "가입전" }));
  assert.equal((await db.listMembers()).length, 1006);
});

test("member-management departures are hidden without deleting retained accounts", async () => {
  const { db, state } = fixture([
    { nickname: "활동", pw_hash: "keep" }, { nickname: "탈퇴", member_departed: true, pw_hash: "retained" }
  ], [{ nickname: "활동" }, { nickname: "탈퇴" }]);
  const rows = await db.listMembers();
  assert.deepEqual(Array.from(rows, row => row.nickname), ["활동"]);
  assert.equal(state.accounts.length, 2);
  assert.equal(state.accounts[1].pw_hash, "retained");
});

test("either list failing rejects the combined list rather than mislabeling members", async () => {
  for (const table of ["accounts", "allowlist"]) {
    const { db, state } = fixture([{ nickname: "가람" }], [{ nickname: "가람" }]);
    state.failRead = table;
    await assert.rejects(db.listMembers());
  }
});

test("member deletion revokes invitation before deleting account, and can be repeated", async () => {
  const { db, state } = fixture([{ nickname: "가람" }], [{ nickname: "가람" }]);
  assert.equal((await db.deleteMember("가람")).error, null);
  assert.deepEqual(state.calls.filter(call => call[1] === "delete"), [["allowlist", "delete", "가람"], ["accounts", "delete", "가람"]]);
  assert.equal(state.accounts.length, 0);
  assert.equal(state.allowlist.length, 0);
  assert.equal((await db.deleteMember("가람")).error, null);
});

test("failed permission deletion leaves account intact and does not report success", async () => {
  const { db, state } = fixture([{ nickname: "가람" }], [{ nickname: "가람" }]);
  state.fail = "allowlist";
  assert.equal((await db.deleteMember("가람")).error, true);
  assert.equal(state.accounts.length, 1);
  assert.equal(state.calls.some(call => call[0] === "accounts" && call[1] === "delete"), false);
});

test("account errors and network failures explain partial completion and support retry", async () => {
  for (const failure of ["fail", "reject"]) {
    const { db, state } = fixture([{ nickname: "가람" }], [{ nickname: "가람" }]);
    state[failure] = "accounts";
    const result = await db.deleteMember("가람");
    assert.equal(result.error, true);
    assert.match(result.message, /가입 허용은 해제됐지만/);
    assert.equal(state.allowlist.length, 0);
    assert.equal(state.accounts.length, 1);
    state[failure] = null;
    assert.equal((await db.deleteMember("가람")).error, null);
    assert.equal(state.accounts.length, 0);
  }
});

test("account-only and invitation-only members can both be removed", async () => {
  for (const accounts of [[], [{ nickname: "가람" }]]) {
    const { db, state } = fixture(accounts, accounts.length ? [] : [{ nickname: "가람" }]);
    assert.equal((await db.deleteMember("가람")).error, null);
    assert.equal(state.accounts.length + state.allowlist.length, 0);
  }
});

test("administrator and failed account lookup never mutate member records", async () => {
  const { db, state } = fixture([{ nickname: "부관리자", is_admin: true }], [{ nickname: "부관리자" }]);
  assert.equal((await db.deleteMember("구나")).error, true);
  assert.equal((await db.deleteMember("부관리자")).error, true);
  state.failRead = "accounts";
  assert.equal((await db.deleteMember("가람")).error, true);
  assert.equal(state.calls.some(call => call[1] === "delete"), false);
});

test("offline member management cannot report successful reads or deletions", async () => {
  const context = { window: { SB: null } };
  vm.runInNewContext(source, context);
  await assert.rejects(context.window.Db.listMembers());
  assert.equal((await context.window.Db.deleteMember("가람")).error, true);
});
