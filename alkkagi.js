window.Alkkagi = (function () {
  "use strict";
  var SW = 340, SH = 440, R = 14, FR = 0.933, MINV = 0.10, MAX_PULL = 90, MAXV = 22.5;
  var cv = null, ctx = null, bound = false;
  var stones = [];
  var turn = "b", seats = { black: null, white: null }, started = false, over = false, winner = null;
  var moving = false, drag = null, dragRaf = 0;
  var onFlick = null, canFlick = null, onHit = null, onPlace = null;
  var mode = "knockout";
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

  function runFlick(idx, vx, vy, onSettle) {
    if (!stones[idx]) { if (onSettle) onSettle(); return; }
    for (var i = 0; i < stones.length; i++) { stones[i].vx = 0; stones[i].vy = 0; }
    stones[idx].vx = vx; stones[idx].vy = vy;
    moving = true;
    (function loop() {
      if (!moving) return;
      for (var i = 0; i < stones.length; i++) { var s = stones[i]; if (!s.alive) continue; s.x += s.vx; s.y += s.vy; s.vx *= FR; s.vy *= FR; if (Math.hypot(s.vx, s.vy) < MINV) { s.vx = 0; s.vy = 0; } }
      for (var a = 0; a < stones.length; a++) {
        for (var b = a + 1; b < stones.length; b++) {
          var p = stones[a], q = stones[b]; if (!p.alive || !q.alive) continue;
          var dx = q.x - p.x, dy = q.y - p.y, dist = Math.hypot(dx, dy);
          if (dist > 0 && dist < R * 2) {
            var nx = dx / dist, ny = dy / dist, ov = R * 2 - dist;
            p.x -= nx * ov / 2; p.y -= ny * ov / 2; q.x += nx * ov / 2; q.y += ny * ov / 2;
            var pvn = p.vx * nx + p.vy * ny, qvn = q.vx * nx + q.vy * ny, dp = pvn - qvn;
            p.vx -= dp * nx; p.vy -= dp * ny; q.vx += dp * nx; q.vy += dp * ny;
            if (onHit && dp > 0) onHit(dp);
          }
        }
      }
      for (var k = 0; k < stones.length; k++) { var s2 = stones[k]; if (s2.alive && (s2.x < 0 || s2.x > SW || s2.y < 0 || s2.y > SH)) s2.alive = false; }
      var any = false; for (var m2 = 0; m2 < stones.length; m2++) { if (stones[m2].alive && (stones[m2].vx || stones[m2].vy)) any = true; }
      render();
      if (any) requestAnimationFrame(loop); else { moving = false; if (onSettle) onSettle(); }
    })();
  }

  function simulate(idx, vx, vy) {
    var sim = stones.map(function (s) { return { x: s.x, y: s.y, c: s.c, alive: s.alive, active: !!s.active, vx: 0, vy: 0 }; });
    if (!sim[idx]) { var ba0 = aliveCount("b"), wa0 = aliveCount("w"); return { stones: getStones(), bAlive: ba0, wAlive: wa0 }; }
    sim[idx].vx = vx; sim[idx].vy = vy;
    var guard = 0;
    while (guard++ < 20000) {
      var any = false;
      for (var i = 0; i < sim.length; i++) { var s = sim[i]; if (!s.alive) continue; s.x += s.vx; s.y += s.vy; s.vx *= FR; s.vy *= FR; if (Math.hypot(s.vx, s.vy) < MINV) { s.vx = 0; s.vy = 0; } }
      for (var a = 0; a < sim.length; a++) {
        for (var b = a + 1; b < sim.length; b++) {
          var p = sim[a], q = sim[b]; if (!p.alive || !q.alive) continue;
          var dx = q.x - p.x, dy = q.y - p.y, dist = Math.hypot(dx, dy);
          if (dist > 0 && dist < R * 2) {
            var nx = dx / dist, ny = dy / dist, ov = R * 2 - dist;
            p.x -= nx * ov / 2; p.y -= ny * ov / 2; q.x += nx * ov / 2; q.y += ny * ov / 2;
            var pvn = p.vx * nx + p.vy * ny, qvn = q.vx * nx + q.vy * ny, dp = pvn - qvn;
            p.vx -= dp * nx; p.vy -= dp * ny; q.vx += dp * nx; q.vy += dp * ny;
          }
        }
      }
      for (var k = 0; k < sim.length; k++) { var s2 = sim[k]; if (s2.alive && (s2.x < 0 || s2.x > SW || s2.y < 0 || s2.y > SH)) s2.alive = false; }
      for (var m2 = 0; m2 < sim.length; m2++) { if (sim[m2].alive && (sim[m2].vx || sim[m2].vy)) any = true; }
      if (!any) break;
    }
    var out = sim.map(function (s) { return { x: s.x, y: s.y, c: s.c, alive: s.alive, active: !!s.active }; });
    var ba = 0, wa = 0; out.forEach(function (s) { if (s.alive) { if (s.c === "b") ba++; else wa++; } });
    return { stones: out, bAlive: ba, wAlive: wa };
  }
  function render() {
    if (!ctx) return;
    ctx.fillStyle = "#E8C88A"; ctx.fillRect(0, 0, SW, SH);
    ctx.strokeStyle = "rgba(90,60,20,.28)"; ctx.lineWidth = 1;
    var g = 13, mX = GM, mY = GM, stX = (SW - 2 * mX) / (g - 1), stY = (SH - 2 * mY) / (g - 1);
    for (var i = 0; i < g; i++) {
      ctx.beginPath(); ctx.moveTo(mX, mY + stY * i); ctx.lineTo(SW - mX, mY + stY * i); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mX + stX * i, mY); ctx.lineTo(mX + stX * i, SH - mY); ctx.stroke();
    }
    if (mode === "territory") { drawTarget(); } else { ctx.strokeStyle = "rgba(90,60,20,.18)"; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(0, SH / 2); ctx.lineTo(SW, SH / 2); ctx.stroke(); ctx.setLineDash([]); }
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
    ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    loadStoneImages();
    onFlick = opts && opts.onFlick; canFlick = opts && opts.canFlick; onHit = opts && opts.onHit; onPlace = opts && opts.onPlace;
    if (!bound) {
      bound = true;
      cv.addEventListener("mousedown", down); window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
      cv.addEventListener("touchstart", down, { passive: false }); cv.addEventListener("touchmove", move, { passive: false }); cv.addEventListener("touchend", up, { passive: false });
    }
    render();
  }

  return {
    init: init, layout: layout, setStones: setStones, getStones: getStones, setMeta: setMeta,
    runFlick: runFlick, simulate: simulate, render: render, aliveCount: aliveCount, isMoving: function () { return moving; },
    setMode: setMode, setKomi: setKomi, spawnActive: spawnActive, markActivePlayed: markActivePlayed, territoryScore: territoryScore, ringPoints: ringPoints, placeActive: placeActive
  };
})();
