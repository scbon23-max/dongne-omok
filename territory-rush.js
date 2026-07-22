window.TerritoryRush = (function () {
  "use strict";

  var WORLD_W = 72;
  var WORLD_H = 108;
  var CELL_COUNT = WORLD_W * WORLD_H;
  var MATCH_MS = 90000;
  var STEP_MS = 50;
  var FRAME_MS = 400;
  var FULL_MIN_MS = 400;
  var INPUT_SEND_MS = 300;
  var OWNER_RECOVERY_MS = 1800;
  var RESPAWN_MS = 1800;
  var RESPAWN_RETRY_MS = 1000;
  var RESPAWN_EMERGENCY_MS = 3500;
  var EMERGENCY_PLAYER_DISTANCE = 9;
  var START_COUNTDOWN_MS = 3000;
  var INPUT_ACK_RETRY_MS = 850;
  var INPUT_ACK_MAX_ATTEMPTS = 3;
  var PREDICTION_MAX_MS = 1200;
  var MIN_FRAME_MS = 200;
  var VISUAL_CATCHUP_SPEED_MULTIPLIER = 3;
  var SPEED = 8.88;
  var TURN_SPEED = Math.PI * 4;
  var ARENA_INSET = .9;
  var PLAYABLE_MIN_X = Math.ceil(ARENA_INSET);
  var PLAYABLE_MAX_X = Math.floor(WORLD_W - ARENA_INSET);
  var PLAYABLE_MIN_Y = Math.ceil(ARENA_INSET);
  var PLAYABLE_MAX_Y = Math.floor(WORLD_H - ARENA_INSET);
  var PLAYABLE_CELL_COUNT = (PLAYABLE_MAX_X - PLAYABLE_MIN_X) * (PLAYABLE_MAX_Y - PLAYABLE_MIN_Y);
  var ARENA_BOUNDARY_COLOR = "#31576a";
  var TRAIL_WIDTH = .64;
  var TRAIL_COLLISION_RADIUS = TRAIL_WIDTH / 2;
  var TRAIL_HEAD_GRACE = TRAIL_COLLISION_RADIUS * Math.SQRT2 + .08;
  var TRAIL_SAMPLE_TOLERANCE = .06;
  var MAX_VISUAL_TRAIL_POINTS = 180;
  var VISUAL_TRAIL_SCALE = 20;
  var MAX_CAPTURE_PARTICLES = 72;
  var MAX_CAPTURE_BURSTS = 12;
  var CAPTURE_PARTICLES_PER_BURST = 3;
  var MAX_PLAYERS = 8;
  var MAX_ROOM_MEMBERS = 10;
  var MAX_TRAIL = 360;
  var LAYER_SCALE = 4;
  var BASE_RADIUS = 4;
  var SPAWN_CLEARANCE = 2;
  var PRESERVED_SPAWN_CLEARANCE = 2;
  var SPAWN_MARGIN = 7;
  var INITIAL_SPAWN_MIN_DISTANCE = 18;
  var RESPAWN_PLAYER_DISTANCE = 14;
  var GAME_BGM_SRC = "assets/territory-rush-bgm.mp3";
  var GAME_BGM_VOLUME = .05;
  var DEATH_SFX_SRC = "assets/catchmind-countdown.wav";
  var DEATH_SFX_VOLUME = 1;
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
  var collisionTrails = Object.create(null);
  var captureParticles = [];
  var pressedKeys = Object.create(null);
  var inputSeq = 0;
  var inputSeqByNick = Object.create(null);
  var inputAtByNick = Object.create(null);
  var inputSessionByNick = Object.create(null);
  var transportSeqBySession = Object.create(null);
  var lastInputAt = 0;
  var pendingInput = null;
  var pendingInputTimer = null;
  var unackedInput = null;
  var inputRetryTimer = null;
  var desiredInputAngle = null;
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
  var gameBgmEl = null;
  var gameBgmPlayPending = false;
  var lastGameBgmMatchId = "";
  var deathSfxEl = null;
  var playedDeathCues = Object.create(null);
  var roomOverflowNotified = Object.create(null);
  var spectatorFocusNick = "";
  var lastChatScope = "";
  var lastScoreboardSignature = "";
  var lastAuthoritativeAt = 0;
  var lastPredictionAt = 0;
  var lastCountdownValue = "";
  var authorityClockOffset = 0;
  var authorityClockSessionId = "";
  var hasAuthorityClock = false;
  var lastStatusAnnouncementKey = "";

  resetGrid();

  function freshState() {
    return {
      phase: "idle",
      rev: 0,
      frameSeq: 0,
      ownerRev: 0,
      matchId: "",
      startAt: 0,
      deadline: 0,
      spectators: [],
      ready: [],
      players: [],
      winner: ""
    };
  }

  function $(id) { return typeof document !== "undefined" ? document.getElementById(id) : null; }
  function nowMs() { return Date.now(); }
  function gameNow() {
    return api && !api.isHost() && hasAuthorityClock ? nowMs() - authorityClockOffset : nowMs();
  }
  function syncAuthorityClock(transport) {
    if (!api || api.isHost() || !transport || !Number.isFinite(Number(transport.sentAt))) return;
    var sample = nowMs() - Number(transport.sentAt);
    var sessionId = String(transport.sessionId || "").slice(0, 96);
    if (!hasAuthorityClock || sessionId !== authorityClockSessionId || Math.abs(sample - authorityClockOffset) > 5000) {
      authorityClockOffset = sample;
      authorityClockSessionId = sessionId;
      hasAuthorityClock = true;
      return;
    }
    if (sample < authorityClockOffset) authorityClockOffset = sample;
    else authorityClockOffset += (sample - authorityClockOffset) * .05;
  }
  function authoritativeTimelineAt(transport) {
    var now = nowMs();
    if (!transport || !hasAuthorityClock || String(transport.sessionId || "").slice(0, 96) !== authorityClockSessionId
        || !Number.isFinite(Number(transport.sentAt))) return now;
    return clamp(Number(transport.sentAt) + authorityClockOffset, now - PREDICTION_MAX_MS, now);
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function has(list, value) { return Array.isArray(list) && list.indexOf(value) >= 0; }
  function safeNick(value) { return String(value == null ? "" : value).trim().slice(0, 20); }
  function safeDeathReason(value) {
    value = String(value || "");
    return value === "cut" || value === "self" || value === "territory" || value === "limit" || value === "waiting"
      ? value : "";
  }
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
  function isPlayableCell(x, y) {
    return x >= PLAYABLE_MIN_X && x < PLAYABLE_MAX_X && y >= PLAYABLE_MIN_Y && y < PLAYABLE_MAX_Y;
  }
  function clearBoundaryOwnerCells(map) {
    if (!map || map.length !== CELL_COUNT) return 0;
    var cleared = 0;
    for (var y = 0; y < WORLD_H; y++) {
      for (var x = 0; x < WORLD_W; x++) {
        var key = cellIndex(x, y);
        if (!isPlayableCell(x, y) && map[key] !== -1) {
          map[key] = -1;
          cleared++;
        }
      }
    }
    return cleared;
  }
  function me() { return api ? api.me() : { nick: "", isAdmin: false }; }
  function people() { return api ? api.roster() : []; }
  function orderedPeople() {
    return people().filter(function (person) { return person && person.nick; }).slice().sort(function (a, b) {
      return (Number(a.joinTs) || 0) - (Number(b.joinTs) || 0) || String(a.nick).localeCompare(String(b.nick));
    });
  }
  function activePeople() { return orderedPeople().filter(function (person) { return !person.away; }); }
  function activeNicks() { return activePeople().map(function (person) { return safeNick(person.nick); }); }
  function personByNick(nick) {
    nick = safeNick(nick);
    var rows = orderedPeople();
    for (var i = 0; i < rows.length; i++) if (safeNick(rows[i].nick) === nick) return rows[i];
    return null;
  }
  function usesVerifiedTransport() { return !!(api && api.isNet && api.isNet()); }
  function trustedTransport(nick, transport, allowedLanes) {
    if (!usesVerifiedTransport()) return true;
    nick = safeNick(nick);
    if (!nick || !transport || !Number.isSafeInteger(Number(transport.seq)) || Number(transport.seq) < 1
        || safeNick(transport.senderNick) !== nick) return false;
    var lanes = Array.isArray(allowedLanes) ? allowedLanes : [allowedLanes];
    if (lanes.indexOf(transport.lane) < 0) return false;
    var person = personByNick(nick);
    if (!person) return false;
    var sessionId = String(transport.sessionId || "").slice(0, 96);
    var sessions = Array.isArray(person.presenceSessionIds) ? person.presenceSessionIds.map(String) : [];
    if (person.clientSessionId && sessions.indexOf(String(person.clientSessionId)) < 0) sessions.push(String(person.clientSessionId));
    if (!sessionId || sessions.indexOf(sessionId) < 0) return false;
    if (person.clientSessionId && sessionId !== String(person.clientSessionId)) return false;
    var key = transport.lane + ":" + sessionId;
    if (Number(transport.seq) <= (transportSeqBySession[key] || 0)) return false;
    transportSeqBySession[key] = Number(transport.seq);
    return true;
  }

  function syncInputSession(nick, transport) {
    nick = safeNick(nick);
    if (!nick || !usesVerifiedTransport()) return;
    var sessionId = String(transport && transport.sessionId || "").slice(0, 96);
    if (!sessionId || inputSessionByNick[nick] === sessionId) return;
    var previousSession = inputSessionByNick[nick];
    var player = playerByNick(nick);
    inputSessionByNick[nick] = sessionId;
    inputSeqByNick[nick] = !previousSession && player ? Math.max(0, Math.floor(Number(player.inputAck) || 0)) : 0;
    inputAtByNick[nick] = 0;
    if (player && previousSession) player.inputAck = 0;
  }
  function trustedHostTransport(message, transport) {
    if (!api || safeNick(message && message.by) !== safeNick(api.host())) return false;
    if (!trustedTransport(api.host(), transport, "room")) return false;
    if (!usesVerifiedTransport() || !api.hostSessionId) return true;
    return String(transport.sessionId || "") === String(api.hostSessionId() || "");
  }
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
      deathSeq: clamp(Math.floor(Number(player.deathSeq) || 0), 0, 9999),
      deathReason: safeDeathReason(player.deathReason),
      deathBy: safeNick(player.deathBy),
      respawnGiveUpAt: Math.max(0, Number(player.respawnGiveUpAt) || 0),
      inputAck: clamp(Math.floor(Number(player.inputAck) || 0), 0, Number.MAX_SAFE_INTEGER),
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
      var numericId = Math.floor(Number(raw.id));
      var id = Number.isFinite(numericId) && numericId >= 0 && numericId < MAX_PLAYERS ? numericId : index;
      if (seen[id]) {
        for (var candidate = 0; candidate < MAX_PLAYERS; candidate++) {
          if (!seen[candidate]) { id = candidate; break; }
        }
      }
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
        deathSeq: clamp(Math.floor(Number(raw.deathSeq) || 0), 0, 9999),
        deathReason: safeDeathReason(raw.deathReason),
        deathBy: safeNick(raw.deathBy),
        respawnGiveUpAt: Math.max(0, Number(raw.respawnGiveUpAt) || 0),
        inputAck: clamp(Math.floor(Number(raw.inputAck) || 0), 0, Number.MAX_SAFE_INTEGER),
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
      startAt: state.startAt,
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

  function shouldResetVisualPlayer(previous, player) {
    if (!previous || !player) return false;
    return Number(previous.deathSeq) !== Number(player.deathSeq)
      || !!previous.deadUntil !== !!player.deadUntil
      || !!previous.retired !== !!player.retired
      || !!previous.away !== !!player.away;
  }

  function mergeVisualPlayers(previousPlayers) {
    var keep = Object.create(null);
    var previousByNick = Object.create(null);
    (previousPlayers || []).forEach(function (player) {
      if (player && player.nick) previousByNick[player.nick] = player;
    });
    state.players.forEach(function (player) {
      var key = player.nick;
      keep[key] = true;
      if (!visualPlayers[key] || shouldResetVisualPlayer(previousByNick[key], player)) {
        visualPlayers[key] = {
          x: player.x,
          y: player.y,
          angle: validAngle(player.angle) ? player.angle : directionAngle(player.dir)
        };
      }
      if (player.trail && player.trail.length) syncVisualTrail(player);
      else {
        delete visualTrails[key];
        delete collisionTrails[key];
      }
    });
    Object.keys(visualPlayers).forEach(function (key) {
      if (!keep[key]) {
        delete visualPlayers[key];
        delete visualTrails[key];
        delete collisionTrails[key];
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
    next.startAt = Math.max(0, Number(raw.startAt) || 0);
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
    for (i = 0; i < map.length; i++) {
      var mapX = i % WORLD_W;
      var mapY = Math.floor(i / WORLD_W);
      if (!isPlayableCell(mapX, mapY)) {
        map[i] = -1;
        visited[i] = 1;
      } else if (map[i] === playerId) blocked[i] = 1;
    }
    for (i = 0; i < trail.length; i++) {
      var trailKey = trail[i];
      if (trailKey >= 0 && trailKey < map.length
          && isPlayableCell(trailKey % WORLD_W, Math.floor(trailKey / WORLD_W))) blocked[trailKey] = 1;
    }
    var head = 0;
    var tail = 0;
    function addEdge(x, y) {
      var index = cellIndex(x, y);
      if (blocked[index] || visited[index]) return;
      visited[index] = 1;
      queue[tail++] = index;
    }
    for (i = PLAYABLE_MIN_X; i < PLAYABLE_MAX_X; i++) {
      addEdge(i, PLAYABLE_MIN_Y);
      addEdge(i, PLAYABLE_MAX_Y - 1);
    }
    for (i = PLAYABLE_MIN_Y; i < PLAYABLE_MAX_Y; i++) {
      addEdge(PLAYABLE_MIN_X, i);
      addEdge(PLAYABLE_MAX_X - 1, i);
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
      if (!visited[i] && map[i] !== playerId
          && isPlayableCell(i % WORLD_W, Math.floor(i / WORLD_W))) {
        map[i] = playerId;
        gained++;
      }
    }
    return gained;
  }

  function createBase(player, overwrite) {
    overwrite = overwrite === true;
    var cx = Math.floor(player.spawnX);
    var cy = Math.floor(player.spawnY);
    var changed = false;
    for (var y = cy - BASE_RADIUS; y <= cy + BASE_RADIUS; y++) {
      for (var x = cx - BASE_RADIUS; x <= cx + BASE_RADIUS; x++) {
        if (isPlayableCell(x, y) && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= BASE_RADIUS * BASE_RADIUS) {
          var key = cellIndex(x, y);
          if (owner[key] < 0 || (overwrite && owner[key] !== player.id)) {
            owner[key] = player.id;
            changed = true;
          }
        }
      }
    }
    if (changed && overwrite) pruneDisconnectedTerritories(owner);
    if (changed) ownerLayerDirty = true;
    return changed;
  }

  function directionForPosition(x, y) {
    var dx = WORLD_W / 2 - x;
    var dy = WORLD_H / 2 - y;
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
  }

  function spawnFor(index, count) {
    var spots = [
      [.27, .28], [.73, .72], [.73, .28], [.27, .72],
      [.5, .17], [.5, .83], [.16, .5], [.84, .5]
    ];
    var spot = spots[index % spots.length];
    var x = Math.round(WORLD_W * spot[0]);
    var y = Math.round(WORLD_H * spot[1]);
    return { x: x, y: y, dir: directionForPosition(x, y), count: count };
  }

  function unitRandom(random) {
    var value = Number((typeof random === "function" ? random : Math.random)());
    if (!isFinite(value)) return 0;
    value %= 1;
    return value < 0 ? value + 1 : value;
  }

  function sampleStolenCells(previous, next, limit, random) {
    if (!previous || !next) return [];
    var length = Math.min(previous.length || 0, next.length || 0);
    var max = clamp(Math.floor(Number(limit) || 0), 0, MAX_CAPTURE_BURSTS);
    if (!length || !max) return [];
    var samples = [];
    var seen = 0;
    for (var key = 0; key < length; key++) {
      var previousId = Number(previous[key]);
      var nextId = Number(next[key]);
      if (previousId < 0 || nextId < 0 || previousId === nextId) continue;
      var sample = { key: key, from: previousId, to: nextId };
      seen++;
      if (samples.length < max) samples.push(sample);
      else {
        var replacement = Math.floor(unitRandom(random) * seen);
        if (replacement < max) samples[replacement] = sample;
      }
    }
    return samples;
  }

  function queueCaptureParticles(previous, next, now, random) {
    var samples = sampleStolenCells(previous, next, MAX_CAPTURE_BURSTS, random);
    if (!samples.length) return 0;
    now = isFinite(Number(now)) ? Number(now) : nowMs();
    var created = 0;
    samples.forEach(function (sample) {
      var cellX = sample.key % WORLD_W + .5;
      var cellY = Math.floor(sample.key / WORLD_W) + .5;
      var oldColor = TERRITORY_COLORS[sample.from] || COLORS[sample.from] || "#ffffff";
      var newColor = TERRITORY_COLORS[sample.to] || COLORS[sample.to] || "#ffffff";
      for (var index = 0; index < CAPTURE_PARTICLES_PER_BURST; index++) {
        var angle = unitRandom(random) * Math.PI * 2;
        var speed = .55 + unitRandom(random) * 1.25;
        captureParticles.push({
          x: cellX + (unitRandom(random) - .5) * .55,
          y: cellY + (unitRandom(random) - .5) * .55,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - .22,
          born: now,
          life: 420 + unitRandom(random) * 220,
          size: .13 + unitRandom(random) * .13,
          color: index === 0 ? newColor : oldColor
        });
        created++;
      }
    });
    if (captureParticles.length > MAX_CAPTURE_PARTICLES) {
      captureParticles.splice(0, captureParticles.length - MAX_CAPTURE_PARTICLES);
    }
    return created;
  }

  function allocateInitialSpawns(count, random) {
    count = clamp(Math.floor(Number(count) || 0), 0, MAX_PLAYERS);
    var columns = [12, 36, 60];
    var rows = [13, 40, 67, 94];
    var slots = [];
    for (var row = 0; row < rows.length; row++) {
      for (var column = 0; column < columns.length; column++) slots.push({ x: columns[column], y: rows[row] });
    }
    for (var i = slots.length - 1; i > 0; i--) {
      var swapIndex = Math.floor(unitRandom(random) * (i + 1));
      var swap = slots[i];
      slots[i] = slots[swapIndex];
      slots[swapIndex] = swap;
    }
    return slots.slice(0, count).map(function (slot) {
      var x = slot.x + Math.floor(unitRandom(random) * 7) - 3;
      var y = slot.y + Math.floor(unitRandom(random) * 7) - 3;
      return { x: x, y: y, dir: directionForPosition(x, y) };
    });
  }

  function buildSpawnBlockedPrefix(playerId, allowOccupiedTerritory) {
    var stride = WORLD_W + 1;
    var spawnBlocked = new Uint8Array(CELL_COUNT);
    var prefix = new Int32Array(stride * (WORLD_H + 1));
    for (var key = 0; key < CELL_COUNT; key++) {
      if ((!allowOccupiedTerritory && owner[key] >= 0 && owner[key] !== playerId)
          || (trailOwner[key] >= 0 && trailOwner[key] !== playerId)) {
        spawnBlocked[key] = 1;
      }
    }
    for (var playerIndex = 0; playerIndex < state.players.length; playerIndex++) {
      var trailPlayer = state.players[playerIndex];
      if (!trailPlayer || trailPlayer.id === playerId) continue;
      var trail = trailPlayer.trail || [];
      for (var trailIndex = 0; trailIndex < trail.length; trailIndex++) {
        var trailKey = trail[trailIndex];
        if (trailKey >= 0 && trailKey < CELL_COUNT) spawnBlocked[trailKey] = 1;
      }
    }
    for (var y = 0; y < WORLD_H; y++) {
      var rowTotal = 0;
      for (var x = 0; x < WORLD_W; x++) {
        rowTotal += spawnBlocked[cellIndex(x, y)];
        prefix[(y + 1) * stride + x + 1] = prefix[y * stride + x + 1] + rowTotal;
      }
    }
    return prefix;
  }

  function blockedSpawnCells(prefix, centerX, centerY, radius) {
    var stride = WORLD_W + 1;
    var x0 = centerX - radius;
    var y0 = centerY - radius;
    var x1 = centerX + radius + 1;
    var y1 = centerY + radius + 1;
    return prefix[y1 * stride + x1] - prefix[y0 * stride + x1]
      - prefix[y1 * stride + x0] + prefix[y0 * stride + x0];
  }

  function farFromActivePlayers(player, x, y, minimumDistance) {
    minimumDistance = Number(minimumDistance) || RESPAWN_PLAYER_DISTANCE;
    var minimumSquared = minimumDistance * minimumDistance;
    for (var i = 0; i < state.players.length; i++) {
      var other = state.players[i];
      if (other === player || other.deadUntil || other.retired) continue;
      var dx = other.x - x;
      var dy = other.y - y;
      if (dx * dx + dy * dy <= minimumSquared) return false;
    }
    return true;
  }

  function findRespawnSpot(player, random) {
    var prefix = buildSpawnBlockedPrefix(player.id);
    var clearRadius = BASE_RADIUS + SPAWN_CLEARANCE;
    var chosen = null;
    var safeCount = 0;
    for (var y = SPAWN_MARGIN; y < WORLD_H - SPAWN_MARGIN; y++) {
      for (var x = SPAWN_MARGIN; x < WORLD_W - SPAWN_MARGIN; x++) {
        if (blockedSpawnCells(prefix, x, y, clearRadius) || !farFromActivePlayers(player, x, y)) continue;
        safeCount++;
        if (unitRandom(random) < 1 / safeCount) chosen = { x: x, y: y, dir: directionForPosition(x, y) };
      }
    }
    return chosen;
  }

  function findEmergencyRespawnSpot(player, random) {
    var prefix = buildSpawnBlockedPrefix(player.id, true);
    var clearRadius = BASE_RADIUS + 1;
    var chosen = null;
    var safeCount = 0;
    for (var y = SPAWN_MARGIN; y < WORLD_H - SPAWN_MARGIN; y++) {
      for (var x = SPAWN_MARGIN; x < WORLD_W - SPAWN_MARGIN; x++) {
        if (blockedSpawnCells(prefix, x, y, clearRadius)
            || !farFromActivePlayers(player, x, y, EMERGENCY_PLAYER_DISTANCE)) continue;
        safeCount++;
        if (unitRandom(random) < 1 / safeCount) chosen = { x: x, y: y, dir: directionForPosition(x, y) };
      }
    }
    return chosen;
  }

  function hasPlayerTerritory(playerId) {
    for (var i = 0; i < owner.length; i++) if (owner[i] === playerId) return true;
    return false;
  }

  function findOwnedRespawnSpot(player, random) {
    var prefix = buildSpawnBlockedPrefix(player.id);
    var chosen = null;
    var safeCount = 0;
    for (var y = SPAWN_MARGIN; y < WORLD_H - SPAWN_MARGIN; y++) {
      for (var x = SPAWN_MARGIN; x < WORLD_W - SPAWN_MARGIN; x++) {
        if (owner[cellIndex(x, y)] !== player.id
            || blockedSpawnCells(prefix, x, y, PRESERVED_SPAWN_CLEARANCE)
            || !farFromActivePlayers(player, x, y)) continue;
        safeCount++;
        if (unitRandom(random) < 1 / safeCount) chosen = { x: x, y: y, dir: directionForPosition(x, y) };
      }
    }
    return chosen;
  }

  function resolveRespawnPlacement(player, now) {
    var preserveTerritory = hasPlayerTerritory(player.id);
    if (preserveTerritory) {
      var ownedSpawn = findOwnedRespawnSpot(player);
      if (ownedSpawn) {
        delete player.freshRespawnAfter;
        return { spawn: ownedSpawn, preserveTerritory: true };
      }
      if (!player.freshRespawnAfter) {
        player.freshRespawnAfter = now + 1000;
        return null;
      }
      if (now < player.freshRespawnAfter) return null;
      var fallbackSpawn = findRespawnSpot(player);
      var emergencyFallback = false;
      if (!fallbackSpawn && player.respawnGiveUpAt && now >= player.respawnGiveUpAt) {
        fallbackSpawn = findEmergencyRespawnSpot(player);
        emergencyFallback = !!fallbackSpawn;
      }
      if (!fallbackSpawn) return null;
      clearTerritory(player.id);
      delete player.freshRespawnAfter;
      return { spawn: fallbackSpawn, preserveTerritory: false, emergency: emergencyFallback };
    }
    delete player.freshRespawnAfter;
    var freshSpawn = findRespawnSpot(player);
    var emergency = false;
    if (!freshSpawn && player.respawnGiveUpAt && now >= player.respawnGiveUpAt) {
      freshSpawn = findEmergencyRespawnSpot(player);
      emergency = !!freshSpawn;
    }
    return freshSpawn ? { spawn: freshSpawn, preserveTerritory: false, emergency: emergency } : null;
  }

  function applyPlayerSpawn(player, spawn) {
    player.x = spawn.x;
    player.y = spawn.y;
    player.spawnX = spawn.x;
    player.spawnY = spawn.y;
    player.dir = spawn.dir || directionForPosition(spawn.x, spawn.y);
    player.angle = directionAngle(player.dir);
    player.targetAngle = player.angle;
    player.lastCell = cellKey(player.x, player.y);
  }

  function makePlayer(id, nick, bot, count, assignedSpawn) {
    var spawn = assignedSpawn || spawnFor(id, count);
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
      deathSeq: 0,
      deathReason: "",
      deathBy: "",
      respawnGiveUpAt: 0,
      inputAck: 0,
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
    delete collisionTrails[player.nick];
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

  function eliminateDisplacedPlayers(previousOwner, attacker, now) {
    var previouslyOwned = Object.create(null);
    for (var key = 0; key < previousOwner.length; key++) {
      var previousId = previousOwner[key];
      if (previousId >= 0 && previousId !== attacker.id) previouslyOwned[previousId] = true;
    }
    state.players.forEach(function (victim) {
      if (!victim || victim === attacker || victim.deadUntil || victim.retired || !previouslyOwned[victim.id]) return;
      if (!hasPlayerTerritory(victim.id)) eliminate(victim, attacker, now, "territory");
    });
  }

  function capturePlayer(player, now) {
    if (!player.trail.length) return;
    now = Number(now) || nowMs();
    var previousOwner = owner.slice();
    captureInto(owner, player.trail, player.id);
    pruneDisconnectedTerritories(owner);
    queueCaptureParticles(previousOwner, owner, now);
    clearTrail(player);
    state.ownerRev++;
    state.rev++;
    ownerLayerDirty = true;
    countsRev = -1;
    fullPending = true;
    eliminateDisplacedPlayers(previousOwner, player, now);
  }

  function eliminate(player, attacker, now, reason) {
    if (!player || player.deadUntil || player.retired) return;
    clearTerritory(player.id);
    clearTrail(player);
    player.deadUntil = now + RESPAWN_MS;
    player.respawnGiveUpAt = player.deadUntil + RESPAWN_EMERGENCY_MS;
    player.deathReason = safeDeathReason(reason) || (attacker && attacker !== player ? "cut" : "self");
    player.deathBy = attacker && attacker !== player ? safeNick(attacker.nick) : "";
    player.deathSeq = clamp((Number(player.deathSeq) || 0) + 1, 0, 9999);
    player.lastCell = -1;
    if (attacker && attacker !== player) attacker.kills++;
    state.rev++;
    fullPending = true;
    announceDeath(player);
  }

  function recallPlayer(player, now) {
    if (!player || player.deadUntil || player.retired) return;
    clearTrail(player);
    player.x = player.spawnX;
    player.y = player.spawnY;
    player.lastCell = cellKey(player.x, player.y);
    player.deadUntil = now + RESPAWN_MS;
    player.respawnGiveUpAt = player.deadUntil + RESPAWN_EMERGENCY_MS;
    player.deathReason = "limit";
    player.deathBy = "";
    state.rev++;
    fullPending = true;
  }

  function respawn(player, now) {
    if (!player.deadUntil || now < player.deadUntil || player.retired) return;
    var placement = resolveRespawnPlacement(player, now);
    if (!placement) {
      player.deathReason = "waiting";
      player.deadUntil = now + RESPAWN_RETRY_MS;
      return;
    }
    player.deadUntil = 0;
    player.respawnGiveUpAt = 0;
    player.deathReason = "";
    player.deathBy = "";
    applyPlayerSpawn(player, placement.spawn);
    player.turnBackAt = 12 + Math.floor(Math.random() * 16);
    var previousOwner = placement.emergency ? owner.slice() : null;
    if (!placement.preserveTerritory && createBase(player, placement.emergency)) {
      state.ownerRev++;
      countsRev = -1;
      fullPending = true;
      if (previousOwner) eliminateDisplacedPlayers(previousOwner, player, now);
    }
  }

  function activateReturningPlayer(player, now) {
    if (!player.respawnGiveUpAt) player.respawnGiveUpAt = now + RESPAWN_EMERGENCY_MS;
    var placement = resolveRespawnPlacement(player, now);
    if (!placement) {
      player.returnRetryAt = now + 1000;
      return false;
    }
    delete player.returnRetryAt;
    player.retired = false;
    player.away = false;
    player.deadUntil = 0;
    player.respawnGiveUpAt = 0;
    player.deathReason = "";
    player.deathBy = "";
    applyPlayerSpawn(player, placement.spawn);
    inputAtByNick[player.nick] = 0;
    var previousOwner = placement.emergency ? owner.slice() : null;
    if (!placement.preserveTerritory && createBase(player, placement.emergency)) {
      state.ownerRev++;
      countsRev = -1;
      if (previousOwner) eliminateDisplacedPlayers(previousOwner, player, now);
    }
    fullPending = true;
    return true;
  }

  function retryReturningPlayers(now) {
    var due = state.players.some(function (player) {
      return !player.bot && (player.retired || player.away) && player.returnRetryAt && now >= player.returnRetryAt;
    });
    if (!due) return false;
    var present = activeNicks();
    var changed = false;
    state.players.forEach(function (player) {
      if (player.bot || (!player.retired && !player.away) || !player.returnRetryAt || now < player.returnRetryAt) return;
      if (!has(present, player.nick)) {
        delete player.returnRetryAt;
        return;
      }
      if (activateReturningPlayer(player, now)) changed = true;
    });
    return changed;
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

  function crossedCellEvents(fromX, fromY, toX, toY) {
    var fromCellX = Math.floor(fromX);
    var fromCellY = Math.floor(fromY);
    var toCellX = Math.floor(toX);
    var toCellY = Math.floor(toY);
    if (fromCellX === toCellX && fromCellY === toCellY) return [];
    var events = [];
    var dx = toX - fromX;
    var dy = toY - fromY;
    var crossXAt = Infinity;
    var crossYAt = Infinity;
    if (fromCellX !== toCellX) {
      var boundaryX = dx > 0 ? fromCellX + 1 : fromCellX;
      crossXAt = dx ? (boundaryX - fromX) / dx : Infinity;
    }
    if (fromCellY !== toCellY) {
      var boundaryY = dy > 0 ? fromCellY + 1 : fromCellY;
      crossYAt = dy ? (boundaryY - fromY) / dy : Infinity;
    }
    if (fromCellX !== toCellX && fromCellY !== toCellY) {
      events.push({
        key: crossXAt <= crossYAt ? cellIndex(toCellX, fromCellY) : cellIndex(fromCellX, toCellY),
        at: clamp(Math.min(crossXAt, crossYAt), 0, 1)
      });
    }
    events.push({
      key: cellIndex(toCellX, toCellY),
      at: clamp(Math.max(isFinite(crossXAt) ? crossXAt : 0, isFinite(crossYAt) ? crossYAt : 0), 0, 1)
    });
    return events;
  }

  function crossedCellKeys(fromX, fromY, toX, toY) {
    return crossedCellEvents(fromX, fromY, toX, toY).map(function (event) { return event.key; });
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
    var cache = collisionTrails[player.nick] || syncCollisionTrail(player);
    return cache && cache.points ? cache.points : [];
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
    advancePlayers([player], dt, now);
  }

  function preparePlayerAdvance(player, dt, now) {
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
    nx = clamp(nx, ARENA_INSET, WORLD_W - ARENA_INSET);
    ny = clamp(ny, ARENA_INSET, WORLD_H - ARENA_INSET);
    var movedX = nx - fromX;
    var movedY = ny - fromY;
    if (movedX * movedX + movedY * movedY < SPEED * SPEED * dt * dt * .01) {
      var tangent = player.angle;
      var atVerticalEdge = fromX <= ARENA_INSET + .001 || fromX >= WORLD_W - ARENA_INSET - .001;
      var atHorizontalEdge = fromY <= ARENA_INSET + .001 || fromY >= WORLD_H - ARENA_INSET - .001;
      if (atVerticalEdge) {
        tangent = Math.abs(Math.sin(player.angle)) > .15
          ? (Math.sin(player.angle) < 0 ? -Math.PI / 2 : Math.PI / 2)
          : (fromY < WORLD_H / 2 ? Math.PI / 2 : -Math.PI / 2);
      } else if (atHorizontalEdge) {
        tangent = Math.abs(Math.cos(player.angle)) > .15
          ? (Math.cos(player.angle) < 0 ? Math.PI : 0)
          : (fromX < WORLD_W / 2 ? 0 : Math.PI);
      }
      player.angle = normalizeAngle(tangent);
      player.targetAngle = player.angle;
      player.dir = nearestDirection(player.angle);
      nx = clamp(fromX + Math.cos(player.angle) * SPEED * dt, ARENA_INSET, WORLD_W - ARENA_INSET);
      ny = clamp(fromY + Math.sin(player.angle) * SPEED * dt, ARENA_INSET, WORLD_H - ARENA_INSET);
    }
    var crossedEvents = crossedCellEvents(fromX, fromY, nx, ny);
    return {
      player: player,
      fromX: fromX,
      fromY: fromY,
      toX: nx,
      toY: ny,
      crossedEvents: crossedEvents,
      crossed: crossedEvents.map(function (event) { return event.key; })
    };
  }

  function analyzeProposalTerritory(proposal, ownerAtStart) {
    var player = proposal.player;
    var plannedTrail = (player.trail || []).slice();
    var trailOpen = plannedTrail.length > 0;
    var lastCell = player.lastCell;
    proposal.closeIndex = -1;
    proposal.closeAt = null;
    proposal.captureTrail = null;
    proposal.limitIndex = -1;
    for (var i = 0; i < proposal.crossedEvents.length; i++) {
      var event = proposal.crossedEvents[i];
      event.ownAtStart = ownerAtStart[event.key] === player.id;
      if (event.key === lastCell) continue;
      lastCell = event.key;
      if (event.ownAtStart) {
        if (trailOpen && proposal.closeIndex < 0) {
          proposal.closeIndex = i;
          proposal.closeAt = event.at;
          proposal.captureTrail = plannedTrail.slice();
          plannedTrail.length = 0;
          trailOpen = false;
        }
      } else {
        if (plannedTrail.length >= MAX_TRAIL) {
          proposal.limitIndex = i;
          proposal.closeIndex = -1;
          proposal.closeAt = null;
          proposal.captureTrail = null;
          break;
        }
        plannedTrail.push(event.key);
        trailOpen = true;
      }
    }
  }

  function proposalHitsTrailBefore(proposal, points, headGrace, cutoff) {
    var toX = proposal.toX;
    var toY = proposal.toY;
    if (cutoff != null) {
      var amount = Math.max(0, Number(cutoff) - 1e-7);
      if (amount <= 0) return false;
      toX = proposal.fromX + (proposal.toX - proposal.fromX) * amount;
      toY = proposal.fromY + (proposal.toY - proposal.fromY) * amount;
    }
    return movementHitsTrail(proposal.fromX, proposal.fromY, toX, toY, points, headGrace);
  }

  function resolveAdvanceCollisions(proposals, now) {
    var trailRows = [];
    var hits = [];
    var candidates = state.players.slice();
    proposals.forEach(function (proposal) {
      if (candidates.indexOf(proposal.player) < 0) candidates.push(proposal.player);
    });
    candidates.forEach(function (player) {
      if (!player || player.deadUntil || player.retired || !player.trail.length) return;
      trailRows.push({ player: player, points: collisionTrailPoints(player).slice() });
    });

    function rowFor(player) {
      for (var rowIndex = 0; rowIndex < trailRows.length; rowIndex++) {
        if (trailRows[rowIndex].player === player) return trailRows[rowIndex];
      }
      return null;
    }

    function proposalFor(player) {
      for (var proposalIndex = 0; proposalIndex < proposals.length; proposalIndex++) {
        if (proposals[proposalIndex].player === player) return proposals[proposalIndex];
      }
      return null;
    }

    function recordHit(victim, attacker) {
      var hit = null;
      for (var hitIndex = 0; hitIndex < hits.length; hitIndex++) {
        if (hits[hitIndex].victim === victim) { hit = hits[hitIndex]; break; }
      }
      if (!hit) {
        hit = { victim: victim, attackers: [] };
        hits.push(hit);
      }
      if (attacker && attacker !== victim && hit.attackers.indexOf(attacker) < 0) hit.attackers.push(attacker);
    }

    proposals.forEach(function (proposal) {
      var player = proposal.player;
      var ownRow = rowFor(player);
      if (ownRow && proposalHitsTrailBefore(proposal, ownRow.points, TRAIL_HEAD_GRACE, proposal.closeAt)) {
        recordHit(player, null);
      }
      trailRows.forEach(function (row) {
        if (row.player === player) return;
        var victimProposal = proposalFor(row.player);
        var cutoff = victimProposal && victimProposal.closeAt != null ? victimProposal.closeAt : null;
        if (proposalHitsTrailBefore(proposal, row.points, 0, cutoff)) {
          recordHit(row.player, player);
        }
      });
    });

    hits.forEach(function (hit) {
      var primary = hit.attackers[0] || null;
      eliminate(hit.victim, primary, now, primary ? "cut" : "self");
      for (var attackerIndex = 1; attackerIndex < hit.attackers.length; attackerIndex++) {
        hit.attackers[attackerIndex].kills++;
      }
    });
    return hits;
  }

  function territoryLossAttackers(victimId, contributions) {
    var counts = contributions[victimId] || Object.create(null);
    var rows = [];
    Object.keys(counts).forEach(function (id) {
      var attacker = playerById(Number(id));
      if (attacker && attacker.id !== victimId) rows.push({ player: attacker, count: counts[id] });
    });
    var bestCount = 0;
    var bestRows = [];
    rows.forEach(function (row) {
      if (row.count > bestCount) {
        bestCount = row.count;
        bestRows = [row];
      } else if (row.count === bestCount) bestRows.push(row);
    });
    return { rows: rows, primary: bestRows.length === 1 ? bestRows[0].player : null };
  }

  function applyTerritoryLoss(victim, attackers, now) {
    attackers = attackers || { rows: [], primary: null };
    if (victim.deadUntil) {
      clearTrail(victim);
      victim.deathReason = "territory";
      victim.deathBy = attackers.primary ? safeNick(attackers.primary.nick) : "";
      victim.lastCell = -1;
      delete victim.freshRespawnAfter;
      attackers.rows.forEach(function (row) { row.player.kills++; });
      state.rev++;
      fullPending = true;
      return;
    }
    eliminate(victim, attackers.primary, now, "territory");
    attackers.rows.forEach(function (row) {
      if (row.player !== attackers.primary) row.player.kills++;
    });
  }

  function distanceSquaredToTerritoryCell(x, y, key) {
    var cellX = key % WORLD_W;
    var cellY = Math.floor(key / WORLD_W);
    var dx = x < cellX ? cellX - x : (x > cellX + 1 ? x - cellX - 1 : 0);
    var dy = y < cellY ? cellY - y : (y > cellY + 1 ? y - cellY - 1 : 0);
    return dx * dx + dy * dy;
  }

  function pruneDisconnectedTerritories(map, anchors) {
    if (!map || map.length !== CELL_COUNT) return 0;
    anchors = anchors || Object.create(null);
    var removed = 0;
    state.players.forEach(function (player) {
      if (!player || player.id < 0 || player.id >= MAX_PLAYERS) return;
      var anchor = anchors[player.id] || player;
      var anchorX = Number(anchor.x);
      var anchorY = Number(anchor.y);
      if (!isFinite(anchorX)) anchorX = Number(player.spawnX) || WORLD_W / 2;
      if (!isFinite(anchorY)) anchorY = Number(player.spawnY) || WORLD_H / 2;
      var floorX = Math.floor(anchorX);
      var floorY = Math.floor(anchorY);
      var anchorKey = inside(floorX, floorY) ? cellIndex(floorX, floorY) : -1;
      var components = [];
      visited.fill(0);
      for (var startKey = 0; startKey < CELL_COUNT; startKey++) {
        if (visited[startKey] || map[startKey] !== player.id) continue;
        var head = 0;
        var tail = 0;
        var component = {
          keys: [],
          size: 0,
          minKey: startKey,
          distanceSquared: Infinity,
          containsAnchor: false
        };
        visited[startKey] = 1;
        queue[tail++] = startKey;
        while (head < tail) {
          var key = queue[head++];
          component.keys.push(key);
          component.size++;
          if (key < component.minKey) component.minKey = key;
          if (key === anchorKey) component.containsAnchor = true;
          component.distanceSquared = Math.min(
            component.distanceSquared,
            distanceSquaredToTerritoryCell(anchorX, anchorY, key)
          );
          var x = key % WORLD_W;
          var y = Math.floor(key / WORLD_W);
          var next;
          if (x > 0) {
            next = key - 1;
            if (!visited[next] && map[next] === player.id) { visited[next] = 1; queue[tail++] = next; }
          }
          if (x < WORLD_W - 1) {
            next = key + 1;
            if (!visited[next] && map[next] === player.id) { visited[next] = 1; queue[tail++] = next; }
          }
          if (y > 0) {
            next = key - WORLD_W;
            if (!visited[next] && map[next] === player.id) { visited[next] = 1; queue[tail++] = next; }
          }
          if (y < WORLD_H - 1) {
            next = key + WORLD_W;
            if (!visited[next] && map[next] === player.id) { visited[next] = 1; queue[tail++] = next; }
          }
        }
        components.push(component);
      }
      if (components.length < 2) return;

      var keep = null;
      components.forEach(function (component) {
        if (component.containsAnchor) keep = component;
      });
      if (!keep) {
        keep = components[0];
        for (var componentIndex = 1; componentIndex < components.length; componentIndex++) {
          var candidate = components[componentIndex];
          if (candidate.distanceSquared < keep.distanceSquared - 1e-9
              || (Math.abs(candidate.distanceSquared - keep.distanceSquared) <= 1e-9
                && (candidate.size > keep.size
                  || (candidate.size === keep.size && candidate.minKey < keep.minKey)))) {
            keep = candidate;
          }
        }
      }
      components.forEach(function (component) {
        if (component === keep) return;
        component.keys.forEach(function (key) {
          map[key] = -1;
          removed++;
        });
      });
    });
    return removed;
  }

  function proposalTerritoryAnchors(proposals) {
    var anchors = Object.create(null);
    (proposals || []).forEach(function (proposal) {
      if (!proposal || !proposal.player || proposal.player.deadUntil || proposal.player.retired || proposal.player.away) return;
      anchors[proposal.player.id] = { x: proposal.toX, y: proposal.toY };
    });
    return anchors;
  }

  function applySimultaneousCaptures(proposals, ownerAtStart, now) {
    var closures = proposals.filter(function (proposal) {
      return proposal.closeIndex >= 0 && !proposal.player.deadUntil && !proposal.player.retired && !proposal.player.away;
    });
    if (!closures.length) return false;

    var ownerBeforeCapture = owner.slice();
    var claimCount = new Uint8Array(CELL_COUNT);
    var claimOwner = new Int8Array(CELL_COUNT);
    claimOwner.fill(-1);
    closures.forEach(function (proposal) {
      var candidate = ownerAtStart.slice();
      captureInto(candidate, proposal.captureTrail || [], proposal.player.id);
      for (var key = 0; key < CELL_COUNT; key++) {
        if (candidate[key] !== proposal.player.id || ownerAtStart[key] === proposal.player.id) continue;
        if (!claimCount[key]) claimOwner[key] = proposal.player.id;
        claimCount[key]++;
      }
      clearTrail(proposal.player);
      proposal.didClose = true;
    });

    var nextOwner = ownerBeforeCapture.slice();
    var contributions = Object.create(null);
    for (var key = 0; key < CELL_COUNT; key++) {
      if (claimCount[key] !== 1) continue;
      var nextId = claimOwner[key];
      var previousId = ownerAtStart[key];
      nextOwner[key] = nextId;
      if (previousId >= 0 && previousId !== nextId) {
        if (!contributions[previousId]) contributions[previousId] = Object.create(null);
        contributions[previousId][nextId] = (contributions[previousId][nextId] || 0) + 1;
      }
    }
    clearBoundaryOwnerCells(nextOwner);
    pruneDisconnectedTerritories(nextOwner, proposalTerritoryAnchors(proposals));

    var hadTerritory = new Uint8Array(MAX_PLAYERS);
    var hasTerritoryAfter = new Uint8Array(MAX_PLAYERS);
    var changed = false;
    for (var ownerIndex = 0; ownerIndex < CELL_COUNT; ownerIndex++) {
      var beforeId = ownerBeforeCapture[ownerIndex];
      var afterId = nextOwner[ownerIndex];
      if (beforeId >= 0 && beforeId < MAX_PLAYERS) hadTerritory[beforeId] = 1;
      if (afterId >= 0 && afterId < MAX_PLAYERS) hasTerritoryAfter[afterId] = 1;
      if (beforeId !== afterId) changed = true;
    }
    if (changed) {
      queueCaptureParticles(ownerBeforeCapture, nextOwner, now);
      owner.set(nextOwner);
      state.ownerRev++;
      ownerLayerDirty = true;
      countsRev = -1;
    }
    state.rev++;
    fullPending = true;

    state.players.forEach(function (victim) {
      if (!victim || victim.retired || !hadTerritory[victim.id] || hasTerritoryAfter[victim.id]) return;
      applyTerritoryLoss(victim, territoryLossAttackers(victim.id, contributions), now);
    });
    return true;
  }

  function proposalPointAt(proposal, amount) {
    amount = clamp(Number(amount) || 0, 0, 1);
    return {
      x: proposal.fromX + (proposal.toX - proposal.fromX) * amount,
      y: proposal.fromY + (proposal.toY - proposal.fromY) * amount
    };
  }

  function appendTrailCell(player, key, now) {
    if (player.trail.length >= MAX_TRAIL) {
      recallPlayer(player, now);
      return false;
    }
    player.trail.push(key);
    if (trailOwner[key] < 0) trailOwner[key] = player.id;
    return true;
  }

  function applyPlayerAdvance(proposal, now) {
    var player = proposal.player;
    if (player.deadUntil || player.retired || player.away) return;
    var fromX = proposal.fromX;
    var fromY = proposal.fromY;
    var nx = proposal.toX;
    var ny = proposal.toY;
    player.x = nx;
    player.y = ny;
    var trailStart = { x: fromX, y: fromY };
    if (proposal.didClose) trailStart = proposalPointAt(proposal, proposal.closeAt);
    for (var i = 0; i < proposal.crossedEvents.length; i++) {
      var event = proposal.crossedEvents[i];
      if (event.key === player.lastCell) continue;
      player.lastCell = event.key;
      if (proposal.didClose && i <= proposal.closeIndex) continue;
      if (proposal.limitIndex === i) {
        recallPlayer(player, now);
        return;
      }
      var onOwnTerritory = proposal.didClose ? owner[event.key] === player.id : event.ownAtStart;
      if (!onOwnTerritory && !appendTrailCell(player, event.key, now)) return;
    }
    if (player.trail.length) {
      syncCollisionTrail(player, trailStart.x, trailStart.y);
      syncVisualTrail(player, trailStart.x, trailStart.y);
    } else {
      delete collisionTrails[player.nick];
      delete visualTrails[player.nick];
    }
  }

  function advancePlayers(players, dt, now) {
    var proposals = [];
    var ownerAtStart = owner.slice();
    (players || []).forEach(function (player) {
      var proposal = preparePlayerAdvance(player, dt, now);
      if (proposal) {
        analyzeProposalTerritory(proposal, ownerAtStart);
        proposals.push(proposal);
      }
    });
    resolveAdvanceCollisions(proposals, now);
    applySimultaneousCaptures(proposals, ownerAtStart, now);
    proposals.forEach(function (proposal) { applyPlayerAdvance(proposal, now); });
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
      return {
        id: player.id,
        nick: player.nick,
        bot: player.bot,
        kills: player.kills,
        area: (counts[player.id] || 0) / PLAYABLE_CELL_COUNT * 100,
        active: !player.retired && !player.away
      };
    }).sort(function (a, b) {
      return Number(b.active) - Number(a.active) || b.area - a.area || b.kills - a.kills || a.id - b.id;
    });
  }

  function isLocalSpectator() {
    return !!api && has(state.spectators, safeNick(me().nick));
  }

  function activeFocusPlayer(nick) {
    var player = playerByNick(nick);
    return player && !player.retired && !player.away ? player : null;
  }

  function cameraFocusPlayer() {
    var mine = playerByNick(me().nick);
    if (!isLocalSpectator()) return mine || state.players[0] || null;
    var selected = activeFocusPlayer(spectatorFocusNick);
    if (selected) return selected;
    var ranked = rankRows();
    for (var i = 0; i < ranked.length; i++) {
      selected = ranked[i].active ? activeFocusPlayer(ranked[i].nick) : null;
      if (selected) {
        spectatorFocusNick = selected.nick;
        return selected;
      }
    }
    spectatorFocusNick = "";
    return null;
  }

  function selectSpectatorFocus(nick) {
    if (state.phase !== "playing" || !isLocalSpectator()) return false;
    var selected = activeFocusPlayer(safeNick(nick));
    if (!selected) return false;
    spectatorFocusNick = selected.nick;
    renderScoreboard();
    return true;
  }

  function notifyRoomChanged() {
    if (api && api.roomChanged) api.roomChanged();
  }

  function frameIntervalMs(playerCount) {
    var count = Math.max(0, Math.floor(Number(playerCount == null ? state.players.length : playerCount) || 0));
    if (count <= 4) return MIN_FRAME_MS;
    return Math.min(FRAME_MS, MIN_FRAME_MS + (count - 4) * 50);
  }

  function broadcastFull(to) {
    if (!api || !api.isHost()) return;
    to = safeNick(to);
    api.send({ t: "tr_state", by: me().nick, to: to, state: snapshot(true) });
    if (!to) {
      lastFrameSentAt = nowMs();
      lastFullSentAt = lastFrameSentAt;
    }
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
    var transport = arguments.length > 2 ? arguments[2] : null;
    var parsed = sanitizeState(raw, true);
    if (!parsed) return false;
    clearBoundaryOwnerCells(parsed.owner);
    sourceHost = safeNick(sourceHost);
    var hostChanged = !!sourceHost && sourceHost !== authoritativeHost;
    var matchChanged = parsed.state.matchId !== state.matchId;
    var resetVisualTimeline = hostChanged || matchChanged || parsed.state.frameSeq < state.frameSeq;
    if (state.matchId && parsed.state.matchId === state.matchId && parsed.state.rev < state.rev
        && !authorityYielded && !hostChanged) return false;
    if (state.matchId && !matchChanged && parsed.state.rev === state.rev
        && parsed.state.frameSeq < state.frameSeq && parsed.state.ownerRev <= state.ownerRev
        && !authorityYielded && !hostChanged) return false;
    if (state.matchId && !matchChanged && parsed.state.rev === state.rev
        && parsed.state.frameSeq < state.frameSeq && parsed.state.ownerRev > state.ownerRev
        && !authorityYielded && !hostChanged) {
      if (state.phase === "playing" && parsed.state.phase === "playing") {
        queueCaptureParticles(owner, parsed.owner, nowMs());
      }
      owner.set(parsed.owner);
      state.ownerRev = parsed.state.ownerRev;
      if (wantedOwnerRev <= state.ownerRev) {
        wantedOwnerRev = state.ownerRev;
        ownerSyncMissingSince = 0;
        needsAuthoritySync = false;
        syncRequestedAt = 0;
      }
      ownerLayerDirty = true;
      countsRev = -1;
      syncHostEligibility();
      render();
      return true;
    }
    var previousPlayers = state.players;
    syncRemoteDeathCues(state, parsed.state);
    if (!matchChanged && state.phase === "playing" && parsed.state.phase === "playing") {
      queueCaptureParticles(owner, parsed.owner, nowMs());
    }
    if (matchChanged || parsed.state.phase !== "playing") {
      clearPendingInput();
      if (matchChanged) {
        inputSeq = 0;
        inputSeqByNick = Object.create(null);
        inputAtByNick = Object.create(null);
        inputSessionByNick = Object.create(null);
        desiredInputAngle = null;
        lastInputAt = 0;
        pressedKeys = Object.create(null);
        visualPlayers = Object.create(null);
        visualTrails = Object.create(null);
        collisionTrails = Object.create(null);
        captureParticles = [];
        spectatorFocusNick = "";
        swipe = null;
      }
    }
    state = parsed.state;
    lastAuthoritativeAt = authoritativeTimelineAt(transport);
    if (resetVisualTimeline) lastPredictionAt = 0;
    if (resetVisualTimeline && !matchChanged) {
      visualTrails = Object.create(null);
      collisionTrails = Object.create(null);
    }
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
    mergeVisualPlayers(previousPlayers);
    acknowledgeLocalInput();
    syncHostEligibility();
    if (hostChanged && !matchChanged) queueDesiredInputForNewHost();
    render();
    return true;
  }

  function applyFrame(raw, sourceHost) {
    var transport = arguments.length > 2 ? arguments[2] : null;
    var parsed = sanitizeState(raw, false);
    if (!parsed) return false;
    if (state.matchId && parsed.state.matchId !== state.matchId) { requestSync(); return false; }
    if (parsed.state.frameSeq <= state.frameSeq) return false;
    if (parsed.state.ownerRev > state.ownerRev) {
      wantedOwnerRev = Math.max(wantedOwnerRev, parsed.state.ownerRev);
      if (!ownerSyncMissingSince) ownerSyncMissingSince = nowMs();
      requestSync();
    }
    sourceHost = safeNick(sourceHost);
    var hostChanged = !!sourceHost && sourceHost !== authoritativeHost;
    parsed.state.ownerRev = state.ownerRev;
    syncRemoteDeathCues(state, parsed.state);
    var previousPlayers = state.players;
    state = parsed.state;
    lastAuthoritativeAt = authoritativeTimelineAt(transport);
    if (sourceHost) authoritativeHost = sourceHost;
    syncHostEligibility();
    if (hostChanged) queueDesiredInputForNewHost();
    rebuildTrailOwner();
    mergeVisualPlayers(previousPlayers);
    acknowledgeLocalInput();
    render();
    return true;
  }

  function applyDirection(player, direction, seq) {
    var legacyDirection = typeof direction === "string" && DIRECTIONS[direction] ? direction : "";
    if (!player || player.bot || player.retired || player.away || player.deadUntil
        || (!legacyDirection && !validAngle(direction))) return false;
    seq = Number(seq);
    var previousSeq = inputSeqByNick[player.nick] || 0;
    if (!Number.isSafeInteger(seq) || seq < 1 || seq <= previousSeq || seq - previousSeq > 256) return false;
    if (legacyDirection && (sameDirection(player.dir, legacyDirection) || reverseDirection(player.dir, legacyDirection))) return false;
    var angle = requestedAngle(direction, requestedAngle(player.targetAngle, requestedAngle(player.angle, directionAngle(player.dir))));
    if (!legacyDirection && Math.abs(angleDelta(requestedAngle(player.targetAngle, player.angle), angle)) < .035) return false;
    var now = nowMs();
    if (now - (inputAtByNick[player.nick] || 0) < 55) return false;
    inputSeqByNick[player.nick] = seq;
    inputAtByNick[player.nick] = now;
    player.inputAck = seq;
    player.targetAngle = angle;
    player.dir = legacyDirection || nearestDirection(angle);
    return true;
  }

  function requestDirection(direction) {
    var legacyDirection = typeof direction === "string" && DIRECTIONS[direction] ? direction : "";
    if (!active || state.phase !== "playing" || (!legacyDirection && !validAngle(direction))) return false;
    var now = nowMs();
    var mine = playerByNick(me().nick);
    if (!mine || mine.retired || mine.deadUntil || mine.bot) return false;
    if (legacyDirection && (reverseDirection(mine.dir, legacyDirection) || sameDirection(mine.dir, legacyDirection))) return false;
    var angle = requestedAngle(direction, requestedAngle(mine.targetAngle, requestedAngle(mine.angle, directionAngle(mine.dir))));
    if (!legacyDirection && Math.abs(angleDelta(requestedAngle(mine.targetAngle, mine.angle), angle)) < .035) return false;
    mine.targetAngle = angle;
    mine.dir = legacyDirection || nearestDirection(angle);
    desiredInputAngle = angle;
    if (api.isHost()) return true;
    pendingInput = { angle: angle, matchId: state.matchId };
    if (now - lastInputAt >= INPUT_SEND_MS) flushPendingInput();
    else if (!pendingInputTimer) pendingInputTimer = setTimeout(flushPendingInput, INPUT_SEND_MS - (now - lastInputAt));
    return true;
  }

  function clearPendingInput() {
    if (pendingInputTimer) { clearTimeout(pendingInputTimer); pendingInputTimer = null; }
    if (inputRetryTimer) { clearTimeout(inputRetryTimer); inputRetryTimer = null; }
    pendingInput = null;
    unackedInput = null;
  }

  function acknowledgeLocalInput() {
    if (!unackedInput || !api || api.isHost()) return false;
    var mine = playerByNick(me().nick);
    if (!mine || Number(mine.inputAck) < unackedInput.message.seq) return false;
    if (inputRetryTimer) { clearTimeout(inputRetryTimer); inputRetryTimer = null; }
    unackedInput = null;
    return true;
  }

  function sendRoomInput(message) {
    if (!api) return;
    try {
      var result = api.sendWithResult ? api.sendWithResult(message) : (api.send(message), null);
      if (result && typeof result.catch === "function") result.catch(function () {});
    } catch (error) {}
  }

  function sendInitialInput(message) {
    if (!api) return;
    if (api.sendHostInputWithResult) {
      try {
        Promise.resolve(api.sendHostInputWithResult(message)).then(function (result) {
          if (unackedInput && unackedInput.message.seq === message.seq && (!result || !result.ok)) sendRoomInput(message);
        }, function () {
          if (unackedInput && unackedInput.message.seq === message.seq) sendRoomInput(message);
        });
        return;
      } catch (error) {}
    }
    if (!api.sendHostInput || !api.sendHostInput(message)) sendRoomInput(message);
  }

  function scheduleInputRetry() {
    if (inputRetryTimer) clearTimeout(inputRetryTimer);
    inputRetryTimer = null;
    if (!unackedInput || unackedInput.attempts >= INPUT_ACK_MAX_ATTEMPTS) return;
    inputRetryTimer = setTimeout(function () {
      inputRetryTimer = null;
      var pending = unackedInput;
      if (!pending || !active || !api || api.isHost() || state.phase !== "playing"
          || pending.message.matchId !== state.matchId) return;
      pending.attempts++;
      sendRoomInput(pending.message);
      scheduleInputRetry();
    }, INPUT_ACK_RETRY_MS);
  }

  function flushPendingInput() {
    if (pendingInputTimer) { clearTimeout(pendingInputTimer); pendingInputTimer = null; }
    var queued = pendingInput;
    pendingInput = null;
    if (!queued || !active || state.phase !== "playing" || queued.matchId !== state.matchId || !api || api.isHost()) return false;
    var mine = playerByNick(me().nick);
    if (!mine || mine.retired || mine.deadUntil || mine.bot) return false;
    var angle = requestedAngle(queued.angle, requestedAngle(mine.targetAngle, mine.angle));
    var seq = ++inputSeq;
    lastInputAt = nowMs();
    mine.targetAngle = angle;
    mine.dir = nearestDirection(angle);
    inputSeqByNick[mine.nick] = seq;
    var message = { t: "tr_input", by: mine.nick, nick: mine.nick, matchId: state.matchId, seq: seq, dir: mine.dir, angle: Math.round(angle * 1000) / 1000 };
    if (inputRetryTimer) { clearTimeout(inputRetryTimer); inputRetryTimer = null; }
    unackedInput = { message: message, attempts: 1 };
    sendInitialInput(message);
    scheduleInputRetry();
    return true;
  }

  function queueDesiredInputForNewHost() {
    if (!active || !api || api.isHost() || state.phase !== "playing" || !validAngle(desiredInputAngle)) return;
    var mine = playerByNick(me().nick);
    if (!mine || mine.retired || mine.deadUntil || mine.bot) return;
    pendingInput = { angle: desiredInputAngle, matchId: state.matchId };
    if (pendingInputTimer) clearTimeout(pendingInputTimer);
    pendingInputTimer = setTimeout(flushPendingInput, INPUT_SEND_MS);
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
    if (spectator && nick === safeNick(api.host())) {
      var hasSuccessor = activeNicks().some(function (name) {
        return name !== nick && !has(state.spectators, name);
      });
      if (!hasSuccessor) {
        if (api.toast) api.toast("다른 참가자가 한 명 이상 있어야 관전할 수 있어요");
        return false;
      }
    }
    if (!spectator && has(state.spectators, nick) && participantNicks().length >= MAX_PLAYERS) {
      if (api.toast) api.toast("동시 플레이는 8명까지 가능해요");
      return false;
    }
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
    if (api.syncHostInputs) {
      var inputNicks = state.phase === "playing"
        ? state.players.filter(function (player) { return !player.bot && !player.retired && !player.away; }).map(function (player) { return player.nick; })
        : participantNicks();
      api.syncHostInputs(inputNicks);
    }
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
    if (has(state.spectators, safeNick(me().nick))) return false;
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
    clearPendingInput();
    resetGrid();
    inputSeq = 0;
    inputSeqByNick = Object.create(null);
    inputAtByNick = Object.create(null);
    inputSessionByNick = Object.create(null);
    lastInputAt = 0;
    desiredInputAngle = null;
    pressedKeys = Object.create(null);
    visualPlayers = Object.create(null);
    visualTrails = Object.create(null);
    collisionTrails = Object.create(null);
    captureParticles = [];
    spectatorFocusNick = "";
    swipe = null;
    var startedAt = nowMs();
    state.phase = "playing";
    state.rev++;
    state.frameSeq = 0;
    state.ownerRev++;
    state.matchId = "tr-" + startedAt.toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
    state.startAt = startedAt + START_COUNTDOWN_MS;
    state.deadline = state.startAt + MATCH_MS;
    state.ready = [];
    state.winner = "";
    playedDeathCues = Object.create(null);
    var initialSpawns = allocateInitialSpawns(entries.length);
    state.players = entries.map(function (entry, index) {
      return makePlayer(index, entry.nick, entry.bot, entries.length, initialSpawns[index]);
    });
    state.players.forEach(createBase);
    rebuildTrailOwner();
    mergeVisualPlayers();
    lastWarnMatchId = "";
    lastCountdownValue = "";
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
    state.startAt = 0;
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
    var frameInterval = frameIntervalMs();
    if (wantedOwnerRev > state.ownerRev) {
      if (ownerSyncMissingSince && now - ownerSyncMissingSince >= OWNER_RECOVERY_MS) recoverMissingOwner();
      return;
    }
    if (state.startAt && now < state.startAt) {
      if (now - lastFrameSentAt >= frameInterval) broadcastFrame(now);
      return;
    }
    if (now >= state.deadline) { hostFinish(); return; }
    retryReturningPlayers(now);
    advancePlayers(state.players, STEP_MS / 1000, now);
    if (fullPending) {
      if (now - lastFullSentAt >= FULL_MIN_MS) {
        fullPending = false;
        state.rev++;
        broadcastFull();
      }
      return;
    }
    if (now - lastFrameSentAt >= frameInterval) {
      broadcastFrame(now);
    }
  }

  function onMessage(message, transport) {
    if (!message || typeof message.t !== "string" || message.t.indexOf("tr_") !== 0) return false;
    var mine = me().nick;
    if (message.to && message.to !== mine) return true;
    switch (message.t) {
      case "tr_hello":
        if (api && api.isHost() && trustedTransport(message.by, transport, "room")) {
          var helloNick = safeNick(message.by);
          if (helloNick && helloNick !== mine && has(activeNicks(), helloNick)) {
            syncInputSession(helloNick, transport);
            if (nowMs() - (syncReplyAtByNick[helloNick] || 0) >= 1200) {
              syncReplyAtByNick[helloNick] = nowMs();
              broadcastFull(helloNick);
            }
          }
        }
        return true;
      case "tr_sync_req":
        if (api && api.isHost() && trustedTransport(message.by, transport, "room")) {
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
        if (!api || api.isHost() || !trustedHostTransport(message, transport)) return true;
        syncAuthorityClock(transport);
        applyFull(message.state, message.by, transport);
        return true;
      case "tr_frame":
        if (!api || api.isHost() || !trustedHostTransport(message, transport)) return true;
        syncAuthorityClock(transport);
        applyFrame(message.state, message.by, transport);
        return true;
      case "tr_input":
        if (!api || !api.isHost() || message.matchId !== state.matchId || message.by !== message.nick
            || !trustedTransport(message.nick, transport, ["direct", "room"])) return true;
        syncInputSession(message.nick, transport);
        applyDirection(playerByNick(message.nick), validAngle(message.angle) ? message.angle : message.dir, message.seq);
        return true;
      case "tr_room_full":
        if (!api || !trustedHostTransport(message, transport)) return true;
        if (api.toast) api.toast("땅따먹기 방은 10명까지 들어올 수 있어요");
        if (api.leaveRoom) setTimeout(function () { if (api && api.leaveRoom) api.leaveRoom(); }, 0);
        return true;
      case "tr_ready_req":
        if (api && api.isHost() && message.by === message.nick && trustedTransport(message.nick, transport, "room")) {
          hostSetReady(message.nick, !!message.ready);
        }
        return true;
      case "tr_role_req":
        if (api && api.isHost() && message.by === message.nick && trustedTransport(message.nick, transport, "room")) {
          hostSetSpectator(message.nick, !!message.spectator);
        }
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

  function renderRoleLists(participantId, spectatorId) {
    var participants = $(participantId);
    var spectators = $(spectatorId);
    var activeRows = activePeople();
    if (participants) {
      var playingHumans = state.phase === "playing"
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

  function renderRoles() {
    renderRoleLists("territory-participants", "territory-spectators");
    renderRoleLists("territory-finished-participants", "territory-finished-spectators");
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
    var finishedRole = $("territory-finished-role-btn");
    var nextStatus = $("territory-next-round-status");
    if (role) {
      role.textContent = spectator ? "참가하기" : "관전하기";
      role.setAttribute("aria-pressed", spectator ? "true" : "false");
      role.disabled = state.phase === "playing";
    }
    if (finishedRole) {
      finishedRole.textContent = spectator ? "참가하기" : "관전하기";
      finishedRole.setAttribute("aria-pressed", spectator ? "true" : "false");
      finishedRole.disabled = state.phase !== "finished";
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
      setHidden(again, state.phase !== "finished" || spectator);
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
    if (nextStatus) {
      var required = requiredReadyNicks();
      var readyCount = required.filter(function (nick) { return has(state.ready, nick); }).length;
      if (spectator) nextStatus.textContent = "관전 중 · 참가하면 다음 판에 함께해요";
      else if (isHost && !required.length) nextStatus.textContent = "바로 시작할 수 있어요";
      else if (isHost && readyCount === required.length) nextStatus.textContent = "모두 레디 완료";
      else if (isHost) nextStatus.textContent = readyCount + "/" + required.length + "명 레디";
      else if (has(state.ready, myNick)) nextStatus.textContent = "레디 완료 · 방장을 기다려주세요";
      else nextStatus.textContent = "레디를 눌러 다음 판을 준비하세요";
    }
  }

  function renderScoreboard() {
    var element = $("territory-scoreboard");
    if (!element) return;
    var mine = me().nick;
    var canFocus = state.phase === "playing" && isLocalSpectator();
    var focused = canFocus ? cameraFocusPlayer() : null;
    var rows = rankRows();
    var signature = JSON.stringify([
      canFocus,
      mine,
      focused ? focused.nick : "",
      rows.map(function (row) { return [row.id, row.nick, row.active, row.area.toFixed(1)]; })
    ]);
    if (signature === lastScoreboardSignature) return;
    lastScoreboardSignature = signature;
    var activeFocus = typeof document !== "undefined" && document.activeElement && element.contains(document.activeElement)
      ? document.activeElement.closest("[data-tr-focus]")
      : null;
    var restoreFocusNick = activeFocus ? activeFocus.getAttribute("data-tr-focus") : "";
    element.innerHTML = rows.map(function (row, index) {
      var isFocused = !!focused && row.nick === focused.nick;
      var name = canFocus && row.active
        ? '<button type="button" class="territory-rank-name territory-rank-focus" data-tr-focus="' + esc(row.nick)
          + '" aria-pressed="' + (isFocused ? "true" : "false") + '" aria-label="' + esc(row.nick) + ' 관전하기">' + esc(row.nick) + "</button>"
        : '<span class="territory-rank-name">' + esc(row.nick) + "</span>";
      return '<div class="territory-rank' + (row.nick === mine ? " is-me" : "") + (isFocused ? " is-focused" : "") + '">'
        + '<span class="territory-rank-number">' + (index + 1) + "</span>"
        + name
        + "<strong>" + row.area.toFixed(1) + "%</strong></div>";
    }).join("");
    if (restoreFocusNick) {
      var buttons = element.querySelectorAll("[data-tr-focus]");
      for (var i = 0; i < buttons.length; i++) {
        if (buttons[i].getAttribute("data-tr-focus") !== restoreFocusNick) continue;
        try { buttons[i].focus({ preventScroll: true }); } catch (error) { buttons[i].focus(); }
        break;
      }
    }
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

  function renderCountdown(now) {
    var shell = $("territory-countdown");
    var value = $("territory-countdown-value");
    if (!shell || !value) return;
    var remaining = state.phase === "playing" && state.startAt ? state.startAt - now : 0;
    var visible = remaining > 0;
    setHidden(shell, !visible);
    shell.setAttribute("aria-hidden", visible ? "false" : "true");
    if (!visible) {
      lastCountdownValue = "";
      shell.classList.remove("is-ticking");
      return;
    }
    var nextValue = String(clamp(Math.ceil(remaining / 1000), 1, Math.ceil(START_COUNTDOWN_MS / 1000)));
    if (nextValue !== lastCountdownValue) {
      lastCountdownValue = nextValue;
      value.textContent = nextValue;
      shell.classList.remove("is-ticking");
      void shell.offsetWidth;
      shell.classList.add("is-ticking");
      if (api && api.playWarning) api.playWarning();
    }
  }

  function renderPlayerStatus(mine, now) {
    var shell = $("territory-status");
    var announcement = $("territory-status-announcement");
    if (!shell) return;
    var visible = state.phase === "playing" && mine && mine.deadUntil > now;
    setHidden(shell, !visible);
    shell.setAttribute("aria-hidden", visible ? "false" : "true");
    if (!visible) {
      lastStatusAnnouncementKey = "";
      if (announcement) announcement.textContent = "";
      return;
    }
    var title = $("territory-status-title");
    var detail = $("territory-status-detail");
    var time = $("territory-respawn-time");
    var reason = safeDeathReason(mine.deathReason);
    var titleText = "잠시 후 다시 출발해요";
    var detailText = "";
    if (reason === "cut") {
      titleText = "이동선이 끊어졌어요";
      detailText = mine.deathBy ? mine.deathBy + "님이 캐릭터 뒤의 이동선에 닿았어요" : "다른 선수가 캐릭터 뒤의 이동선에 닿았어요";
    } else if (reason === "self") {
      titleText = "내 이동선을 다시 밟았어요";
      detailText = "내 땅으로 돌아가기 전에는 캐릭터 뒤의 색 선을 피하세요";
    } else if (reason === "territory") {
      titleText = "영역을 모두 빼앗겼어요";
      detailText = mine.deathBy ? mine.deathBy + "님이 마지막 땅을 차지했어요" : "새로운 땅에서 다시 시작해요";
    } else if (reason === "limit") {
      titleText = "이동선이 너무 길어 안전 귀환해요";
      detailText = "다음에는 조금 일찍 내 땅으로 돌아오세요";
    } else if (reason === "waiting") {
      titleText = "안전한 위치를 찾고 있어요";
      detailText = "곧 빈 공간을 만들어 다시 출발해요";
    }
    if (title) title.textContent = titleText;
    if (detail) detail.textContent = detailText;
    if (time) time.textContent = reason === "waiting" ? "" : Math.max(0, (mine.deadUntil - now) / 1000).toFixed(1) + "초";
    var announcementKey = [state.matchId, mine.deathSeq, mine.deadUntil, reason, mine.deathBy].join(":");
    if (announcement && announcementKey !== lastStatusAnnouncementKey) {
      lastStatusAnnouncementKey = announcementKey;
      announcement.textContent = titleText + (detailText ? ". " + detailText : "");
    }
  }

  function renderHud() {
    if (!api) return;
    var now = gameNow();
    var remaining = state.phase === "playing"
      ? (state.startAt && now < state.startAt ? MATCH_MS : Math.max(0, state.deadline - now))
      : MATCH_MS;
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
    var spectator = isLocalSpectator();
    var focused = spectator ? cameraFocusPlayer() : null;
    var areaShell = $("territory-area-shell");
    var focusShell = $("territory-focus-hud");
    var focusVisible = state.phase === "playing" && spectator && !!focused;
    setHidden(areaShell, state.phase !== "playing" || spectator);
    setHidden(focusShell, !focusVisible);
    if (focusShell) focusShell.setAttribute("aria-hidden", focusVisible ? "false" : "true");
    if (focusVisible) {
      var focusDot = $("territory-focus-dot");
      var focusName = $("territory-focus-name");
      var focusArea = $("territory-focus-area");
      if (focusDot) focusDot.style.background = COLORS[focused.id];
      if (focusName) focusName.textContent = focused.nick;
      if (focusArea) focusArea.textContent = ((counts[focused.id] || 0) / PLAYABLE_CELL_COUNT * 100).toFixed(1) + "%";
    }
    var myDot = $("territory-my-dot");
    if (myDot && mine) myDot.style.background = COLORS[mine.id];
    var area = $("territory-area");
    if (area) area.textContent = mine ? ((counts[mine.id] || 0) / PLAYABLE_CELL_COUNT * 100).toFixed(1) + "%" : "0.0%";
    var count = $("territory-people-count");
    if (count) count.textContent = String(activePeople().length);
    renderCountdown(now);
    renderPlayerStatus(mine, now);
    renderScoreboard();
  }

  function canChat(nick) {
    nick = safeNick(nick || (api ? me().nick : ""));
    if (!nick) return false;
    if (state.phase !== "playing") return true;
    return has(state.spectators, nick) || !playerByNick(nick);
  }

  function renderChat() {
    if (!api) return;
    var allowed = canChat(me().nick);
    var row = $("territory-chat-row");
    var input = $("territory-chat-input");
    var send = $("territory-chat-send");
    var overlay = $("territory-chat-overlay");
    var root = $("territorygame");
    var scope = state.phase === "playing" ? (allowed ? "playing:spectator" : "playing:participant") : state.phase + ":all";
    if (overlay && lastChatScope !== scope) overlay.innerHTML = "";
    lastChatScope = scope;
    setHidden(row, !allowed);
    setHidden(overlay, !allowed);
    if (root) root.classList.toggle("chat-enabled", allowed);
    if (input) {
      input.disabled = !allowed;
      input.placeholder = state.phase === "playing" ? "관전자 채팅" : "채팅 입력";
    }
    if (send) send.disabled = !allowed;
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
    syncAudio();
    var root = $("territorygame");
    if (!root || !api) return;
    if (state.phase !== "playing" && Object.keys(pressedKeys).length) pressedKeys = Object.create(null);
    root.classList.toggle("is-playing", state.phase === "playing");
    root.classList.toggle("is-spectating", state.phase === "playing" && isLocalSpectator());
    setHidden($("territory-lobby"), state.phase !== "idle");
    setHidden($("territory-finished"), state.phase !== "finished");
    var copy = $("territory-lobby-copy");
    if (copy) copy.textContent = participantNicks().length <= 1
      ? "혼자 시작하면 귀여운 AI 3명과 연습해요"
      : "밖으로 나갔다 내 땅으로 돌아오면 영역이 넓어져요";
    if (copy && participantNicks().length <= 1) copy.textContent += " · 밖으로 나갔다가 내 영역으로 돌아오면 땅이 넓어져요";
    renderRoles();
    renderControls();
    renderFinished();
    renderHud();
    renderChat();
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
    var focus = cameraFocusPlayer() || { nick: "", x: WORLD_W / 2, y: WORLD_H / 2 };
    var visual = focus.deadUntil ? { x: focus.spawnX, y: focus.spawnY } : (visualPlayers[focus.nick] || focus);
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
  }

  function rebuildTerritoryLayer() {
    if (!ownerLayerDirty || !territoryCtx) return;
    var s = LAYER_SCALE;
    territoryCtx.clearRect(0, 0, territoryLayer.width, territoryLayer.height);
    territoryCtx.globalAlpha = 1;
    for (var y = 0; y < WORLD_H; y++) {
      for (var x = 0; x < WORLD_W;) {
        var id = isPlayableCell(x, y) ? owner[cellIndex(x, y)] : -1;
        if (id < 0) { x++; continue; }
        var startX = x;
        while (x < WORLD_W && isPlayableCell(x, y) && owner[cellIndex(x, y)] === id) x++;
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

  function fillArenaOutside(targetCtx, left, top, right, bottom, width, height) {
    if (!targetCtx) return;
    var innerLeft = clamp(Math.min(left, right), 0, width);
    var innerRight = clamp(Math.max(left, right), 0, width);
    var innerTop = clamp(Math.min(top, bottom), 0, height);
    var innerBottom = clamp(Math.max(top, bottom), 0, height);
    targetCtx.fillStyle = ARENA_BOUNDARY_COLOR;
    targetCtx.fillRect(0, 0, width, innerTop);
    targetCtx.fillRect(0, innerBottom, width, Math.max(0, height - innerBottom));
    targetCtx.fillRect(0, innerTop, innerLeft, Math.max(0, innerBottom - innerTop));
    targetCtx.fillRect(innerRight, innerTop, Math.max(0, width - innerRight), Math.max(0, innerBottom - innerTop));
  }

  function drawArenaBoundary(view) {
    var left = screenX(ARENA_INSET, view);
    var top = screenY(ARENA_INSET, view);
    var right = screenX(WORLD_W - ARENA_INSET, view);
    var bottom = screenY(WORLD_H - ARENA_INSET, view);
    ctx.save();
    ctx.globalAlpha = 1;
    fillArenaOutside(ctx, left, top, right, bottom, view.width, view.height);
    ctx.strokeStyle = "#31576a";
    ctx.lineWidth = Math.max(2.5, Math.min(4, view.scale * .28));
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.restore();
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

  function appendCollisionTrailPoint(points, x, y) {
    if (!isFinite(x) || !isFinite(y)) return points;
    var next = { x: Number(x), y: Number(y) };
    if (!points.length) {
      points.push(next);
      return points;
    }
    var last = points[points.length - 1];
    var dx = next.x - last.x;
    var dy = next.y - last.y;
    if (dx * dx + dy * dy <= 1e-12) points[points.length - 1] = next;
    else points.push(next);
    return points;
  }

  function collisionTrailContinues(cache, trail) {
    return !!(cache && cache.matchId === state.matchId && cache.first === trail[0]
      && cache.trailLength > 0 && cache.trailLength <= trail.length
      && trail[cache.trailLength - 1] === cache.lastKey);
  }

  function syncCollisionTrail(player, startX, startY) {
    var trail = player.trail || [];
    if (!trail.length) {
      delete collisionTrails[player.nick];
      return null;
    }
    var cache = collisionTrails[player.nick];
    if (!collisionTrailContinues(cache, trail)) {
      var hasStart = isFinite(startX) && isFinite(startY);
      var decodedPath = decodeVisualTrail(player.path);
      var rebuildForAuthority = !!(api && api.isHost && api.isHost());
      var points = hasStart ? [{ x: Number(startX), y: Number(startY) }]
        : (!rebuildForAuthority && decodedPath.length ? decodedPath : rebuiltVisualTrailPoints(trail));
      if (!hasStart && points.length > 1) points[points.length - 1] = { x: player.x, y: player.y };
      cache = collisionTrails[player.nick] = {
        matchId: state.matchId,
        first: trail[0],
        trailLength: trail.length,
        lastKey: trail[trail.length - 1],
        points: points
      };
    }
    appendCollisionTrailPoint(cache.points, player.x, player.y);
    cache.trailLength = trail.length;
    cache.lastKey = trail[trail.length - 1];
    return cache;
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
    var drawX = player.deadUntil ? player.spawnX : visual.x;
    var drawY = player.deadUntil ? player.spawnY : visual.y;
    var px = screenX(drawX, view);
    var py = screenY(drawY, view);
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

  function drawCaptureParticles(view, now) {
    if (!captureParticles.length) return;
    var visible = [];
    ctx.save();
    for (var i = 0; i < captureParticles.length; i++) {
      var particle = captureParticles[i];
      var age = now - particle.born;
      if (age < 0 || age >= particle.life) continue;
      var progress = age / particle.life;
      var seconds = age / 1000;
      var x = particle.x + particle.vx * seconds;
      var y = particle.y + particle.vy * seconds + progress * progress * .7;
      var px = screenX(x, view);
      var py = screenY(y, view);
      visible.push(particle);
      if (px < -12 || px > view.width + 12 || py < -12 || py > view.height + 12) continue;
      ctx.globalAlpha = Math.pow(1 - progress, 1.35);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.2, view.scale * particle.size * (1 - progress * .35)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    captureParticles = visible;
  }

  function predictedPlayerPose(player, elapsedMs, targetOverride) {
    var pose = {
      x: Number(player && player.x) || 0,
      y: Number(player && player.y) || 0,
      angle: requestedAngle(player && player.angle, directionAngle(player && player.dir))
    };
    if (!player || player.deadUntil || player.retired || player.away) return pose;
    var remaining = clamp(Number(elapsedMs) || 0, 0, PREDICTION_MAX_MS);
    var targetAngle = requestedAngle(targetOverride, requestedAngle(player.targetAngle, pose.angle));
    while (remaining > 0) {
      var stepMs = Math.min(STEP_MS, remaining);
      var dt = stepMs / 1000;
      pose.angle = normalizeAngle(pose.angle + clamp(angleDelta(pose.angle, targetAngle), -TURN_SPEED * dt, TURN_SPEED * dt));
      var nx = clamp(pose.x + Math.cos(pose.angle) * SPEED * dt, ARENA_INSET, WORLD_W - ARENA_INSET);
      var ny = clamp(pose.y + Math.sin(pose.angle) * SPEED * dt, ARENA_INSET, WORLD_H - ARENA_INSET);
      var movedX = nx - pose.x;
      var movedY = ny - pose.y;
      if (movedX * movedX + movedY * movedY < SPEED * SPEED * dt * dt * .01) {
        var atVerticalEdge = pose.x <= ARENA_INSET + .001 || pose.x >= WORLD_W - ARENA_INSET - .001;
        var atHorizontalEdge = pose.y <= ARENA_INSET + .001 || pose.y >= WORLD_H - ARENA_INSET - .001;
        if (atVerticalEdge) {
          pose.angle = Math.abs(Math.sin(pose.angle)) > .15
            ? (Math.sin(pose.angle) < 0 ? -Math.PI / 2 : Math.PI / 2)
            : (pose.y < WORLD_H / 2 ? Math.PI / 2 : -Math.PI / 2);
        } else if (atHorizontalEdge) {
          pose.angle = Math.abs(Math.cos(pose.angle)) > .15
            ? (Math.cos(pose.angle) < 0 ? Math.PI : 0)
            : (pose.x < WORLD_W / 2 ? 0 : Math.PI);
        }
        pose.angle = normalizeAngle(pose.angle);
        targetAngle = pose.angle;
        nx = clamp(pose.x + Math.cos(pose.angle) * SPEED * dt, ARENA_INSET, WORLD_W - ARENA_INSET);
        ny = clamp(pose.y + Math.sin(pose.angle) * SPEED * dt, ARENA_INSET, WORLD_H - ARENA_INSET);
      }
      pose.x = nx;
      pose.y = ny;
      remaining -= stepMs;
    }
    return pose;
  }

  function visualTargetFor(player, now) {
    var elapsed = 0;
    if (api && !api.isHost() && lastAuthoritativeAt && (!state.startAt || now >= state.startAt)) {
      elapsed = clamp(now - lastAuthoritativeAt, 0, PREDICTION_MAX_MS);
    }
    var target = player.nick === safeNick(me().nick) && validAngle(desiredInputAngle)
      ? desiredInputAngle : player.targetAngle;
    return predictedPlayerPose(player, elapsed, target);
  }

  function visualPositionBlend(dx, dy, baseBlend, frameDelta) {
    var distance = Math.sqrt(dx * dx + dy * dy);
    if (!distance) return 0;
    baseBlend = clamp(Number(baseBlend) || 0, 0, 1);
    var maxStep = SPEED * clamp(Number(frameDelta) || 0, 8, 80) / 1000 * VISUAL_CATCHUP_SPEED_MULTIPLIER;
    return Math.min(baseBlend, maxStep / distance);
  }

  function paint() {
    if (!active || !ctx || !canvas) return;
    var now = nowMs();
    var authoritativeNow = gameNow();
    var frameDelta = lastPredictionAt ? clamp(now - lastPredictionAt, 8, 80) : 32;
    var blend = 1 - Math.pow(.76, frameDelta / 32);
    lastPredictionAt = now;
    state.players.forEach(function (player) {
      var visual = visualPlayers[player.nick] || player;
      var target = visualTargetFor(player, now);
      var dx = target.x - visual.x;
      var dy = target.y - visual.y;
      var positionBlend = visualPositionBlend(dx, dy, blend, frameDelta);
      visual.x += dx * positionBlend;
      visual.y += dy * positionBlend;
      var playerAngle = target.angle;
      if (!validAngle(visual.angle)) visual.angle = playerAngle;
      visual.angle = normalizeAngle(visual.angle + angleDelta(visual.angle, playerAngle) * blend);
    });
    var view = viewInfo();
    ctx.clearRect(0, 0, view.width, view.height);
    drawArena(view);
    drawTerritories(view);
    drawArenaBoundary(view);
    state.players.forEach(function (player) { drawTrail(player, view); });
    drawCaptureParticles(view, now);
    state.players.forEach(function (player) { drawPlayer(player, view, authoritativeNow); });
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
    var miniLeft = ARENA_INSET / WORLD_W * width;
    var miniTop = ARENA_INSET / WORLD_H * height;
    var miniRight = (WORLD_W - ARENA_INSET) / WORLD_W * width;
    var miniBottom = (WORLD_H - ARENA_INSET) / WORLD_H * height;
    fillArenaOutside(miniCtx, miniLeft, miniTop, miniRight, miniBottom, width, height);
    miniCtx.strokeStyle = ARENA_BOUNDARY_COLOR;
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(miniLeft, miniTop, miniRight - miniLeft, miniBottom - miniTop);
    var focus = cameraFocusPlayer();
    for (var i = 0; i < state.players.length; i++) {
      var player = state.players[i];
      if (player.deadUntil || player.retired) continue;
      var isFocused = !!focus && player.nick === focus.nick;
      miniCtx.fillStyle = COLORS[player.id];
      miniCtx.beginPath();
      miniCtx.arc(player.x / WORLD_W * width, player.y / WORLD_H * height, isFocused ? 3.2 : 2.2, 0, Math.PI * 2);
      miniCtx.fill();
      if (isFocused) {
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
    ["territory-lobby-rules-btn", "territory-finished-rules-btn"].forEach(function (id) {
      var button = $(id);
      if (button) button.addEventListener("click", function () {
        if (api && api.openRules) api.openRules();
        else if (api && api.openMenu) api.openMenu();
      });
    });
    $("territory-role-btn").addEventListener("click", toggleRole);
    $("territory-finished-role-btn").addEventListener("click", toggleRole);
    $("territory-ready-btn").addEventListener("click", toggleReady);
    $("territory-start-btn").addEventListener("click", hostStart);
    $("territory-again-btn").addEventListener("click", function () { if (api && api.isHost()) hostStart(); else toggleReady(); });
    $("territory-scoreboard").addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-tr-focus]") : null;
      if (target) selectSpectatorFocus(target.getAttribute("data-tr-focus"));
    });
    function submitTerritoryChat() {
      var input = $("territory-chat-input");
      if (!input || !api || !canChat(me().nick)) return false;
      if (api.sendChat && api.sendChat(input.value)) {
        input.value = "";
        try { input.focus({ preventScroll: true }); } catch (error) { input.focus(); }
        return true;
      }
      return false;
    }
    $("territory-chat-input").addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.isComposing || !api || !canChat(me().nick)) return;
      submitTerritoryChat();
    });
    var chatSend = $("territory-chat-send");
    if (chatSend) chatSend.addEventListener("click", submitTerritoryChat);

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
    function isEditableTarget(target) {
      if (!target) return false;
      var tag = String(target.tagName || "").toUpperCase();
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target.isContentEditable;
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
      if (!active || state.phase !== "playing" || !keyVectors[event.code] || isEditableTarget(event.target)) return;
      pressedKeys[event.code] = true;
      updateKeyboardDirection();
      event.preventDefault();
    });
    window.addEventListener("keyup", function (event) {
      if (!active || !keyVectors[event.code]) return;
      delete pressedKeys[event.code];
      if (isEditableTarget(event.target)) return;
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
      Object.keys(roomOverflowNotified).forEach(function (nick) {
        if (!has(shownList, nick)) delete roomOverflowNotified[nick];
      });
      shownPeople.slice(MAX_ROOM_MEMBERS).forEach(function (person) {
        var nick = safeNick(person.nick);
        if (!nick || roomOverflowNotified[nick]) return;
        roomOverflowNotified[nick] = true;
        api.send({ t: "tr_room_full", by: me().nick, to: nick });
      });
      activeList.filter(function (nick) { return !has(state.spectators, nick); }).slice(MAX_PLAYERS).forEach(function (nick) {
        state.spectators.push(nick);
        state.ready = state.ready.filter(function (name) { return name !== nick; });
        changed = true;
      });
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
            if (activateReturningPlayer(player, nowMs())) changed = true;
          } else if (present && player.away) {
            if (player.deadUntil || !hasPlayerTerritory(player.id)) {
              if (!player.deadUntil) {
                player.deathReason = "territory";
                player.deadUntil = nowMs();
                player.respawnGiveUpAt = player.deadUntil + RESPAWN_EMERGENCY_MS;
              }
              if (activateReturningPlayer(player, nowMs())) changed = true;
            } else {
              player.away = false;
              inputAtByNick[player.nick] = 0;
              changed = true;
            }
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
      html: '<div class="territory-rules">'
        + '<p class="rule-intro">내 색의 땅에서 출발해 바깥을 돌고 돌아오세요. <b>90초 동안 땅을 가장 넓게 만든 사람</b>이 이깁니다.</p>'
        + '<div class="territory-rule-cards">'
        + '<section class="territory-rule-card">'
        + '<svg viewBox="0 0 150 104" aria-hidden="true" focusable="false">'
        + '<rect x="11" y="8" width="128" height="88" rx="13" fill="#e5f5ef" stroke="#b8ddd1" stroke-width="3"/>'
        + '<circle cx="60" cy="63" r="10" fill="#fff" stroke="#173747" stroke-width="4"/>'
        + '<path d="M67 56 C83 40 98 29 119 19" fill="none" stroke="#ff735f" stroke-width="6" stroke-linecap="round"/>'
        + '<path d="M107 18 l13 1 -4 12" fill="none" stroke="#ff735f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<circle cx="42" cy="79" r="9" fill="#ffd7c7" stroke="#e69d7f" stroke-width="3"/>'
        + '<path d="M45 73 l18 -18" stroke="#e69d7f" stroke-width="4" stroke-linecap="round" stroke-dasharray="3 5"/>'
        + '<text x="77" y="86" fill="#47636e" font-size="10" font-weight="800">밀어 준 방향으로 이동</text>'
        + '</svg>'
        + '<div class="territory-rule-copy"><h3>1. 원하는 방향으로 밀기</h3><p>화면을 손가락으로 <b>밀어 준 방향</b>으로 계속 움직여요. 달리는 중에도 방향을 바꿀 수 있어요.</p></div>'
        + '</section>'
        + '<section class="territory-rule-card">'
        + '<svg viewBox="0 0 150 104" aria-hidden="true" focusable="false">'
        + '<rect x="5" y="14" width="55" height="76" rx="10" fill="#43cbae"/>'
        + '<path d="M52 41 C83 11 132 20 132 52 C132 84 86 93 52 66 Z" fill="#bcefe4" stroke="#43cbae" stroke-width="3"/>'
        + '<path d="M51 41 C84 12 132 22 132 52 C132 82 88 92 52 66" fill="none" stroke="#ff735f" stroke-width="5" stroke-linecap="round"/>'
        + '<circle cx="52" cy="41" r="6" fill="#fff" stroke="#173747" stroke-width="3"/>'
        + '<path d="M52 66 l-7 -4 m7 4 l-6 6" fill="none" stroke="#173747" stroke-width="2.5" stroke-linecap="round"/>'
        + '</svg>'
        + '<div class="territory-rule-copy"><h3>2. 밖으로 나갔다 돌아오기</h3><p>내 땅을 출발해 한 바퀴 돌고 <b>다시 내 땅으로 돌아오면</b>, 이동선으로 둘러싼 곳이 내 땅이 돼요.</p></div>'
        + '</section>'
        + '<section class="territory-rule-card">'
        + '<svg viewBox="0 0 150 104" aria-hidden="true" focusable="false">'
        + '<rect x="5" y="14" width="42" height="76" rx="10" fill="#43cbae"/>'
        + '<path d="M43 68 C63 68 62 31 104 31" fill="none" stroke="#ff735f" stroke-width="6" stroke-linecap="round"/>'
        + '<circle cx="109" cy="31" r="9" fill="#fff" stroke="#173747" stroke-width="4"/>'
        + '<path d="M83 12 C83 29 82 48 82 67" fill="none" stroke="#6094f1" stroke-width="6" stroke-linecap="round"/>'
        + '<circle cx="83" cy="12" r="8" fill="#fff" stroke="#2e65c5" stroke-width="4"/>'
        + '<path d="M74 59 l16 16 M90 59 L74 75" stroke="#e94242" stroke-width="5" stroke-linecap="round"/>'
        + '<text x="55" y="96" fill="#a23b2b" font-size="10" font-weight="800">캐릭터 뒤의 이동선</text>'
        + '</svg>'
        + '<div class="territory-rule-copy"><h3>3. 뒤에 생긴 선 지키기</h3><p>밖에 나간 동안 캐릭터 뒤에 이어지는 <b>색 선</b>을 상대가 건드리거나 내가 다시 밟으면 탈락해요.</p></div>'
        + '</section>'
        + '<section class="territory-rule-card">'
        + '<svg viewBox="0 0 150 104" aria-hidden="true" focusable="false">'
        + '<circle cx="35" cy="50" r="27" fill="#fff" stroke="#dce7eb" stroke-width="7"/>'
        + '<path d="M35 50 L35 29 M35 50 L49 59" fill="none" stroke="#173747" stroke-width="5" stroke-linecap="round"/>'
        + '<text x="23" y="91" fill="#173747" font-size="11" font-weight="900">90초</text>'
        + '<rect x="75" y="58" width="17" height="30" rx="4" fill="#69a1f2"/>'
        + '<rect x="98" y="40" width="17" height="48" rx="4" fill="#ff876f"/>'
        + '<rect x="121" y="18" width="17" height="70" rx="4" fill="#43cbae"/>'
        + '<path d="M125 12 l4 -7 4 7" fill="#ffd65a" stroke="#e5a51f" stroke-width="2"/>'
        + '</svg>'
        + '<div class="territory-rule-copy"><h3>4. 가장 넓으면 승리</h3><p>상대 땅도 둘러싸서 빼앗을 수 있어요. 시간이 끝났을 때 <b>영역 비율 1위</b>가 승리해요.</p></div>'
        + '</section>'
        + '</div>'
        + '<p class="territory-tail-definition"><strong>‘꼬리’가 뭐예요?</strong><br>내 땅 밖을 달리는 동안 <b>캐릭터 뒤에 이어지는 색 이동선</b>을 뜻해요. 규칙에서는 헷갈리지 않게 ‘이동선’이라고 부를게요.</p>'
        + '<ul class="territory-rule-notes">'
        + '<li>진한 경기장 경계는 벽이에요. 벽 바깥은 땅으로 만들 수 없고, 벽에 닿으면 가장자리를 따라 움직여요.</li>'
        + '<li>이동선이 끊기거나 내 땅을 모두 빼앗기면 잠시 뒤 빈 곳에서 다시 시작해요.</li>'
        + '<li>혼자 시작하면 AI 3명과 연습해요.</li>'
        + '</ul></div>'
    };
  }

  function isSoundMuted() {
    try { return localStorage.getItem("omok_mute") === "1"; }
    catch (error) { return false; }
  }

  function ensureGameBgm() {
    if (gameBgmEl) return gameBgmEl;
    if (typeof Audio === "undefined") return null;
    try {
      gameBgmEl = new Audio(GAME_BGM_SRC);
      gameBgmEl.preload = "auto";
      gameBgmEl.volume = GAME_BGM_VOLUME;
      gameBgmEl.loop = true;
      gameBgmEl.setAttribute("playsinline", "");
      gameBgmEl.setAttribute("webkit-playsinline", "");
      return gameBgmEl;
    } catch (error) {
      return null;
    }
  }

  function stopGameBgm(reset) {
    gameBgmPlayPending = false;
    if (!gameBgmEl) return;
    try {
      gameBgmEl.pause();
      if (reset) gameBgmEl.currentTime = 0;
    } catch (error) {}
  }

  function playGameBgm() {
    var matchId = state.matchId;
    if (!matchId || gameBgmPlayPending) return;
    var el = ensureGameBgm();
    if (!el) return;
    var isNewMatch = lastGameBgmMatchId !== matchId;
    if (!isNewMatch && !el.paused) return;
    try {
      if (isNewMatch) {
        el.pause();
        el.currentTime = 0;
      }
      lastGameBgmMatchId = matchId;
      el.volume = GAME_BGM_VOLUME;
      el.loop = true;
      gameBgmPlayPending = true;
      var play = el.play();
      if (play && play.then) {
        play.then(function () { gameBgmPlayPending = false; })
          .catch(function () { gameBgmPlayPending = false; });
      } else {
        gameBgmPlayPending = false;
      }
    } catch (error) {
      gameBgmPlayPending = false;
    }
  }

  function ensureDeathSfx() {
    if (deathSfxEl) return deathSfxEl;
    if (typeof Audio === "undefined") return null;
    try {
      deathSfxEl = new Audio(DEATH_SFX_SRC);
      deathSfxEl.preload = "auto";
      deathSfxEl.volume = DEATH_SFX_VOLUME;
      deathSfxEl.setAttribute("playsinline", "");
      return deathSfxEl;
    } catch (error) {
      return null;
    }
  }

  function deathCue(matchId, nick, deadUntil) {
    return [String(matchId || ""), safeNick(nick), Math.floor(Number(deadUntil) || 0)].join(":");
  }

  function playDeathSfx(cue) {
    cue = String(cue || "");
    if (!cue || playedDeathCues[cue]) return false;
    playedDeathCues[cue] = true;
    if (isSoundMuted()) return false;
    var el = ensureDeathSfx();
    if (!el) return false;
    try {
      el.pause();
      el.currentTime = 0;
      el.volume = DEATH_SFX_VOLUME;
      var play = el.play();
      if (play && play.catch) play.catch(function () {});
      return true;
    } catch (error) {
      return false;
    }
  }

  function announceDeath(player) {
    if (!player || !player.nick || !player.deadUntil || !state.matchId) return;
    var cue = deathCue(state.matchId, player.nick, player.deadUntil);
    playDeathSfx(cue);
  }

  function syncRemoteDeathCues(previous, next) {
    if (!previous || !next || previous.matchId !== next.matchId || next.phase !== "playing") return;
    var prior = Object.create(null);
    (previous.players || []).forEach(function (player) { prior[player.nick] = Math.floor(Number(player.deathSeq) || 0); });
    (next.players || []).forEach(function (player) {
      var deadUntil = Math.floor(Number(player.deadUntil) || 0);
      var deathSeq = Math.floor(Number(player.deathSeq) || 0);
      if (deadUntil > gameNow() && deathSeq > (prior[player.nick] || 0)) playDeathSfx(deathCue(next.matchId, player.nick, deadUntil));
    });
  }

  function syncAudio() {
    if (!api || state.phase !== "playing") {
      stopGameBgm(true);
      return;
    }
    if (isSoundMuted()) {
      stopGameBgm(false);
      if (deathSfxEl) {
        try { deathSfxEl.pause(); deathSfxEl.currentTime = 0; } catch (error) {}
      }
      return;
    }
    playGameBgm();
  }

  function enter(nextApi) {
    leave();
    api = nextApi;
    active = true;
    state = freshState();
    resetGrid();
    visualPlayers = Object.create(null);
    visualTrails = Object.create(null);
    collisionTrails = Object.create(null);
    captureParticles = [];
    pressedKeys = Object.create(null);
    inputSeq = 0;
    inputSeqByNick = Object.create(null);
    inputAtByNick = Object.create(null);
    inputSessionByNick = Object.create(null);
    transportSeqBySession = Object.create(null);
    clearPendingInput();
    desiredInputAngle = null;
    syncReplyAtByNick = Object.create(null);
    helloPending = false;
    lastInputAt = 0;
    lastWarnMatchId = "";
    playedDeathCues = Object.create(null);
    roomOverflowNotified = Object.create(null);
    spectatorFocusNick = "";
    lastChatScope = "";
    lastScoreboardSignature = "";
    wantedOwnerRev = 0;
    ownerSyncMissingSince = 0;
    authoritativeHost = "";
    authorityYielded = false;
    needsAuthoritySync = false;
    lastFullSentAt = 0;
    lastAuthoritativeAt = 0;
    lastPredictionAt = 0;
    lastCountdownValue = "";
    authorityClockOffset = 0;
    authorityClockSessionId = "";
    hasAuthorityClock = false;
    lastStatusAnnouncementKey = "";
    ensureGameBgm();
    ensureDeathSfx();
    if (!bindDom()) throw new Error("땅따먹기 화면을 찾을 수 없습니다.");
    resizeCanvases();
    startLoops();
    syncHostEligibility();
    render();
  }

  function leave() {
    if (api && api.syncHostInputs) api.syncHostInputs([]);
    clearPendingInput();
    desiredInputAngle = null;
    stopGameBgm(true);
    if (deathSfxEl) {
      try { deathSfxEl.pause(); deathSfxEl.currentTime = 0; } catch (error) {}
    }
    lastGameBgmMatchId = "";
    playedDeathCues = Object.create(null);
    roomOverflowNotified = Object.create(null);
    spectatorFocusNick = "";
    lastChatScope = "";
    lastScoreboardSignature = "";
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
    collisionTrails = Object.create(null);
    captureParticles = [];
    pressedKeys = Object.create(null);
    syncReplyAtByNick = Object.create(null);
    inputSessionByNick = Object.create(null);
    transportSeqBySession = Object.create(null);
    helloPending = false;
    wantedOwnerRev = 0;
    ownerSyncMissingSince = 0;
    authoritativeHost = "";
    authorityYielded = false;
    needsAuthoritySync = false;
    lastFullSentAt = 0;
    lastAuthoritativeAt = 0;
    lastPredictionAt = 0;
    lastCountdownValue = "";
    authorityClockOffset = 0;
    authorityClockSessionId = "";
    hasAuthorityClock = false;
    lastStatusAnnouncementKey = "";
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
      isPlayableCell: isPlayableCell,
      clearBoundaryOwnerCells: clearBoundaryOwnerCells,
      fillArenaOutside: fillArenaOutside,
      rankRows: rankRows,
      pruneDisconnectedTerritories: pruneDisconnectedTerritories,
      sampleStolenCells: sampleStolenCells,
      queueCaptureParticles: queueCaptureParticles,
      clearCaptureParticles: function () { captureParticles = []; },
      getCaptureParticles: function () { return captureParticles.slice(); },
      sanitizeState: sanitizeState,
      sanitizePlayers: sanitizePlayers,
      makePlayer: makePlayer,
      allocateInitialSpawns: allocateInitialSpawns,
      findRespawnSpot: findRespawnSpot,
      findEmergencyRespawnSpot: findEmergencyRespawnSpot,
      findOwnedRespawnSpot: findOwnedRespawnSpot,
      hasPlayerTerritory: hasPlayerTerritory,
      resolveRespawnPlacement: resolveRespawnPlacement,
      applyPlayerSpawn: applyPlayerSpawn,
      createBase: createBase,
      respawn: respawn,
      activateReturningPlayer: activateReturningPlayer,
      retryReturningPlayers: retryReturningPlayers,
      applyDirection: applyDirection,
      advancePlayer: advancePlayer,
      advancePlayers: advancePlayers,
      crossedCellKeys: crossedCellKeys,
      segmentDistanceSquared: segmentDistanceSquared,
      trailWithoutHead: trailWithoutHead,
      movementHitsTrail: movementHitsTrail,
      simplifyTrailPoints: simplifyTrailPoints,
      appendVisualTrailPoint: appendVisualTrailPoint,
      syncVisualTrail: syncVisualTrail,
      syncCollisionTrail: syncCollisionTrail,
      collisionTrailPoints: collisionTrailPoints,
      rebuiltVisualTrailPoints: rebuiltVisualTrailPoints,
      visibleTrailPoints: visibleTrailPoints,
      sanitizeVisualTrail: sanitizeVisualTrail,
      encodeVisualTrail: encodeVisualTrail,
      decodeVisualTrail: decodeVisualTrail,
      predictedPlayerPose: predictedPlayerPose,
      visualPositionBlend: visualPositionBlend,
      frameIntervalMs: frameIntervalMs,
      gameNow: gameNow,
      syncAuthorityClock: syncAuthorityClock,
      authoritativeTimelineAt: authoritativeTimelineAt,
      normalizeAngle: normalizeAngle,
      angleDelta: angleDelta,
      reverseDirection: reverseDirection,
      hostStart: hostStart,
      hostTick: hostTick,
      hostSetReady: hostSetReady,
      hostSetSpectator: hostSetSpectator,
      cameraFocusPlayer: cameraFocusPlayer,
      selectSpectatorFocus: selectSpectatorFocus,
      eliminate: eliminate,
      syncAudio: syncAudio,
      playDeathSfx: playDeathSfx,
      broadcastFull: broadcastFull,
      applyFull: applyFull,
      applyFrame: applyFrame,
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
      getTrailOwner: function () { return trailOwner; },
      getBroadcastTimes: function () { return { frame: lastFrameSentAt, full: lastFullSentAt }; },
      setBroadcastTimes: function (frame, full) {
        lastFrameSentAt = Number(frame) || 0;
        lastFullSentAt = Number(full) || 0;
      },
      resetGrid: resetGrid,
      constants: {
        width: WORLD_W,
        height: WORLD_H,
        cells: CELL_COUNT,
        playableCells: PLAYABLE_CELL_COUNT,
        matchMs: MATCH_MS,
        stepMs: STEP_MS,
        frameMs: FRAME_MS,
        minFrameMs: MIN_FRAME_MS,
        predictionMaxMs: PREDICTION_MAX_MS,
        visualCatchupSpeedMultiplier: VISUAL_CATCHUP_SPEED_MULTIPLIER,
        fullMinMs: FULL_MIN_MS,
        inputSendMs: INPUT_SEND_MS,
        speed: SPEED,
        arenaInset: ARENA_INSET,
        trailWidth: TRAIL_WIDTH,
        trailCollisionRadius: TRAIL_COLLISION_RADIUS,
        trailHeadGrace: TRAIL_HEAD_GRACE,
        trailSampleTolerance: TRAIL_SAMPLE_TOLERANCE,
        maxVisualTrailPoints: MAX_VISUAL_TRAIL_POINTS,
        visualTrailScale: VISUAL_TRAIL_SCALE,
        maxCaptureParticles: MAX_CAPTURE_PARTICLES,
        maxCaptureBursts: MAX_CAPTURE_BURSTS,
        captureParticlesPerBurst: CAPTURE_PARTICLES_PER_BURST,
        maxPlayers: MAX_PLAYERS,
        maxRoomMembers: MAX_ROOM_MEMBERS,
        maxTrail: MAX_TRAIL,
        baseRadius: BASE_RADIUS,
        spawnClearance: SPAWN_CLEARANCE,
        preservedSpawnClearance: PRESERVED_SPAWN_CLEARANCE,
        spawnMargin: SPAWN_MARGIN,
        initialSpawnMinDistance: INITIAL_SPAWN_MIN_DISTANCE,
        respawnPlayerDistance: RESPAWN_PLAYER_DISTANCE,
        gameBgmSrc: GAME_BGM_SRC,
        gameBgmVolume: GAME_BGM_VOLUME,
        deathSfxSrc: DEATH_SFX_SRC,
        deathSfxVolume: DEATH_SFX_VOLUME
      }
    };
  }

  return controller;
})();
