window.OmokAI = (function () {
  "use strict";
  var SIZE = 15, BLACK = 1, WHITE = 2, WIN = 100000;
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  function inb(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  function lineInfo(board, r, c, dr, dc, color) {
    var cnt = 1, open = 0;
    var i = 1;
    while (true) { var rr = r + dr * i, cc = c + dc * i; if (!inb(rr, cc)) break; if (board[rr][cc] === color) { cnt++; i++; } else { if (board[rr][cc] === 0) open++; break; } }
    var j = 1;
    while (true) { var rr2 = r - dr * j, cc2 = c - dc * j; if (!inb(rr2, cc2)) break; if (board[rr2][cc2] === color) { cnt++; j++; } else { if (board[rr2][cc2] === 0) open++; break; } }
    return { cnt: cnt, open: open };
  }
  function patternScore(cnt, open) {
    if (cnt >= 5) return WIN;
    if (open === 0) return 0;
    if (cnt === 4) return open === 2 ? 15000 : 2200;
    if (cnt === 3) return open === 2 ? 900 : 120;
    if (cnt === 2) return open === 2 ? 90 : 15;
    return open === 2 ? 8 : 2;
  }
  function evalPlace(board, r, c, color) {
    var s = 0;
    for (var d = 0; d < 4; d++) { var info = lineInfo(board, r, c, DIRS[d][0], DIRS[d][1], color); s += patternScore(info.cnt, info.open); }
    return s;
  }
  function candidates(board) {
    var seen = {}, list = [];
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
      if (board[r][c]) {
        for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
          var rr = r + dr, cc = c + dc;
          if (inb(rr, cc) && board[rr][cc] === 0) { var k = rr * SIZE + cc; if (!seen[k]) { seen[k] = 1; list.push([rr, cc]); } }
        }
      }
    }
    if (!list.length) list.push([7, 7]);
    return list;
  }
  function legal(board, r, c, color) {
    if (window.Renju && Renju.checkMove) { return Renju.checkMove(board, r, c, color).legal; }
    return board[r][c] === 0;
  }

  function bestMove(board, color, level) {
    var opp = color === BLACK ? WHITE : BLACK;
    var cands = candidates(board);
    var scored = [];
    cands.forEach(function (p) {
      if (!legal(board, p[0], p[1], color)) return;
      var off = evalPlace(board, p[0], p[1], color);
      var def = evalPlace(board, p[0], p[1], opp);
      scored.push({ p: p, off: off, def: def });
    });
    if (!scored.length) return null;

    var win = null, block = null;
    for (var i = 0; i < scored.length; i++) {
      if (scored[i].off >= WIN && !win) win = scored[i];
      if (scored[i].def >= WIN && !block) block = scored[i];
    }
    if (win) return win.p;
    var missBlock = (level === "easy" && Math.random() < 0.45);
    if (block && !missBlock) return block.p;

    var defW = level === "hard" ? 1.1 : (level === "medium" ? 0.95 : 0.7);
    scored.forEach(function (s) { s.total = s.off + s.def * defW; });
    scored.sort(function (a, b) { return b.total - a.total; });

    var K = level === "hard" ? 1 : (level === "medium" ? Math.min(3, scored.length) : Math.min(7, scored.length));
    var pick = scored[Math.floor(Math.random() * K)];
    return pick.p;
  }

  return { bestMove: bestMove };
})();
