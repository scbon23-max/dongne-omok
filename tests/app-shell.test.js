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
    "pro-hint-explain.js",
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

  while (scripts.length < 14) scripts[scripts.length - 1].onload();
  assert.equal(scripts[1].src, "config.js?v=" + encodeURIComponent(version));
  assert.equal(scripts[5].src, "pro-hint-explain.js?v=" + encodeURIComponent(version));
  assert.equal(scripts[13].src, "game.js?v=" + encodeURIComponent(version));
});

test("room entry is not blocked by an HTML and JavaScript build label mismatch", () => {
  assert.doesNotMatch(game, /shell\.content\s*!==/);
  assert.doesNotMatch(game, /var APP_BUILD\s*=/);
  assert.match(game, /url\.searchParams\.set\("app_refresh", String\(now\)\)/);
});

test("late-loaded game code still binds the interface", () => {
  assert.match(game, /if \(document\.readyState === "loading"\) document\.addEventListener\("DOMContentLoaded", bind\);\s*else bind\(\);/);
});

test("the CatchMind result dialog is wired to the shared season rating calculation", () => {
  assert.match(index, /id="catch-result-backdrop"/);
  assert.match(index, /id="catch-result-list"/);
  assert.match(index, /id="catch-result-open-btn"/);
  assert.match(index, /id="catch-stage-marks"/);
  assert.match(index, /id="catch-lobby-roles"/);
  assert.match(index, /id="catch-round-highlights"/);
  assert.match(index, /id="catch-highlight-fast-value"/);
  assert.match(game, /resultSummary: function \(matchId, results\)/);
  assert.match(game, /function buildCatchmindResultSummary\(matchId, results\)/);
  assert.match(game, /aggregateCatchmind\(priorGames\.concat\(virtualRows\)\)/);
});

test("the Omok board uses a HiDPI backing store with logical input coordinates", () => {
  assert.match(game, /var BOARD_SIZE = 450/);
  assert.match(game, /Math\.min\(3, Number\(window\.devicePixelRatio\) \|\| 1\)/);
  assert.match(game, /canvas\.width = backingSize/);
  assert.match(game, /ctx\.setTransform\(renderScale, 0, 0, renderScale, 0, 0\)/);
  assert.match(game, /ctx\.imageSmoothingQuality = "high"/);
  assert.match(game, /var W = BOARD_SIZE/);
  assert.match(game, /var scale = BOARD_SIZE \/ rect\.width/);
  assert.match(game, /var canvas, ctx, MARGIN = 28, GAP, RADIUS/);
  assert.match(game, /ctx\.shadowBlur = RADIUS \* 0\.28 \* boardPixelRatio/);
  assert.match(game, /ctx\.shadowOffsetX = RADIUS \* 0\.1 \* boardPixelRatio/);
  assert.match(game, /ctx\.shadowOffsetY = RADIUS \* 0\.18 \* boardPixelRatio/);
  assert.match(game, /var STONE_SOURCE_INSET = 0\.09/);
  assert.match(game, /RADIUS = GAP \* 0\.5/);
  assert.match(game, /ctx\.drawImage\(img, sourceX, sourceY, sourceWidth, sourceHeight, x - size \/ 2/);
  assert.match(game, /if \(position\.lastMove\) drawLastMoveMarker\(position\.lastMove, board\)/);
  assert.match(game, /strokeBoundaryCircle\(ctx, px\(move\.c\), px\(move\.r\), RADIUS, "#D94A2F", 2\)/);
  assert.doesNotMatch(game, /#FFB347/);
  assert.match(game, /function strokeBoundaryCircle[\s\S]*target\.arc\(x, y, radius, 0, Math\.PI \* 2\)/);
  assert.match(game, /strokeBoundaryCircle\(ctx, px\(move\.c\), px\(move\.r\), RADIUS,[^;]*, 2\)/);
  assert.doesNotMatch(game, /strokeInsideCircle/);
  assert.match(game, /drawStoneShadow\(px\(sc\), px\(sr\), board\[sr\]\[sc\]\)[\s\S]*drawStone\(px\(c\), px\(r\), board\[r\]\[c\]\)/);
  assert.doesNotMatch(game, /ctx\.arc\([^;]*RADIUS \+/);
});
