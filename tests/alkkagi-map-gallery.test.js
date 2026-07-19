const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function fakeContext() {
  const calls = [];
  const ctx = { calls };
  [
    "save", "restore", "clearRect", "scale", "beginPath", "moveTo", "lineTo",
    "quadraticCurveTo", "bezierCurveTo", "closePath", "clip", "fill", "stroke",
    "arc", "ellipse", "translate", "rotate", "fillRect", "strokeRect", "setLineDash", "drawImage"
  ].forEach((name) => {
    ctx[name] = (...args) => calls.push([name, ...args]);
  });
  return ctx;
}

test("map catalog exposes all nine visual themes", () => {
  const source = fs.readFileSync(path.join(root, "alkkagi-maps.js"), "utf8");
  const sandbox = { window: {}, Image: function () { this.complete = false; this.naturalWidth = 0; } };
  vm.runInNewContext(source, sandbox);
  const maps = sandbox.window.AlkkagiMaps.all();

  assert.deepEqual(
    Array.from(maps, (map) => map.id),
    ["base", "ice", "magnet", "blackhole", "wind", "obstacle", "swamp", "portal", "minefield"]
  );
  assert.equal(maps[0].desc, "기존 나무 바둑판");
});

test("every map renders at the shared 340 by 440 board ratio", () => {
  const source = fs.readFileSync(path.join(root, "alkkagi-maps.js"), "utf8");
  const sandbox = { window: {}, Image: function () { this.complete = false; this.naturalWidth = 0; } };
  vm.runInNewContext(source, sandbox);
  const maps = sandbox.window.AlkkagiMaps;

  maps.all().forEach((map) => {
    const ctx = fakeContext();
    assert.doesNotThrow(() => maps.draw(ctx, 340, 440, map.id));
    assert.ok(ctx.calls.some((call) => call[0] === "clip"), `${map.id} should use the shared board silhouette`);
  });
});

test("alkkagi canvases use a high-density backing store without changing logical coordinates", () => {
  const mapsSource = fs.readFileSync(path.join(root, "alkkagi-maps.js"), "utf8");
  const gameSource = fs.readFileSync(path.join(root, "game.js"), "utf8");
  const alkkagiSource = fs.readFileSync(path.join(root, "alkkagi.js"), "utf8");
  const context = fakeContext();
  context.setTransform = (...args) => context.calls.push(["setTransform", ...args]);
  const canvas = { width: 340, height: 440, getContext: () => context };
  const sandbox = {
    window: { devicePixelRatio: 3 },
    Image: function () { this.complete = false; this.naturalWidth = 0; }
  };
  vm.runInNewContext(mapsSource, sandbox);

  const prepared = sandbox.window.AlkkagiMaps.prepareCanvas(canvas, 340, 440);
  assert.equal(prepared, context);
  assert.equal(canvas.width, 1020);
  assert.equal(canvas.height, 1320);
  assert.deepEqual(context.calls.at(-1), ["setTransform", 3, 0, 0, 3, 0, 0]);
  assert.match(alkkagiSource, /AlkkagiMaps\.prepareCanvas\(cv, SW, SH\)/);
  assert.match(gameSource, /AlkkagiMaps\.prepareCanvas\(canvas, 170, 220\)/);
  assert.match(gameSource, /AlkkagiMaps\.prepareCanvas\(preview, 170, 220\)/);
  assert.match(alkkagiSource, /\/ r\.width \* SW/);
  assert.match(alkkagiSource, /\/ r\.height \* SH/);
});

test("special map backgrounds and gameplay objects are separate image assets", () => {
  const source = fs.readFileSync(path.join(root, "alkkagi-maps.js"), "utf8");
  const sandbox = { window: {}, Image: function () { this.complete = false; this.naturalWidth = 0; } };
  vm.runInNewContext(source, sandbox);
  const maps = sandbox.window.AlkkagiMaps;

  maps.all().slice(1).forEach((map) => {
    assert.match(map.background, /^bg-.+\.png$/);
  });
  ["magnet", "blackhole", "wind", "obstacle", "swamp", "portal", "minefield"].forEach((id) => {
    assert.match(maps.get(id).object, /^object-.+\.png$/);
    assert.ok(maps.createObjects(id, "test-seed").length > 0);
  });
  assert.notEqual(maps.drawBackground, maps.drawObjects);
});

test("the live alkkagi screen loads and exposes the map gallery", () => {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const game = fs.readFileSync(path.join(root, "game.js"), "utf8");
  const alkkagi = fs.readFileSync(path.join(root, "alkkagi.js"), "utf8");

  assert.match(index, /\{ src: "alkkagi-maps\.js" \},\s*\{ src: "alkkagi\.js" \}/);
  assert.match(index, /id="alk-map-gallery-btn"/);
  assert.match(index, /id="alk-map-grid"/);
  assert.match(index, /id="alk-map-random-btn"/);
  assert.match(index, /id="alk-map-roulette"/);
  assert.match(index, /id="alk-roulette-canvas"/);
  assert.match(game, /AlkkagiMaps\.all\(\)/);
  assert.match(game, /requestAlkMapSelection\(map\.id\)/);
  assert.match(game, /mapId: A\.mapId \|\| "base", mapObjects: Alkkagi\.getMapObjects\(\)/);
  assert.match(game, /function showAlkMapRoulette\(chosenId, seed, onDone\)/);
  assert.match(game, /prepareAlkMapForGame\("match"/);
  assert.match(game, /mapMode: A\.mapMode === "fixed" \? "fixed" : "random"/);
  assert.match(game, /case "alk_roulette": onRemoteAlkRoulette\(msg\)/);
  assert.match(game, /host !== "127\.0\.0\.1" && host !== "localhost"/);
  assert.match(game, /params\.get\("preview"\) !== "alk-maps"/);
  assert.match(alkkagi, /setMap: setMap, setMapState: setMapState, getMap: getMap/);
});

test("alkkagi waiting screen offers separate random and selected-map start actions", () => {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const game = fs.readFileSync(path.join(root, "game.js"), "utf8");

  assert.match(index, /id="alk-start-actions"/);
  assert.match(index, /id="alk-random-start-btn"[\s\S]*랜덤 맵 시작/);
  assert.match(index, /id="alk-select-start-btn"[\s\S]*맵 선택 시작/);
  assert.match(index, /id="alk-map-dialog-action"[\s\S]*선택한 맵 보기/);
  assert.match(styles, /\.alk-start-actions \{/);
  assert.match(styles, /#alk-map-modal\.start-selecting \.alk-map-random-btn \{ display: none; \}/);
  assert.match(game, /function startAlkWithRandomMap\(\)[\s\S]*requestAlkRandomMode\(\);[\s\S]*runAlkStartAction/);
  assert.match(game, /function openAlkMapStartPicker\(\)/);
  assert.match(game, /function confirmAlkMapStart\(\)[\s\S]*requestAlkMapSelection\(A\.mapId \|\| "base"\)/);
  assert.match(game, /\$\("alk-random-start-btn"\)\.addEventListener\("click", startAlkWithRandomMap\)/);
  assert.match(game, /\$\("alk-select-start-btn"\)\.addEventListener\("click", openAlkMapStartPicker\)/);
});

test("random stage roulette slows down and avoids repeating the current map", () => {
  const game = fs.readFileSync(path.join(root, "game.js"), "utf8");
  const intervalsMatch = game.match(/var intervals = \[([^\]]+)\]/);

  assert.ok(intervalsMatch);
  const intervals = intervalsMatch[1].split(",").map((value) => Number(value.trim()));
  assert.ok(intervals.length >= 10);
  for (let i = 2; i < intervals.length; i++) {
    assert.ok(intervals[i] > intervals[i - 1], `interval ${i} should be slower than the previous tick`);
  }
  assert.match(game, /maps\.filter\(function \(map\) \{ return map\.id !== A\.mapId; \}\)/);
  assert.match(game, /if \(A\.mapMode !== "random"\) \{\s*applyAlkMapSelection/);
  assert.match(game, /order\.push\(chosen\)/);
  assert.match(game, /playAlkRouletteTick\(\);\s*drawAlkRouletteMap\(map, seed \+ ":" \+ index\)/);
  assert.match(game, /fetch\("assets\/alkkagi-roulette\.mp3"\)/);
  assert.match(game, /function playAlkRouletteTick\(\)/);
  assert.equal(fs.existsSync(path.join(root, "assets/alkkagi-roulette.mp3")), true);
});
