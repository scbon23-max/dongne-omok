window.AlkkagiMaps = (function () {
  "use strict";

  var BASE_W = 340;
  var BASE_H = 440;
  var ASSET_ROOT = "assets/alkkagi-maps/v2/";
  var catalog = [
    { id: "base", name: "기본맵", desc: "기존 나무 바둑판" },
    { id: "ice", name: "얼음맵", desc: "끝없이 미끄러운 빙판", background: "bg-ice.png" },
    { id: "magnet", name: "자석맵", desc: "랜덤 자석 1~3개", background: "bg-magnet.png", object: "object-magnet.png" },
    { id: "blackhole", name: "블랙홀맵", desc: "빠지면 판 밖으로 탈락", background: "bg-blackhole.png", object: "object-blackhole.png" },
    { id: "wind", name: "바람맵", desc: "턴마다 바뀌는 바람", background: "bg-wind.png", object: "object-wind.png" },
    { id: "obstacle", name: "장애물맵", desc: "랜덤 장애물 배치", background: "bg-obstacle.png", object: "object-obstacles.png" },
    { id: "swamp", name: "늪지맵", desc: "랜덤 늪지에서 급감속", background: "bg-swamp.png", object: "object-swamp.png" },
    { id: "portal", name: "포털맵", desc: "짝 포털로 순간이동", background: "bg-portal.png", object: "object-portals.png" },
    { id: "minefield", name: "지뢰밭맵", desc: "랜덤 지뢰 충격파", background: "bg-minefield.png", object: "object-mine.png" }
  ];
  var images = {};
  var loadCallbacks = [];

  function assetUrl(path) {
    var value = ASSET_ROOT + path;
    return window.AppShell && AppShell.assetUrl ? AppShell.assetUrl(value) : value;
  }

  function has(id) {
    for (var i = 0; i < catalog.length; i++) if (catalog[i].id === id) return true;
    return false;
  }

  function mapById(id) {
    for (var i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i];
    return catalog[0];
  }

  function boardPath(ctx) {
    var r = 10;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(BASE_W - r, 0);
    ctx.quadraticCurveTo(BASE_W, 0, BASE_W, r);
    ctx.lineTo(BASE_W, BASE_H - r);
    ctx.quadraticCurveTo(BASE_W, BASE_H, BASE_W - r, BASE_H);
    ctx.lineTo(r, BASE_H);
    ctx.quadraticCurveTo(0, BASE_H, 0, BASE_H - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
  }

  function drawBase(ctx) {
    ctx.fillStyle = "#E8C88A";
    ctx.fillRect(0, 0, BASE_W, BASE_H);
    var count = 13;
    var marginX = BASE_H * 0.09;
    var marginY = BASE_H * 0.09;
    var stepX = (BASE_W - marginX * 2) / (count - 1);
    var stepY = (BASE_H - marginY * 2) / (count - 1);
    ctx.save();
    ctx.strokeStyle = "rgba(90,60,20,.28)";
    ctx.lineWidth = 1;
    for (var i = 0; i < count; i++) {
      ctx.beginPath();
      ctx.moveTo(marginX, marginY + stepY * i);
      ctx.lineTo(BASE_W - marginX, marginY + stepY * i);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(marginX + stepX * i, marginY);
      ctx.lineTo(marginX + stepX * i, BASE_H - marginY);
      ctx.stroke();
    }
    ctx.restore();
  }

  function queueImage(filename) {
    if (!filename || images[filename]) return;
    var img = new Image();
    images[filename] = img;
    img.onload = notifyReady;
    img.onerror = notifyReady;
    img.src = assetUrl(filename);
  }

  function notifyReady() {
    var callbacks = loadCallbacks.slice();
    for (var i = 0; i < callbacks.length; i++) callbacks[i]();
  }

  function preload(onProgress) {
    if (typeof onProgress === "function" && loadCallbacks.indexOf(onProgress) < 0) loadCallbacks.push(onProgress);
    for (var i = 0; i < catalog.length; i++) {
      queueImage(catalog[i].background);
      queueImage(catalog[i].object);
    }
  }

  function readyImage(filename) {
    var img = images[filename];
    return img && img.complete && img.naturalWidth ? img : null;
  }

  function drawBackground(ctx, width, height, id) {
    var map = mapById(id);
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.scale(width / BASE_W, height / BASE_H);
    boardPath(ctx);
    ctx.clip();
    if (map.id === "base") {
      drawBase(ctx);
    } else {
      var img = readyImage(map.background);
      if (img) ctx.drawImage(img, 0, 0, BASE_W, BASE_H);
      else {
        ctx.fillStyle = "#17253b";
        ctx.fillRect(0, 0, BASE_W, BASE_H);
      }
    }
    ctx.restore();
  }

  function seedNumber(seed) {
    var text = String(seed == null ? "alkkagi" : seed);
    var value = 2166136261;
    for (var i = 0; i < text.length; i++) {
      value ^= text.charCodeAt(i);
      value = Math.imul(value, 16777619);
    }
    return value >>> 0;
  }

  function randomFactory(seed) {
    var value = seedNumber(seed);
    return function () {
      value += 0x6D2B79F5;
      var t = value;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function randomPoints(random, count, minDistance) {
    var points = [];
    var guard = 0;
    while (points.length < count && guard++ < 300) {
      var point = { x: 45 + random() * 250, y: 92 + random() * 256 };
      var clear = true;
      for (var i = 0; i < points.length; i++) {
        if (Math.hypot(point.x - points[i].x, point.y - points[i].y) < minDistance) clear = false;
      }
      if (clear) points.push(point);
    }
    return points;
  }

  function createObjects(id, seed) {
    var random = randomFactory(String(id) + ":" + String(seed == null ? "preview" : seed));
    var objects = [];
    var points;
    var i;
    if (id === "magnet" || id === "blackhole") {
      points = randomPoints(random, 1 + Math.floor(random() * 3), 78);
      for (i = 0; i < points.length; i++) objects.push({ type: id, x: points[i].x, y: points[i].y, radius: id === "magnet" ? 25 : 23, rotation: random() * Math.PI * 2 });
    } else if (id === "wind") {
      objects.push({ type: "wind", x: BASE_W / 2, y: BASE_H / 2, radius: 29, rotation: (Math.floor(random() * 8) * Math.PI) / 4 });
    } else if (id === "obstacle") {
      points = randomPoints(random, 4, 70);
      for (i = 0; i < points.length; i++) objects.push({ type: "obstacle", variant: i % 3, x: points[i].x, y: points[i].y, radius: i % 3 === 2 ? 31 : 25, rotation: (random() - 0.5) * 0.8 });
    } else if (id === "swamp") {
      points = randomPoints(random, 4, 72);
      for (i = 0; i < points.length; i++) objects.push({ type: "swamp", x: points[i].x, y: points[i].y, radius: 33 + random() * 7, rotation: random() * Math.PI * 2 });
    } else if (id === "portal") {
      points = randomPoints(random, 4, 92);
      for (i = 0; i < points.length; i++) objects.push({ type: "portal", variant: i < 2 ? 0 : 1, pair: i % 2, x: points[i].x, y: points[i].y, radius: 28, rotation: (random() - 0.5) * 0.35 });
    } else if (id === "minefield") {
      points = randomPoints(random, 5, 62);
      for (i = 0; i < points.length; i++) objects.push({ type: "minefield", x: points[i].x, y: points[i].y, radius: 22, rotation: random() * Math.PI * 2 });
    }
    return objects;
  }

  function drawSprite(ctx, img, object, sourceIndex, sourceCount) {
    if (!img) return;
    var sourceW = img.naturalWidth / (sourceCount || 1);
    var sourceX = sourceW * (sourceIndex || 0);
    var size = object.radius * 2.4;
    ctx.save();
    ctx.translate(object.x, object.y);
    ctx.rotate(object.rotation || 0);
    ctx.drawImage(img, sourceX, 0, sourceW, img.naturalHeight, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function drawObjects(ctx, width, height, id, objects) {
    var map = mapById(id);
    if (!map.object) return;
    var img = readyImage(map.object);
    if (!img) return;
    var list = objects || createObjects(id, "preview");
    ctx.save();
    ctx.scale(width / BASE_W, height / BASE_H);
    boardPath(ctx);
    ctx.clip();
    for (var i = 0; i < list.length; i++) {
      var object = list[i];
      if (object.active === false) continue;
      if (object.type === "obstacle") drawSprite(ctx, img, object, object.variant, 3);
      else if (object.type === "portal") drawSprite(ctx, img, object, object.variant, 2);
      else drawSprite(ctx, img, object, 0, 1);
    }
    ctx.restore();
  }

  function draw(ctx, width, height, id, objects) {
    id = has(id) ? id : "base";
    drawBackground(ctx, width, height, id);
    drawObjects(ctx, width, height, id, objects);
  }

  function all() {
    return catalog.map(function (map) {
      return { id: map.id, name: map.name, desc: map.desc, background: map.background || null, object: map.object || null };
    });
  }

  function get(id) {
    var map = mapById(id);
    return { id: map.id, name: map.name, desc: map.desc, background: map.background || null, object: map.object || null };
  }

  preload();
  return {
    all: all,
    get: get,
    has: has,
    preload: preload,
    draw: draw,
    drawBackground: drawBackground,
    drawObjects: drawObjects,
    createObjects: createObjects
  };
})();
