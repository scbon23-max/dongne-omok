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
const relay = fs.readFileSync(path.join(root, "relay-drawing.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "202607210001_relay_gallery.sql"), "utf8");
const edgeFunction = fs.readFileSync(path.join(root, "supabase", "functions", "relay-gallery", "index.ts"), "utf8");
const supabaseConfig = fs.readFileSync(path.join(root, "supabase", "config.toml"), "utf8");

test("relay albums open from the lobby and the room", () => {
  assert.match(index, /id="lobby-relay-gallery-btn"/);
  assert.match(index, /id="relay-gallery-btn"/);
  assert.match(index, /id="relay-gallery-backdrop"/);
  assert.match(index, /id="relay-gallery-grid"/);
  assert.match(index, /id="relay-gallery-preview-chain"/);
  assert.match(game, /lobby-relay-gallery-btn[\s\S]{0,300}RelayDrawing\.openGallery\(controllerApi\(\)\)/);
  assert.match(relay, /openGallery:\s*openGallery/);
  assert.match(styles, /\.relay-gallery-dialog\s*\{/);
  assert.match(styles, /\.relay-gallery-preview-chain\s*\{/);
});

test("gallery storage keeps only one hundred compact WebP albums", () => {
  assert.match(migration, /create table if not exists public\.relay_albums/);
  assert.match(migration, /create table if not exists public\.relay_album_entries/);
  assert.match(migration, /references public\.relay_albums\(id\) on delete cascade/);
  assert.match(migration, /limit 100/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /153600/);
  assert.match(migration, /array\['image\/webp'\]/);
  assert.match(edgeFunction, /RECENT_LIMIT\s*=\s*100/);
  assert.match(edgeFunction, /MAX_IMAGE_BYTES\s*=\s*153600/);
  assert.match(edgeFunction, /verifyAccount/);
  assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edgeFunction, /rpc\("relay_gallery_prune_candidates"/);
  assert.match(edgeFunction, /storage\.from\(BUCKET\)\.remove\(paths\)/);
  assert.match(supabaseConfig, /\[functions\.relay-gallery\]\s+verify_jwt\s*=\s*false/);
});

test("album lists are paged while full chains load only on selection", () => {
  assert.match(relay, /GALLERY_PAGE_SIZE\s*=\s*10/);
  assert.match(relay, /loadRelayAlbums\(galleryOffset, GALLERY_PAGE_SIZE\)/);
  assert.match(relay, /loading="lazy"/);
  assert.match(relay, /async function openGalleryDetail\(id\)[\s\S]*?api\.loadRelayAlbum\(row\.id\)/);
  assert.match(edgeFunction, /select\("id,origin,start_text,player_count,entry_count,cover_path,created_at"/);
  assert.match(edgeFunction, /async function albumDetail/);
});

test("only the host snapshots finished chains for gallery storage", () => {
  assert.match(relay, /state\.phase\s*=\s*"finished"[\s\S]{0,220}saveFinishedAlbums\(\)/);
  assert.match(relay, /function saveFinishedAlbums\(\)[\s\S]{0,180}!api\.isHost\(\)/);
  assert.match(relay, /output\.toBlob\([\s\S]{0,300}"image\/webp"/);
  assert.match(relay, /GALLERY_IMAGE_SIZE\s*=\s*480/);
  assert.match(relay, /GALLERY_IMAGE_MAX_BYTES\s*=\s*153600/);
});

test("relay gallery database calls include account proof and clamp page sizes", async () => {
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

  const auth = { nick: "A", hash: "a".repeat(64) };
  await context.window.Db.getRelayAlbums(auth, -5, 999);
  await context.window.Db.getRelayAlbum(auth, 12);

  assert.equal(calls[0].name, "relay-gallery");
  assert.equal(calls[0].body.action, "list");
  assert.equal(calls[0].body.offset, 0);
  assert.equal(calls[0].body.limit, 20);
  assert.equal(calls[0].body.auth.nick, "A");
  assert.equal(calls[0].body.auth.hash, "a".repeat(64));
  assert.equal(calls[1].body.action, "detail");
  assert.equal(calls[1].body.albumId, 12);
});
