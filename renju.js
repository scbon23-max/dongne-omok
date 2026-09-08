(function (global) {
  "use strict";

  var SIZE = 15;
  var BLACK = 1;
  var WHITE = 2;
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  function inBounds(r, c) {
    return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function hasBoardRows(board) {
    if (!Array.isArray(board) || board.length !== SIZE) return false;
    for (var i = 0; i < SIZE; i++) if (!Array.isArray(board[i]) || board[i].length !== SIZE) return false;
    return true;
  }

  function isValidBoard(board) {
    return hasBoardRows(board) && board.every(function (row) {
      for (var i = 0; i < SIZE; i++) if (row[i] !== 0 && row[i] !== BLACK && row[i] !== WHITE) return false;
      return true;
    });
  }

  function cellAt(board, r, c) {
    if (!inBounds(r, c)) return -1;
    return board[r][c];
  }

  function runLength(board, r, c, dr, dc, color) {
    var count = 1;
    var rr = r + dr, cc = c + dc;
    while (inBounds(rr, cc) && board[rr][cc] === color) { count++; rr += dr; cc += dc; }
    rr = r - dr; cc = c - dc;
    while (inBounds(rr, cc) && board[rr][cc] === color) { count++; rr -= dr; cc -= dc; }
    return count;
  }

  function maxRunAfter(board, r, c, color, dr, dc) {
    var prev = board[r][c];
    board[r][c] = color;
    var len = runLength(board, r, c, dr, dc, color);
    board[r][c] = prev;
    return len;
  }

  function isFiveOrMore(board, r, c, color) {
    for (var i = 0; i < DIRS.length; i++) {
      if (maxRunAfter(board, r, c, color, DIRS[i][0], DIRS[i][1]) >= 5) return true;
    }
    return false;
  }

  function isExactFive(board, r, c, color) {
    for (var i = 0; i < DIRS.length; i++) {
      if (maxRunAfter(board, r, c, color, DIRS[i][0], DIRS[i][1]) === 5) return true;
    }
    return false;
  }

  function isOverline(board, r, c, color) {
    for (var i = 0; i < DIRS.length; i++) {
      if (maxRunAfter(board, r, c, color, DIRS[i][0], DIRS[i][1]) >= 6) return true;
    }
    return false;
  }

  function countFiveCompletionsInDir(board, r, c, dr, dc) {
    var completions = 0;
    for (var off = -4; off <= 4; off++) {
      if (off === 0) continue;
      var er = r + dr * off, ec = c + dc * off;
      if (!inBounds(er, ec) || board[er][ec] !== 0) continue;
      board[er][ec] = BLACK;
      var len = maxRunAfter(board, r, c, BLACK, dr, dc);
      board[er][ec] = 0;
      if (len === 5) completions++;
    }
    return completions;
  }

  function isFourInDir(board, r, c, dr, dc) {
    return countFiveCompletionsInDir(board, r, c, dr, dc) >= 1;
  }

  function countFoursInDir(board, r, c, dr, dc) {
    var groups = Object.create(null);
    for (var off = -4; off <= 4; off++) {
      var er = r + dr * off, ec = c + dc * off;
      if (off === 0 || !inBounds(er, ec) || board[er][ec] !== 0) continue;
      board[er][ec] = BLACK;
      if (runLength(board, r, c, dr, dc, BLACK) === 5) {
        var start = 0;
        while (inBounds(r + dr * (start - 1), c + dc * (start - 1)) &&
            board[r + dr * (start - 1)][c + dc * (start - 1)] === BLACK) start--;
        var stones = [];
        for (var at = start; at < start + 5; at++) if (at !== off) stones.push(at);
        if (stones.length === 4) groups[stones.join(",")] = true;
      }
      board[er][ec] = 0;
    }
    return Object.keys(groups).length;
  }

  function isOpenThreeInDir(board, r, c, dr, dc) {
    if (isFourInDir(board, r, c, dr, dc)) return false;
    for (var off = -4; off <= 4; off++) {
      if (off === 0) continue;
      var er = r + dr * off, ec = c + dc * off;
      if (!inBounds(er, ec) || board[er][ec] !== 0) continue;
      board[er][ec] = BLACK;
      var makesFour = (maxRunAfter(board, r, c, BLACK, dr, dc) === 4);
      var openFour = makesFour && (countFiveCompletionsInDir(board, r, c, dr, dc) >= 2);
      board[er][ec] = 0;
      if (openFour) return true;
    }
    return false;
  }

  function analyzeBlack(board, r, c) {
    if (!inBounds(r, c) || !hasBoardRows(board)) return { exactFive: false, overline: false, fours: 0, openThrees: 0 };
    var placed = board[r][c];
    board[r][c] = BLACK;
    var exactFive = false, overline = false, fours = 0, openThrees = 0;
    for (var i = 0; i < DIRS.length; i++) {
      var dr = DIRS[i][0], dc = DIRS[i][1];
      var len = runLength(board, r, c, dr, dc, BLACK);
      if (len === 5) exactFive = true;
      if (len >= 6) overline = true;
    }
    if (!exactFive) {
      for (var j = 0; j < DIRS.length; j++) {
        var d0 = DIRS[j][0], d1 = DIRS[j][1];
        var dirFours = countFoursInDir(board, r, c, d0, d1);
        if (dirFours) fours += dirFours;
        else if (isOpenThreeInDir(board, r, c, d0, d1)) openThrees++;
      }
    }
    board[r][c] = placed;
    return { exactFive: exactFive, overline: overline, fours: fours, openThrees: openThrees };
  }

  function blackForbiddenReason(board, r, c) {
    if (!inBounds(r, c) || !hasBoardRows(board)) return null;
    if (board[r][c] !== 0) return null;
    var a = analyzeBlack(board, r, c);
    if (a.exactFive) return null;
    if (a.overline) return "overline";
    if (a.fours >= 2) return "double_four";
    if (a.openThrees >= 2) return "double_three";
    return null;
  }

  function checkMove(board, r, c, color) {
    if (!inBounds(r, c) || !hasBoardRows(board) || (color !== BLACK && color !== WHITE)) {
      return { legal: false, win: false, reason: "invalid" };
    }
    if (!inBounds(r, c) || board[r][c] !== 0) {
      return { legal: false, win: false, reason: "occupied" };
    }
    if (color === BLACK) {
      var a = analyzeBlack(board, r, c);
      if (a.exactFive) return { legal: true, win: true, reason: null };
      if (a.overline) return { legal: false, win: false, reason: "overline" };
      if (a.fours >= 2) return { legal: false, win: false, reason: "double_four" };
      if (a.openThrees >= 2) return { legal: false, win: false, reason: "double_three" };
      return { legal: true, win: false, reason: null };
    }
    var win = isFiveOrMore(board, r, c, WHITE);
    return { legal: true, win: win, reason: null };
  }

  function forbiddenPoints(board) {
    var pts = [];
    if (!isValidBoard(board)) return pts;
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (board[r][c] !== 0) continue;
        var reason = blackForbiddenReason(board, r, c);
        if (reason) pts.push({ r: r, c: c, reason: reason });
      }
    }
    return pts;
  }

  function emptyBoard() {
    var b = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push(0);
      b.push(row);
    }
    return b;
  }

  var Renju = {
    SIZE: SIZE, BLACK: BLACK, WHITE: WHITE,
    emptyBoard: emptyBoard,
    isValidBoard: isValidBoard,
    checkMove: checkMove,
    forbiddenPoints: forbiddenPoints,
    blackForbiddenReason: blackForbiddenReason,
    analyzeBlack: analyzeBlack
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Renju;
  global.Renju = Renju;
})(typeof window !== "undefined" ? window : this);
