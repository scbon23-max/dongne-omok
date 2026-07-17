"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const gameSource = fs.readFileSync(path.join(root, "game.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

function createDb(rows) {
  const state = { inserted: [], room: null, limit: null };
  const sb = {
    from(table) {
      assert.equal(table, "chat");
      return {
        insert(row) {
          state.inserted.push(row);
          return Promise.resolve({ data: [row], error: null });
        },
        select() {
          const query = {
            eq(column, value) {
              assert.equal(column, "room");
              state.room = value;
              return query;
            },
            order(column, options) {
              assert.equal(column, "created_at");
              assert.equal(options && options.ascending, false);
              return query;
            },
            limit(value) {
              state.limit = value;
              return Promise.resolve({ data: rows || [], error: null });
            }
          };
          return query;
        }
      };
    }
  };
  const context = {
    window: { SB: sb },
    crypto: globalThis.crypto,
    TextEncoder,
    console
  };
  vm.runInNewContext(dbSource, context);
  return { Db: context.window.Db, state };
}

test("activity events use a private chat namespace and keep only needed room metadata", async () => {
  const { Db, state } = createDb([]);

  await Db.recordActivity("구나", "room_create", {
    roomId: "room-1",
    roomName: "저녁 오목",
    game: "omok",
    password: "must-not-be-recorded"
  });
  await Db.recordActivity("구나", "unknown", {});

  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].room, "__admin_activity_v1__");
  assert.equal(state.inserted[0].nick, "구나");
  assert.match(state.inserted[0].text, /^@activity:/);

  const payload = JSON.parse(state.inserted[0].text.slice("@activity:".length));
  assert.deepEqual(
    JSON.parse(JSON.stringify(payload)),
    { v: 1, type: "room_create", roomId: "room-1", roomName: "저녁 오목", game: "omok" }
  );
});

test("activity history ignores malformed rows and returns newest query results", async () => {
  const rows = [
    {
      nick: "구나",
      text: '@activity:{"v":1,"type":"login"}',
      created_at: "2026-07-17T03:08:00Z"
    },
    {
      nick: "산본",
      text: '@activity:{"v":1,"type":"room_leave","roomId":"room-3","roomName":"3번방","game":"omok"}',
      created_at: "2026-07-17T03:05:00Z"
    },
    { nick: "베니", text: "일반 채팅", created_at: "2026-07-17T03:00:00Z" },
    { nick: "베니", text: "@activity:{broken", created_at: "2026-07-17T02:59:00Z" }
  ];
  const { Db, state } = createDb(rows);

  const logs = await Db.getActivityLogs(9999);

  assert.equal(state.room, "__admin_activity_v1__");
  assert.equal(state.limit, 500);
  assert.equal(logs.length, 2);
  assert.equal(logs[0].type, "login");
  assert.equal(logs[1].type, "room_leave");
  assert.equal(logs[1].roomName, "3번방");
});

test("activity history UI and entry point are restricted to admins", () => {
  assert.match(indexSource, /id="activity-log-btn" class="menu-item admin-only"/);
  assert.match(indexSource, /id="activity-log-modal" class="modal-overlay hidden admin-only"/);
  assert.match(gameSource, /async function openActivityLog\(\) {\s*if \(!me\.isAdmin\) return;/);
  assert.match(gameSource, /recordActivity\("login"\)/);
  assert.match(gameSource, /recordActivity\("room_create"/);
  assert.match(gameSource, /logRoomLeave\(leavingActivity\)/);
  assert.match(gameSource, /\$\("logout-btn"\)\.addEventListener\("click", logoutAndReload\)/);
});
