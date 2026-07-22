"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function idCount(id) {
  return Array.from(index.matchAll(new RegExp(`id=["']${id}["']`, "g"))).length;
}

test("Territory Rush exposes one accessible element for every live UX state", () => {
  [
    "territory-lobby-copy",
    "territory-countdown",
    "territory-countdown-value",
    "territory-status",
    "territory-status-title",
    "territory-status-detail",
    "territory-respawn-time",
    "territory-status-announcement",
    "territory-area-shell",
    "territory-focus-hud",
    "territory-focus-name",
    "territory-focus-area"
  ].forEach((id) => assert.equal(idCount(id), 1, `${id} should exist exactly once`));

  assert.match(index, /id="territory-countdown"[^>]*role="status"[^>]*aria-live="assertive"/);
  assert.match(index, /id="territory-status-announcement"[^>]*role="status"[^>]*aria-live="assertive"/);
  assert.doesNotMatch(index, /id="territory-focus-hud"[^>]*aria-live=/);
  assert.match(index, /class="territory-lobby-guide"[\s\S]*id="territory-lobby-copy"/);
});

test("Territory Rush keeps results scrollable while rematch actions stay visible", () => {
  assert.match(index, /id="territory-finished"[\s\S]*class="territory-finished-scroll"[\s\S]*class="territory-finished-actions territory-sticky-actions"/);
  assert.match(styles, /\.territory-finished-scroll\s*\{[^}]*overflow-y:\s*auto;/);
  assert.match(styles, /\.territory-sticky-actions\s*\{[^}]*flex:\s*0 0 auto;/);
});

test("Territory Rush chat has a mobile send affordance and accessible name", () => {
  assert.equal(idCount("territory-chat-send"), 1);
  assert.match(index, /for="territory-chat-input">채팅 메시지<\/label>/);
  assert.match(index, /id="territory-chat-input"[^>]*enterkeyhint="send"/);
  assert.match(index, /id="territory-chat-send"[^>]*aria-label="채팅 보내기"/);
  assert.match(styles, /\.territory-chat-row #territory-chat-send\s*\{/);
  assert.match(styles, /min-height:\s*44px/);
});
