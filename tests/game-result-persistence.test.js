"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));
function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: i => Array.from(values.keys())[i],
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key) };
}
function loadDb({ disk = storage(), write = () => ({ error: null }) } = {}) {
  const writes = [], timers = new Map();
  let sequence = 0;
  const window = { SB: { from(table) {
    assert.equal(table, "games");
    return { upsert(row, options) {
      const copy = JSON.parse(JSON.stringify(row));
      writes.push({ row: copy, options: JSON.parse(JSON.stringify(options)) });
      return write(copy, options);
    } };
  } }, crypto: { randomUUID: () => `result-${++sequence}` } };
  vm.runInNewContext(source, { window, localStorage: disk, console,
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); } }, { filename: "db.js" });
  return { db: window.Db, writes, timers, disk, retry() {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id); timer.fn();
  } };
}
const record = (id = "match-1", owner = "A", game = "omok") => ({ id, owner, game,
  black: "A", white: "B", winner: "black", moves: [{ r: 7, c: 7, color: 1 }] });

test("resolved database errors retain a frozen match, then retry and notify success only after saving", async () => {
  let failed = true;
  const fixture = loadDb({ write: () => ({ error: failed ? { message: "offline" } : null }) });
  const events = [], original = record();
  fixture.db.queueGameResult(original, (status, item) => events.push([status, item.id]));
  original.moves[0].r = 0;
  original.black = "next player";
  await flush();
  assert.deepEqual(events, [["failed", "match-1"]]);
  assert.equal(fixture.disk.length, 1);
  assert.equal(fixture.timers.values().next().value.delay, 1000);
  failed = false;
  fixture.retry();
  await flush();
  assert.deepEqual(events, [["failed", "match-1"], ["saved", "match-1"]]);
  assert.deepEqual(fixture.writes[0].row, fixture.writes[1].row);
  assert.equal(fixture.writes[1].row.moves[0].r, 7);
  assert.equal(fixture.disk.length, 0);
});

test("lost acknowledgement retries the same unique ID without another result", async () => {
  const rows = new Map();
  let first = true;
  const fixture = loadDb({ write(row, options) {
    assert.equal(options.onConflict, "result_id");
    assert.equal(options.ignoreDuplicates, true);
    if (!rows.has(row.result_id)) rows.set(row.result_id, row);
    if (first) { first = false; return Promise.reject(new Error("ack lost")); }
    return { error: null };
  } });
  fixture.db.queueGameResult(record());
  fixture.db.queueGameResult(record());
  await flush();
  assert.equal(fixture.writes.length, 1);
  fixture.retry();
  await flush();
  assert.equal(rows.size, 1);
  assert.equal(fixture.disk.length, 0);
});

test("reload restores only the logged-in owner's results without overwriting another tab's queue", async () => {
  const disk = storage();
  const offline = () => ({ error: { message: "offline" } });
  const first = loadDb({ disk, write: offline }), second = loadDb({ disk, write: offline });
  first.db.queueGameResult(record("one"));
  second.db.queueGameResult(record("two", "A", "alk"));
  first.db.queueGameResult(record("three", "B", "alk_terr"));
  await flush();
  assert.equal(disk.length, 3);
  const reloaded = loadDb({ disk });
  reloaded.db.retryGameResults("A");
  await flush();
  assert.deepEqual(reloaded.writes.map(w => w.row.result_id), ["one", "two"]);
  assert.equal(disk.length, 1);
  reloaded.db.retryGameResults("B");
  await flush();
  assert.equal(reloaded.writes[2].row.game, "alk_terr");
  assert.equal(disk.length, 0);
});

test("a missing moves column retries without moves while retaining result identity", async () => {
  const fixture = loadDb({ write: row => ({ error: row.moves ? { code: "PGRST204", message: "moves missing" } : null }) });
  fixture.db.queueGameResult(record());
  await flush();
  assert.equal(fixture.writes.length, 2);
  assert.equal(fixture.writes[1].row.result_id, "match-1");
  assert.equal(fixture.writes[1].row.moves, undefined);
  assert.equal(fixture.disk.length, 0);
});

test("a delayed save cannot mark a subsequent match as recorded", () => {
  const game = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
  const start = game.indexOf("  function queueRecordedGame(");
  const end = game.indexOf("  // ---------- 무르기", start);
  const events = [], toasts = [];
  const context = { window: {}, Db: {}, me: { nick: "A" }, G: { resultId: "next", recorded: false },
    A: { resultId: "alk-next", recorded: false }, Net: { sendLobby: m => events.push(m) },
    refreshScores() {}, toast: t => toasts.push(t) };
  vm.createContext(context);
  vm.runInContext(game.slice(start, end), context);
  context.onGameResultStatus("failed", { owner: "A", game: "omok", id: "previous" });
  assert.equal(context.G.recorded, false);
  assert.equal(events.length, 0);
  context.onGameResultStatus("saved", { owner: "A", game: "omok", id: "previous" });
  assert.equal(context.G.recorded, false);
  context.onGameResultStatus("saved", { owner: "A", game: "omok", id: "next" });
  assert.equal(context.G.recorded, true);
  assert.equal(toasts.length, 1);
});
