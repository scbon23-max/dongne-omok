"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");
const net = fs.readFileSync(path.join(root, "net.js"), "utf8");
const sb = fs.readFileSync(path.join(root, "sb.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function idCount(id) {
  return (index.match(new RegExp(`id="${id}"`, "g")) || []).length;
}

test("the lobby presence monitor is available only through admin UI", () => {
  [
    "presence-monitor-btn",
    "presence-monitor-modal",
    "presence-monitor-status",
    "presence-monitor-detail",
    "presence-monitor-users",
    "presence-monitor-sessions",
    "presence-monitor-lobby",
    "presence-monitor-rooms",
    "presence-monitor-list",
    "presence-monitor-events",
    "presence-monitor-reconnect"
  ].forEach((id) => assert.equal(idCount(id), 1, `${id} must be unique`));

  assert.match(index, /id="presence-monitor-btn" class="menu-item admin-only"/);
  assert.match(index, /id="presence-monitor-modal" class="modal-overlay hidden admin-only"/);
  assert.match(game, /function openPresenceMonitor\(\) \{\s*if \(!me\.isAdmin\) return;/);
  assert.match(game, /function reconnectLobbyPresence\(\) \{\s*if \(!me\.isAdmin \|\| !window\.Net\) return;/);
});

test("the monitor renders full synchronized state and flags stale lobby data", () => {
  assert.match(game, /if \(options && options\.event && options\.event !== "sync"\) return;/);
  assert.match(game, /lobbyPresenceLastSyncAt = Date\.now\(\);/);
  assert.match(game, /lobbyPresenceStale = false;/);
  assert.match(game, /presenceCount/);
  assert.match(game, /lobbyPresenceLocation\(member\)/);
  assert.match(game, /현재 명단은 마지막 정상 동기화 기준입니다/);
  assert.match(game, /접속자 확인 중/);
  assert.match(styles, /\.online-list\.is-stale \.online-item/);
  assert.match(styles, /\.presence-monitor-metrics\s*\{[\s\S]*grid-template-columns:\s*repeat\(4/);
});

test("Supabase Realtime uses a pinned client with worker heartbeats", () => {
  assert.match(index, /@supabase\/supabase-js@2\.111\.0/);
  assert.match(sb, /worker:\s*true/);
  assert.match(sb, /heartbeatCallback:\s*reportHeartbeat/);
  assert.match(sb, /dongne-realtime-heartbeat/);
  assert.match(sb, /client\.realtime\.connect\(\)/);
  assert.match(game, /window\.addEventListener\("dongne-realtime-heartbeat", onRealtimeHeartbeat\)/);
});

test("lobby presence registration records status and retries failures", () => {
  assert.match(net, /function trackLobbyPresence\(reason\)/);
  assert.match(net, /scheduleLobbyTrackRetry\("retry"\)/);
  assert.match(net, /lastTrackStatus:\s*lobbyLastTrackStatus/);
  assert.match(net, /lobbyDiagnostics:\s*lobbyDiagnostics/);
  assert.match(net, /retryLobbyPresence:/);
});
