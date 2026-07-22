"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const script = fs.readFileSync(path.join(root, "territory-rush.js"), "utf8");

function tagFor(id) {
  const match = index.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`));
  assert.ok(match, `${id} should exist`);
  return match[0];
}

function cssRule(selectorPattern) {
  const match = styles.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selectorPattern} rule should exist`);
  return match[1];
}

test("the complete local-area pill has a stable shell that spectator mode can hide", () => {
  assert.match(
    index,
    /id="territory-area-shell" class="territory-area">[\s\S]*?id="territory-my-dot"[\s\S]*?id="territory-area-label"[\s\S]*?id="territory-area"[\s\S]*?<\/div>/
  );
});

test("the focus HUD starts hidden and is not a frequently updating live region", () => {
  const focusTag = tagFor("territory-focus-hud");
  assert.match(focusTag, /class="[^"]*\bhidden\b[^"]*"/);
  assert.match(focusTag, /aria-hidden="true"/);
  assert.doesNotMatch(focusTag, /aria-live=|role="status"/);
});

test("death copy announces once through a separate visually-hidden status node", () => {
  const visualStatusTag = tagFor("territory-status");
  const announcementTag = tagFor("territory-status-announcement");

  assert.doesNotMatch(visualStatusTag, /aria-live=|role="status"/);
  assert.match(visualStatusTag, /aria-hidden="true"/);
  assert.match(announcementTag, /role="status"/);
  assert.match(announcementTag, /aria-live="assertive"/);
  assert.match(announcementTag, /aria-atomic="true"/);

  const hiddenAnnouncement = cssRule("\\.territory-status-announcement");
  assert.match(hiddenAnnouncement, /position:\s*absolute;/);
  assert.match(hiddenAnnouncement, /width:\s*1px;/);
  assert.match(hiddenAnnouncement, /clip-path:\s*inset\(50%\);/);
});

test("spectator mode removes the irrelevant swipe hint, including reduced-motion layouts", () => {
  const spectatorHint = cssRule("\\.territory-screen\\.is-playing\\.is-spectating \\.territory-swipe-hint");
  assert.match(spectatorHint, /display:\s*none;/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.territory-screen\.is-playing \.territory-swipe-hint\s*\{\s*opacity:\s*0;\s*\}/
  );
});

test("mobile chat keeps a 44px send target and 62px clearance for every lower HUD", () => {
  const sendButton = cssRule("\\.territory-chat-row #territory-chat-send");
  const chatOverlay = cssRule("\\.territory-chat-overlay");
  const localArea = cssRule("\\.territory-screen\\.is-playing\\.chat-enabled \\.territory-area");
  const focusHud = cssRule("\\.territory-screen\\.is-playing\\.chat-enabled \\.territory-focus-hud");

  assert.match(sendButton, /min-height:\s*44px;/);
  [chatOverlay, localArea, focusHud].forEach((rule) => {
    assert.match(rule, /bottom:\s*calc\(max\(8px, env\(safe-area-inset-bottom\)\) \+ 62px\);/);
  });
});

test("spectator HUD state is connected to the complete shell and only exposed during play", () => {
  assert.match(script, /var areaShell = \$\("territory-area-shell"\);/);
  assert.match(script, /var focusVisible = state\.phase === "playing" && spectator && !!focused;/);
  assert.match(script, /setHidden\(areaShell, state\.phase !== "playing" \|\| spectator\);/);
  assert.match(script, /setHidden\(focusShell, !focusVisible\);/);
  assert.match(script, /root\.classList\.toggle\("is-spectating", state\.phase === "playing" && isLocalSpectator\(\)\);/);
});

test("death announcements and mobile chat focus are updated without timer spam", () => {
  assert.match(script, /var announcementKey = \[state\.matchId, mine\.deathSeq, mine\.deadUntil, reason, mine\.deathBy\]\.join\(":"\);/);
  assert.match(script, /announcementKey !== lastStatusAnnouncementKey/);
  assert.match(script, /input\.value = "";\s*try \{ input\.focus\(\{ preventScroll: true \}\); \} catch \(error\) \{ input\.focus\(\); \}/);
});
