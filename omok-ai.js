window.OmokAI = (function () {
  "use strict";
  var SIZE = 15, BLACK = 1, WHITE = 2, WIN = 100000, OPEN4 = 20000;
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
  function evalPlace(board, r, c, color) {
    var s = 0;
    for (var d = 0; d < 4; d++) { var info = lineInfo(board, r, c, DIRS[d][0], DIRS[d][1], color); s += patternScore(info.cnt, info.open); }
    return s;
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
    if (myOpen4) return myOpen4.p;
    if (oppOpen4 && level !== "easy") return oppOpen4.p;
    if (oppOpen4 && level === "easy" && Math.random() < 0.6) return oppOpen4.p;

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
