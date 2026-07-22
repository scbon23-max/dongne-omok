"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");
const catchmind = fs.readFileSync(path.join(root, "catchmind.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "202607180001_catchmind_gallery.sql"), "utf8");
const edgeFunction = fs.readFileSync(path.join(root, "supabase", "functions", "catchmind-gallery", "index.ts"), "utf8");

test("the main lobby opens CatchMind gallery before ranking", () => {
  assert.match(index, /id="lobby-catch-gallery-btn"[\s\S]*?id="lobby-rank-btn"[\s\S]*?id="lobby-menu-btn"/);
  assert.match(index, /id="catch-rank-btn"[\s\S]*?id="catch-gallery-btn"[\s\S]*?id="catch-role-btn"/);
  assert.match(game, /lobby-catch-gallery-btn[\s\S]{0,300}CatchMind\.openGallery\(controllerApi\(\)\)/);
  assert.match(catchmind, /openGallery:\s*openGallery/);
  assert.match(catchmind, /function openGallery\(nextApi\)[\s\S]{0,120}bindGallery\(\)/);
  assert.match(index, /id="catch-gallery-backdrop"/);
  assert.match(index, /id="catch-gallery-recent-tab"/);
  assert.match(index, /id="catch-gallery-favorite-tab"/);
  assert.match(index, /id="catch-gallery-person"/);
  assert.match(index, /id="catch-gallery-preview"/);
  assert.match(styles, /\.cm-gallery-grid\s*\{[^}]*repeat\(2,/);
  assert.match(styles, /\.cm-gallery-thumb\s*\{[^}]*aspect-ratio:\s*1/);
  assert.match(styles, /\.cm-gallery-person-filter\s*\{/);
});

test("gallery can show drawings from only the selected person", () => {
  assert.match(catchmind, /var galleryDrawer = ""/);
  assert.match(catchmind, /function setGalleryDrawer\(drawer\)/);
  assert.match(catchmind, /api\.loadGallery\(galleryMode, galleryOffset, GALLERY_PAGE_SIZE, galleryDrawer, includeDrawers\)/);
  assert.match(catchmind, /galleryPerson\.addEventListener\("change"/);
  assert.match(edgeFunction, /async function galleryDrawers\(/);
  assert.match(edgeFunction, /body\.includeDrawers === true/);
  assert.match(edgeFunction, /query = query\.eq\("drawer", drawer\)/);
  assert.match(edgeFunction, /!drawer \|\| row\.drawer === drawer/);
});

test("gallery schema enforces one thousand recent drawings and twenty favorites per account", () => {
  assert.match(migration, /create table if not exists public\.catchmind_drawings/);
  assert.match(migration, /create table if not exists public\.catchmind_favorites/);
  assert.match(migration, />=\s*20/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /catchmind_gallery_prune_candidates/);
  assert.match(migration, /limit 1000/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /catchmind-gallery/);
  assert.match(edgeFunction, /RECENT_LIMIT\s*=\s*1000/);
  assert.match(edgeFunction, /FAVORITE_LIMIT\s*=\s*20/);
  assert.match(edgeFunction, /rpc\("catchmind_gallery_prune_candidates"/);
  assert.match(edgeFunction, /verifyAccount/);
  assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("gallery database calls include account proof and clamp list sizes", async () => {
  const calls = [];
  const sb = {
    functions: {
      invoke(name, options) {
        calls.push({ name, body: options.body });
        return Promise.resolve({ data: { ok: true, rows: [] }, error: null });
      }
    }
  };
  const context = { window: { SB: sb }, console, crypto: { subtle: {} }, TextEncoder };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "db.js"), "utf8"), context, { filename: "db.js" });

  await context.window.Db.getCatchmindGallery({ nick: "A", hash: "a".repeat(64) }, "favorites", -4, 999, "민서", true);
  await context.window.Db.toggleCatchmindFavorite({ nick: "A", hash: "a".repeat(64) }, 12, true);

  assert.equal(calls[0].name, "catchmind-gallery");
  assert.equal(calls[0].body.action, "list");
  assert.equal(calls[0].body.mode, "favorites");
  assert.equal(calls[0].body.offset, 0);
  assert.equal(calls[0].body.limit, 40);
  assert.equal(calls[0].body.drawer, "민서");
  assert.equal(calls[0].body.includeDrawers, true);
  assert.equal(calls[0].body.auth.nick, "A");
  assert.equal(calls[0].body.auth.hash, "a".repeat(64));
  assert.equal(calls[1].body.action, "favorite");
  assert.equal(calls[1].body.drawingId, 12);
  assert.equal(calls[1].body.favorite, true);
});
