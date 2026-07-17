(function (global) {
  "use strict";

  var DIRECTIONS = [
    { dr: 0, dc: 1, name: "가로" },
    { dr: 1, dc: 0, name: "세로" },
    { dr: 1, dc: 1, name: "왼쪽 위·오른쪽 아래 대각선" },
    { dr: 1, dc: -1, name: "오른쪽 위·왼쪽 아래 대각선" }
  ];

  function inside(size, r, c) {
    return r >= 0 && r < size && c >= 0 && c < size;
  }

  function copyBoard(board) {
    return board.map(function (row) { return row.slice(); });
  }

  function otherColor(color, renju) {
    return color === renju.BLACK ? renju.WHITE : renju.BLACK;
  }

  function moveKey(move) {
    return move.r + ":" + move.c;
  }

  function winningMoves(board, color, renju) {
    var moves = [];
    for (var r = 0; r < renju.SIZE; r++) {
      for (var c = 0; c < renju.SIZE; c++) {
        if (board[r][c] !== 0) continue;
        var result = renju.checkMove(board, r, c, color);
        if (result.legal && result.win) moves.push({ r: r, c: c });
      }
    }
    return moves;
  }

  function newMoves(after, before) {
    var known = Object.create(null);
    before.forEach(function (move) { known[moveKey(move)] = true; });
    return after.filter(function (move) { return !known[moveKey(move)]; });
  }

  function containsMove(moves, r, c) {
    return moves.some(function (move) { return move.r === r && move.c === c; });
  }

  function lineProfile(board, r, c, color, direction, renju) {
    var opponent = otherColor(color, renju);
    var bestStones = 0, openWindows = 0;
    for (var offset = -4; offset <= 0; offset++) {
      var startR = r + direction.dr * offset;
      var startC = c + direction.dc * offset;
      var endR = startR + direction.dr * 4;
      var endC = startC + direction.dc * 4;
      if (!inside(renju.SIZE, startR, startC) || !inside(renju.SIZE, endR, endC)) continue;
      var blocked = false, stones = 0;
      for (var i = 0; i < 5; i++) {
        var cell = board[startR + direction.dr * i][startC + direction.dc * i];
        if (cell === opponent) { blocked = true; break; }
        if (cell === color) stones++;
      }
      if (!blocked) {
        openWindows++;
        if (stones > bestStones) bestStones = stones;
      }
    }
    return { name: direction.name, stones: bestStones, openWindows: openWindows };
  }

  function joinNames(profiles) {
    var names = profiles.map(function (profile) { return profile.name; });
    if (names.length <= 1) return names[0] || "";
    return names.slice(0, -1).join(", ") + "와 " + names[names.length - 1];
  }

  function explain(board, r, c, color, renju) {
    renju = renju || global.Renju;
    if (!renju || !Array.isArray(board) || !inside(renju.SIZE, r, c) ||
        !Array.isArray(board[r]) || board[r][c] !== 0 ||
        (color !== renju.BLACK && color !== renju.WHITE)) return null;

    var moveResult = renju.checkMove(board, r, c, color);
    if (!moveResult.legal) return null;

    var opponent = otherColor(color, renju);
    var ownWinsBefore = winningMoves(board, color, renju);
    var opponentWinsBefore = winningMoves(board, opponent, renju);
    var blocksImmediateWin = containsMove(opponentWinsBefore, r, c);
    var after = copyBoard(board);
    after[r][c] = color;
    var ownNewWins = newMoves(winningMoves(after, color, renju), ownWinsBefore);

    var opponentNewWins = [];
    var opponentMove = renju.checkMove(board, r, c, opponent);
    if (opponentMove.legal && !opponentMove.win) {
      var opponentAfter = copyBoard(board);
      opponentAfter[r][c] = opponent;
      opponentNewWins = newMoves(winningMoves(opponentAfter, opponent, renju), opponentWinsBefore);
    }

    var profiles = DIRECTIONS.map(function (direction) {
      return lineProfile(after, r, c, color, direction, renju);
    });
    var strong = profiles.filter(function (profile) { return profile.stones >= 3; });
    var building = profiles.filter(function (profile) { return profile.stones >= 2; });
    var openLanes = profiles.filter(function (profile) { return profile.openWindows > 0; });
    var center = (renju.SIZE - 1) / 2;
    var nearCenter = Math.max(Math.abs(r - center), Math.abs(c - center)) <= 2;
    var reasons = [], category = "positional", summary = "다음 공격의 선택지를 넓히는 자리예요.";

    if (moveResult.win) {
      category = "win";
      summary = "바로 끝내는 승리수예요.";
      reasons.push("이곳에 두면 다섯 돌이 이어져 즉시 승리합니다.");
    } else {
      if (blocksImmediateWin) {
        reasons.push("상대가 이 자리에 두면 바로 오목이 되는 급한 자리라 먼저 차단해야 합니다.");
      }
      if (ownNewWins.length >= 2) {
        reasons.push("이 수 뒤에는 다음 차례에 오목을 완성할 자리가 " + ownNewWins.length + "곳 생깁니다. 상대가 한 수로 모두 막기 어려운 겹공격입니다.");
      } else if (ownNewWins.length === 1) {
        reasons.push("다음 차례에 오목을 완성할 자리가 생겨 상대에게 즉시 대응을 요구합니다.");
      }
      if (!blocksImmediateWin && opponentNewWins.length >= 2) {
        reasons.push("반대로 상대가 이곳을 차지하면 승리점이 " + opponentNewWins.length + "곳 생길 수 있어, 위험한 공격 자리를 먼저 차지한 수입니다.");
      } else if (!blocksImmediateWin && opponentNewWins.length === 1) {
        reasons.push("상대가 이곳을 차지해 사목을 만드는 길도 미리 막습니다.");
      }

      if (blocksImmediateWin && ownNewWins.length) {
        category = "counterattack";
        summary = "급한 위협을 막고 바로 공격으로 바꾸는 수예요.";
      } else if (blocksImmediateWin) {
        category = "block";
        summary = "먼저 막아야 하는 급한 자리예요.";
      } else if (ownNewWins.length >= 2) {
        category = "double-threat";
        summary = "두 갈래 승리점을 만드는 겹공격이에요.";
      } else if (ownNewWins.length === 1) {
        category = "forcing";
        summary = "상대에게 바로 응수를 요구하는 수예요.";
      } else if (opponentNewWins.length >= 2) {
        category = "prevention";
        summary = "상대의 큰 공격 자리를 먼저 차지하는 수예요.";
      }
    }

    if (!moveResult.win && reasons.length < 3) {
      if (strong.length >= 2) {
        reasons.push("이 돌은 " + joinNames(strong) + "에 동시에 연결됩니다. 한 방향이 막혀도 다른 방향으로 공격을 이어가기 좋습니다.");
      } else if (strong.length === 1) {
        reasons.push(strong[0].name + " 쪽 다섯 칸 안에 내 돌 " + strong[0].stones + "개가 모여 다음 공격의 뼈대를 만듭니다.");
      } else if (building.length >= 2) {
        reasons.push(joinNames(building) + "의 연결을 함께 키워 다음 수의 선택 폭을 넓힙니다.");
      } else if (openLanes.length >= 3) {
        reasons.push("이 교차점에는 막히지 않은 다섯 칸 길이 " + openLanes.length + "방향이 남아 있어 여러 공격으로 전환하기 좋습니다.");
      }
    }
    if (!moveResult.win && reasons.length < 2 && nearCenter) {
      reasons.push("중앙에 가까워 가로·세로·두 대각선으로 힘을 보내기 좋은 위치입니다.");
    }
    if (!moveResult.win && reasons.length < 2) {
      reasons.push("당장 끝내는 수보다는 상대의 응수 뒤에도 연결 가능성을 남기는 포석 성격이 큽니다.");
    }

    return {
      category: category,
      summary: summary,
      coordinate: (c + 1) + "열 · " + (r + 1) + "행",
      reasons: reasons.slice(0, 3),
      metrics: {
        immediateWin: moveResult.win,
        blocksImmediateWin: blocksImmediateWin,
        winningReplies: ownNewWins.length,
        preventedWinningReplies: opponentNewWins.length,
        openDirections: openLanes.length
      }
    };
  }

  var api = { explain: explain };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.ProHintExplain = api;
})(typeof window !== "undefined" ? window : this);
