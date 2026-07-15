window.OmokAI = (function () {
  "use strict";
  var SIZE = 15, BLACK = 1, WHITE = 2, WIN = 100000, OPEN4 = 20000;
  var FOUR = 4500, OPEN3 = 1800, BROKEN3 = 450;
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  function inb(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  function lineInfo(board, r, c, dr, dc, color) {
    var cnt = 1, open = 0, i;
    i = 1;
    while (true) { var rr = r + dr * i, cc = c + dc * i; if (!inb(rr, cc)) break; if (board[rr][cc] === color) { cnt++; i++; } else { if (board[rr][cc] === 0) open++; break; } }
    i = 1;
    while (true) { var r2 = r - dr * i, c2 = c - dc * i; if (!inb(r2, c2)) break; if (board[r2][c2] === color) { cnt++; i++; } else { if (board[r2][c2] === 0) open++; break; } }
    return { cnt: cnt, open: open };
  }
  function patternScore(cnt, open) {
    if (cnt >= 5) return WIN;
    if (open === 0) return 0;
    if (cnt === 4) return open === 2 ? OPEN4 : 3000;
    if (cnt === 3) return open === 2 ? 1500 : 200;
    if (cnt === 2) return open === 2 ? 150 : 30;
    return open === 2 ? 12 : 3;
  }
  function lineCells(board, r, c, dr, dc, color) {
    var arr = [];
    for (var i = -4; i <= 4; i++) {
      var rr = r + dr * i, cc = c + dc * i;
      if (i === 0) arr.push(1);
      else if (!inb(rr, cc)) arr.push(3);
      else if (board[rr][cc] === 0) arr.push(0);
      else arr.push(board[rr][cc] === color ? 1 : 3);
    }
    return arr;
  }
  function windowInfo(arr, st, len) {
    var mine = 0, empty = 0;
    for (var i = st; i < st + len; i++) {
      if (arr[i] === 3) return null;
      if (arr[i] === 1) mine++;
      else empty++;
    }
    return { mine: mine, empty: empty };
  }
  function lineThreat(board, r, c, dr, dc, color) {
    var arr = lineCells(board, r, c, dr, dc, color);
    var wins = {}, broken3 = 0, open3 = 0;
    for (var st = 0; st <= 4; st++) {
      if (!(st <= 4 && 4 < st + 5)) continue;
      var w = windowInfo(arr, st, 5);
      if (!w) continue;
      if (w.mine >= 5) return { score: WIN, four: true, openFour: true, openThree: false };
      if (w.mine === 4 && w.empty === 1) {
        for (var i = st; i < st + 5; i++) if (arr[i] === 0) wins[i] = 1;
      } else if (w.mine === 3 && w.empty === 2) {
        broken3 = 1;
      }
    }
    for (var st6 = 0; st6 <= 3; st6++) {
      if (!(st6 <= 4 && 4 < st6 + 6)) continue;
      if (arr[st6] !== 0 || arr[st6 + 5] !== 0) continue;
      var w6 = windowInfo(arr, st6, 6);
      if (w6 && w6.mine === 3 && w6.empty === 3) open3 = 1;
    }
    var winPts = 0;
    for (var k in wins) if (wins.hasOwnProperty(k)) winPts++;
    if (winPts >= 2) return { score: OPEN4 + 5000, four: true, openFour: true, openThree: !!open3 };
    if (winPts === 1) return { score: FOUR, four: true, openFour: false, openThree: !!open3 };
    if (open3) return { score: OPEN3, four: false, openFour: false, openThree: true };
    if (broken3) return { score: BROKEN3, four: false, openFour: false, openThree: false };
    return { score: 0, four: false, openFour: false, openThree: false };
  }
  function evalPlace(board, r, c, color) {
    var s = 0, fours = 0, openThrees = 0, win = false;
    for (var d = 0; d < 4; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      var info = lineInfo(board, r, c, dr, dc, color);
      var base = patternScore(info.cnt, info.open);
      var th = lineThreat(board, r, c, dr, dc, color);
      if (base >= WIN || th.score >= WIN) win = true;
      if (th.four || base >= 3000) fours++;
      if (th.openThree || (info.cnt === 3 && info.open === 2)) openThrees++;
      s += Math.max(base, th.score);
    }
    if (win) return WIN;
    if (fours >= 2) s += 30000;
    else if (fours && openThrees) s += 12000;
    if (openThrees >= 2) s += 9000;
    return Math.min(s, WIN - 1);
  }
  function candidates(board) {
    var seen = {}, list = [], any = false;
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
      if (board[r][c]) {
        any = true;
        for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
          var rr = r + dr, cc = c + dc;
          if (inb(rr, cc) && board[rr][cc] === 0) { var k = rr * SIZE + cc; if (!seen[k]) { seen[k] = 1; list.push([rr, cc]); } }
        }
      }
    }
    if (!any) list.push([7, 7]);
    return list;
  }
  function legal(board, r, c, color) {
    if (window.Renju && Renju.checkMove) { return Renju.checkMove(board, r, c, color).legal; }
    return board[r][c] === 0;
  }
  function oppBestReply(board, opp) {
    var cs = candidates(board), best = 0;
    for (var i = 0; i < cs.length; i++) {
      if (board[cs[i][0]][cs[i][1]] !== 0) continue;
      var v = evalPlace(board, cs[i][0], cs[i][1], opp);
      if (v > best) best = v;
    }
    return best;
  }

  var MASTER_DEPTH = 5, FORCE_DEPTH = 7;
  function cloneBoard(board) { var b = []; for (var r = 0; r < SIZE; r++) b.push(board[r].slice()); return b; }
  function other(color) { return color === BLACK ? WHITE : BLACK; }
  function checkWin(board, r, c, color) {
    if (window.Renju && Renju.checkMove) return Renju.checkMove(board, r, c, color).win;
    return evalPlace(board, r, c, color) >= WIN;
  }
  function immediateWins(board, color) {
    var cs = candidates(board), out = [];
    for (var i = 0; i < cs.length; i++) {
      var p = cs[i];
      if (board[p[0]][p[1]] !== 0 || !legal(board, p[0], p[1], color)) continue;
      if (evalPlace(board, p[0], p[1], color) >= WIN) out.push(p);
    }
    return out;
  }
  function forcingMoves(board, color, cap) {
    var opp = other(color), cs = candidates(board), mv = [];
    for (var i = 0; i < cs.length; i++) {
      var p = cs[i];
      if (board[p[0]][p[1]] !== 0 || !legal(board, p[0], p[1], color)) continue;
      var off = evalPlace(board, p[0], p[1], color);
      if (off < FOUR) continue;
      mv.push({ p: p, k: off + evalPlace(board, p[0], p[1], opp) * 0.35 });
    }
    mv.sort(function (a, b) { return b.k - a.k; });
    return mv.slice(0, cap || 16);
  }
  function canForceWin(board, color, depth) {
    var opp = other(color), wins = immediateWins(board, color);
    if (wins.length) return true;
    if (depth <= 0) return false;
    if (immediateWins(board, opp).length) return false;
    var mv = forcingMoves(board, color, 16);
    for (var i = 0; i < mv.length; i++) {
      var p = mv[i].p;
      board[p[0]][p[1]] = color;
      var ok = checkWin(board, p[0], p[1], color) || attackStillForces(board, color, depth);
      board[p[0]][p[1]] = 0;
      if (ok) return true;
    }
    return false;
  }
  function attackStillForces(board, color, depth) {
    var opp = other(color);
    if (immediateWins(board, opp).length) return false;
    var threats = immediateWins(board, color);
    if (threats.length >= 2) return true;
    if (threats.length !== 1 || depth <= 0) return false;
    var b = threats[0];
    if (!legal(board, b[0], b[1], opp)) return true;
    board[b[0]][b[1]] = opp;
    var ok = !checkWin(board, b[0], b[1], opp) && canForceWin(board, color, depth - 1);
    board[b[0]][b[1]] = 0;
    return ok;
  }
  function findForcingWin(board, color) {
    var mv = forcingMoves(board, color, 18);
    for (var i = 0; i < mv.length; i++) {
      var p = mv[i].p;
      board[p[0]][p[1]] = color;
      var ok = !opponentKillReply(board, color) &&
        (checkWin(board, p[0], p[1], color) || attackStillForces(board, color, FORCE_DEPTH));
      board[p[0]][p[1]] = 0;
      if (ok) return p;
    }
    return null;
  }
  function findForceDefense(board, color) {
    var opp = other(color);
    if (!canForceWin(board, opp, FORCE_DEPTH)) return null;
    var mv = orderedMoves(board, color, opp, 14), best = null, bestScore = -1e18;
    for (var i = 0; i < mv.length; i++) {
      var p = mv[i].p;
      board[p[0]][p[1]] = color;
      var safe = !checkWin(board, p[0], p[1], color) && !canForceWin(board, opp, FORCE_DEPTH);
      var score = evalPlace(board, p[0], p[1], color) + evalPlace(board, p[0], p[1], opp);
      board[p[0]][p[1]] = 0;
      if (safe && score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }
  function addUniqueMoves(dst, src) {
    var seen = {};
    for (var i = 0; i < dst.length; i++) seen[dst[i].p[0] + "," + dst[i].p[1]] = 1;
    for (var j = 0; j < src.length; j++) {
      var k = src[j].p[0] + "," + src[j].p[1];
      if (!seen[k]) { seen[k] = 1; dst.push(src[j]); }
    }
    return dst;
  }
  function opponentKillReply(board, color) {
    var opp = other(color);
    if (immediateWins(board, opp).length) return true;
    var cs = candidates(board);
    for (var i = 0; i < cs.length; i++) {
      var p = cs[i];
      if (board[p[0]][p[1]] !== 0 || !legal(board, p[0], p[1], opp)) continue;
      board[p[0]][p[1]] = opp;
      var bad = checkWin(board, p[0], p[1], opp) ||
        (immediateWins(board, color).length === 0 && immediateWins(board, opp).length >= 2);
      board[p[0]][p[1]] = 0;
      if (bad) return true;
    }
    return false;
  }
  function safetyMoves(board, color, opp, cap) {
    var cs = candidates(board), mv = [];
    for (var i = 0; i < cs.length; i++) {
      var p = cs[i];
      if (board[p[0]][p[1]] !== 0 || !legal(board, p[0], p[1], color)) continue;
      var off = evalPlace(board, p[0], p[1], color);
      var def = evalPlace(board, p[0], p[1], opp);
      board[p[0]][p[1]] = color;
      var safe = !opponentKillReply(board, color);
      board[p[0]][p[1]] = 0;
      if (safe) mv.push({ p: p, k: off + def * 1.4 });
    }
    mv.sort(function (a, b) { return b.k - a.k; });
    return mv.slice(0, cap || 8);
  }
  function staticEval(board, side, opp) {
    var sideWins = immediateWins(board, side).length;
    var oppWins = immediateWins(board, opp).length;
    if (sideWins >= 2) return WIN * 0.8;
    if (oppWins >= 2) return -WIN * 0.9;
    if (sideWins === 1) return WIN * 0.35;
    if (oppWins === 1) return -WIN * 0.45;
    var cs = candidates(board), mine = 0, their = 0, mine2 = 0, their2 = 0, minePressure = 0, theirPressure = 0;
    for (var i = 0; i < cs.length; i++) {
      var p = cs[i]; if (board[p[0]][p[1]] !== 0) continue;
      var a = evalPlace(board, p[0], p[1], side);
      if (a > mine) { mine2 = mine; mine = a; } else if (a > mine2) mine2 = a;
      if (a >= 150) minePressure += a;
      var b = evalPlace(board, p[0], p[1], opp);
      if (b > their) { their2 = their; their = b; } else if (b > their2) their2 = b;
      if (b >= 150) theirPressure += b;
    }
    return mine + mine2 * 0.45 + minePressure * 0.04 - their * 1.2 - their2 * 0.55 - theirPressure * 0.06;
  }
  function orderedMoves(board, side, opp, cap) {
    var cs = candidates(board), mv = [], wins = [];
    for (var i = 0; i < cs.length; i++) {
      var p = cs[i]; if (board[p[0]][p[1]] !== 0) continue; if (!legal(board, p[0], p[1], side)) continue;
      var off = evalPlace(board, p[0], p[1], side);
      var def = evalPlace(board, p[0], p[1], opp);
      var item = { p: p, k: off + def };
      if (off >= WIN) wins.push(item);
      mv.push(item);
    }
    if (wins.length) return wins.slice(0, cap);
    mv.sort(function (a, b) { return b.k - a.k; });
    return mv.slice(0, cap);
  }
  function negamax(board, side, ply, maxPly, alpha, beta) {
    var opp = side === BLACK ? WHITE : BLACK;
    var sideWins = immediateWins(board, side).length;
    var oppWins = immediateWins(board, opp).length;
    if (sideWins) return WIN - ply;
    if (oppWins >= 2) return -WIN + ply;
    var mv = orderedMoves(board, side, opp, 7);
    if (!mv.length) return 0;
    var best = -1e9;
    for (var m = 0; m < mv.length; m++) {
      var p = mv[m].p, off = evalPlace(board, p[0], p[1], side);
      board[p[0]][p[1]] = side;
      var val;
      if (off >= WIN) val = WIN - ply;
      else if (immediateWins(board, opp).length >= 2) val = -WIN + ply;
      else if (ply + 1 >= maxPly) val = staticEval(board, side, opp);
      else val = -negamax(board, opp, ply + 1, maxPly, -beta, -alpha);
      board[p[0]][p[1]] = 0;
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  function bestMoveMaster(board0, color) {
    var opp = color === BLACK ? WHITE : BLACK;
    var board = cloneBoard(board0);
    var forceWin = findForcingWin(board, color);
    if (forceWin) return forceWin;
    var forceDefense = findForceDefense(board, color);
    if (forceDefense) return forceDefense;
    var mv = orderedMoves(board, color, opp, 12), hasSafeRoot = false;
    for (var sm = 0; sm < mv.length; sm++) {
      var sp = mv[sm].p;
      board[sp[0]][sp[1]] = color;
      if (!opponentKillReply(board, color)) hasSafeRoot = true;
      board[sp[0]][sp[1]] = 0;
      if (hasSafeRoot) break;
    }
    if (!hasSafeRoot) addUniqueMoves(mv, safetyMoves(board, color, opp, 8));
    if (!mv.length) return null;
    var best = -1e18, bestP = mv[0].p;
    for (var m = 0; m < mv.length; m++) {
      var p = mv[m].p, off = evalPlace(board, p[0], p[1], color);
      board[p[0]][p[1]] = color;
      var val = (off >= WIN) ? (WIN * 2) : (opponentKillReply(board, color) ? -WIN * 2 : -negamax(board, opp, 1, MASTER_DEPTH, -1e9, 1e9));
      board[p[0]][p[1]] = 0;
      if (val > best) { best = val; bestP = p; }
    }
    return bestP;
  }

  function bestMove(board, color, level) {
    var opp = color === BLACK ? WHITE : BLACK;
    var cands = candidates(board);
    var scored = [];
    for (var i = 0; i < cands.length; i++) {
      var p = cands[i];
      if (!legal(board, p[0], p[1], color)) continue;
      scored.push({ p: p, off: evalPlace(board, p[0], p[1], color), def: evalPlace(board, p[0], p[1], opp) });
    }
    if (!scored.length) return null;

    var win = null, five = null, myOpen4 = null, oppOpen4 = null;
    for (var j = 0; j < scored.length; j++) {
      var s = scored[j];
      if (s.off >= WIN && !win) win = s;
      if (s.def >= WIN && !five) five = s;
      if (s.off >= OPEN4 && !myOpen4) myOpen4 = s;
      if (s.def >= OPEN4 && !oppOpen4) oppOpen4 = s;
    }
    if (win) return win.p;
    var miss = (level === "easy" && Math.random() < 0.25);
    if (five && !miss) return five.p;
    if (myOpen4 && level !== "master") return myOpen4.p;
    if (oppOpen4 && level === "master") {
      var block = null, blockScore = -1e18;
      for (var bo = 0; bo < scored.length; bo++) {
        var sb = scored[bo];
        if (sb.def < OPEN4) continue;
        board[sb.p[0]][sb.p[1]] = color;
        var safeBlock = !opponentKillReply(board, color) && !canForceWin(board, opp, FORCE_DEPTH);
        board[sb.p[0]][sb.p[1]] = 0;
        var bs = sb.def * 1.6 + sb.off;
        if (safeBlock && bs > blockScore) { block = sb; blockScore = bs; }
      }
      if (!block) {
        var safeBlocks = safetyMoves(board, color, opp, 8);
        if (safeBlocks.length) block = safeBlocks[0];
      }
      return block ? block.p : oppOpen4.p;
    }
    if (oppOpen4 && level !== "easy") return oppOpen4.p;
    if (oppOpen4 && level === "easy" && Math.random() < 0.6) return oppOpen4.p;

    if (level === "master") {
      var fork = null, forkScore = -1;
      for (var f = 0; f < scored.length; f++) {
        var sf = scored[f];
        if (sf.off >= 9000 && sf.off < OPEN4 && sf.off + sf.def * 0.4 > forkScore) {
          board[sf.p[0]][sf.p[1]] = color;
          var forkSafe = !opponentKillReply(board, color) && !canForceWin(board, opp, FORCE_DEPTH);
          board[sf.p[0]][sf.p[1]] = 0;
          if (forkSafe) { fork = sf; forkScore = sf.off + sf.def * 0.4; }
        }
      }
      if (fork) return fork.p;
    }

    if (level === "master") { var mm = bestMoveMaster(board, color); if (mm) return mm; }

    var defW = level === "hard" ? 1.15 : (level === "medium" ? 1.0 : 0.6);
    for (var k = 0; k < scored.length; k++) scored[k].base = scored[k].off + scored[k].def * defW;
    scored.sort(function (a, b) { return b.base - a.base; });

    if (level === "hard") {
      var top = scored.slice(0, 10);
      for (var t = 0; t < top.length; t++) {
        var pp = top[t].p;
        board[pp[0]][pp[1]] = color;
        var reply = oppBestReply(board, opp);
        board[pp[0]][pp[1]] = 0;
        top[t].look = top[t].off + top[t].def * 1.1 - reply * 0.95;
      }
      top.sort(function (a, b) { return b.look - a.look; });
      return top[0].p;
    }

    var K = level === "medium" ? Math.min(2, scored.length) : Math.min(6, scored.length);
    return scored[Math.floor(Math.random() * K)].p;
  }

  return { bestMove: bestMove };
})();
