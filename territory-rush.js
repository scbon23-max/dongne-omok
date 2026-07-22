window.TerritoryRush = (function () {
  "use strict";

  var WORLD_W = 72;
  var WORLD_H = 108;
  var CELL_COUNT = WORLD_W * WORLD_H;
  var MATCH_MS = 90000;
  var STEP_MS = 50;
  var FRAME_MS = 250;
  var FULL_MIN_MS = 300;
  var OWNER_RECOVERY_MS = 1800;
  var RESPAWN_MS = 1800;
  var SPEED = 7.4;
  var TURN_SPEED = Math.PI * 4;
  var TRAIL_WIDTH = .64;
  var TRAIL_COLLISION_RADIUS = TRAIL_WIDTH / 2;
  var TRAIL_HEAD_GRACE = TRAIL_COLLISION_RADIUS + .08;
  var TRAIL_SAMPLE_TOLERANCE = .06;
  var MAX_VISUAL_TRAIL_POINTS = 180;
  var VISUAL_TRAIL_SCALE = 20;
  var MAX_PLAYERS = 8;
  var MAX_TRAIL = 360;
  var LAYER_SCALE = 4;
  var COLORS = ["#ff756d", "#43c7a0", "#ffc857", "#7f8cff", "#ef72b3", "#42b8d5", "#9bc95b", "#f49b52"];
  var TERRITORY_COLORS = ["#ff6f73", "#35cfa1", "#ffc54a", "#7585ff", "#f36bae", "#34bfdf", "#8dcc4d", "#ff9950"];
  var MASCOTS = ["🐱", "🐻", "🐰", "🐥", "🐶", "🦊", "🐼", "🐹"];
  var BOT_NAMES = ["몽이", "두부", "토리"];
  var DIRECTIONS = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }
  };

  var api = null;
  var state = freshState();
  var owner = new Int8Array(CELL_COUNT);
  var trailOwner = new Int8Array(CELL_COUNT);
  var blocked = new Uint8Array(CELL_COUNT);
  var visited = new Uint8Array(CELL_COUNT);
  var queue = new Int32Array(CELL_COUNT);
  var visualPlayers = Object.create(null);
  var visualTrails = Object.create(null);
  var pressedKeys = Object.create(null);
  var inputSeq = 0;
  var inputSeqByNick = Object.create(null);
  var inputAtByNick = Object.create(null);
  var lastInputAt = 0;
  var syncRequestedAt = 0;
  var helloPending = false;
  var syncReplyAtByNick = Object.create(null);
  var wantedOwnerRev = 0;
  var ownerSyncMissingSince = 0;
  var authoritativeHost = "";
  var needsAuthoritySync = false;
  var authorityYielded = false;
  var fullPending = false;
  var active = false;
  var bound = false;
  var tickId = null;
  var renderRaf = 0;
  var lastRenderAt = 0;
  var lastHudAt = 0;
  var lastMiniAt = 0;
  var lastFrameSentAt = 0;
  var lastFullSentAt = 0;
  var lastWarnMatchId = "";
  var swipe = null;
  var resizeTimer = null;
  var canvas = null;
  var ctx = null;
  var miniCanvas = null;
  var miniCtx = null;
  var territoryLayer = null;
  var territoryCtx = null;
  var ownerLayerDirty = true;
  var countsRev = -1;
  var cachedCounts = [];

  resetGrid();

  function freshState() {
    return {
      phase: "idle",
      rev: 0,
      frameSeq: 0,
      ownerRev: 0,
      matchId: "",
      deadline: 0,
      spectators: [],
      ready: [],
      players: [],
      winner: ""
    };
  }

  function $(id) { return typeof document !== "undefined" ? document.getElementById(id) : null; }
  function nowMs() { return Date.now(); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function has(list, value) { return Array.isArray(list) && list.indexOf(value) >= 0; }
  function safeNick(value) { return String(value == null ? "" : value).trim().slice(0, 20); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch];
    });
  }
  function sameDirection(a, b) { return a === b; }
  function reverseDirection(a, b) {
    return (a === "up" && b === "down") || (a === "down" && b === "up")
      || (a === "left" && b === "right") || (a === "right" && b === "left");
  }
  function normalizeAngle(value) {
    value = Number(value);
    if (!isFinite(value)) return 0;
    value = (value + Math.PI) % (Math.PI * 2);
    if (value < 0) value += Math.PI * 2;
    return value - Math.PI;
  }
  function directionAngle(direction) {
    if (direction === "up") return -Math.PI / 2;
    if (direction === "down") return Math.PI / 2;
    if (direction === "left") return Math.PI;
    return 0;
  }
  function angleDelta(from, to) { return normalizeAngle(to - from); }
  function nearestDirection(angle) {
    var x = Math.cos(angle);
    var y = Math.sin(angle);
    return Math.abs(x) >= Math.abs(y) ? (x < 0 ? "left" : "right") : (y < 0 ? "up" : "down");
  }
  function validAngle(value) {
    return value !== null && value !== "" && isFinite(Number(value));
  }
  function requestedAngle(value, fallback) {
    if (typeof value === "string" && DIRECTIONS[value]) return directionAngle(value);
    return validAngle(value) ? normalizeAngle(value) : normalizeAngle(fallback);
  }
  function cellIndex(x, y) { return y * WORLD_W + x; }
  function inside(x, y) { return x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H; }
  function cellKey(x, y) { return cellIndex(Math.floor(x), Math.floor(y)); }
  function me() { return api ? api.me() : { nick: "", isAdmin: false }; }
  function people() { return api ? api.roster() : []; }
  function orderedPeople() {
    return people().filter(function (person) { return person && person.nick; }).slice().sort(function (a, b) {
      return (Number(a.joinTs) || 0) - (Number(b.joinTs) || 0) || String(a.nick).localeCompare(String(b.nick));
    });
  }
  function activePeople() { return orderedPeople().filter(function (person) { return !person.away; }); }
  function activeNicks() { return activePeople().map(function (person) { return safeNick(person.nick); }); }
  function participantNicks() {
    return activeNicks().filter(function (nick) { return !has(state.spectators, nick); }).slice(0, MAX_PLAYERS);
  }
  function requiredReadyNicks() {
    var host = api && api.host ? safeNick(api.host()) : "";
    return participantNicks().filter(function (nick) { return nick !== host; });
  }
  function allReady() {
    return requiredReadyNicks().every(function (nick) { return has(state.ready, nick); });
  }
  function resetGrid() {
    owner.fill(-1);
    trailOwner.fill(-1);
    ownerLayerDirty = true;
    countsRev = -1;
  }

  function encodeOwner(values) {
    if (!values || !values.length) return "";
    var out = "";
    var current = Number(values[0]) + 1;
    var run = 1;
    for (var i = 1; i < values.length; i++) {
      var value = Number(values[i]) + 1;
      if (value === current) run++;
      else {
        out += current.toString(36) + run.toString(36) + ".";
        current = value;
        run = 1;
      }
    }
    return out + current.toString(36) + run.toString(36) + ".";
  }

  function decodeOwner(raw, expectedLength) {
    expectedLength = expectedLength || CELL_COUNT;
    if (typeof raw !== "string" || !raw || raw.length > 120000) return null;
    var result = new Int8Array(expectedLength);
    result.fill(-1);
    var offset = 0;
    var parts = raw.split(".");
    for (var i = 0; i < parts.length; i++) {
      var token = parts[i];
      if (!token) continue;
      var value = parseInt(token.charAt(0), 36) - 1;
      var run = parseInt(token.slice(1), 36);
      if (!isFinite(value) || value < -1 || value >= MAX_PLAYERS || !isFinite(run) || run < 1 || offset + run > expectedLength) return null;
      result.fill(value, offset, offset + run);
      offset += run;
    }
    return offset === expectedLength ? result : null;
  }

  function compactPlayer(player) {
    var angle = validAngle(player.angle) ? normalizeAngle(player.angle) : directionAngle(player.dir);
    var targetAngle = validAngle(player.targetAngle) ? normalizeAngle(player.targetAngle) : angle;
    return {
      id: player.id,
      nick: safeNick(player.nick),
      bot: !!player.bot,
      x: Math.round(player.x * 100) / 100,
      y: Math.round(player.y * 100) / 100,
      spawnX: player.spawnX,
      spawnY: player.spawnY,
      dir: DIRECTIONS[player.dir] ? player.dir : "right",
      angle: Math.round(angle * 1000) / 1000,
      targetAngle: Math.round(targetAngle * 1000) / 1000,
      trail: (player.trail || []).slice(0, MAX_TRAIL),
      path: compactVisualTrail(player),
      deadUntil: Number(player.deadUntil) || 0,
      kills: clamp(Number(player.kills) || 0, 0, 999),
      retired: !!player.retired,
      away: !!player.away
    };
  }

  function sanitizePlayers(rows) {
    if (!Array.isArray(rows)) return [];
    var seen = Object.create(null);
    return rows.slice(0, MAX_PLAYERS).map(function (raw, index) {
      raw = raw || {};
      var id = clamp(Math.floor(Number(raw.id)), 0, MAX_PLAYERS - 1);
      if (seen[id]) id = index;
      seen[id] = true;
      var nick = safeNick(raw.nick) || ("플레이어 " + (id + 1));
      var trail = Array.isArray(raw.trail) ? raw.trail.slice(0, MAX_TRAIL).map(function (key) {
        return clamp(Math.floor(Number(key) || 0), 0, CELL_COUNT - 1);
      }) : [];
      var dir = DIRECTIONS[raw.dir] ? raw.dir : "right";
      var angle = validAngle(raw.angle) ? normalizeAngle(raw.angle) : directionAngle(dir);
      return {
        id: id,
        nick: nick,
        bot: !!raw.bot,
        x: clamp(Number(raw.x) || 0, 0, WORLD_W - .01),
        y: clamp(Number(raw.y) || 0, 0, WORLD_H - .01),
        spawnX: clamp(Number(raw.spawnX) || 0, 1, WORLD_W - 2),
        spawnY: clamp(Number(raw.spawnY) || 0, 1, WORLD_H - 2),
        dir: dir,
        angle: angle,
        targetAngle: validAngle(raw.targetAngle) ? normalizeAngle(raw.targetAngle) : angle,
        trail: trail,
        path: sanitizeVisualTrail(raw.path),
        deadUntil: Math.max(0, Number(raw.deadUntil) || 0),
        kills: clamp(Number(raw.kills) || 0, 0, 999),
        retired: !!raw.retired,
        away: !!raw.away,
        lastCell: -1,
        decisionAt: 0,
        turnBackAt: 12 + Math.floor(Math.random() * 16)
      };
    });
  }

  function snapshot(includeOwner) {
    var value = {
      phase: state.phase,
      rev: state.rev,
      frameSeq: state.frameSeq,
      ownerRev: state.ownerRev,
      matchId: state.matchId,
      deadline: state.deadline,
      spectators: state.spectators.slice(0, 40),
      ready: state.ready.slice(0, 40),
      players: state.players.map(compactPlayer),
      winner: state.winner
    };
    if (includeOwner) value.owner = encodeOwner(owner);
    return value;
  }

  function rebuildTrailOwner() {
    trailOwner.fill(-1);
    state.players.forEach(function (player) {
      (player.trail || []).forEach(function (key) {
        if (key >= 0 && key < CELL_COUNT) trailOwner[key] = player.id;
      });
    });
  }

  function mergeVisualPlayers() {
    var keep = Object.create(null);
    state.players.forEach(function (player) {
      var key = player.nick;
      keep[key] = true;
      if (!visualPlayers[key]) {
        visualPlayers[key] = {
          x: player.x,
          y: player.y,
          angle: validAngle(player.angle) ? player.angle : directionAngle(player.dir)
        };
      }
      if (player.trail && player.trail.length) syncVisualTrail(player);
      else delete visualTrails[key];
    });
    Object.keys(visualPlayers).forEach(function (key) {
      if (!keep[key]) {
        delete visualPlayers[key];
        delete visualTrails[key];
      }
    });
  }

  function sanitizeState(raw, requireOwner) {
    raw = raw || {};
    var phases = ["idle", "playing", "finished"];
    var next = freshState();
    next.phase = phases.indexOf(raw.phase) >= 0 ? raw.phase : "idle";
    next.rev = Math.max(0, Math.floor(Number(raw.rev) || 0));
    next.frameSeq = Math.max(0, Math.floor(Number(raw.frameSeq) || 0));
    next.ownerRev = Math.max(0, Math.floor(Number(raw.ownerRev) || 0));
    next.matchId = String(raw.matchId || "").slice(0, 80);
    next.deadline = Math.max(0, Number(raw.deadline) || 0);
    next.spectators = Array.isArray(raw.spectators) ? raw.spectators.slice(0, 40).map(safeNick).filter(Boolean) : [];
    next.ready = Array.isArray(raw.ready) ? raw.ready.slice(0, 40).map(safeNick).filter(Boolean) : [];
    next.players = sanitizePlayers(raw.players);
    next.winner = safeNick(raw.winner);
    var decoded = raw.owner != null ? decodeOwner(raw.owner, CELL_COUNT) : null;
    if (requireOwner && !decoded) return null;
    return { state: next, owner: decoded };
  }

  function captureInto(map, trail, playerId) {
    blocked.fill(0);
    visited.fill(0);
    var i;
    for (i = 0; i < map.length; i++) if (map[i] === playerId) blocked[i] = 1;
    for (i = 0; i < trail.length; i++) {
      var trailKey = trail[i];
      if (trailKey >= 0 && trailKey < map.length) blocked[trailKey] = 1;
    }
    var head = 0;
    var tail = 0;
    function addEdge(x, y) {
      var index = cellIndex(x, y);
      if (blocked[index] || visited[index]) return;
      visited[index] = 1;
      queue[tail++] = index;
    }
    for (i = 0; i < WORLD_W; i++) {
      addEdge(i, 0);
      addEdge(i, WORLD_H - 1);
    }
    for (i = 0; i < WORLD_H; i++) {
      addEdge(0, i);
      addEdge(WORLD_W - 1, i);
    }
    while (head < tail) {
      var index = queue[head++];
      var x = index % WORLD_W;
      var y = Math.floor(index / WORLD_W);
      var next;
      if (x > 0) {
        next = index - 1;
        if (!blocked[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
      }
      if (x < WORLD_W - 1) {
        next = index + 1;
        if (!blocked[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
      }
      if (y > 0) {
        next = index - WORLD_W;
        if (!blocked[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
      }
      if (y < WORLD_H - 1) {
        next = index + WORLD_W;
        if (!blocked[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
      }
    }
    var gained = 0;
    for (i = 0; i < map.length; i++) {
      if (!visited[i] && map[i] !== playerId) {
        map[i] = playerId;
        gained++;
      }
    }
    return gained;
  }

  function createBase(player) {
    var cx = Math.floor(player.spawnX);
    var cy = Math.floor(player.spawnY);
    var changed = false;
    for (var y = cy - 4; y <= cy + 4; y++) {
      for (var x = cx - 4; x <= cx + 4; x++) {
        if (inside(x, y) && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= 16) {
          owner[cellIndex(x, y)] = player.id;
          changed = true;
        }
      }
    }
    if (changed) ownerLayerDirty = true;
    return changed;
  }

  function spawnFor(index, count) {
    var spots = [
      [.27, .28], [.73, .72], [.73, .28], [.27, .72],
      [.5, .17], [.5, .83], [.16, .5], [.84, .5]
    ];
    var spot = spots[index % spots.length];
    var x = Math.round(WORLD_W * spot[0]);
    var y = Math.round(WORLD_H * spot[1]);
    var dx = WORLD_W / 2 - x;
    var dy = WORLD_H / 2 - y;
    var dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    return { x: x, y: y, dir: dir, count: count };
  }

  function makePlayer(id, nick, bot, count) {
    var spawn = spawnFor(id, count);
    var angle = directionAngle(spawn.dir);
    return {
      id: id,
      nick: safeNick(nick),
      bot: !!bot,
      x: spawn.x,
      y: spawn.y,
      spawnX: spawn.x,
      spawnY: spawn.y,
      dir: spawn.dir,
      angle: angle,
      targetAngle: angle,
      trail: [],
      path: [],
      deadUntil: 0,
      kills: 0,
      retired: false,
      away: false,
      lastCell: cellKey(spawn.x, spawn.y),
      decisionAt: 0,
      turnBackAt: 12 + Math.floor(Math.random() * 16)
    };
  }

  function playerById(id) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i];
    return null;
  }
  function playerByNick(nick) {
    nick = safeNick(nick);
    for (var i = 0; i < state.players.length; i++) if (state.players[i].nick === nick) return state.players[i];
    return null;
  }

  function clearTrail(player) {
    for (var i = 0; i < player.trail.length; i++) {
      var key = player.trail[i];
      if (trailOwner[key] === player.id) trailOwner[key] = -1;
    }
    player.trail.length = 0;
    player.path = [];
    delete visualTrails[player.nick];
  }

  function clearTerritory(id) {
    var changed = false;
    for (var i = 0; i < owner.length; i++) {
      if (owner[i] === id) { owner[i] = -1; changed = true; }
    }
    if (changed) {
      state.ownerRev++;
      ownerLayerDirty = true;
      countsRev = -1;
      fullPending = true;
    }
  }

  function capturePlayer(player) {
    if (!player.trail.length) return;
    captureInto(owner, player.trail, player.id);
    clearTrail(player);
    state.ownerRev++;
    state.rev++;
    ownerLayerDirty = true;
    countsRev = -1;
    fullPending = true;
  }

  function eliminate(player, attacker, now) {
    if (!player || player.deadUntil || player.retired) return;
    clearTerritory(player.id);
    clearTrail(player);
    player.deadUntil = now + RESPAWN_MS;
    player.lastCell = -1;
    if (attacker && attacker !== player) attacker.kills++;
    state.rev++;
    fullPending = true;
  }

  function recallPlayer(player, now) {
    if (!player || player.deadUntil || player.retired) return;
    clearTrail(player);
    player.x = player.spawnX;
    player.y = player.spawnY;
    player.lastCell = cellKey(player.x, player.y);
    player.deadUntil = now + RESPAWN_MS;
    state.rev++;
  }

  function respawn(player, now) {
    if (!player.deadUntil || now < player.deadUntil || player.retired) return;
    player.deadUntil = 0;
    player.x = player.spawnX;
    player.y = player.spawnY;
    player.dir = spawnFor(player.id, state.players.length).dir;
    player.angle = directionAngle(player.dir);
    player.targetAngle = player.angle;
    player.lastCell = cellKey(player.x, player.y);
    player.turnBackAt = 12 + Math.floor(Math.random() * 16);
    if (createBase(player)) {
      state.ownerRev++;
      countsRev = -1;
      fullPending = true;
    }
  }

  function chooseBotDirection(player, now) {
    if (now < player.decisionAt || player.deadUntil || player.retired) return;
    var onOwn = owner[cellKey(player.x, player.y)] === player.id;
    var target = requestedAngle(player.targetAngle, requestedAngle(player.angle, directionAngle(player.dir)));
    var projectedX = player.x + Math.cos(target) * 8;
    var projectedY = player.y + Math.sin(target) * 8;
    if (projectedX < 4 || projectedX > WORLD_W - 4 || projectedY < 4 || projectedY > WORLD_H - 4) {
      target = Math.atan2(WORLD_H / 2 - player.y, WORLD_W / 2 - player.x);
    } else if (!onOwn && player.trail.length >= player.turnBackAt) {
      target = Math.atan2(player.spawnY - player.y, player.spawnX - player.x);
    } else if (Math.random() < (onOwn ? .46 : .68)) {
      target += (Math.random() - .5) * Math.PI * 1.35;
    }
    player.targetAngle = normalizeAngle(target);
    player.dir = nearestDirection(player.targetAngle);
    player.decisionAt = now + 480 + Math.random() * 920;
    if (onOwn) player.turnBackAt = 12 + Math.floor(Math.random() * 18);
  }

  function crossedCellKeys(fromX, fromY, toX, toY) {
    var fromCellX = Math.floor(fromX);
    var fromCellY = Math.floor(fromY);
    var toCellX = Math.floor(toX);
    var toCellY = Math.floor(toY);
    if (fromCellX === toCellX && fromCellY === toCellY) return [];
    var keys = [];
    if (fromCellX !== toCellX && fromCellY !== toCellY) {
      var dx = toX - fromX;
      var dy = toY - fromY;
      var boundaryX = dx > 0 ? fromCellX + 1 : fromCellX;
      var boundaryY = dy > 0 ? fromCellY + 1 : fromCellY;
      var crossXAt = dx ? (boundaryX - fromX) / dx : Infinity;
      var crossYAt = dy ? (boundaryY - fromY) / dy : Infinity;
      keys.push(crossXAt <= crossYAt
        ? cellIndex(toCellX, fromCellY)
        : cellIndex(fromCellX, toCellY));
    }
    keys.push(cellIndex(toCellX, toCellY));
    return keys;
  }

  function segmentsIntersect(startA, endA, startB, endB) {
    var ax = endA.x - startA.x;
    var ay = endA.y - startA.y;
    var bx = endB.x - startB.x;
    var by = endB.y - startB.y;
    var aLengthSquared = ax * ax + ay * ay;
    var bLengthSquared = bx * bx + by * by;
    var epsilon = 1e-9;
    if (aLengthSquared <= epsilon) return pointDistanceToSegmentSquared(startA, startB, endB) <= epsilon;
    if (bLengthSquared <= epsilon) return pointDistanceToSegmentSquared(startB, startA, endA) <= epsilon;
    var offsetX = startB.x - startA.x;
    var offsetY = startB.y - startA.y;
    var denominator = ax * by - ay * bx;
    if (Math.abs(denominator) <= epsilon) {
      if (Math.abs(offsetX * ay - offsetY * ax) > epsilon) return false;
      var from = (offsetX * ax + offsetY * ay) / aLengthSquared;
      var to = from + (bx * ax + by * ay) / aLengthSquared;
      return Math.max(Math.min(from, to), 0) <= Math.min(Math.max(from, to), 1) + epsilon;
    }
    var amountA = (offsetX * by - offsetY * bx) / denominator;
    var amountB = (offsetX * ay - offsetY * ax) / denominator;
    return amountA >= -epsilon && amountA <= 1 + epsilon && amountB >= -epsilon && amountB <= 1 + epsilon;
  }

  function segmentDistanceSquared(startA, endA, startB, endB) {
    if (segmentsIntersect(startA, endA, startB, endB)) return 0;
    return Math.min(
      pointDistanceToSegmentSquared(startA, startB, endB),
      pointDistanceToSegmentSquared(endA, startB, endB),
      pointDistanceToSegmentSquared(startB, startA, endA),
      pointDistanceToSegmentSquared(endB, startA, endA)
    );
  }

  function trailWithoutHead(points, excludedLength) {
    if (!Array.isArray(points) || points.length < 2) return [];
    var remaining = Math.max(0, Number(excludedLength) || 0);
    for (var i = points.length - 1; i > 0; i--) {
      var start = points[i - 1];
      var end = points[i];
      var dx = end.x - start.x;
      var dy = end.y - start.y;
      var length = Math.sqrt(dx * dx + dy * dy);
      if (length <= remaining + 1e-9) {
        remaining -= length;
        continue;
      }
      var keptRatio = (length - remaining) / length;
      var trimmed = points.slice(0, i);
      trimmed.push({ x: start.x + dx * keptRatio, y: start.y + dy * keptRatio });
      return trimmed.length >= 2 ? trimmed : [];
    }
    return [];
  }

  function movementHitsTrail(fromX, fromY, toX, toY, points, headGrace, radius) {
    var collisionPoints = trailWithoutHead(points, headGrace);
    if (collisionPoints.length < 2) return false;
    var movementStart = { x: Number(fromX), y: Number(fromY) };
    var movementEnd = { x: Number(toX), y: Number(toY) };
    var hitRadius = isFinite(radius) ? Math.max(0, Number(radius)) : TRAIL_COLLISION_RADIUS;
    var radiusSquared = hitRadius * hitRadius;
    for (var i = 1; i < collisionPoints.length; i++) {
      if (segmentDistanceSquared(movementStart, movementEnd, collisionPoints[i - 1], collisionPoints[i]) <= radiusSquared) return true;
    }
    return false;
  }

  function collisionTrailPoints(player) {
    if (!player || !player.trail || !player.trail.length) return [];
    var cache = visualTrails[player.nick] || syncVisualTrail(player);
    return cache && cache.points ? cache.points : [];
  }

  function resolveTrailCollisions(player, fromX, fromY, toX, toY, now) {
    var targetKey = cellKey(toX, toY);
    if (player.trail.length && owner[targetKey] !== player.id
        && movementHitsTrail(fromX, fromY, toX, toY, collisionTrailPoints(player), TRAIL_HEAD_GRACE)) {
      eliminate(player, null, now);
      return false;
    }
    for (var i = 0; i < state.players.length; i++) {
      var victim = state.players[i];
      if (victim === player || victim.deadUntil || victim.retired || victim.away || !victim.trail.length) continue;
      if (movementHitsTrail(fromX, fromY, toX, toY, collisionTrailPoints(victim), 0)) {
        eliminate(victim, player, now);
        break;
      }
    }
    return !player.deadUntil;
  }

  function enterPlayerCell(player, key, now) {
    player.lastCell = key;
    if (owner[key] === player.id) {
      if (player.trail.length) capturePlayer(player);
    } else {
      if (player.trail.length >= MAX_TRAIL) { recallPlayer(player, now); return false; }
      player.trail.push(key);
      if (trailOwner[key] < 0) trailOwner[key] = player.id;
    }
    return !player.deadUntil;
  }

  function advancePlayer(player, dt, now) {
    if (player.retired || player.away) return;
    if (player.deadUntil) { respawn(player, now); return; }
    if (player.bot) chooseBotDirection(player, now);
    var angle = requestedAngle(player.angle, directionAngle(player.dir));
    var targetAngle = requestedAngle(player.targetAngle, angle);
    var turn = clamp(angleDelta(angle, targetAngle), -TURN_SPEED * dt, TURN_SPEED * dt);
    player.angle = normalizeAngle(angle + turn);
    player.targetAngle = targetAngle;
    player.dir = nearestDirection(player.angle);
    var fromX = player.x;
    var fromY = player.y;
    var nx = fromX + Math.cos(player.angle) * SPEED * dt;
    var ny = fromY + Math.sin(player.angle) * SPEED * dt;
    if (!inside(Math.floor(nx), Math.floor(ny))) { eliminate(player, null, now); return; }
    if (!resolveTrailCollisions(player, fromX, fromY, nx, ny, now)) return;
    player.x = nx;
    player.y = ny;
    var crossed = crossedCellKeys(fromX, fromY, nx, ny);
    for (var i = 0; i < crossed.length; i++) {
      if (crossed[i] === player.lastCell) continue;
      if (!enterPlayerCell(player, crossed[i], now)) return;
    }
    if (player.trail.length) syncVisualTrail(player, fromX, fromY);
    else delete visualTrails[player.nick];
  }

  function territoryCounts() {
    if (countsRev === state.ownerRev && cachedCounts.length === state.players.length) return cachedCounts.slice();
    var counts = state.players.map(function () { return 0; });
    for (var i = 0; i < owner.length; i++) if (owner[i] >= 0 && owner[i] < counts.length) counts[owner[i]]++;
    cachedCounts = counts;
    countsRev = state.ownerRev;
    return counts.slice();
  }

  function rankRows() {
    var counts = territoryCounts();
    return state.players.map(function (player) {
      return { id: player.id, nick: player.nick, bot: player.bot, kills: player.kills, area: (counts[player.id] || 0) / CELL_COUNT * 100 };
    }).sort(function (a, b) { return b.area - a.area || b.kills - a.kills || a.id - b.id; });
  }

  function notifyRoomChanged() {
    if (api && api.roomChanged) api.roomChanged();
  }

  function broadcastFull(to) {
    if (!api || !api.isHost()) return;
    api.send({ t: "tr_state", by: me().nick, to: to || "", state: snapshot(true) });
    lastFrameSentAt = nowMs();
    lastFullSentAt = lastFrameSentAt;
  }

  function broadcastFrame(now) {
    if (!api || !api.isHost()) return;
    state.frameSeq++;
    api.send({ t: "tr_frame", by: me().nick, state: snapshot(false) });
    lastFrameSentAt = now;
  }

  function requestSync() {
    if (!api || api.isHost() || nowMs() - syncRequestedAt < 1000) return;
    syncRequestedAt = nowMs();
    api.send({ t: "tr_sync_req", by: me().nick, matchId: state.matchId, ownerRev: state.ownerRev });
  }

  function applyFull(raw, sourceHost) {
    var parsed = sanitizeState(raw, true);
    if (!parsed) return false;
    sourceHost = safeNick(sourceHost);
    var hostChanged = !!sourceHost && sourceHost !== authoritativeHost;
    var resetVisualTimeline = hostChanged || parsed.state.matchId !== state.matchId || parsed.state.frameSeq < state.frameSeq;
    if (state.matchId && parsed.state.matchId === state.matchId && parsed.state.rev < state.rev
        && !authorityYielded && !hostChanged) return false;
    state = parsed.state;
    if (resetVisualTimeline) visualTrails = Object.create(null);
    if (sourceHost) authoritativeHost = sourceHost;
    owner.set(parsed.owner);
    wantedOwnerRev = state.ownerRev;
    ownerSyncMissingSince = 0;
    authorityYielded = false;
    needsAuthoritySync = false;
    fullPending = false;
    syncRequestedAt = 0;
    ownerLayerDirty = true;
    countsRev = -1;
    rebuildTrailOwner();
    mergeVisualPlayers();
    syncHostEligibility();
    render();
    return true;
  }

  function applyFrame(raw, sourceHost) {
    var parsed = sanitizeState(raw, false);
    if (!parsed) return false;
    if (state.matchId && parsed.state.matchId !== state.matchId) { requestSync(); return false; }
    if (parsed.state.frameSeq <= state.frameSeq) return false;
    if (parsed.state.ownerRev > state.ownerRev) {
      wantedOwnerRev = Math.max(wantedOwnerRev, parsed.state.ownerRev);
      if (!ownerSyncMissingSince) ownerSyncMissingSince = nowMs();
      requestSync();
    }
    parsed.state.ownerRev = state.ownerRev;
    state = parsed.state;
    sourceHost = safeNick(sourceHost);
    if (sourceHost) authoritativeHost = sourceHost;
    syncHostEligibility();
    rebuildTrailOwner();
    mergeVisualPlayers();
    render();
    return true;
  }

  function applyDirection(player, direction, seq) {
    var legacyDirection = typeof direction === "string" && DIRECTIONS[direction] ? direction : "";
    if (!player || player.bot || player.retired || player.away || player.deadUntil
        || (!legacyDirection && !validAngle(direction))) return false;
    if (Number(seq) <= (inputSeqByNick[player.nick] || 0)) return false;
    inputSeqByNick[player.nick] = Number(seq);
    if (legacyDirection && (sameDirection(player.dir, legacyDirection) || reverseDirection(player.dir, legacyDirection))) return false;
    var angle = requestedAngle(direction, requestedAngle(player.targetAngle, requestedAngle(player.angle, directionAngle(player.dir))));
    if (!legacyDirection && Math.abs(angleDelta(requestedAngle(player.targetAngle, player.angle), angle)) < .035) return false;
    var now = nowMs();
    if (now - (inputAtByNick[player.nick] || 0) < 55) return false;
    inputAtByNick[player.nick] = now;
    player.targetAngle = angle;
    player.dir = legacyDirection || nearestDirection(angle);
    return true;
  }

  function requestDirection(direction) {
    var legacyDirection = typeof direction === "string" && DIRECTIONS[direction] ? direction : "";
    if (!active || state.phase !== "playing" || (!legacyDirection && !validAngle(direction))) return false;
    var now = nowMs();
    if (now - lastInputAt < 90) return false;
    var mine = playerByNick(me().nick);
    if (!mine || mine.retired || mine.deadUntil || mine.bot) return false;
    if (legacyDirection && (reverseDirection(mine.dir, legacyDirection) || sameDirection(mine.dir, legacyDirection))) return false;
    var angle = requestedAngle(direction, requestedAngle(mine.targetAngle, requestedAngle(mine.angle, directionAngle(mine.dir))));
    if (!legacyDirection && Math.abs(angleDelta(requestedAngle(mine.targetAngle, mine.angle), angle)) < .035) return false;
    var seq = ++inputSeq;
    lastInputAt = now;
    mine.targetAngle = angle;
    mine.dir = legacyDirection || nearestDirection(angle);
    inputSeqByNick[mine.nick] = seq;
    if (api.isHost()) return true;
    api.send({ t: "tr_input", by: mine.nick, nick: mine.nick, matchId: state.matchId, seq: seq, dir: mine.dir, angle: Math.round(angle * 1000) / 1000 });
    return true;
  }

  function hostSetReady(nick, ready) {
    if (!api || !api.isHost() || (state.phase !== "idle" && state.phase !== "finished")) return false;
    nick = safeNick(nick);
    if (!nick || !has(participantNicks(), nick) || nick === safeNick(api.host())) return false;
    state.ready = state.ready.filter(function (name) { return name !== nick; });
    if (ready) state.ready.push(nick);
    state.rev++;
    broadcastFull();
    render();
    return true;
  }

  function toggleReady() {
    var nick = me().nick;
    var ready = !has(state.ready, nick);
    if (api.isHost()) return hostSetReady(nick, ready);
    api.send({ t: "tr_ready_req", by: nick, nick: nick, ready: ready });
    return true;
  }

  function hostSetSpectator(nick, spectator) {
    if (!api || !api.isHost() || (state.phase !== "idle" && state.phase !== "finished")) return false;
    nick = safeNick(nick);
    if (!nick || !has(activeNicks(), nick)) return false;
    state.spectators = state.spectators.filter(function (name) { return name !== nick; });
    state.ready = state.ready.filter(function (name) { return name !== nick; });
    if (spectator) state.spectators.push(nick);
    state.rev++;
    broadcastFull();
    syncHostEligibility();
    notifyRoomChanged();
    render();
    return true;
  }

  function toggleRole() {
    var nick = me().nick;
    var spectator = !has(state.spectators, nick);
    if (api.isHost()) return hostSetSpectator(nick, spectator);
    api.send({ t: "tr_role_req", by: nick, nick: nick, spectator: spectator });
    return true;
  }

  function syncHostEligibility() {
    if (!api || !api.setHostEligible) return;
    var awaitingOwner = state.phase === "playing" && (wantedOwnerRev > state.ownerRev || needsAuthoritySync);
    var yieldedDuringMatch = state.phase === "playing" && authorityYielded;
    api.setHostEligible(!has(state.spectators, me().nick) && !awaitingOwner && !yieldedDuringMatch);
  }

  function recoverMissingOwner() {
    if (!api || !api.isHost() || state.phase !== "playing" || wantedOwnerRev <= state.ownerRev) return false;
    wantedOwnerRev = state.ownerRev;
    ownerSyncMissingSince = 0;
    authorityYielded = false;
    needsAuthoritySync = false;
    fullPending = false;
    state.rev++;
    syncHostEligibility();
    onPresence(people(), { forceFull: true });
    notifyRoomChanged();
    return true;
  }

  function hostStart() {
    if (!api || !api.isHost() || (state.phase !== "idle" && state.phase !== "finished")) return false;
    var humans = participantNicks();
    if (!humans.length || !allReady()) {
      if (api.toast) api.toast(!humans.length ? "참가자가 한 명 이상 필요해요" : "모두 레디하면 시작할 수 있어요");
      return false;
    }
    var entries = humans.map(function (nick) { return { nick: nick, bot: false }; });
    if (entries.length === 1) BOT_NAMES.forEach(function (base) {
      var nick = "🤖 " + base;
      while (entries.some(function (entry) { return entry.nick === nick; })) nick += "·";
      entries.push({ nick: nick, bot: true });
    });
    entries = entries.slice(0, MAX_PLAYERS);
    resetGrid();
    inputSeqByNick = Object.create(null);
    inputAtByNick = Object.create(null);
    lastInputAt = 0;
    state.phase = "playing";
    state.rev++;
    state.frameSeq = 0;
    state.ownerRev++;
    state.matchId = "tr-" + nowMs().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
    state.deadline = nowMs() + MATCH_MS;
    state.ready = [];
    state.winner = "";
    state.players = entries.map(function (entry, index) { return makePlayer(index, entry.nick, entry.bot, entries.length); });
    state.players.forEach(createBase);
    rebuildTrailOwner();
    mergeVisualPlayers();
    lastWarnMatchId = "";
    wantedOwnerRev = state.ownerRev;
    ownerSyncMissingSince = 0;
    authoritativeHost = me().nick;
    authorityYielded = false;
    needsAuthoritySync = false;
    fullPending = false;
    broadcastFull();
    notifyRoomChanged();
    render();
    return true;
  }

  function hostFinish() {
    if (!api || !api.isHost() || state.phase !== "playing") return;
    var ranks = rankRows();
    state.phase = "finished";
    state.deadline = 0;
    state.winner = ranks.length ? ranks[0].nick : "";
    state.ready = [];
    state.rev++;
    wantedOwnerRev = state.ownerRev;
    ownerSyncMissingSince = 0;
    authorityYielded = false;
    needsAuthoritySync = false;
    fullPending = false;
    broadcastFull();
    notifyRoomChanged();
    render();
  }

  function hostTick() {
    if (!active || !api || !api.isHost() || state.phase !== "playing") return;
    if ((api.isConnected && !api.isConnected()) || authorityYielded || needsAuthoritySync) return;
    var now = nowMs();
    if (wantedOwnerRev > state.ownerRev) {
      if (ownerSyncMissingSince && now - ownerSyncMissingSince >= OWNER_RECOVERY_MS) recoverMissingOwner();
      return;
    }
    if (now >= state.deadline) { hostFinish(); return; }
    for (var i = 0; i < state.players.length; i++) advancePlayer(state.players[i], STEP_MS / 1000, now);
    if (fullPending) {
      if (now - lastFullSentAt >= FULL_MIN_MS) {
        fullPending = false;
        state.rev++;
        broadcastFull();
      }
      return;
    }
    if (now - lastFrameSentAt >= FRAME_MS) {
      broadcastFrame(now);
    }
  }

  function onMessage(message) {
    if (!message || typeof message.t !== "string" || message.t.indexOf("tr_") !== 0) return false;
    var mine = me().nick;
    if (message.to && message.to !== mine) return true;
    switch (message.t) {
      case "tr_hello":
        if (api && api.isHost()) {
          var helloNick = safeNick(message.by);
          if (helloNick && helloNick !== mine && has(activeNicks(), helloNick)) {
            inputSeqByNick[helloNick] = 0;
            inputAtByNick[helloNick] = 0;
            if (nowMs() - (syncReplyAtByNick[helloNick] || 0) >= 1200) {
              syncReplyAtByNick[helloNick] = nowMs();
              broadcastFull(helloNick);
            }
          }
        }
        return true;
      case "tr_sync_req":
        if (api && api.isHost()) {
          var syncNick = safeNick(message.by);
          if (syncNick && syncNick !== mine && has(activeNicks(), syncNick)
              && (!message.matchId || message.matchId === state.matchId)
              && nowMs() - (syncReplyAtByNick[syncNick] || 0) >= 1200) {
            syncReplyAtByNick[syncNick] = nowMs();
            broadcastFull(syncNick);
          }
        }
        return true;
      case "tr_state":
        if (!api || api.isHost() || message.by !== api.host()) return true;
        applyFull(message.state, message.by);
        return true;
      case "tr_frame":
        if (!api || api.isHost() || message.by !== api.host()) return true;
        applyFrame(message.state, message.by);
        return true;
      case "tr_input":
        if (!api || !api.isHost() || message.matchId !== state.matchId || message.by !== message.nick) return true;
        applyDirection(playerByNick(message.nick), validAngle(message.angle) ? message.angle : message.dir, message.seq);
        return true;
      case "tr_ready_req":
        if (api && api.isHost() && message.by === message.nick) hostSetReady(message.nick, !!message.ready);
        return true;
      case "tr_role_req":
        if (api && api.isHost() && message.by === message.nick) hostSetSpectator(message.nick, !!message.spectator);
        return true;
    }
    return true;
  }

  function setHidden(element, hidden) { if (element) element.classList.toggle("hidden", !!hidden); }
  function formatTime(ms) {
    var seconds = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }

  function personChip(person, ready) {
    var nick = safeNick(person.nick || person);
    var classes = ["territory-person"];
    if (nick === me().nick) classes.push("is-me");
    if (ready) classes.push("is-ready");
    return '<span class="' + classes.join(" ") + '">' + esc(nick) + (person.bot ? " AI" : "") + "</span>";
  }

  function renderRoles() {
    var participants = $("territory-participants");
    var spectators = $("territory-spectators");
    var activeRows = activePeople();
    if (participants) {
      var playingHumans = state.phase === "playing" || state.phase === "finished"
        ? state.players.filter(function (player) { return !player.bot; }).map(function (player) { return player.nick; })
        : participantNicks();
      participants.innerHTML = activeRows.filter(function (person) { return has(playingHumans, safeNick(person.nick)); })
        .map(function (person) { return personChip(person, has(state.ready, safeNick(person.nick))); }).join("")
        || '<span class="territory-person">아직 없음</span>';
    }
    if (spectators) {
      spectators.innerHTML = activeRows.filter(function (person) { return has(state.spectators, safeNick(person.nick)); })
        .map(function (person) { return personChip(person, false); }).join("")
        || '<span class="territory-person">없음</span>';
    }
  }

  function renderControls() {
    if (!api) return;
    var isHost = api.isHost();
    var myNick = me().nick;
    var spectator = has(state.spectators, myNick);
    var role = $("territory-role-btn");
    var ready = $("territory-ready-btn");
    var start = $("territory-start-btn");
    var again = $("territory-again-btn");
    if (role) {
      role.textContent = spectator ? "참가하기" : "관전하기";
      role.setAttribute("aria-pressed", spectator ? "true" : "false");
      role.disabled = state.phase === "playing";
    }
    setHidden(ready, isHost || spectator || state.phase !== "idle");
    if (ready) {
      var isReady = has(state.ready, myNick);
      ready.textContent = isReady ? "레디 취소" : "레디";
      ready.setAttribute("aria-pressed", isReady ? "true" : "false");
    }
    setHidden(start, !isHost || spectator || state.phase !== "idle");
    if (start) {
      var humans = participantNicks().length;
      start.textContent = humans <= 1 ? "연습 시작" : "게임 시작";
      start.disabled = !humans || !allReady();
    }
    if (again) {
      if (isHost) {
        again.textContent = participantNicks().length <= 1 ? "다시 연습" : "다시 시작";
        again.disabled = !participantNicks().length || !allReady();
        again.setAttribute("aria-pressed", "false");
      } else {
        var againReady = has(state.ready, myNick);
        again.textContent = againReady ? "레디 취소" : "레디";
        again.disabled = spectator;
        again.setAttribute("aria-pressed", againReady ? "true" : "false");
      }
    }
  }

  function renderScoreboard() {
    var element = $("territory-scoreboard");
    if (!element) return;
    var mine = me().nick;
    element.innerHTML = rankRows().map(function (row, index) {
      return '<div class="territory-rank' + (row.nick === mine ? " is-me" : "") + '">'
        + '<span class="territory-dot" style="background:' + COLORS[row.id] + '"></span>'
        + '<span class="territory-rank-name">' + MASCOTS[row.id] + " " + (index + 1) + ". " + esc(row.nick) + "</span>"
        + "<strong>" + row.area.toFixed(1) + "%</strong></div>";
    }).join("");
  }

  function renderFinished() {
    var title = $("territory-finished-title");
    var list = $("territory-finished-list");
    if (title) title.textContent = state.winner ? state.winner + " 승리!" : "경기 결과";
    if (list) {
      list.innerHTML = rankRows().map(function (row, index) {
        return '<div class="territory-result-row"><b>' + (index + 1) + '</b><span>' + MASCOTS[row.id] + " " + esc(row.nick)
          + (row.bot ? " <small>AI</small>" : "") + '</span><strong>' + row.area.toFixed(1) + "%</strong></div>";
      }).join("");
    }
  }

  function renderHud() {
    if (!api) return;
    var remaining = state.phase === "playing" ? Math.max(0, state.deadline - nowMs()) : MATCH_MS;
    var time = $("territory-time");
    var timeShell = time ? time.parentElement : null;
    if (time) time.textContent = formatTime(remaining);
    if (timeShell) timeShell.classList.toggle("urgent", state.phase === "playing" && remaining <= 5000);
    if (state.phase === "playing" && remaining <= 5000 && remaining > 0 && lastWarnMatchId !== state.matchId) {
      lastWarnMatchId = state.matchId;
      if (api.playWarning) api.playWarning();
    }
    var mine = playerByNick(me().nick);
    var counts = territoryCounts();
    var myDot = $("territory-my-dot");
    if (myDot && mine) myDot.style.background = COLORS[mine.id];
    var area = $("territory-area");
    if (area) area.textContent = mine ? ((counts[mine.id] || 0) / CELL_COUNT * 100).toFixed(1) + "%" : "0.0%";
    var count = $("territory-people-count");
    if (count) count.textContent = String(activePeople().length);
    renderScoreboard();
  }

  function onVisibilityChange() {
    if (!active || !api || state.phase !== "playing") return;
    if (document.hidden && api.isHost()) {
      authorityYielded = true;
      syncHostEligibility();
      return;
    }
    if (!document.hidden && authorityYielded) {
      var hasOtherActivePlayer = activeNicks().some(function (nick) { return nick !== me().nick; });
      if (!hasOtherActivePlayer) authorityYielded = false;
      syncHostEligibility();
      if (authorityYielded || !api.isHost()) api.send({ t: "tr_hello", by: me().nick });
    }
  }

  function render() {
    var root = $("territorygame");
    if (!root || !api) return;
    if (state.phase !== "playing" && Object.keys(pressedKeys).length) pressedKeys = Object.create(null);
    root.classList.toggle("is-playing", state.phase === "playing");
    setHidden($("territory-lobby"), state.phase !== "idle");
    setHidden($("territory-finished"), state.phase !== "finished");
    var copy = $("territory-lobby-copy");
    if (copy) copy.textContent = participantNicks().length <= 1
      ? "혼자 시작하면 귀여운 AI 3명과 연습해요"
      : "밖으로 나갔다 내 땅으로 돌아오면 영역이 넓어져요";
    renderRoles();
    renderControls();
    renderFinished();
    renderHud();
  }

  function resizeCanvases() {
    if (!active || !canvas || !miniCanvas) return;
    var stage = $("territory-stage");
    if (!stage) return;
    var rect = stage.getBoundingClientRect();
    var width = Math.max(280, Math.floor(rect.width));
    var height = Math.max(320, Math.floor(rect.height));
    var dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.dataset.logicalWidth = String(width);
    canvas.dataset.logicalHeight = String(height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var miniRect = miniCanvas.getBoundingClientRect();
    var miniWidth = Math.max(60, Math.floor(miniRect.width));
    var miniHeight = Math.max(90, Math.floor(miniRect.height));
    miniCanvas.width = Math.round(miniWidth * dpr);
    miniCanvas.height = Math.round(miniHeight * dpr);
    miniCanvas.dataset.logicalWidth = String(miniWidth);
    miniCanvas.dataset.logicalHeight = String(miniHeight);
    miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.phase === "playing") {
      paint();
      paintMinimap();
    }
  }

  function scheduleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resizeTimer = null; resizeCanvases(); }, 80);
  }

  function viewInfo() {
    var width = Number(canvas.dataset.logicalWidth) || canvas.getBoundingClientRect().width;
    var height = Number(canvas.dataset.logicalHeight) || canvas.getBoundingClientRect().height;
    var scale = Math.max(width / WORLD_W, height / WORLD_H, Math.min(14, width / 34));
    var focus = playerByNick(me().nick) || state.players[0] || { nick: "", x: WORLD_W / 2, y: WORLD_H / 2 };
    var visual = visualPlayers[focus.nick] || focus;
    var halfW = Math.min(WORLD_W / 2, width / scale / 2);
    var halfH = Math.min(WORLD_H / 2, height / scale / 2);
    var cx = clamp(visual.x, halfW, WORLD_W - halfW);
    var cy = clamp(visual.y, halfH, WORLD_H - halfH);
    return { width: width, height: height, scale: scale, cx: cx, cy: cy };
  }
  function screenX(x, view) { return (x - view.cx) * view.scale + view.width / 2; }
  function screenY(y, view) { return (y - view.cy) * view.scale + view.height / 2; }

  function drawArena(view) {
    var gradient = ctx.createLinearGradient(0, 0, view.width, view.height);
    gradient.addColorStop(0, "#eaf9df");
    gradient.addColorStop(.55, "#d7f1dc");
    gradient.addColorStop(1, "#cae9e3");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, view.width, view.height);
    var startX = Math.max(0, Math.floor(view.cx - view.width / view.scale / 2) - 2);
    var endX = Math.min(WORLD_W, Math.ceil(view.cx + view.width / view.scale / 2) + 2);
    var startY = Math.max(0, Math.floor(view.cy - view.height / view.scale / 2) - 2);
    var endY = Math.min(WORLD_H, Math.ceil(view.cy + view.height / view.scale / 2) + 2);
    ctx.globalAlpha = .25;
    for (var y = startY - startY % 11; y < endY; y += 11) {
      for (var x = startX - startX % 11; x < endX; x += 11) {
        var px = screenX(x + 2, view);
        var py = screenY(y + 2, view);
        ctx.fillStyle = (x + y) % 3 ? "#73bd93" : "#f6c65f";
        for (var petal = 0; petal < 4; petal++) {
          var angle = petal * Math.PI / 2;
          ctx.beginPath();
          ctx.arc(px + Math.cos(angle) * view.scale * .22, py + Math.sin(angle) * view.scale * .22, Math.max(1, view.scale * .11), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#fff6bd";
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1, view.scale * .09), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(65,132,105,.4)";
    ctx.lineWidth = Math.max(2, view.scale * .2);
    ctx.strokeRect(screenX(0, view), screenY(0, view), WORLD_W * view.scale, WORLD_H * view.scale);
  }

  function rebuildTerritoryLayer() {
    if (!ownerLayerDirty || !territoryCtx) return;
    var s = LAYER_SCALE;
    territoryCtx.clearRect(0, 0, territoryLayer.width, territoryLayer.height);
    territoryCtx.globalAlpha = 1;
    for (var y = 0; y < WORLD_H; y++) {
      for (var x = 0; x < WORLD_W;) {
        var id = owner[cellIndex(x, y)];
        if (id < 0) { x++; continue; }
        var startX = x;
        while (x < WORLD_W && owner[cellIndex(x, y)] === id) x++;
        territoryCtx.fillStyle = TERRITORY_COLORS[id] || COLORS[id];
        territoryCtx.fillRect(startX * s, y * s, (x - startX) * s, s);
      }
    }
    territoryCtx.globalAlpha = 1;
    ownerLayerDirty = false;
  }

  function drawTerritories(view) {
    rebuildTerritoryLayer();
    var worldWidth = Math.min(WORLD_W, view.width / view.scale);
    var worldHeight = Math.min(WORLD_H, view.height / view.scale);
    var sourceX = clamp(view.cx - worldWidth / 2, 0, WORLD_W - worldWidth) * LAYER_SCALE;
    var sourceY = clamp(view.cy - worldHeight / 2, 0, WORLD_H - worldHeight) * LAYER_SCALE;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.drawImage(territoryLayer, sourceX, sourceY, worldWidth * LAYER_SCALE, worldHeight * LAYER_SCALE, 0, 0, view.width, view.height);
  }

  function pointDistanceToSegmentSquared(point, start, end) {
    var dx = end.x - start.x;
    var dy = end.y - start.y;
    if (!dx && !dy) {
      dx = point.x - start.x;
      dy = point.y - start.y;
      return dx * dx + dy * dy;
    }
    var amount = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
    var px = start.x + amount * dx;
    var py = start.y + amount * dy;
    dx = point.x - px;
    dy = point.y - py;
    return dx * dx + dy * dy;
  }

  function simplifyTrailPoints(points, tolerance) {
    if (points.length <= 2) return points;
    var keep = new Uint8Array(points.length);
    var stack = [0, points.length - 1];
    var toleranceSquared = tolerance * tolerance;
    keep[0] = 1;
    keep[points.length - 1] = 1;
    while (stack.length) {
      var end = stack.pop();
      var start = stack.pop();
      var furthest = -1;
      var distance = toleranceSquared;
      for (var i = start + 1; i < end; i++) {
        var nextDistance = pointDistanceToSegmentSquared(points[i], points[start], points[end]);
        if (nextDistance > distance) {
          distance = nextDistance;
          furthest = i;
        }
      }
      if (furthest >= 0) {
        keep[furthest] = 1;
        stack.push(start, furthest, furthest, end);
      }
    }
    return points.filter(function (_point, index) { return !!keep[index]; });
  }

  function sanitizeVisualTrail(raw) {
    if (!Array.isArray(raw)) return [];
    var length = Math.min(raw.length - raw.length % 2, MAX_VISUAL_TRAIL_POINTS * 2);
    var maxX = Math.floor((WORLD_W - .001) * VISUAL_TRAIL_SCALE);
    var maxY = Math.floor((WORLD_H - .001) * VISUAL_TRAIL_SCALE);
    var packed = [];
    for (var i = 0; i < length; i += 2) {
      var x = Number(raw[i]);
      var y = Number(raw[i + 1]);
      if (!isFinite(x) || !isFinite(y)) continue;
      packed.push(clamp(Math.round(x), 0, maxX), clamp(Math.round(y), 0, maxY));
    }
    return packed;
  }

  function decodeVisualTrail(raw) {
    var packed = sanitizeVisualTrail(raw);
    var points = [];
    for (var i = 0; i < packed.length; i += 2) {
      points.push({ x: packed[i] / VISUAL_TRAIL_SCALE, y: packed[i + 1] / VISUAL_TRAIL_SCALE });
    }
    return points;
  }

  function limitVisualTrailPoints(points) {
    var compact = (points || []).slice();
    var tolerance = TRAIL_SAMPLE_TOLERANCE * 1.5;
    while (compact.length > MAX_VISUAL_TRAIL_POINTS && tolerance <= 1.2) {
      compact = simplifyTrailPoints(compact, tolerance);
      tolerance *= 1.6;
    }
    if (compact.length <= MAX_VISUAL_TRAIL_POINTS) return compact;
    var sampled = [];
    for (var i = 0; i < MAX_VISUAL_TRAIL_POINTS; i++) {
      sampled.push(compact[Math.round(i * (compact.length - 1) / (MAX_VISUAL_TRAIL_POINTS - 1))]);
    }
    return sampled;
  }

  function encodeVisualTrail(points) {
    var compact = limitVisualTrailPoints(points);
    var packed = [];
    for (var i = 0; i < compact.length; i++) {
      packed.push(
        clamp(Math.round(compact[i].x * VISUAL_TRAIL_SCALE), 0, Math.floor((WORLD_W - .001) * VISUAL_TRAIL_SCALE)),
        clamp(Math.round(compact[i].y * VISUAL_TRAIL_SCALE), 0, Math.floor((WORLD_H - .001) * VISUAL_TRAIL_SCALE))
      );
    }
    return packed;
  }

  function compactVisualTrail(player) {
    if (!player || !player.trail || !player.trail.length) return [];
    var cache = visualTrails[player.nick];
    var points = cache && cache.points ? cache.points : decodeVisualTrail(player.path);
    if (!points.length) points = rebuiltVisualTrailPoints(player.trail);
    var compact = limitVisualTrailPoints(points);
    if (cache && compact.length !== cache.points.length) cache.points = compact;
    return encodeVisualTrail(compact);
  }

  function appendVisualTrailPoint(points, x, y) {
    if (!isFinite(x) || !isFinite(y)) return points;
    var next = { x: Number(x), y: Number(y) };
    if (!points.length) { points.push(next); return points; }
    var last = points[points.length - 1];
    var dx = next.x - last.x;
    var dy = next.y - last.y;
    if (dx * dx + dy * dy < .0004) {
      points[points.length - 1] = next;
      return points;
    }
    if (points.length >= 2) {
      var start = points[points.length - 2];
      var forward = (last.x - start.x) * dx + (last.y - start.y) * dy;
      if (forward >= 0 && pointDistanceToSegmentSquared(last, start, next) <= TRAIL_SAMPLE_TOLERANCE * TRAIL_SAMPLE_TOLERANCE) {
        points[points.length - 1] = next;
        return points;
      }
    }
    points.push(next);
    return points;
  }

  function rebuiltVisualTrailPoints(trail) {
    return (trail || []).map(function (key) {
      return { x: key % WORLD_W + .5, y: Math.floor(key / WORLD_W) + .5 };
    });
  }

  function visualTrailContinues(cache, trail) {
    return !!(cache && cache.matchId === state.matchId && cache.first === trail[0]
      && cache.trailLength > 0 && cache.trailLength <= trail.length
      && trail[cache.trailLength - 1] === cache.lastKey);
  }

  function syncVisualTrail(player, startX, startY) {
    var trail = player.trail || [];
    if (!trail.length) { delete visualTrails[player.nick]; return null; }
    var cache = visualTrails[player.nick];
    var networkPath = Array.isArray(player.path) && player.path.length ? player.path : null;
    if (networkPath && api && !api.isHost() && (!cache || cache.networkPath !== networkPath)) {
      var networkPoints = decodeVisualTrail(networkPath);
      if (networkPoints.length) {
        cache = visualTrails[player.nick] = {
          matchId: state.matchId,
          first: trail[0],
          trailLength: trail.length,
          lastKey: trail[trail.length - 1],
          points: networkPoints,
          networkPath: networkPath
        };
      }
    }
    if (!visualTrailContinues(cache, trail)) {
      var hasStart = isFinite(startX) && isFinite(startY);
      var decodedPath = decodeVisualTrail(player.path);
      var points = hasStart ? [{ x: Number(startX), y: Number(startY) }]
        : (decodedPath.length ? decodedPath : rebuiltVisualTrailPoints(trail));
      if (!hasStart && points.length > 1) points[points.length - 1] = { x: player.x, y: player.y };
      cache = visualTrails[player.nick] = {
        matchId: state.matchId,
        first: trail[0],
        trailLength: trail.length,
        lastKey: trail[trail.length - 1],
        points: points
      };
    }
    appendVisualTrailPoint(cache.points, player.x, player.y);
    if (cache.points.length > MAX_VISUAL_TRAIL_POINTS) cache.points = limitVisualTrailPoints(cache.points);
    cache.trailLength = trail.length;
    cache.lastKey = trail[trail.length - 1];
    return cache;
  }

  function visibleTrailPoints(points, endpoint) {
    if (!points || !points.length) return [];
    if (!endpoint || !isFinite(endpoint.x) || !isFinite(endpoint.y) || points.length === 1) return points.slice();
    var tail = points[points.length - 1];
    if (Math.abs(tail.x - endpoint.x) <= .001 && Math.abs(tail.y - endpoint.y) <= .001) return points.slice();
    var bestIndex = points.length - 2;
    var bestDistance = Infinity;
    for (var i = points.length - 2; i >= 0; i--) {
      var distance = pointDistanceToSegmentSquared(endpoint, points[i], points[i + 1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    var visible = points.slice(0, bestIndex + 1);
    appendVisualTrailPoint(visible, endpoint.x, endpoint.y);
    return visible;
  }

  function trailPoints(player, endpoint) {
    var cache = syncVisualTrail(player);
    return cache ? visibleTrailPoints(cache.points, endpoint) : [];
  }

  function drawTrail(player, view) {
    if (!player.trail.length) return;
    var visual = visualPlayers[player.nick] || player;
    var points = trailPoints(player, visual);
    if (!points.length) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(screenX(points[0].x, view), screenY(points[0].y, view));
    for (var i = 1; i < points.length; i++) {
      var point = points[i];
      ctx.lineTo(screenX(point.x, view), screenY(point.y, view));
    }
    ctx.strokeStyle = TERRITORY_COLORS[player.id] || COLORS[player.id];
    ctx.lineWidth = Math.max(5, view.scale * TRAIL_WIDTH);
    ctx.stroke();
  }

  function drawPlayer(player, view, now) {
    var visual = visualPlayers[player.nick] || player;
    var px = screenX(visual.x, view);
    var py = screenY(visual.y, view);
    if (px < -50 || px > view.width + 50 || py < -50 || py > view.height + 50 || player.retired) return;
    if (player.deadUntil) {
      var progress = clamp(1 - (player.deadUntil - now) / RESPAWN_MS, 0, 1);
      ctx.strokeStyle = COLORS[player.id];
      ctx.lineWidth = 3;
      ctx.globalAlpha = .3 + progress * .7;
      ctx.beginPath();
      ctx.arc(screenX(player.spawnX, view), screenY(player.spawnY, view), view.scale * (1 + progress * 1.8), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    var radius = Math.max(10, view.scale * .9);
    var bob = Math.sin(now / 110 + player.id) * radius * .06;
    ctx.save();
    ctx.translate(px, py + bob);
    ctx.rotate(visual.angle);
    ctx.fillStyle = "rgba(32,68,83,.15)";
    ctx.beginPath();
    ctx.ellipse(1, radius * .82, radius * .78, radius * .3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS[player.id];
    ctx.strokeStyle = "#214457";
    ctx.lineWidth = Math.max(2, radius * .13);
    ctx.beginPath();
    ctx.moveTo(-radius * .55, -radius * .55);
    ctx.lineTo(-radius * .3, -radius * 1.02);
    ctx.lineTo(-radius * .05, -radius * .62);
    ctx.moveTo(radius * .55, -radius * .55);
    ctx.lineTo(radius * .3, -radius * 1.02);
    ctx.lineTo(radius * .05, -radius * .62);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fffaf1";
    ctx.beginPath();
    ctx.arc(radius * .14, -radius * .17, radius * .67, -.9, 2.1);
    ctx.fill();
    ctx.fillStyle = "#214457";
    ctx.beginPath(); ctx.arc(radius * .35, -radius * .2, radius * .1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(radius * .54, radius * .08, radius * .08, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#214457";
    ctx.lineWidth = Math.max(1.5, radius * .09);
    ctx.beginPath(); ctx.arc(radius * .48, radius * .2, radius * .17, 0, Math.PI * .75); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#214457";
    ctx.font = "900 " + Math.max(10, Math.round(view.scale * .76)) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(player.nick + (player.bot ? " AI" : ""), px, py - radius - 8);
  }

  function paint() {
    if (!active || !ctx || !canvas) return;
    var view = viewInfo();
    var now = nowMs();
    ctx.clearRect(0, 0, view.width, view.height);
    drawArena(view);
    drawTerritories(view);
    state.players.forEach(function (player) {
      var visual = visualPlayers[player.nick] || player;
      visual.x += (player.x - visual.x) * .24;
      visual.y += (player.y - visual.y) * .24;
      var playerAngle = requestedAngle(player.angle, directionAngle(player.dir));
      if (!validAngle(visual.angle)) visual.angle = playerAngle;
      visual.angle = normalizeAngle(visual.angle + angleDelta(visual.angle, playerAngle) * .24);
    });
    state.players.forEach(function (player) { drawTrail(player, view); });
    state.players.forEach(function (player) { drawPlayer(player, view, now); });
  }

  function paintMinimap() {
    if (!active || !miniCtx || !miniCanvas) return;
    var width = Number(miniCanvas.dataset.logicalWidth) || miniCanvas.getBoundingClientRect().width;
    var height = Number(miniCanvas.dataset.logicalHeight) || miniCanvas.getBoundingClientRect().height;
    rebuildTerritoryLayer();
    miniCtx.clearRect(0, 0, width, height);
    miniCtx.fillStyle = "#cfeedd";
    miniCtx.fillRect(0, 0, width, height);
    miniCtx.globalAlpha = 1;
    miniCtx.imageSmoothingEnabled = false;
    miniCtx.drawImage(territoryLayer, 0, 0, width, height);
    miniCtx.globalAlpha = 1;
    for (var i = 0; i < state.players.length; i++) {
      var player = state.players[i];
      if (player.deadUntil || player.retired) continue;
      miniCtx.fillStyle = COLORS[player.id];
      miniCtx.beginPath();
      miniCtx.arc(player.x / WORLD_W * width, player.y / WORLD_H * height, player.nick === me().nick ? 3.2 : 2.2, 0, Math.PI * 2);
      miniCtx.fill();
      if (player.nick === me().nick) {
        miniCtx.strokeStyle = "#214457";
        miniCtx.lineWidth = 1.2;
        miniCtx.stroke();
      }
    }
  }

  function renderLoop(timestamp) {
    if (!active) return;
    if (typeof document !== "undefined" && document.hidden) {
      renderRaf = requestAnimationFrame(renderLoop);
      return;
    }
    if (state.phase === "playing") {
      if (timestamp - lastRenderAt >= 32) {
        paint();
        lastRenderAt = timestamp;
      }
      if (timestamp - lastHudAt >= 250) {
        renderHud();
        lastHudAt = timestamp;
      }
      if (timestamp - lastMiniAt >= 350) {
        paintMinimap();
        lastMiniAt = timestamp;
      }
    }
    renderRaf = requestAnimationFrame(renderLoop);
  }

  function bindDom() {
    canvas = $("territory-board");
    miniCanvas = $("territory-minimap");
    if (!canvas || !miniCanvas) return false;
    ctx = canvas.getContext("2d");
    miniCtx = miniCanvas.getContext("2d");
    if (!territoryLayer) {
      territoryLayer = document.createElement("canvas");
      territoryLayer.width = WORLD_W * LAYER_SCALE;
      territoryLayer.height = WORLD_H * LAYER_SCALE;
      territoryCtx = territoryLayer.getContext("2d");
    }
    if (bound) return true;
    bound = true;

    $("territory-people-btn").addEventListener("click", function () { if (api && api.openPlayers) api.openPlayers(); });
    $("territory-leave-btn").addEventListener("click", function () { if (api && api.leaveRoom) api.leaveRoom(); });
    $("territory-menu-btn").addEventListener("click", function () { if (api && api.openMenu) api.openMenu(); });
    $("territory-role-btn").addEventListener("click", toggleRole);
    $("territory-ready-btn").addEventListener("click", toggleReady);
    $("territory-start-btn").addEventListener("click", hostStart);
    $("territory-again-btn").addEventListener("click", function () { if (api && api.isHost()) hostStart(); else toggleReady(); });

    var keyVectors = {
      ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },
      ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 },
      ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 }
    };
    function updateKeyboardDirection() {
      var x = 0;
      var y = 0;
      Object.keys(pressedKeys).forEach(function (code) {
        var vector = keyVectors[code];
        if (vector) { x += vector.x; y += vector.y; }
      });
      if (x || y) requestDirection(Math.atan2(y, x));
    }

    canvas.addEventListener("pointerdown", function (event) {
      if (!active) return;
      swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    canvas.addEventListener("pointermove", function (event) {
      if (!swipe || swipe.id !== event.pointerId) return;
      var dx = event.clientX - swipe.x;
      var dy = event.clientY - swipe.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
      requestDirection(Math.atan2(dy, dx));
      swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
      event.preventDefault();
    });
    function clearSwipe(event) {
      if (!event || !swipe || swipe.id === event.pointerId) swipe = null;
    }
    canvas.addEventListener("pointerup", clearSwipe);
    canvas.addEventListener("pointercancel", clearSwipe);
    window.addEventListener("keydown", function (event) {
      if (!active || state.phase !== "playing" || !keyVectors[event.code]) return;
      pressedKeys[event.code] = true;
      updateKeyboardDirection();
      event.preventDefault();
    });
    window.addEventListener("keyup", function (event) {
      if (!active || !keyVectors[event.code]) return;
      delete pressedKeys[event.code];
      if (state.phase !== "playing") return;
      updateKeyboardDirection();
      event.preventDefault();
    });
    window.addEventListener("blur", function () { pressedKeys = Object.create(null); });
    window.addEventListener("resize", scheduleResize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return true;
  }

  function startLoops() {
    stopLoops();
    tickId = setInterval(hostTick, STEP_MS);
    lastRenderAt = 0;
    lastHudAt = 0;
    lastMiniAt = 0;
    renderRaf = requestAnimationFrame(renderLoop);
  }

  function stopLoops() {
    if (tickId) { clearInterval(tickId); tickId = null; }
    if (renderRaf) { cancelAnimationFrame(renderRaf); renderRaf = 0; }
  }

  function onReady() {
    if (!api) return;
    if (api.isHost() && !authorityYielded && !needsAuthoritySync && wantedOwnerRev <= state.ownerRev
        && (!api.isConnected || api.isConnected())) broadcastFull();
    else {
      helloPending = true;
      api.send({ t: "tr_hello", by: me().nick });
    }
  }

  function onConnection(online) {
    if (!api) return;
    if (!online) {
      if (state.phase === "playing") {
        needsAuthoritySync = true;
        if (api.isHost()) authorityYielded = true;
      }
      syncHostEligibility();
      return;
    }
    if (state.phase !== "playing") {
      authorityYielded = false;
      needsAuthoritySync = false;
      wantedOwnerRev = state.ownerRev;
    }
    syncHostEligibility();
    if (state.phase === "playing" && (authorityYielded || needsAuthoritySync || !api.isHost() || wantedOwnerRev > state.ownerRev)) {
      helloPending = true;
      api.send({ t: "tr_hello", by: me().nick });
    }
  }

  function onPresence(_list, options) {
    if (!api) return;
    var shownPeople = orderedPeople();
    var shownList = shownPeople.map(function (person) { return safeNick(person.nick); });
    var activeList = activeNicks();
    var changed = false;
    state.spectators = state.spectators.filter(function (nick) { return has(shownList, nick); });
    state.ready = state.ready.filter(function (nick) { return has(activeList, nick); });
    if (api.isHost()) {
      if (options && options.becameHost) authoritativeHost = me().nick;
      if (state.phase === "playing" && (authorityYielded || needsAuthoritySync)) {
        var hasOtherActivePlayer = activeList.some(function (nick) { return nick !== me().nick; });
        if (hasOtherActivePlayer) {
          syncHostEligibility();
          render();
          return;
        }
        authorityYielded = false;
        needsAuthoritySync = false;
      }
      if (state.phase === "playing" && wantedOwnerRev > state.ownerRev) {
        if (!ownerSyncMissingSince) ownerSyncMissingSince = nowMs();
        syncHostEligibility();
        render();
        return;
      }
      if (state.phase === "playing") {
        activeList.forEach(function (nick) {
          if (!playerByNick(nick) && !has(state.spectators, nick)) { state.spectators.push(nick); changed = true; }
        });
        state.players.forEach(function (player) {
          if (player.bot) return;
          var person = shownPeople.filter(function (entry) { return safeNick(entry.nick) === player.nick; })[0];
          var present = !!person && !person.away;
          var away = !!person && !!person.away;
          if (away && !player.retired) {
            if (!player.away) {
              clearTrail(player);
              player.x = player.spawnX;
              player.y = player.spawnY;
              player.lastCell = cellKey(player.x, player.y);
              player.deadUntil = 0;
              player.away = true;
              changed = true;
            }
          } else if (!person && !player.retired) {
            clearTerritory(player.id);
            clearTrail(player);
            player.retired = true;
            player.away = false;
            player.deadUntil = 0;
            changed = true;
          } else if (present && player.retired) {
            player.retired = false;
            player.away = false;
            player.x = player.spawnX;
            player.y = player.spawnY;
            player.lastCell = cellKey(player.x, player.y);
            if (createBase(player)) state.ownerRev++;
            changed = true;
          } else if (present && player.away) {
            player.away = false;
            inputSeqByNick[player.nick] = 0;
            inputAtByNick[player.nick] = 0;
            if (owner[cellKey(player.spawnX, player.spawnY)] !== player.id && createBase(player)) state.ownerRev++;
            changed = true;
          }
        });
      }
      if (options && options.becameHost) {
        state.rev++;
        changed = true;
      }
      if (changed || (options && options.forceFull)) {
        countsRev = -1;
        ownerLayerDirty = true;
        rebuildTrailOwner();
        fullPending = false;
        broadcastFull();
      } else if (state.phase === "idle" || state.phase === "finished") {
        broadcastFull();
      }
    } else if (state.phase === "playing") {
      if (helloPending) {
        helloPending = false;
        api.send({ t: "tr_hello", by: me().nick });
      } else requestSync();
    }
    syncHostEligibility();
    render();
  }

  function roomMeta() {
    if (state.phase === "playing") {
      var leader = rankRows()[0];
      return { status: "게임중", summary: leader ? leader.nick + " " + leader.area.toFixed(1) + "% 선두" : "영역 확장 중" };
    }
    if (state.phase === "finished") {
      return { status: "끝", summary: state.winner ? state.winner + " 승리" : "경기 종료" };
    }
    return { status: "대기중", summary: participantNicks().length + "명 참가 · " + state.spectators.length + "명 관전" };
  }

  function isBusy() {
    var mine = playerByNick(me().nick);
    return state.phase === "playing" && !!(mine && !mine.retired);
  }

  function canChat() { return true; }

  function renderPlayers(box, hint) {
    if (!box || !api) return;
    if (hint) {
      hint.className = "players-hint";
      hint.textContent = api.isHost() && state.phase !== "playing"
        ? "방장은 참가자와 관전자를 바꿀 수 있어요."
        : "게임 중에는 역할을 바꿀 수 없어요.";
    }
    var host = api.host ? api.host() : "";
    box.innerHTML = orderedPeople().map(function (person) {
      var nick = safeNick(person.nick);
      var spectator = has(state.spectators, nick) || (state.phase === "playing" && !playerByNick(nick));
      var role = spectator ? "관전" : "참가";
      var html = '<div class="prow' + (person.away ? " away" : "") + '"><span class="pname"><span class="rtag ' + (spectator ? "role-spec" : "role-black") + '">' + role + "</span>" + esc(nick);
      if (nick === host && !person.away) html += ' <span class="mini-host">방장</span>';
      if (nick === me().nick) html += ' <span class="mini-me">나</span>';
      if (person.away) html += ' <span class="mini-away">자리비움</span>';
      html += "</span>";
      if (api.isHost() && state.phase !== "playing" && !person.away) {
        html += '<span class="passign"><button class="pbtn" data-tr-role="' + (spectator ? "play" : "spec") + '" data-nick="' + esc(nick) + '">' + (spectator ? "참가" : "관전") + "</button></span>";
      }
      return html + "</div>";
    }).join("");
    var buttons = box.querySelectorAll("[data-tr-role]");
    for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener("click", function () {
      hostSetSpectator(this.getAttribute("data-nick"), this.getAttribute("data-tr-role") === "spec");
      renderPlayers(box, hint);
    });
  }

  function rules() {
    return {
      title: "땅따먹기 규칙",
      html: '<p class="rule-intro">선을 그리듯 달려서 <b>내 색의 영역을 가장 많이 만드는 게임</b>입니다.</p>'
        + '<p class="rule-foot" style="text-align:left;line-height:1.8">'
        + '· 화면을 원하는 방향으로 밀어 이동 방향을 바꿉니다.<br>'
        + '· 내 땅 밖으로 나갔다가 <b>다시 내 땅으로 돌아오면</b> 둘러싼 곳이 내 영역이 됩니다.<br>'
        + '· 밖에 나온 꼬리를 상대가 건드리면 영역을 잃고 잠시 뒤 다시 출발합니다.<br>'
        + '· 내 꼬리를 내가 밟거나 경기장 밖으로 나가도 다시 출발합니다.<br>'
        + '· 제한시간 <b>90초</b>가 끝났을 때 영역 비율이 가장 높은 사람이 승리합니다.<br>'
        + '· 혼자 시작하면 AI 3명이 함께 연습 경기를 합니다.</p>'
    };
  }

  function syncAudio() {}

  function enter(nextApi) {
    leave();
    api = nextApi;
    active = true;
    state = freshState();
    resetGrid();
    visualPlayers = Object.create(null);
    visualTrails = Object.create(null);
    pressedKeys = Object.create(null);
    inputSeq = 0;
    inputSeqByNick = Object.create(null);
    inputAtByNick = Object.create(null);
    syncReplyAtByNick = Object.create(null);
    helloPending = false;
    lastInputAt = 0;
    lastWarnMatchId = "";
    wantedOwnerRev = 0;
    ownerSyncMissingSince = 0;
    authoritativeHost = "";
    authorityYielded = false;
    needsAuthoritySync = false;
    lastFullSentAt = 0;
    if (!bindDom()) throw new Error("땅따먹기 화면을 찾을 수 없습니다.");
    resizeCanvases();
    startLoops();
    syncHostEligibility();
    render();
  }

  function leave() {
    active = false;
    stopLoops();
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
    swipe = null;
    var root = $("territorygame");
    if (root) root.classList.remove("is-playing");
    api = null;
    state = freshState();
    resetGrid();
    visualPlayers = Object.create(null);
    visualTrails = Object.create(null);
    pressedKeys = Object.create(null);
    syncReplyAtByNick = Object.create(null);
    helloPending = false;
    wantedOwnerRev = 0;
    ownerSyncMissingSince = 0;
    authoritativeHost = "";
    authorityYielded = false;
    needsAuthoritySync = false;
    lastFullSentAt = 0;
  }

  var controller = {
    enter: enter,
    leave: leave,
    onReady: onReady,
    onConnection: onConnection,
    onMessage: onMessage,
    onPresence: onPresence,
    roomMeta: roomMeta,
    isBusy: isBusy,
    canChat: canChat,
    renderPlayers: renderPlayers,
    render: render,
    rules: rules,
    syncAudio: syncAudio,
    get state() { return state; }
  };

  if (window.__TERRITORY_RUSH_TEST__) {
    controller._test = {
      freshState: freshState,
      encodeOwner: encodeOwner,
      decodeOwner: decodeOwner,
      captureInto: captureInto,
      sanitizeState: sanitizeState,
      makePlayer: makePlayer,
      applyDirection: applyDirection,
      advancePlayer: advancePlayer,
      crossedCellKeys: crossedCellKeys,
      segmentDistanceSquared: segmentDistanceSquared,
      trailWithoutHead: trailWithoutHead,
      movementHitsTrail: movementHitsTrail,
      simplifyTrailPoints: simplifyTrailPoints,
      appendVisualTrailPoint: appendVisualTrailPoint,
      rebuiltVisualTrailPoints: rebuiltVisualTrailPoints,
      visibleTrailPoints: visibleTrailPoints,
      sanitizeVisualTrail: sanitizeVisualTrail,
      encodeVisualTrail: encodeVisualTrail,
      decodeVisualTrail: decodeVisualTrail,
      normalizeAngle: normalizeAngle,
      angleDelta: angleDelta,
      reverseDirection: reverseDirection,
      hostStart: hostStart,
      hostTick: hostTick,
      hostSetReady: hostSetReady,
      hostSetSpectator: hostSetSpectator,
      snapshot: snapshot,
      setApi: function (nextApi) { api = nextApi; },
      setState: function (nextState) { state = nextState; },
      setSyncState: function (wanted, yielded, missingSince, needsSync) {
        wantedOwnerRev = Number(wanted) || 0;
        authorityYielded = !!yielded;
        ownerSyncMissingSince = Number(missingSince) || 0;
        needsAuthoritySync = !!needsSync;
        syncRequestedAt = 0;
      },
      setAuthoritativeHost: function (nick) { authoritativeHost = safeNick(nick); },
      getAuthoritativeHost: function () { return authoritativeHost; },
      recoverMissingOwner: recoverMissingOwner,
      getState: function () { return state; },
      getOwner: function () { return owner; },
      resetGrid: resetGrid,
      constants: {
        width: WORLD_W,
        height: WORLD_H,
        cells: CELL_COUNT,
        matchMs: MATCH_MS,
        stepMs: STEP_MS,
        frameMs: FRAME_MS,
        trailWidth: TRAIL_WIDTH,
        trailCollisionRadius: TRAIL_COLLISION_RADIUS,
        trailHeadGrace: TRAIL_HEAD_GRACE,
        trailSampleTolerance: TRAIL_SAMPLE_TOLERANCE,
        maxVisualTrailPoints: MAX_VISUAL_TRAIL_POINTS,
        visualTrailScale: VISUAL_TRAIL_SCALE,
        maxPlayers: MAX_PLAYERS,
        maxTrail: MAX_TRAIL
      }
    };
  }

  return controller;
})();
