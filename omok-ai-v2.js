(function (global) {
  "use strict";

  var legacy = global.OmokAI;
  var Renju = global.Renju;
  if (!legacy || !Renju) return;

  var SIZE = Renju.SIZE;
  var CELLS = SIZE * SIZE;
  var BLACK = Renju.BLACK;
  var WHITE = Renju.WHITE;
  var MATE = 100000000;
  var OPEN_FOUR = 1000000;
  var FOUR = 120000;
  var OPEN_THREE = 15000;
  var BROKEN_THREE = 3200;
  var INF = 1000000000;
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  var SIDE_HASH_1 = [0, 0x6a09e667, 0xbb67ae85];
  var SIDE_HASH_2 = [0, 0x3c6ef372, 0xa54ff53a];
  var POW3 = [1];
  var PATTERN_CACHE = new Array(19683);
  var NEIGHBORS = new Array(CELLS);
  var ZOBRIST_1 = new Array(CELLS);
  var ZOBRIST_2 = new Array(CELLS);
  var lastStats = null;

  for (var p3 = 1; p3 < 9; p3++) POW3[p3] = POW3[p3 - 1] * 3;

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function other(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  function xorshift(seed) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed | 0;
  }

  (function initTables() {
    var seed = 0x1f123bb5;
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var idx = r * SIZE + c;
        var near = [];
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            if (dr === 0 && dc === 0) continue;
            var rr = r + dr, cc = c + dc;
            if (inBounds(rr, cc)) near.push(rr * SIZE + cc);
          }
        }
        NEIGHBORS[idx] = near;
        seed = xorshift(seed); var a = seed >>> 0;
        seed = xorshift(seed); var b = seed >>> 0;
        seed = xorshift(seed); var d = seed >>> 0;
        seed = xorshift(seed); var e = seed >>> 0;
        ZOBRIST_1[idx] = [0, a || 1, b || 2];
        ZOBRIST_2[idx] = [0, d || 3, e || 4];
      }
    }
  })();

  function hasFiveIncluding(line, extraA, extraB) {
    for (var start = 0; start <= 4; start++) {
      if (extraA != null && (extraA < start || extraA >= start + 5)) continue;
      if (extraB != null && (extraB < start || extraB >= start + 5)) continue;
      var ok = true;
      for (var i = start; i < start + 5; i++) {
        if (line[i] !== 1) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  function winningPointCount(line, required) {
    var count = 0;
    for (var i = 0; i < 9; i++) {
      if (line[i] !== 0) continue;
      line[i] = 1;
      if (hasFiveIncluding(line, required, i)) count++;
      line[i] = 0;
    }
    return count;
  }

  function decodePattern(code) {
    var line = new Array(9);
    for (var i = 0; i < 9; i++) {
      line[i] = code % 3;
      code = Math.floor(code / 3);
    }
    return line;
  }

  function patternInfo(code) {
    var cached = PATTERN_CACHE[code];
    if (cached) return cached;

    var line = decodePattern(code);
    if (line[4] !== 1) {
      cached = { score: 0, win: false, four: false, openFour: false, openThree: false };
      PATTERN_CACHE[code] = cached;
      return cached;
    }
    if (hasFiveIncluding(line, null, null)) {
      cached = { score: MATE, win: true, four: true, openFour: true, openThree: false };
      PATTERN_CACHE[code] = cached;
      return cached;
    }

    var wins = winningPointCount(line, null);
    if (wins >= 2) {
      cached = { score: OPEN_FOUR, win: false, four: true, openFour: true, openThree: false };
      PATTERN_CACHE[code] = cached;
      return cached;
    }
    if (wins === 1) {
      cached = { score: FOUR, win: false, four: true, openFour: false, openThree: false };
      PATTERN_CACHE[code] = cached;
      return cached;
    }

    var openFourCreators = 0, fourCreators = 0;
    for (var j = 0; j < 9; j++) {
      if (line[j] !== 0) continue;
      line[j] = 1;
      var nextWins = winningPointCount(line, j);
      line[j] = 0;
      if (nextWins >= 2) openFourCreators++;
      else if (nextWins === 1) fourCreators++;
    }
    if (openFourCreators) {
      cached = {
        score: OPEN_THREE + Math.min(openFourCreators, 2) * 1200,
        win: false, four: false, openFour: false, openThree: true
      };
      PATTERN_CACHE[code] = cached;
      return cached;
    }
    if (fourCreators) {
      cached = {
        score: BROKEN_THREE + Math.min(fourCreators, 3) * 240,
        win: false, four: false, openFour: false, openThree: false
      };
      PATTERN_CACHE[code] = cached;
      return cached;
    }

    var best = 1;
    for (var st = 0; st <= 4; st++) {
      var stones = 0, blocked = false;
      for (var k = st; k < st + 5; k++) {
        if (line[k] === 2) { blocked = true; break; }
        if (line[k] === 1) stones++;
      }
      if (!blocked && stones > best) best = stones;
    }
    cached = {
      score: best >= 3 ? 900 : (best === 2 ? 140 : 12),
      win: false, four: false, openFour: false, openThree: false
    };
    PATTERN_CACHE[code] = cached;
    return cached;
  }

  function createState(board0) {
    var board = new Array(SIZE);
    var cells = new Uint8Array(CELLS);
    var frontier = new Uint8Array(CELLS);
    var hash1 = 0, hash2 = 0, stones = 0;
    var r, c, idx, color, n, near;

    for (r = 0; r < SIZE; r++) {
      board[r] = board0[r].slice();
      for (c = 0; c < SIZE; c++) {
        idx = r * SIZE + c;
        color = board[r][c] || 0;
        cells[idx] = color;
        if (color) {
          stones++;
          hash1 ^= ZOBRIST_1[idx][color];
          hash2 ^= ZOBRIST_2[idx][color];
        }
      }
    }
    for (idx = 0; idx < CELLS; idx++) {
      if (!cells[idx]) continue;
      near = NEIGHBORS[idx];
      for (n = 0; n < near.length; n++) frontier[near[n]]++;
    }
    return {
      board: board, cells: cells, frontier: frontier,
      hash1: hash1 >>> 0, hash2: hash2 >>> 0, stones: stones
    };
  }

  function makeMove(state, idx, color) {
    var r = Math.floor(idx / SIZE), c = idx % SIZE;
    state.cells[idx] = color;
    state.board[r][c] = color;
    state.hash1 = (state.hash1 ^ ZOBRIST_1[idx][color]) >>> 0;
    state.hash2 = (state.hash2 ^ ZOBRIST_2[idx][color]) >>> 0;
    state.stones++;
    var near = NEIGHBORS[idx];
    for (var i = 0; i < near.length; i++) state.frontier[near[i]]++;
  }

  function undoMove(state, idx, color) {
    var r = Math.floor(idx / SIZE), c = idx % SIZE;
    var near = NEIGHBORS[idx];
    for (var i = 0; i < near.length; i++) state.frontier[near[i]]--;
    state.stones--;
    state.hash1 = (state.hash1 ^ ZOBRIST_1[idx][color]) >>> 0;
    state.hash2 = (state.hash2 ^ ZOBRIST_2[idx][color]) >>> 0;
    state.cells[idx] = 0;
    state.board[r][c] = 0;
  }

  function candidateIndexes(state) {
    if (!state.stones) return [Math.floor(CELLS / 2)];
    var out = [];
    for (var idx = 0; idx < CELLS; idx++) {
      if (!state.cells[idx] && state.frontier[idx]) out.push(idx);
    }
    return out;
  }

  function lineCode(state, idx, color, dr, dc) {
    var r = Math.floor(idx / SIZE), c = idx % SIZE, code = 0;
    for (var offset = -4; offset <= 4; offset++) {
      var v, rr = r + dr * offset, cc = c + dc * offset;
      if (offset === 0) v = 1;
      else if (!inBounds(rr, cc)) v = 2;
      else {
        var cell = state.board[rr][cc];
        v = cell === 0 ? 0 : (cell === color ? 1 : 2);
      }
      code += v * POW3[offset + 4];
    }
    return code;
  }

  function moveProfile(state, idx, color, ctx) {
    if (state.cells[idx]) return { legal: false, win: false, score: -INF, fours: 0, openFours: 0, openThrees: 0 };

    var r = Math.floor(idx / SIZE), c = idx % SIZE;
    var rule = null;
    if (color === BLACK) {
      ctx.ruleChecks++;
      rule = Renju.checkMove(state.board, r, c, color);
      if (!rule.legal) return { legal: false, win: false, score: -INF, fours: 0, openFours: 0, openThrees: 0 };
      if (rule.win) return { legal: true, win: true, score: MATE, fours: 1, openFours: 1, openThrees: 0 };
    }

    var score = 0, fours = 0, openFours = 0, openThrees = 0, win = false;
    for (var d = 0; d < DIRS.length; d++) {
      var info = patternInfo(lineCode(state, idx, color, DIRS[d][0], DIRS[d][1]));
      score += info.score;
      if (info.win) win = true;
      if (info.four) fours++;
      if (info.openFour) openFours++;
      if (info.openThree) openThrees++;
    }
    if (win) return { legal: true, win: true, score: MATE, fours: fours, openFours: openFours, openThrees: openThrees };
    if (fours >= 2) score += OPEN_FOUR * 2;
    else if (fours && openThrees) score += OPEN_FOUR / 2;
    if (openThrees >= 2) score += OPEN_THREE * 3;
    if (score >= MATE) score = MATE - 1000;
    return {
      legal: true, win: false, score: score,
      fours: fours, openFours: openFours, openThrees: openThrees
    };
  }

  function positionKey(state, side) {
    return (state.hash1 ^ SIDE_HASH_1[side]) >>> 0;
  }

  function positionLock(state, side) {
    return (state.hash2 ^ SIDE_HASH_2[side]) >>> 0;
  }

  function analyzePosition(state, side, ctx) {
    var key = positionKey(state, side), lock = positionLock(state, side);
    var cached = ctx.moveCache.get(key);
    if (cached && cached.lock === lock) {
      ctx.moveCacheHits++;
      return cached.info;
    }

    var opponent = other(side);
    var indexes = candidateIndexes(state);
    var moves = [], myWins = [], oppWins = [], mineThreats = [], oppThreats = [];
    for (var i = 0; i < indexes.length; i++) {
      var idx = indexes[i];
      var mine = moveProfile(state, idx, side, ctx);
      var theirs = moveProfile(state, idx, opponent, ctx);
      if (mine.legal) mineThreats.push(mine);
      if (theirs.legal) oppThreats.push(theirs);
      if (theirs.legal && theirs.win) oppWins.push(idx);
      if (!mine.legal) continue;

      var r = Math.floor(idx / SIZE), c = idx % SIZE;
      var center = 14 - (Math.abs(r - 7) + Math.abs(c - 7));
      var priority = mine.score * 1.16 + (theirs.legal ? theirs.score * 1.08 : 0) + center;
      var item = { idx: idx, mine: mine, theirs: theirs, priority: priority };
      moves.push(item);
      if (mine.win) myWins.push(item);
    }
    moves.sort(function (a, b) { return b.priority - a.priority || a.idx - b.idx; });
    myWins.sort(function (a, b) { return b.priority - a.priority || a.idx - b.idx; });
    var info = {
      moves: moves, myWins: myWins, oppWins: oppWins,
      mineThreats: mineThreats, oppThreats: oppThreats
    };
    if (ctx.moveCache.size < 12000) ctx.moveCache.set(key, { lock: lock, info: info });
    return info;
  }

  function threatAggregate(profiles) {
    var top = [0, 0, 0, 0], fours = 0, threes = 0, pressure = 0;
    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i], value = p.win ? OPEN_FOUR * 2 : p.score;
      if (p.fours) fours++;
      if (p.openThrees) threes += p.openThrees;
      if (value >= 140) pressure += Math.min(value, OPEN_THREE);
      for (var k = 0; k < top.length; k++) {
        if (value > top[k]) {
          for (var j = top.length - 1; j > k; j--) top[j] = top[j - 1];
          top[k] = value;
          break;
        }
      }
    }
    return top[0] + top[1] * 0.48 + top[2] * 0.22 + top[3] * 0.1
      + pressure * 0.025 + fours * 9000 + threes * 900;
  }

  function staticEval(info) {
    var value = threatAggregate(info.mineThreats) - threatAggregate(info.oppThreats) * 1.1 + 24;
    if (value > MATE / 2) value = MATE / 2;
    if (value < -MATE / 2) value = -MATE / 2;
    return value;
  }

  function orderedMoves(info, ttBest, limit) {
    var moves;
    if (info.myWins.length) moves = info.myWins.slice();
    else if (info.oppWins.length === 1) {
      moves = info.moves.filter(function (m) { return m.idx === info.oppWins[0]; });
    } else {
      moves = info.moves.slice();
    }
    if (ttBest != null) {
      for (var t = 0; t < moves.length; t++) {
        if (moves[t].idx === ttBest) {
          var first = moves.splice(t, 1)[0];
          moves.unshift(first);
          break;
        }
      }
    }
    if (!limit || moves.length <= limit) return moves;

    var selected = moves.slice(0, limit);
    for (var i = limit; i < moves.length && selected.length < limit + 4; i++) {
      var item = moves[i];
      if (item.mine.fours || item.mine.openThrees || (item.theirs && (item.theirs.fours || item.theirs.openThrees))) {
        selected.push(item);
      }
    }
    return selected;
  }

  function quiescence(state, side, alpha, beta, ply, depth, ctx) {
    ctx.qnodes++;
    var info = analyzePosition(state, side, ctx);
    if (info.myWins.length) return MATE - ply;
    if (info.oppWins.length >= 2) return -MATE + ply;

    var stand = staticEval(info);
    if (depth <= 0) return stand;

    var moves;
    if (info.oppWins.length === 1) {
      moves = orderedMoves(info, null, 1);
      if (!moves.length) return -MATE + ply;
    } else {
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      moves = info.moves.filter(function (m) {
        return m.mine.fours || m.mine.openFours || m.mine.openThrees >= 2;
      }).slice(0, 6);
      if (!moves.length) return stand;
    }

    var best = info.oppWins.length === 1 ? -INF : stand;
    for (var i = 0; i < moves.length; i++) {
      var item = moves[i];
      makeMove(state, item.idx, side);
      var value = -quiescence(state, other(side), -beta, -alpha, ply + 1, depth - 1, ctx);
      undoMove(state, item.idx, side);
      if (value > best) best = value;
      if (value > alpha) alpha = value;
      if (alpha >= beta) break;
    }
    return best;
  }

  function search(state, side, depth, alpha, beta, ply, extensionsLeft, ctx) {
    ctx.nodes++;
    if (depth <= 0) return quiescence(state, side, alpha, beta, ply, 6, ctx);

    var key = positionKey(state, side), lock = positionLock(state, side);
    var alphaStart = alpha;
    var entry = ctx.tt.get(key), ttBest = null;
    if (entry && entry.lock === lock) {
      ttBest = entry.best;
      if (entry.depth >= depth) {
        ctx.ttHits++;
        if (entry.flag === 0) return entry.value;
        if (entry.flag === 1 && entry.value > alpha) alpha = entry.value;
        else if (entry.flag === 2 && entry.value < beta) beta = entry.value;
        if (alpha >= beta) return entry.value;
      }
    }

    var info = analyzePosition(state, side, ctx);
    if (info.myWins.length) return MATE - ply;
    if (info.oppWins.length >= 2) return -MATE + ply;

    var limit = depth >= 5 ? 9 : (depth >= 3 ? 8 : 7);
    var moves = orderedMoves(info, ttBest, limit);
    if (!moves.length) return info.oppWins.length ? -MATE + ply : 0;

    var best = -INF, bestMove = moves[0].idx;
    for (var i = 0; i < moves.length; i++) {
      var item = moves[i];
      var extend = depth <= 2 && extensionsLeft > 0 && item.mine.openThrees > 0 ? 1 : 0;
      makeMove(state, item.idx, side);
      var nextDepth = depth - 1 + extend;
      var value;
      if (i === 0) {
        value = -search(state, other(side), nextDepth, -beta, -alpha, ply + 1, extensionsLeft - extend, ctx);
      } else {
        value = -search(state, other(side), nextDepth, -alpha - 1, -alpha, ply + 1, extensionsLeft - extend, ctx);
        if (value > alpha && value < beta) {
          value = -search(state, other(side), nextDepth, -beta, -alpha, ply + 1, extensionsLeft - extend, ctx);
        }
      }
      undoMove(state, item.idx, side);
      if (value > best) { best = value; bestMove = item.idx; }
      if (value > alpha) alpha = value;
      if (alpha >= beta) break;
    }

    if (ctx.tt.size < 120000) {
      var flag = best <= alphaStart ? 2 : (best >= beta ? 1 : 0);
      ctx.tt.set(key, { lock: lock, depth: depth, value: best, flag: flag, best: bestMove });
    }
    return best;
  }

  function rootSearch(state, side, depth, previousBest, ctx) {
    var info = analyzePosition(state, side, ctx);
    if (!info.moves.length) return { idx: null, score: 0 };
    if (info.myWins.length) return { idx: info.myWins[0].idx, score: MATE };

    var moves;
    if (info.oppWins.length >= 2) {
      var losses = {};
      for (var w = 0; w < info.oppWins.length; w++) losses[info.oppWins[w]] = 1;
      moves = info.moves.filter(function (m) { return losses[m.idx]; });
      if (!moves.length) moves = orderedMoves(info, previousBest, 14);
    } else {
      moves = orderedMoves(info, previousBest, 14);
    }
    if (!moves.length) return { idx: info.moves[0].idx, score: -MATE };

    var alpha = -INF, beta = INF, best = -INF, bestIdx = moves[0].idx;
    for (var i = 0; i < moves.length; i++) {
      var item = moves[i];
      var extend = depth <= 2 && item.mine.openThrees > 0 ? 1 : 0;
      makeMove(state, item.idx, side);
      var value;
      if (i === 0) {
        value = -search(state, other(side), depth - 1 + extend, -beta, -alpha, 1, 2 - extend, ctx);
      } else {
        value = -search(state, other(side), depth - 1 + extend, -alpha - 1, -alpha, 1, 2 - extend, ctx);
        if (value > alpha && value < beta) {
          value = -search(state, other(side), depth - 1 + extend, -beta, -alpha, 1, 2 - extend, ctx);
        }
      }
      undoMove(state, item.idx, side);
      if (value > best) { best = value; bestIdx = item.idx; }
      if (value > alpha) alpha = value;
    }
    return { idx: bestIdx, score: best };
  }

  function depthSchedule(maxDepth) {
    var depths = [];
    for (var d = 2; d <= maxDepth; d += 2) depths.push(d);
    if (!depths.length || depths[depths.length - 1] !== maxDepth) depths.push(maxDepth);
    return depths;
  }

  function bestMoveMaster(board, color, options) {
    options = options || {};
    var started = Date.now();
    var state = createState(board);
    var ctx = {
      tt: new Map(), moveCache: new Map(), nodes: 0, qnodes: 0,
      ttHits: 0, moveCacheHits: 0, ruleChecks: 0
    };
    if (!state.stones) {
      lastStats = { depth: 0, score: 0, nodes: 0, qnodes: 0, ttHits: 0, moveCacheHits: 0, ruleChecks: 0, elapsedMs: Date.now() - started };
      return [7, 7];
    }

    var maxDepth = Math.max(2, Math.min(10, Number(options.maxDepth) || 6));
    var softTimeMs = Number(options.softTimeMs) > 0 ? Number(options.softTimeMs) : 0;
    var schedule = depthSchedule(maxDepth);
    var best = null, completedDepth = 0, previousIterMs = 0, olderIterMs = 0;

    for (var i = 0; i < schedule.length; i++) {
      var depth = schedule[i];
      if (best && softTimeMs) {
        var elapsed = Date.now() - started;
        var growth = olderIterMs > 0 ? previousIterMs / olderIterMs : 6;
        growth = Math.max(3, Math.min(12, growth * 1.35));
        if (elapsed + Math.max(20, previousIterMs * growth) >= softTimeMs) break;
      }

      var iterStarted = Date.now();
      var result = rootSearch(state, color, depth, best ? best.idx : null, ctx);
      olderIterMs = previousIterMs;
      previousIterMs = Math.max(1, Date.now() - iterStarted);
      if (result.idx != null) best = result;
      completedDepth = depth;
      if (result.score >= MATE - 100 || result.score <= -MATE + 100) break;
    }

    if (!best) {
      var fallback = analyzePosition(state, color, ctx);
      if (!fallback.moves.length) return null;
      best = { idx: fallback.moves[0].idx, score: 0 };
    }
    lastStats = {
      depth: completedDepth, score: best.score, nodes: ctx.nodes, qnodes: ctx.qnodes,
      ttHits: ctx.ttHits, moveCacheHits: ctx.moveCacheHits, ruleChecks: ctx.ruleChecks,
      elapsedMs: Date.now() - started
    };
    return [Math.floor(best.idx / SIZE), best.idx % SIZE];
  }

  var legacyBestMove = legacy.bestMove;
  var promotedLegacyLevel = {
    easy: "medium",
    medium: "hard",
    hard: "master"
  };
  global.OmokAI = {
    version: "2.1",
    bestMove: function (board, color, level, options) {
      if (level !== "master") {
        lastStats = null;
        return legacyBestMove(board, color, promotedLegacyLevel[level] || "medium");
      }
      return bestMoveMaster(board, color, options);
    },
    bestMoveLegacy: function (board, color, level) {
      return legacyBestMove(board, color, level);
    },
    getLastStats: function () {
      if (!lastStats) return null;
      var copy = {};
      for (var key in lastStats) if (lastStats.hasOwnProperty(key)) copy[key] = lastStats[key];
      return copy;
    }
  };
})(typeof window !== "undefined" ? window : this);
