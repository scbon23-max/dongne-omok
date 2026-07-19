window.Alkkagi = (function () {
  "use strict";
  var SW = 340, SH = 440, R = 14, FR = 0.933, ICE_FR = 0.975, MINV = 0.10, MAX_PULL = 90, MAXV = 22.5;
  var cv = null, ctx = null, bound = false;
  var stones = [];
  var turn = "b", seats = { black: null, white: null }, started = false, over = false, winner = null;
  var moving = false, drag = null, dragRaf = 0;
  var onFlick = null, canFlick = null, onHit = null, onPlace = null;
  var mode = "knockout";
  var mapId = "base";
  var mapObjects = [];
  var komi = 0;
  var STONE_SOURCE_INSET = 0.09;
  var stoneImages = { black: null, white: null };
  var TCX = SW / 2, TCY = SH / 2, GM = SH * 0.09, RING = { c: SH * 0.062, m: SH * 0.115, o: SH * 0.18 };
  function placeActive(x) {
    for (var i = 0; i < stones.length; i++) {
      if (stones[i].active) { stones[i].x = Math.max(GM, Math.min(SW - GM, x)); stones[i].y = stones[i].c === "b" ? SH - GM : GM; render(); return; }
    }
  }
  function setMode(m) { mode = m; }
  function setMap(id, seed) {
    mapId = window.AlkkagiMaps && AlkkagiMaps.has(id) ? id : "base";
    mapObjects = window.AlkkagiMaps ? AlkkagiMaps.createObjects(mapId, seed == null ? Date.now() + ":" + Math.random() : seed) : [];
    render();
  }
  function cloneMapObjects(list) {
    return (list || []).slice(0, 12).map(function (object) {
      var copy = {};
      Object.keys(object || {}).forEach(function (key) {
        var value = object[key];
        if (typeof value === "number" && !isFinite(value)) return;
        if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") copy[key] = value;
      });
      if (typeof copy.x === "number") copy.x = Math.max(0, Math.min(SW, copy.x));
      if (typeof copy.y === "number") copy.y = Math.max(0, Math.min(SH, copy.y));
      if (typeof copy.radius === "number") copy.radius = Math.max(10, Math.min(60, copy.radius));
      if (typeof copy.variant === "number") copy.variant = Math.max(0, Math.min(2, Math.floor(copy.variant)));
      if (typeof copy.pair === "number") copy.pair = Math.max(0, Math.min(3, Math.floor(copy.pair)));
      return copy;
    });
  }
  function setMapState(id, objects) {
    mapId = window.AlkkagiMaps && AlkkagiMaps.has(id) ? id : "base";
    mapObjects = cloneMapObjects(objects);
    render();
  }
  function getMap() { return mapId; }
  function getMapObjects() { return cloneMapObjects(mapObjects); }
  function advanceMapTurn(seed, objects) {
    var next = cloneMapObjects(objects == null ? mapObjects : objects);
    if (mapId !== "wind" || !next.length) return next;
    var text = String(seed == null ? Date.now() : seed), hash = 0;
    for (var i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    var oldStep = Math.round((next[0].rotation || 0) / (Math.PI / 4));
    var step = Math.abs(hash) % 8;
    if (step === ((oldStep % 8) + 8) % 8) step = (step + 1) % 8;
    next[0].rotation = step * Math.PI / 4;
    return next;
  }
  function setKomi(k) { komi = k || 0; }
  function localAssetUrl(path) {
    return window.AppShell && AppShell.assetUrl ? AppShell.assetUrl(path) : path;
  }
  function loadStoneImages() {
    if (stoneImages.black && stoneImages.white) return;
    function load(kind, path) {
      var img = new Image();
      img.onload = render;
      img.onerror = function () { stoneImages[kind] = null; };
      img.src = localAssetUrl(path);
      stoneImages[kind] = img;
    }
    load("black", "assets/stone-black.png");
    load("white", "assets/stone-white.png");
  }
  function drawStoneShadow(stone) {
    ctx.save();
    ctx.shadowColor = stone.c === "w" ? "rgba(42,29,16,.31)" : "rgba(42,29,16,.28)";
    ctx.shadowBlur = R * 0.28;
    ctx.shadowOffsetX = R * 0.1;
    ctx.shadowOffsetY = R * 0.18;
    ctx.fillStyle = "#E8C88A";
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, R * 0.97, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function drawStone(stone) {
    var img = stone.c === "b" ? stoneImages.black : stoneImages.white;
    if (img && img.complete && img.naturalWidth) {
      var sourceX = img.naturalWidth * STONE_SOURCE_INSET;
      var sourceY = img.naturalHeight * STONE_SOURCE_INSET;
      var sourceWidth = img.naturalWidth - sourceX * 2;
      var sourceHeight = img.naturalHeight - sourceY * 2;
      var size = R * 2;
      ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight,
        stone.x - size / 2, stone.y - size / 2, size, size);
      return;
    }
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, R, 0, Math.PI * 2);
    ctx.fillStyle = stone.c === "b" ? "#1b1b1b" : "#f4f4f4";
    ctx.fill();
    ctx.strokeStyle = stone.c === "b" ? "#000" : "#b9b4a6";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  function ringPoints(x, y) {
    var d = Math.hypot(x - TCX, y - TCY);
    if (d <= RING.c) return 3;
    if (d <= RING.m) return 2;
    if (d <= RING.o) return 1;
    return 0;
  }
  function territoryScore() {
    var sc = { b: 0, w: 0 };
    stones.forEach(function (s) { if (s.alive && !s.active) { var p = ringPoints(s.x, s.y); if (s.c === "b") sc.b += p; else sc.w += p; } });
    return sc;
  }
  function spawnActive(color) {
    stones = stones.filter(function (s) { return !s.active; });
    stones.push({ x: TCX, y: color === "b" ? SH - GM : GM, c: color, alive: true, active: true, vx: 0, vy: 0 });
  }
  function markActivePlayed() { stones.forEach(function (s) { s.active = false; }); }
  function drawTarget() {
    var fills = [[RING.o, "rgba(90,60,20,.10)"], [RING.m, "rgba(243,97,42,.14)"], [RING.c, "rgba(243,97,42,.30)"]];
    fills.forEach(function (g) { ctx.beginPath(); ctx.arc(TCX, TCY, g[0], 0, 7); ctx.fillStyle = g[1]; ctx.fill(); });
    [RING.o, RING.m, RING.c].forEach(function (r) { ctx.beginPath(); ctx.arc(TCX, TCY, r, 0, 7); ctx.strokeStyle = "rgba(90,60,20,.4)"; ctx.lineWidth = 1.5; ctx.stroke(); });
    ctx.beginPath(); ctx.arc(TCX, TCY, 3, 0, 7); ctx.fillStyle = "#C7481B"; ctx.fill();
  }

  function layout() {
    var arr = [], xs = [SW * 1 / 6, SW * 2 / 6, SW * 3 / 6, SW * 4 / 6, SW * 5 / 6];
    xs.forEach(function (x) { arr.push({ x: x, y: SH * 0.85, c: "b", alive: true }); });
    xs.forEach(function (x) { arr.push({ x: x, y: SH * 0.15, c: "w", alive: true }); });
    return arr;
  }
  function setStones(arr) { stones = (arr || []).map(function (s) { return { x: s.x, y: s.y, c: s.c, alive: s.alive, active: !!s.active, vx: 0, vy: 0 }; }); }
  function getStones() { return stones.map(function (s) { return { x: s.x, y: s.y, c: s.c, alive: s.alive, active: !!s.active }; }); }
  function setMeta(t, se, st, ov, wn) { turn = t; if (se) seats = se; started = st; over = ov; winner = wn; render(); }
  function aliveCount(c) { return stones.filter(function (s) { return s.alive && s.c === c; }).length; }

  function pos(e) { var r = cv.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return { x: (t.clientX - r.left) / r.width * SW, y: (t.clientY - r.top) / r.height * SH }; }
  function hit(p, color) {
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (!s.alive || s.c !== color) continue;
      if (mode === "territory" && !s.active) continue;
      if (Math.hypot(s.x - p.x, s.y - p.y) <= R + 6) return i;
    }
    return -1;
  }
  function down(e) {
    if (moving) return;
    var g = canFlick ? canFlick() : { ok: false };
    if (!g.ok) return;
    var p = pos(e), idx = hit(p, g.color);
    if (idx < 0) {
      if (mode === "territory") {
        var inBand = g.color === "b" ? (p.y > SH * 0.62) : (p.y < SH * 0.38);
        if (inBand) {
          var act = null;
          for (var k = 0; k < stones.length; k++) { if (stones[k].active) { act = stones[k]; break; } }
          if (act) { placeActive(p.x); if (onPlace) onPlace(act.x); e.preventDefault(); }
        }
      }
      return;
    }
    drag = { idx: idx, x: p.x, y: p.y }; e.preventDefault();
    cancelAnimationFrame(dragRaf);
    (function dragTick() { if (drag) { render(); dragRaf = requestAnimationFrame(dragTick); } })();
  }
  function move(e) { if (!drag) return; var p = pos(e); drag.x = p.x; drag.y = p.y; render(); e.preventDefault(); }
  function up(e) {
    if (!drag) return;
    var s = stones[drag.idx], dx = s.x - drag.x, dy = s.y - drag.y, d = Math.hypot(dx, dy), idx = drag.idx;
    drag = null;
    if (d > 6) {
      var sc = Math.min(d, MAX_PULL) / MAX_PULL * MAXV / d;
      var vx = dx * sc, vy = dy * sc;
      if (onFlick) onFlick(idx, vx, vy);
    }
    render(); e.preventDefault();
  }

  function movingFastEnough(stone) {
    return Math.hypot(stone.vx || 0, stone.vy || 0) >= MINV;
  }

  function applyFieldForces(stone, objects, step) {
    if (!movingFastEnough(stone) || step > 150) return;
    if (mapId === "magnet") {
      for (var i = 0; i < objects.length; i++) {
        var magnet = objects[i];
        var dx = magnet.x - stone.x, dy = magnet.y - stone.y, distance = Math.hypot(dx, dy);
        if (!distance || distance > 145) continue;
        var pull = 0.052 * (1 - distance / 145);
        stone.vx += dx / distance * pull;
        stone.vy += dy / distance * pull;
      }
    } else if (mapId === "wind" && objects.length) {
      var angle = objects[0].rotation || 0;
      stone.vx += Math.cos(angle) * 0.038;
      stone.vy += Math.sin(angle) * 0.038;
    }
  }

  function applySwampDrag(stone, objects) {
    if (mapId !== "swamp") return;
    for (var i = 0; i < objects.length; i++) {
      var swamp = objects[i];
      if (Math.hypot(stone.x - swamp.x, stone.y - swamp.y) <= swamp.radius * 0.88 + R) {
        stone.vx *= 0.93;
        stone.vy *= 0.93;
        return;
      }
    }
  }

  function resolveStoneCollisions(world, hitCallback) {
    for (var a = 0; a < world.stones.length; a++) {
      for (var b = a + 1; b < world.stones.length; b++) {
        var p = world.stones[a], q = world.stones[b];
        if (!p.alive || !q.alive) continue;
        var dx = q.x - p.x, dy = q.y - p.y, dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < R * 2) {
          var nx = dx / dist, ny = dy / dist, overlap = R * 2 - dist;
          p.x -= nx * overlap / 2; p.y -= ny * overlap / 2;
          q.x += nx * overlap / 2; q.y += ny * overlap / 2;
          var pvn = p.vx * nx + p.vy * ny, qvn = q.vx * nx + q.vy * ny, delta = pvn - qvn;
          p.vx -= delta * nx; p.vy -= delta * ny;
          q.vx += delta * nx; q.vy += delta * ny;
          if (hitCallback && delta > 0) hitCallback(delta);
        }
      }
    }
  }

  function resolveObstacleCollisions(stone, objects, hitCallback) {
    if (mapId !== "obstacle" || !stone.alive) return;
    for (var i = 0; i < objects.length; i++) {
      var obstacle = objects[i];
      var objectRadius = obstacle.radius * (obstacle.variant === 2 ? 1.12 : 0.88);
      var dx = stone.x - obstacle.x, dy = stone.y - obstacle.y, distance = Math.hypot(dx, dy);
      var hitDistance = R + objectRadius;
      if (distance >= hitDistance) continue;
      var nx = distance ? dx / distance : Math.cos(obstacle.rotation || 0);
      var ny = distance ? dy / distance : Math.sin(obstacle.rotation || 0);
      stone.x = obstacle.x + nx * hitDistance;
      stone.y = obstacle.y + ny * hitDistance;
      var normalVelocity = stone.vx * nx + stone.vy * ny;
      if (normalVelocity < 0) {
        stone.vx -= 1.82 * normalVelocity * nx;
        stone.vy -= 1.82 * normalVelocity * ny;
        stone.vx *= 0.86;
        stone.vy *= 0.86;
        if (hitCallback) hitCallback(Math.abs(normalVelocity));
      }
    }
  }

  function teleportStone(stone, objects) {
    if (mapId !== "portal" || !stone.alive) return;
    if (stone.portalCooldown > 0) { stone.portalCooldown--; return; }
    for (var i = 0; i < objects.length; i++) {
      var portal = objects[i];
      if (Math.hypot(stone.x - portal.x, stone.y - portal.y) > portal.radius * 0.58 + R * 0.45) continue;
      var destination = null;
      for (var j = 0; j < objects.length; j++) {
        if (i !== j && objects[j].pair === portal.pair && objects[j].variant !== portal.variant) { destination = objects[j]; break; }
      }
      if (!destination) return;
      var speed = Math.hypot(stone.vx, stone.vy);
      var nx = speed ? stone.vx / speed : Math.cos(destination.rotation || 0);
      var ny = speed ? stone.vy / speed : Math.sin(destination.rotation || 0);
      stone.x = destination.x + nx * (destination.radius * 0.7 + R);
      stone.y = destination.y + ny * (destination.radius * 0.7 + R);
      stone.portalCooldown = 16;
      return;
    }
  }

  function absorbBlackHole(stone, objects) {
    if (mapId !== "blackhole" || !stone.alive) return;
    for (var i = 0; i < objects.length; i++) {
      var hole = objects[i];
      if (Math.hypot(stone.x - hole.x, stone.y - hole.y) <= hole.radius * 0.58 + R * 0.35) {
        stone.alive = false;
        stone.vx = 0;
        stone.vy = 0;
        return;
      }
    }
  }

  function triggerMines(world, stone) {
    if (mapId !== "minefield" || !stone.alive) return;
    for (var i = 0; i < world.objects.length; i++) {
      var mine = world.objects[i];
      if (mine.active === false) continue;
      if (Math.hypot(stone.x - mine.x, stone.y - mine.y) > mine.radius * 0.72 + R) continue;
      mine.active = false;
      for (var j = 0; j < world.stones.length; j++) {
        var target = world.stones[j];
        if (!target.alive) continue;
        var dx = target.x - mine.x, dy = target.y - mine.y, distance = Math.hypot(dx, dy);
        if (distance > 105) continue;
        if (!distance) {
          var incoming = Math.hypot(target.vx, target.vy);
          dx = incoming ? target.vx / incoming : 1;
          dy = incoming ? target.vy / incoming : 0;
          distance = 1;
        }
        var force = 10.5 * (1 - Math.min(distance, 105) / 105) + 2.2;
        target.vx += dx / distance * force;
        target.vy += dy / distance * force;
      }
      return;
    }
  }

  function stepWorld(world, hitCallback) {
    var friction = mapId === "ice" ? ICE_FR : FR;
    for (var i = 0; i < world.stones.length; i++) {
      var stone = world.stones[i];
      if (!stone.alive) continue;
      applyFieldForces(stone, world.objects, world.step);
      stone.x += stone.vx || 0;
      stone.y += stone.vy || 0;
      stone.vx = (stone.vx || 0) * friction;
      stone.vy = (stone.vy || 0) * friction;
      applySwampDrag(stone, world.objects);
      if (Math.hypot(stone.vx, stone.vy) < MINV) { stone.vx = 0; stone.vy = 0; }
    }
    world.step++;
    resolveStoneCollisions(world, hitCallback);
    for (var j = 0; j < world.stones.length; j++) {
      var current = world.stones[j];
      if (!current.alive) continue;
      resolveObstacleCollisions(current, world.objects, hitCallback);
      teleportStone(current, world.objects);
      absorbBlackHole(current, world.objects);
      triggerMines(world, current);
      if (current.alive && (current.x < 0 || current.x > SW || current.y < 0 || current.y > SH)) {
        current.alive = false;
        current.vx = 0;
        current.vy = 0;
      }
    }
    for (var k = 0; k < world.stones.length; k++) if (world.stones[k].alive && movingFastEnough(world.stones[k])) return true;
    return false;
  }

  function prepareWorld(sourceStones, sourceObjects, idx, vx, vy) {
    var world = {
      stones: sourceStones.map(function (stone) {
        return { x: stone.x, y: stone.y, c: stone.c, alive: stone.alive, active: !!stone.active, vx: 0, vy: 0, portalCooldown: 0 };
      }),
      objects: cloneMapObjects(sourceObjects),
      step: 0
    };
    if (world.stones[idx]) { world.stones[idx].vx = vx; world.stones[idx].vy = vy; }
    return world;
  }

  function stopWorld(world) {
    for (var i = 0; i < world.stones.length; i++) { world.stones[i].vx = 0; world.stones[i].vy = 0; }
  }

  function publicStones(list) {
    return list.map(function (stone) {
      return { x: stone.x, y: stone.y, c: stone.c, alive: stone.alive, active: !!stone.active };
    });
  }

  function runFlick(idx, vx, vy, onSettle) {
    if (!stones[idx]) { if (onSettle) onSettle(); return; }
    var world = prepareWorld(stones, mapObjects, idx, vx, vy);
    stones = world.stones;
    mapObjects = world.objects;
    var guard = 0;
    moving = true;
    (function loop() {
      if (!moving) return;
      var any = stepWorld(world, onHit);
      if (++guard > 1400) { stopWorld(world); any = false; }
      render();
      if (any) requestAnimationFrame(loop);
      else { moving = false; if (onSettle) onSettle(); }
    })();
  }

  function simulate(idx, vx, vy) {
    var world = prepareWorld(stones, mapObjects, idx, vx, vy);
    if (!world.stones[idx]) {
      return { stones: getStones(), mapObjects: getMapObjects(), bAlive: aliveCount("b"), wAlive: aliveCount("w") };
    }
    var guard = 0;
    while (guard++ < 1400 && stepWorld(world, null)) {}
    if (guard >= 1400) stopWorld(world);
    var out = publicStones(world.stones);
    var blackAlive = 0, whiteAlive = 0;
    out.forEach(function (stone) {
      if (stone.alive) { if (stone.c === "b") blackAlive++; else whiteAlive++; }
    });
    return { stones: out, mapObjects: cloneMapObjects(world.objects), bAlive: blackAlive, wAlive: whiteAlive };
  }
  function render() {
    if (!cv) return;
    if (window.AlkkagiMaps && AlkkagiMaps.prepareCanvas) ctx = AlkkagiMaps.prepareCanvas(cv, SW, SH);
    if (!ctx) return;
    if (window.AlkkagiMaps) AlkkagiMaps.drawBackground(ctx, SW, SH, mapId);
    else { ctx.fillStyle = "#F6EEDC"; ctx.fillRect(0, 0, SW, SH); }
    if (mode === "territory") { drawTarget(); }
    else {
      ctx.strokeStyle = mapId === "ice" || mapId === "wind" ? "rgba(255,255,255,.38)" : "rgba(255,255,255,.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(0, SH / 2); ctx.lineTo(SW, SH / 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (window.AlkkagiMaps) AlkkagiMaps.drawObjects(ctx, SW, SH, mapId, mapObjects);
    var g2 = canFlick ? canFlick() : { ok: false };
    if (drag) {
      var s = stones[drag.idx], dx = s.x - drag.x, dy = s.y - drag.y, d = Math.hypot(dx, dy);
      var pw = Math.min(1, d / MAX_PULL), maxed = d >= MAX_PULL;
      var cap = d > 0 ? Math.min(d, MAX_PULL) / d : 0, cdx = dx * cap, cdy = dy * cap;
      ctx.strokeStyle = maxed ? "rgba(220,20,20,.98)" : "rgba(243,97,42,.9)"; ctx.lineWidth = maxed ? 4 : 3; ctx.setLineDash([7, 6]);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - cdx * 1.4, s.y - cdy * 1.4); ctx.stroke(); ctx.setLineDash([]);
      if (maxed) {
        var bl = 0.5 + 0.5 * Math.sin(performance.now() / 80);
        ctx.beginPath(); ctx.arc(s.x, s.y, R + 4 + 8 * pw, 0, 7);
        ctx.strokeStyle = "rgba(222,15,15," + (0.12 + 0.88 * bl) + ")"; ctx.lineWidth = 3 + 4 * bl; ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(s.x, s.y, R + 4 + 8 * pw, 0, 7); ctx.strokeStyle = "rgba(243,97,42,.8)"; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    for (var j = 0; j < stones.length; j++) {
      var shadowStone = stones[j]; if (shadowStone.alive) drawStoneShadow(shadowStone);
    }
    for (var j2 = 0; j2 < stones.length; j2++) {
      var s3 = stones[j2]; if (!s3.alive) continue;
      drawStone(s3);
      if (!moving && !drag && g2.ok && s3.c === g2.color && (mode !== "territory" || s3.active)) { ctx.beginPath(); ctx.arc(s3.x, s3.y, R + 5, 0, 7); ctx.strokeStyle = "rgba(47,184,158,.6)"; ctx.lineWidth = 2; ctx.stroke(); }
    }
    if (mode === "territory") {
      var sc = territoryScore();
      ctx.font = "bold 18px 'Malgun Gothic', sans-serif";
      ctx.fillStyle = "#1b1b1b"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText("흑 " + sc.b + (komi ? " +" + komi : ""), 10, SH - 8);
      ctx.fillStyle = "#3a2a12"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillText("백 " + sc.w, SW - 10, 8);
    }
  }

  function init(opts) {
    cv = document.getElementById("alk-board"); if (!cv) return;
    ctx = window.AlkkagiMaps && AlkkagiMaps.prepareCanvas
      ? AlkkagiMaps.prepareCanvas(cv, SW, SH)
      : cv.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    }
    if (window.AlkkagiMaps) AlkkagiMaps.preload(render);
    loadStoneImages();
    onFlick = opts && opts.onFlick; canFlick = opts && opts.canFlick; onHit = opts && opts.onHit; onPlace = opts && opts.onPlace;
    if (!bound) {
      bound = true;
      cv.addEventListener("mousedown", down); window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
      cv.addEventListener("touchstart", down, { passive: false }); cv.addEventListener("touchmove", move, { passive: false }); cv.addEventListener("touchend", up, { passive: false });
      window.addEventListener("resize", render);
    }
    render();
  }

  return {
    init: init, layout: layout, setStones: setStones, getStones: getStones, setMeta: setMeta,
    runFlick: runFlick, simulate: simulate, render: render, aliveCount: aliveCount, isMoving: function () { return moving; },
    setMode: setMode, setMap: setMap, setMapState: setMapState, getMap: getMap, getMapObjects: getMapObjects, advanceMapTurn: advanceMapTurn,
    setKomi: setKomi, spawnActive: spawnActive, markActivePlayed: markActivePlayed, territoryScore: territoryScore, ringPoints: ringPoints, placeActive: placeActive
  };
})();
