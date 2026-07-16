"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");
const inlineScripts = Array.from(index.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1]);
const shellSource = inlineScripts.find((source) => source.includes("window.AppShell ="));
const loaderSource = inlineScripts.find((source) => source.includes("var files = ["));

test("the app shell versions every local runtime asset from one build", () => {
  assert.match(index, /<meta name="app-build" content="[^"]+">/);
  assert.match(index, /Date\.parse\(document\.lastModified\)/);
  assert.match(index, /window\.AppShell = \{ build: build, assetUrl: assetUrl, refresh: refresh \}/);
  assert.match(index, /style\.href = assetUrl\("styles\.css"\)/);

  const files = [
    "config.js",
    "sb.js",
    "db.js",
    "renju.js",
    "omok-ai.js",
    "omok-ai-v2.js",
    "net.js",
    "alkkagi.js",
    "game-catalog.js",
    "catchmind-words.js",
    "catchmind.js",
    "game.js"
  ];
  for (const file of files) assert.match(index, new RegExp('\\{ src: "' + file.replace(".", "\\.") + '" \\}'));

  assert.match(index, /script\.src = file\.external \? file\.src : shell\.assetUrl\(file\.src\)/);
  assert.doesNotMatch(index, /<script src="(?!https:\/\/)[^"]+\.js/);
});

test("the app shell loads local scripts sequentially with the same revision", () => {
  const styles = [];
  const scripts = [];
  const values = new Map();
  const lastModified = "07/16/2026 21:50:58";
  const document = {
    lastModified,
    querySelector() { return { content: "test-build" }; },
    createElement(tagName) { return { tagName }; },
    head: { appendChild(node) { styles.push(node); } },
    body: { appendChild(node) { scripts.push(node); } }
  };
  const window = {
    location: {
      href: "https://example.test/",
      replace(value) { this.replaced = value; },
      reload() { this.reloaded = true; }
    }
  };
  const context = {
    window,
    document,
    sessionStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); }
    },
    URL,
    console,
    encodeURIComponent
  };

  vm.runInNewContext(shellSource, context);
  vm.runInNewContext(loaderSource, context);

  const version = "test-build-" + Date.parse(lastModified);
  assert.equal(styles[0].href, "styles.css?v=" + encodeURIComponent(version));
  assert.equal(scripts[0].src, "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");

  while (scripts.length < 13) scripts[scripts.length - 1].onload();
  assert.equal(scripts[1].src, "config.js?v=" + encodeURIComponent(version));
  assert.equal(scripts[12].src, "game.js?v=" + encodeURIComponent(version));
});

test("room entry is not blocked by an HTML and JavaScript build label mismatch", () => {
  assert.doesNotMatch(game, /shell\.content\s*!==/);
  assert.doesNotMatch(game, /var APP_BUILD\s*=/);
  assert.match(game, /url\.searchParams\.set\("app_refresh", String\(now\)\)/);
});

test("late-loaded game code still binds the interface", () => {
  assert.match(game, /if \(document\.readyState === "loading"\) document\.addEventListener\("DOMContentLoaded", bind\);\s*else bind\(\);/);
});
