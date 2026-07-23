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
    console,
    Math,
    Date
  };
  vm.runInNewContext(dbSource, context);
  return { Db: context.window.Db, state };
}

test("feedback posts and completion events use an isolated chat namespace", async () => {
  const { Db, state } = createDb([]);

  const post = await Db.submitFeedback("산본", "  버튼 오류  ", "  눌러도 반응이 없어요  ");
  const denied = await Db.completeFeedback("산본", post.id);
  const completed = await Db.completeFeedback("구나", post.id);

  assert.equal(post.ok, true);
  assert.match(post.id, /^fb-[a-z0-9]+-[a-z0-9]+$/);
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "forbidden");
  assert.equal(completed.ok, true);
  assert.equal(state.inserted.length, 2);
  assert.equal(state.inserted[0].room, "__feedback_v1__");
  assert.equal(state.inserted[1].room, "__feedback_v1__");

  const postPayload = JSON.parse(state.inserted[0].text.slice("@feedback:".length));
  const donePayload = JSON.parse(state.inserted[1].text.slice("@feedback:".length));
  assert.deepEqual(
    JSON.parse(JSON.stringify(postPayload)),
    { v: 1, type: "post", id: post.id, title: "버튼 오류", body: "눌러도 반응이 없어요" }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(donePayload)), { v: 1, type: "done", id: post.id });
});

test("feedback history marks only administrator completion events", async () => {
  const rows = [
    { nick: "구나", text: '@feedback:{"v":1,"type":"done","id":"feedback-01"}', created_at: "2026-07-24T05:04:00Z" },
    { nick: "산본", text: '@feedback:{"v":1,"type":"done","id":"feedback-02"}', created_at: "2026-07-24T05:03:00Z" },
    { nick: "베니", text: '@feedback:{"v":1,"type":"post","id":"feedback-02","title":"좋은 의견","body":"이 기능도 넣어주세요"}', created_at: "2026-07-24T05:02:00Z" },
    { nick: "산본", text: '@feedback:{"v":1,"type":"post","id":"feedback-01","title":"버그","body":"화면이 멈췄어요"}', created_at: "2026-07-24T05:01:00Z" },
    { nick: "산본", text: "@feedback:{broken", created_at: "2026-07-24T05:00:00Z" }
  ];
  const { Db, state } = createDb(rows);

  const posts = await Db.getFeedbackPosts(9999);

  assert.equal(state.room, "__feedback_v1__");
  assert.equal(state.limit, 500);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].id, "feedback-02");
  assert.equal(posts[0].completed, false);
  assert.equal(posts[1].id, "feedback-01");
  assert.equal(posts[1].completed, true);
});

test("the lobby exposes feedback composition while the report list stays admin-only", () => {
  assert.match(indexSource, /class="lobby-page-title">로비화면<\/h1>/);
  assert.doesNotMatch(indexSource, /오류·이상이 생기면/);
  assert.match(indexSource, /id="lobby-feedback-btn"/);
  assert.match(indexSource, /id="feedback-badge" class="feedback-badge admin-only hidden"/);
  assert.match(indexSource, /id="feedback-title"/);
  assert.match(indexSource, /id="feedback-body"/);
  assert.match(indexSource, /id="feedback-send-btn"/);
  assert.match(indexSource, /id="feedback-admin-section" class="feedback-admin-section admin-only"/);
  assert.match(indexSource, /id="feedback-list"/);

  assert.match(gameSource, /refreshFeedbackBadge\(\);\s*logLoginOnce\(\)/);
  assert.match(gameSource, /msg\.t === "feedback_new" \|\| msg\.t === "feedback_updated"/);
  assert.match(gameSource, /async function submitFeedbackForm\(\)/);
  assert.match(gameSource, /async function completeFeedbackPost\(id, button\) \{\s*if \(!me\.isAdmin/);
  assert.match(gameSource, /\$\("lobby-feedback-btn"\)\.addEventListener\("click", openFeedbackModal\)/);
  assert.match(gameSource, /\$\("feedback-send-btn"\)\.addEventListener\("click", submitFeedbackForm\)/);
});
