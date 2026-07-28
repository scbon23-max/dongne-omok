(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoldemEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA_VERSION = 1;
  var MAX_SEATS = 6;
  var ACTION_HISTORY_LIMIT = 128;
  var BOT_THINK_DELAY_MS = 900;
  var JOIN_REQUEST_TTL_MS = 60 * 1000;
  var BOT_DISPLAY_NAME = "AI";
  var BLIND_LEVEL_MULTIPLIERS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 20, 30, 40, 60, 80, 100];
  var WHOLE_CHIP_BLIND_MULTIPLIERS = [1, 2, 3, 4, 6, 8, 10, 15, 20, 30, 40, 60, 80, 100, 150];
  var BOT_PERSONALITIES = {
    tight_passive: "타이트 패시브",
    tight_aggressive: "타이트 어그레시브",
    loose_passive: "루즈 패시브",
    loose_aggressive: "루즈 어그레시브"
  };
  var BOT_PERSONALITY_IDS = Object.keys(BOT_PERSONALITIES);
  var RANKS = "23456789TJQKA";
  var SUITS = "cdhs";
  var PHASES = {
    waiting: true,
    preflop: true,
    flop: true,
    turn: true,
    river: true,
    hand_end: true,
    tournament_end: true
  };
  var PLAYING_PHASES = { preflop: true, flop: true, turn: true, river: true };
  var HAND_NAMES = [
    "하이카드",
    "원페어",
    "투페어",
    "트리플",
    "스트레이트",
    "플러시",
    "풀하우스",
    "포카드",
    "스트레이트 플러시"
  ];

  function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function integer(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? Math.floor(n) : fallback;
  }

  function clamp(value, min, max, fallback) {
    var n = integer(value, fallback);
    return Math.max(min, Math.min(max, n));
  }

  function normalizedChipUnit(value) {
    var unit = clamp(value, 100, 10000, 100);
    return Math.max(100, Math.round(unit / 100) * 100);
  }

  function roundToChipUnit(value, unit) {
    unit = normalizedChipUnit(unit);
    return Math.max(unit, Math.round(Number(value || 0) / unit) * unit);
  }

  function isChipMultiple(value, unit) {
    return integer(value, NaN) === Number(value) &&
      integer(value, 0) % normalizedChipUnit(unit) === 0;
  }

  function text(value, max) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function normalizeBotPersonality(value) {
    value = text(value, 32).toLowerCase().replace(/-/g, "_");
    return own(BOT_PERSONALITIES, value) ? value : "";
  }

  function normalizeTableMode(value) {
    return text(value, 24).toLowerCase() === "ring" ? "ring" : "tournament";
  }

  function normalizeTournamentSpeed(value) {
    return text(value, 24).toLowerCase() === "turbo" ? "turbo" : "normal";
  }

  function legacyBotPersonality(player, fallbackIndex) {
    var idMatch = /^bot-(\d+)$/.exec(text(player && player.botId, 40));
    var index = idMatch
      ? Math.max(0, integer(idMatch[1], 1) - 1)
      : Math.max(0, integer(fallbackIndex, 0));
    return BOT_PERSONALITY_IDS[index % BOT_PERSONALITY_IDS.length];
  }

  function chooseBotPersonality(state, randomInt) {
    var used = {};
    occupiedPlayers(state).forEach(function (player) {
      if (!player.isBot) return;
      var personality = normalizeBotPersonality(player.botPersonality);
      if (personality) used[personality] = true;
    });
    var choices = BOT_PERSONALITY_IDS.filter(function (personality) {
      return !used[personality];
    });
    if (!choices.length) choices = BOT_PERSONALITY_IDS.slice();
    randomInt = typeof randomInt === "function" ? randomInt : defaultRandomInt;
    var index = integer(randomInt(choices.length), 0);
    if (index < 0 || index >= choices.length) throw new Error("invalid_random");
    return choices[index];
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeDeck() {
    var out = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < RANKS.length; r++) out.push(RANKS[r] + SUITS[s]);
    }
    return out;
  }

  function defaultRandomInt(max) {
    return Math.floor(Math.random() * max);
  }

  function shuffleDeck(randomInt) {
    var deck = makeDeck();
    randomInt = typeof randomInt === "function" ? randomInt : defaultRandomInt;
    for (var i = deck.length - 1; i > 0; i--) {
      var j = integer(randomInt(i + 1), 0);
      if (j < 0 || j > i) throw new Error("invalid_random");
      var tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  function parseCard(card) {
    card = text(card, 2);
    if (card.length !== 2) throw new Error("invalid_card");
    var rankIndex = RANKS.indexOf(card.charAt(0).toUpperCase());
    var suitIndex = SUITS.indexOf(card.charAt(1).toLowerCase());
    if (rankIndex < 0 || suitIndex < 0) throw new Error("invalid_card");
    return { code: RANKS.charAt(rankIndex) + SUITS.charAt(suitIndex), rank: rankIndex + 2, suit: SUITS.charAt(suitIndex) };
  }

  function compareNumberArrays(a, b) {
    var len = Math.max(a.length, b.length);
    for (var i = 0; i < len; i++) {
      var av = a[i] || 0;
      var bv = b[i] || 0;
      if (av !== bv) return av > bv ? 1 : -1;
    }
    return 0;
  }

  function straightHigh(ranks) {
    var seen = {};
    for (var i = 0; i < ranks.length; i++) seen[ranks[i]] = true;
    if (seen[14]) seen[1] = true;
    var run = 0;
    for (var rank = 14; rank >= 1; rank--) {
      if (seen[rank]) {
        run++;
        if (run === 5) return rank + 4;
      } else {
        run = 0;
      }
    }
    return 0;
  }

  function evaluateFive(cards) {
    if (!Array.isArray(cards) || cards.length !== 5) throw new Error("five_cards_required");
    var parsed = cards.map(parseCard);
    var ranks = parsed.map(function (card) { return card.rank; }).sort(function (a, b) { return b - a; });
    var flush = parsed.every(function (card) { return card.suit === parsed[0].suit; });
    var highStraight = straightHigh(ranks);
    var counts = {};
    ranks.forEach(function (rank) { counts[rank] = (counts[rank] || 0) + 1; });
    var groups = Object.keys(counts).map(function (rank) {
      return { rank: Number(rank), count: counts[rank] };
    }).sort(function (a, b) {
      return b.count - a.count || b.rank - a.rank;
    });
    var category;
    var tiebreak;
    if (flush && highStraight) {
      category = 8;
      tiebreak = [highStraight];
    } else if (groups[0].count === 4) {
      category = 7;
      tiebreak = [groups[0].rank, groups[1].rank];
    } else if (groups[0].count === 3 && groups[1].count === 2) {
      category = 6;
      tiebreak = [groups[0].rank, groups[1].rank];
    } else if (flush) {
      category = 5;
      tiebreak = ranks.slice();
    } else if (highStraight) {
      category = 4;
      tiebreak = [highStraight];
    } else if (groups[0].count === 3) {
      category = 3;
      tiebreak = [groups[0].rank].concat(groups.slice(1).map(function (group) { return group.rank; }).sort(function (a, b) { return b - a; }));
    } else if (groups[0].count === 2 && groups[1].count === 2) {
      var pairs = [groups[0].rank, groups[1].rank].sort(function (a, b) { return b - a; });
      category = 2;
      tiebreak = pairs.concat([groups[2].rank]);
    } else if (groups[0].count === 2) {
      category = 1;
      tiebreak = [groups[0].rank].concat(groups.slice(1).map(function (group) { return group.rank; }).sort(function (a, b) { return b - a; }));
    } else {
      category = 0;
      tiebreak = ranks.slice();
    }
    return {
      category: category,
      name: category === 8 && tiebreak[0] === 14 ? "로열 플러시" : HAND_NAMES[category],
      tiebreak: tiebreak,
      cards: parsed.map(function (card) { return card.code; })
    };
  }

  function compareEvaluations(a, b) {
    if (a.category !== b.category) return a.category > b.category ? 1 : -1;
    return compareNumberArrays(a.tiebreak, b.tiebreak);
  }

  function evaluateSeven(cards) {
    if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) throw new Error("five_to_seven_cards_required");
    var normalized = cards.map(function (card) { return parseCard(card).code; });
    var best = null;
    for (var a = 0; a < normalized.length - 4; a++) {
      for (var b = a + 1; b < normalized.length - 3; b++) {
        for (var c = b + 1; c < normalized.length - 2; c++) {
          for (var d = c + 1; d < normalized.length - 1; d++) {
            for (var e = d + 1; e < normalized.length; e++) {
              var current = evaluateFive([normalized[a], normalized[b], normalized[c], normalized[d], normalized[e]]);
              if (!best || compareEvaluations(current, best) > 0) best = current;
            }
          }
        }
      }
    }
    return best;
  }

  function buildSidePots(players) {
    players = Array.isArray(players) ? players : [];
    var normalized = players.map(function (player, index) {
      return {
        seat: integer(player && player.seat, index),
        nick: text(player && player.nick, 40),
        committed: Math.max(0, integer(player && (player.totalBet != null ? player.totalBet : player.committed), 0)),
        folded: !!(player && player.folded)
      };
    }).filter(function (player) { return player.nick && player.committed > 0; });
    var levels = [];
    normalized.forEach(function (player) {
      if (levels.indexOf(player.committed) < 0) levels.push(player.committed);
    });
    levels.sort(function (a, b) { return a - b; });
    var previous = 0;
    var pots = [];
    var refunds = [];
    levels.forEach(function (level) {
      var contributors = normalized.filter(function (player) { return player.committed >= level; });
      var amount = (level - previous) * contributors.length;
      var eligible = contributors.filter(function (player) { return !player.folded; });
      if (contributors.length === 1) {
        refunds.push({ seat: contributors[0].seat, nick: contributors[0].nick, amount: amount });
      } else if (amount > 0) {
        pots.push({
          amount: amount,
          cap: level,
          contributors: contributors.map(function (player) { return player.seat; }),
          eligible: eligible.map(function (player) { return player.seat; }),
          winners: []
        });
      }
      previous = level;
    });
    return { pots: pots, refunds: refunds };
  }

  function clockwiseWinnerOrder(winnerSeats, buttonSeat, maxSeats) {
    maxSeats = Math.max(2, integer(maxSeats, MAX_SEATS));
    buttonSeat = integer(buttonSeat, -1);
    return winnerSeats.slice().sort(function (a, b) {
      var da = ((a - buttonSeat + maxSeats) % maxSeats) || maxSeats;
      var db = ((b - buttonSeat + maxSeats) % maxSeats) || maxSeats;
      return da - db;
    });
  }

  function createPlayer(nick, seat, stack, now, options) {
    options = options || {};
    var isBot = options.isBot === true;
    var personality = isBot ? normalizeBotPersonality(options.botPersonality) : "";
    var displayName = text(options.displayName || nick, 40) || text(nick, 40);
    return {
      seat: seat,
      nick: nick,
      displayName: displayName,
      isBot: isBot,
      botId: isBot ? text(options.botId, 40) : null,
      botPersonality: isBot ? personality : null,
      stack: stack,
      ready: stack > 0,
      joinedAt: now,
      waiting: true,
      leaving: false,
      inHand: false,
      folded: false,
      allIn: false,
      streetBet: 0,
      totalBet: 0,
      cards: [],
      revealed: false,
      lastAction: "",
      lastActionBet: null,
      winAmount: 0
    };
  }

  function createTable(options) {
    options = options || {};
    var mode = normalizeTableMode(options.mode);
    var tournamentSpeed = normalizeTournamentSpeed(options.tournamentSpeed);
    var chipUnit = normalizedChipUnit(options.chipUnit);
    var smallBlind = roundToChipUnit(
      clamp(options.smallBlind, chipUnit, 1000000, chipUnit),
      chipUnit
    );
    var bigBlind = roundToChipUnit(
      clamp(options.bigBlind, smallBlind * 2, 2000000, smallBlind * 2),
      chipUnit
    );
    if (bigBlind < smallBlind * 2) bigBlind = smallBlind * 2;
    var defaultLevelMs = tournamentSpeed === "turbo" ? 5 * 60 * 1000 : 10 * 60 * 1000;
    var blindLevelMs = mode === "ring"
      ? 0
      : clamp(options.blindLevelMs, 60 * 1000, 60 * 60 * 1000, defaultLevelMs);
    var startingStack = roundToChipUnit(
      clamp(options.startingStack, bigBlind * 10, 100000000, 10000),
      chipUnit
    );
    var refillAmount = roundToChipUnit(
      clamp(options.refillAmount, bigBlind * 10, 100000000, startingStack),
      chipUnit
    );
    return {
      schemaVersion: SCHEMA_VERSION,
      economyVersion: 2,
      roomId: text(options.roomId, 80),
      ownerNick: text(options.ownerNick, 40),
      phase: "waiting",
      settings: {
        mode: mode,
        tournamentSpeed: mode === "ring" ? "" : tournamentSpeed,
        assetBacked: mode === "ring" && options.assetBacked === true,
        chipUnit: chipUnit,
        maxPlayers: Math.min(MAX_SEATS, clamp(options.maxPlayers, 2, MAX_SEATS, MAX_SEATS)),
        startingStack: startingStack,
        initialSmallBlind: smallBlind,
        initialBigBlind: bigBlind,
        smallBlind: smallBlind,
        bigBlind: bigBlind,
        blindLevelMs: blindLevelMs,
        actionMs: clamp(options.actionMs, 5000, 120000, mode === "ring" ? 20000 : tournamentSpeed === "turbo" ? 15000 : 20000),
        refillAmount: mode === "ring"
          ? refillAmount
          : 0,
        dailyRefillLimit: mode === "ring"
          ? clamp(options.dailyRefillLimit, 1, 10, 3)
          : 0
      },
      ringStacks: {},
      walletAdjustments: [],
      seats: [null, null, null, null, null, null],
      handNo: 0,
      tournamentStartedAt: null,
      blindLevel: 0,
      nextBlindAt: null,
      buttonSeat: null,
      previousBigBlindSeat: null,
      smallBlindSeat: null,
      bigBlindSeat: null,
      actorSeat: null,
      actionDeadline: null,
      board: [],
      deck: [],
      burn: [],
      currentBet: 0,
      lastFullRaiseSize: bigBlind,
      pendingSeats: [],
      pots: [],
      showdown: [],
      pendingJoinRequests: [],
      lastEvent: { type: "table_created" },
      recentRequestIds: [],
      actionSeq: 0,
      nextBotSeq: 1,
      botDueAt: null,
      actionHistory: []
    };
  }

  function validState(state) {
    return !!state && typeof state === "object" && state.schemaVersion === SCHEMA_VERSION &&
      Array.isArray(state.seats) && state.seats.length === MAX_SEATS && PHASES[state.phase];
  }

  function ensureAdditiveState(state, now) {
    state.settings = state.settings && typeof state.settings === "object" ? state.settings : {};
    state.settings.mode = normalizeTableMode(state.settings.mode);
    state.settings.tournamentSpeed = state.settings.mode === "ring"
      ? ""
      : normalizeTournamentSpeed(state.settings.tournamentSpeed);
    state.settings.assetBacked = state.settings.mode === "ring" &&
      state.settings.assetBacked === true;
    state.settings.chipUnit = normalizedChipUnit(state.settings.chipUnit);
    state.settings.initialSmallBlind = roundToChipUnit(
      clamp(
        state.settings.initialSmallBlind,
        state.settings.chipUnit,
        1000000,
        clamp(state.settings.smallBlind, state.settings.chipUnit, 1000000, state.settings.chipUnit)
      ),
      state.settings.chipUnit
    );
    state.settings.initialBigBlind = roundToChipUnit(
      clamp(
        state.settings.initialBigBlind,
        state.settings.initialSmallBlind * 2,
        2000000,
        clamp(state.settings.bigBlind, state.settings.initialSmallBlind * 2, 2000000, state.settings.initialSmallBlind * 2)
      ),
      state.settings.chipUnit
    );
    state.settings.startingStack = roundToChipUnit(
      clamp(
        state.settings.startingStack,
        state.settings.initialBigBlind * 10,
        100000000,
        10000
      ),
      state.settings.chipUnit
    );
    if (state.settings.mode === "ring") {
      state.settings.smallBlind = state.settings.initialSmallBlind;
      state.settings.bigBlind = state.settings.initialBigBlind;
      state.settings.blindLevelMs = 0;
      state.settings.refillAmount = roundToChipUnit(
        clamp(
          state.settings.refillAmount,
          state.settings.initialBigBlind * 10,
          100000000,
          state.settings.startingStack
        ),
        state.settings.chipUnit
      );
      state.settings.dailyRefillLimit = clamp(state.settings.dailyRefillLimit, 1, 10, 3);
    } else {
      state.settings.blindLevelMs = clamp(
        state.settings.blindLevelMs,
        60 * 1000,
        60 * 60 * 1000,
        state.settings.tournamentSpeed === "turbo" ? 5 * 60 * 1000 : 10 * 60 * 1000
      );
      state.settings.refillAmount = 0;
      state.settings.dailyRefillLimit = 0;
    }
    state.walletAdjustments = [];
    state.settings.actionMs = clamp(
      state.settings.actionMs,
      5000,
      120000,
      state.settings.tournamentSpeed === "turbo" ? 15000 : 20000
    );
    state.blindLevel = Math.max(0, integer(state.blindLevel, 0));
    state.tournamentStartedAt = state.tournamentStartedAt != null &&
      Number.isFinite(Number(state.tournamentStartedAt))
      ? Math.max(0, integer(state.tournamentStartedAt, 0))
      : null;
    state.nextBlindAt = state.nextBlindAt != null &&
      Number.isFinite(Number(state.nextBlindAt))
      ? Math.max(0, integer(state.nextBlindAt, 0))
      : null;
    var savedRingStacks = Object.create(null);
    if (state.ringStacks && typeof state.ringStacks === "object" &&
        !Array.isArray(state.ringStacks)) {
      Object.keys(state.ringStacks).slice(0, 200).forEach(function (nick) {
        if (!nick || nick.length > 40) return;
        savedRingStacks[nick] = clamp(
          state.ringStacks[nick],
          0,
          100000000,
          state.settings.startingStack
        );
      });
    }
    state.ringStacks = savedRingStacks;
    var nextBotSeq = Math.max(1, integer(state.nextBotSeq, 1));
    state.seats.forEach(function (player, seatIndex) {
      if (!player) return;
      player.isBot = player.isBot === true;
      player.displayName = text(player.displayName || player.nick, 40) || text(player.nick, 40);
      if (player.isBot) {
        player.botId = text(player.botId, 40);
        player.botPersonality = normalizeBotPersonality(player.botPersonality) ||
          legacyBotPersonality(player, seatIndex);
        delete player.botDifficulty;
        var idMatch = /^bot-(\d+)$/.exec(player.botId);
        if (idMatch) {
          player.displayName = BOT_DISPLAY_NAME + " " + idMatch[1];
          nextBotSeq = Math.max(nextBotSeq, Number(idMatch[1]) + 1);
        } else {
          player.displayName = BOT_DISPLAY_NAME;
        }
      } else {
        player.botId = null;
        delete player.botDifficulty;
        delete player.botPersonality;
        if (state.settings.mode === "ring" && player.nick) {
          state.ringStacks[player.nick] = clamp(
            player.stack,
            0,
            100000000,
            state.settings.startingStack
          );
        }
      }
    });
    if (state.settings.mode === "ring" && botPlayers(state).length > 0) {
      convertRingTableToPractice(state);
    }
    state.nextBotSeq = nextBotSeq;
    state.actionHistory = Array.isArray(state.actionHistory)
      ? state.actionHistory.slice(-ACTION_HISTORY_LIMIT)
      : [];
    state.pendingJoinRequests = normalizeJoinRequests(state.pendingJoinRequests, now);
    state.botDueAt = Number.isFinite(Number(state.botDueAt))
      ? Math.max(0, integer(state.botDueAt, 0))
      : null;
    var actor = state.actorSeat == null ? null : state.seats[state.actorSeat];
    if (!actor || !actor.isBot || !PLAYING_PHASES[state.phase]) {
      state.botDueAt = null;
    } else if (state.botDueAt == null && Number.isFinite(Number(now))) {
      state.botDueAt = Math.max(0, integer(now, 0)) + BOT_THINK_DELAY_MS;
    }
    return state;
  }

  function addWalletAdjustment(state, nick, delta, reason) {
    if (!state || !state.settings || state.settings.mode !== "ring" ||
        state.settings.assetBacked !== true) return;
    nick = text(nick, 40);
    delta = integer(delta, 0);
    if (!nick || !delta || !isChipMultiple(delta, state.settings.chipUnit)) return;
    if (!Array.isArray(state.walletAdjustments)) state.walletAdjustments = [];
    state.walletAdjustments.push({
      nickname: nick,
      delta: delta,
      reason: text(reason, 24)
    });
  }

  function ringBuyInBounds(state) {
    var unit = normalizedChipUnit(state && state.settings && state.settings.chipUnit);
    var max = roundToChipUnit(
      clamp(
        state && state.settings && state.settings.startingStack,
        unit,
        100000000,
        10000
      ),
      unit
    );
    var blindMin = roundToChipUnit(
      clamp(
        state && state.settings && state.settings.bigBlind
          ? state.settings.bigBlind * 10
          : unit,
        unit,
        max,
        Math.min(max, 10000)
      ),
      unit
    );
    var min = Math.min(max, Math.max(unit, 10000, blindMin));
    return { min: min, max: max, defaultAmount: max, unit: unit };
  }

  function requestedRingBuyIn(state, cmd) {
    var bounds = ringBuyInBounds(state);
    var raw = cmd && (cmd.buyIn != null ? cmd.buyIn : cmd.amount);
    var amount = raw == null ? bounds.defaultAmount : Number(raw);
    if (!Number.isFinite(amount)) amount = bounds.defaultAmount;
    amount = roundToChipUnit(amount, bounds.unit);
    return clamp(amount, bounds.min, bounds.max, bounds.defaultAmount);
  }

  function updateBlindLevel(state, now) {
    if (state.settings.mode === "ring") {
      state.settings.smallBlind = state.settings.initialSmallBlind;
      state.settings.bigBlind = state.settings.initialBigBlind;
      state.blindLevel = 0;
      state.nextBlindAt = null;
      return;
    }
    if (state.tournamentStartedAt == null) state.tournamentStartedAt = now;
    var levelMs = state.settings.blindLevelMs;
    var elapsed = Math.max(0, now - state.tournamentStartedAt);
    var blindMultipliers = normalizedChipUnit(state.settings.chipUnit) > 1
      ? WHOLE_CHIP_BLIND_MULTIPLIERS
      : BLIND_LEVEL_MULTIPLIERS;
    var level = Math.min(
      blindMultipliers.length - 1,
      Math.floor(elapsed / levelMs)
    );
    var multiplier = blindMultipliers[level];
    state.blindLevel = level;
    state.settings.smallBlind = roundToChipUnit(
      state.settings.initialSmallBlind * multiplier,
      state.settings.chipUnit
    );
    state.settings.bigBlind = Math.max(
      state.settings.smallBlind * 2,
      roundToChipUnit(
        state.settings.initialBigBlind * multiplier,
        state.settings.chipUnit
      )
    );
    state.nextBlindAt = level < blindMultipliers.length - 1
      ? state.tournamentStartedAt + (level + 1) * levelMs
      : null;
  }

  function occupiedPlayers(state) {
    return state.seats.filter(function (player) { return !!player && !player.leaving; });
  }

  function humanPlayers(state) {
    return occupiedPlayers(state).filter(function (player) { return !player.isBot; });
  }

  function botPlayers(state) {
    return occupiedPlayers(state).filter(function (player) { return !!player.isBot; });
  }

  function normalizeJoinRequests(value, now) {
    if (!Array.isArray(value)) return [];
    now = Math.max(0, integer(now, Date.now()));
    var seen = {};
    return value.map(function (entry) {
      entry = entry && typeof entry === "object" ? entry : {};
      var nick = text(entry.nick, 40);
      var targetNick = text(entry.targetNick, 40);
      var requestedAt = Math.max(0, integer(entry.requestedAt, now));
      var expiresAt = Math.max(requestedAt + 1000, integer(entry.expiresAt, requestedAt + JOIN_REQUEST_TTL_MS));
      var key = nick + "\n" + targetNick;
      if (!nick || !targetNick || expiresAt <= now || seen[key]) return null;
      seen[key] = true;
      return {
        nick: nick,
        targetNick: targetNick,
        requestedAt: requestedAt,
        expiresAt: expiresAt
      };
    }).filter(Boolean).slice(-12);
  }

  function practiceJoinTarget(state) {
    if (!state || !state.settings || state.settings.mode !== "ring" || botPlayers(state).length <= 0) return null;
    var humans = humanPlayers(state).filter(function (player) {
      return !player.leaving && player.stack > 0;
    });
    return humans.length === 1 ? humans[0] : null;
  }

  function emptySeatIndexes(state) {
    var seats = [];
    for (var i = 0; i < MAX_SEATS; i++) {
      if (!state.seats[i]) seats.push(i);
    }
    return seats;
  }

  function randomEmptySeat(state, randomInt) {
    var seats = emptySeatIndexes(state);
    if (!seats.length) return -1;
    var pick = typeof randomInt === "function"
      ? clamp(integer(randomInt(seats.length), 0), 0, seats.length - 1)
      : 0;
    return seats[pick];
  }

  function pendingJoinRequest(state, requester, targetNick) {
    requester = text(requester, 40);
    targetNick = text(targetNick, 40);
    for (var i = 0; i < state.pendingJoinRequests.length; i++) {
      var request = state.pendingJoinRequests[i];
      if (request.nick === requester && request.targetNick === targetNick) return request;
    }
    return null;
  }

  function removeJoinRequest(state, requester, targetNick) {
    requester = text(requester, 40);
    targetNick = text(targetNick, 40);
    state.pendingJoinRequests = state.pendingJoinRequests.filter(function (request) {
      return !(request.nick === requester && request.targetNick === targetNick);
    });
  }

  function convertRingTableToPractice(state) {
    if (!state || !state.settings || state.settings.mode !== "ring") return;
    if (state.settings.assetBacked === true) {
      humanPlayers(state).forEach(function (player) {
        if (!player || !player.nick) return;
        var amount = own(state.ringStacks, player.nick)
          ? clamp(state.ringStacks[player.nick], 0, 100000000, player.stack)
          : player.stack;
        addWalletAdjustment(state, player.nick, amount, "practice_refund");
      });
    }
    state.settings.assetBacked = false;
    state.settings.practice = true;
  }

  function convertRingTableToAssetBacked(state) {
    if (!state || !state.settings || state.settings.mode !== "ring" ||
        state.settings.assetBacked === true || botPlayers(state).length > 0) return;
    state.settings.assetBacked = true;
    state.settings.practice = false;
    humanPlayers(state).forEach(function (player) {
      if (!player || !player.nick) return;
      var amount = own(state.ringStacks, player.nick)
        ? clamp(state.ringStacks[player.nick], 0, 100000000, player.stack)
        : player.stack;
      addWalletAdjustment(state, player.nick, -amount, "buy_in");
    });
  }

  function handPlayers(state) {
    return state.seats.filter(function (player) { return !!player && player.inHand; });
  }

  function livePlayers(state) {
    return state.seats.filter(function (player) { return !!player && player.inHand && !player.folded; });
  }

  function actionablePlayers(state) {
    return state.seats.filter(function (player) {
      return !!player && player.inHand && !player.folded && !player.allIn && player.stack > 0;
    });
  }

  function playerByNick(state, nick) {
    for (var i = 0; i < state.seats.length; i++) {
      if (state.seats[i] && !state.seats[i].isBot && state.seats[i].nick === nick) return state.seats[i];
    }
    return null;
  }

  function anyPlayerByNick(state, nick) {
    for (var i = 0; i < state.seats.length; i++) {
      if (state.seats[i] && state.seats[i].nick === nick) return state.seats[i];
    }
    return null;
  }

  function botById(state, botId) {
    botId = text(botId, 40);
    if (!botId) return null;
    for (var i = 0; i < state.seats.length; i++) {
      if (state.seats[i] && state.seats[i].isBot && state.seats[i].botId === botId) return state.seats[i];
    }
    return null;
  }

  function nextSeatMatching(state, fromSeat, predicate) {
    for (var step = 1; step <= MAX_SEATS; step++) {
      var seat = (integer(fromSeat, -1) + step + MAX_SEATS) % MAX_SEATS;
      var player = state.seats[seat];
      if (player && predicate(player)) return seat;
    }
    return null;
  }

  function orderedSeats(state, startSeat, predicate) {
    var out = [];
    for (var step = 0; step < MAX_SEATS; step++) {
      var seat = (startSeat + step + MAX_SEATS) % MAX_SEATS;
      var player = state.seats[seat];
      if (player && predicate(player)) out.push(seat);
    }
    return out;
  }

  function nextHandSeat(state, fromSeat) {
    return nextSeatMatching(state, fromSeat, function (player) {
      return !player.leaving && player.stack > 0;
    });
  }

  function nextLiveSeat(state, fromSeat) {
    return nextSeatMatching(state, fromSeat, function (player) {
      return player.inHand && !player.folded;
    });
  }

  function nextActionSeat(state, fromSeat) {
    return nextSeatMatching(state, fromSeat, function (player) {
      return player.inHand && !player.folded && !player.allIn && player.stack > 0;
    });
  }

  function potTotal(state) {
    return handPlayers(state).reduce(function (sum, player) { return sum + player.totalBet; }, 0);
  }

  function postChips(player, amount) {
    amount = Math.max(0, Math.min(player.stack, integer(amount, 0)));
    player.stack -= amount;
    player.streetBet += amount;
    player.totalBet += amount;
    if (player.stack === 0) player.allIn = true;
    return amount;
  }

  function dealCard(state) {
    if (!state.deck.length) throw new Error("deck_empty");
    return state.deck.shift();
  }

  function burnAndDeal(state, count) {
    state.burn.push(dealCard(state));
    for (var i = 0; i < count; i++) state.board.push(dealCard(state));
  }

  function assignActor(state, now) {
    state.botDueAt = null;
    while (state.pendingSeats.length) {
      var seat = state.pendingSeats[0];
      var player = state.seats[seat];
      if (player && player.inHand && !player.folded && !player.allIn && player.stack > 0) {
        state.actorSeat = seat;
        state.actionDeadline = now + state.settings.actionMs;
        if (player.isBot) state.botDueAt = now + BOT_THINK_DELAY_MS;
        return;
      }
      state.pendingSeats.shift();
    }
    state.actorSeat = null;
    state.actionDeadline = null;
  }

  function removePending(state, seat) {
    state.pendingSeats = state.pendingSeats.filter(function (pendingSeat) { return pendingSeat !== seat; });
  }

  function pendingAfterIncrease(state, raiserSeat, fullRaise) {
    var start = (raiserSeat + 1) % MAX_SEATS;
    var outstanding = {};
    if (!fullRaise) {
      state.pendingSeats.forEach(function (seat) { outstanding[seat] = true; });
    }
    actionablePlayers(state).forEach(function (player) {
      if (player.seat !== raiserSeat && player.streetBet < state.currentBet) outstanding[player.seat] = true;
      if (fullRaise && player.seat !== raiserSeat) outstanding[player.seat] = true;
    });
    state.pendingSeats = orderedSeats(state, start, function (player) {
      return !!outstanding[player.seat] && player.inHand && !player.folded && !player.allIn && player.stack > 0;
    });
  }

  function canPlayerRaise(state, player) {
    if (!player || player.lastActionBet == null) return true;
    return state.currentBet - player.lastActionBet >= state.lastFullRaiseSize;
  }

  function hasBettableOpponent(state, player) {
    return state.seats.some(function (other) {
      return !!other && other.seat !== player.seat && other.inHand && !other.folded && !other.allIn && other.stack > 0;
    });
  }

  function legalActionsForPlayer(state, player) {
    var empty = {
      actions: [],
      callAmount: 0,
      minBet: null,
      minRaiseTo: null,
      maxRaiseTo: null,
      pot: potTotal(state),
      step: state && state.settings
        ? normalizedChipUnit(state.settings.chipUnit)
        : 1
    };
    if (!validState(state) || !PLAYING_PHASES[state.phase]) return empty;
    if (!player || player.seat !== state.actorSeat || player.folded || player.allIn || !player.inHand) return empty;
    var owed = Math.max(0, state.currentBet - player.streetBet);
    var callAmount = Math.min(player.stack, owed);
    var maxTo = player.streetBet + player.stack;
    var actions = ["fold"];
    if (owed === 0) actions.push("check");
    else actions.push("call");
    var canCompete = hasBettableOpponent(state, player);
    var minBet = Math.min(state.settings.bigBlind, maxTo);
    var minRaiseTo = state.currentBet + state.lastFullRaiseSize;
    if (state.currentBet === 0 && canCompete && player.stack > 0) {
      actions.push("bet");
    } else if (state.currentBet > 0 && canCompete && maxTo > state.currentBet &&
        canPlayerRaise(state, player) && maxTo >= minRaiseTo) {
      actions.push("raise");
    }
    var allInCalls = maxTo <= state.currentBet;
    var allInOpens = state.currentBet === 0 && canCompete;
    var allInRaises = state.currentBet > 0 && canCompete && canPlayerRaise(state, player);
    if (player.stack > 0 && (allInCalls || allInOpens || allInRaises)) actions.push("allin");
    return {
      actions: actions,
      callAmount: callAmount,
      minBet: state.currentBet === 0 ? minBet : null,
      minRaiseTo: state.currentBet > 0 && canCompete && canPlayerRaise(state, player) ? Math.min(minRaiseTo, maxTo) : null,
      maxRaiseTo: canCompete ? maxTo : player.streetBet + callAmount,
      pot: potTotal(state),
      currentBet: state.currentBet,
      streetBet: player.streetBet,
      stack: player.stack,
      step: normalizedChipUnit(state.settings.chipUnit),
      raiseReopened: canPlayerRaise(state, player)
    };
  }

  function legalActions(state, nick) {
    return legalActionsForPlayer(state, playerByNick(state, text(nick, 40)));
  }

  function finishByFold(state, winner, now) {
    var amount = potTotal(state);
    winner.stack += amount;
    winner.winAmount += amount;
    state.pots = [{ amount: amount, eligible: [winner.seat], winners: [winner.seat] }];
    state.showdown = [];
    state.actorSeat = null;
    state.actionDeadline = null;
    state.pendingSeats = [];
    state.phase = state.settings.mode !== "ring" &&
      state.seats.filter(function (player) { return !!player && !player.leaving && player.stack > 0; }).length <= 1
      ? "tournament_end"
      : "hand_end";
    state.lastEvent = { type: "hand_won", nick: winner.nick, amount: amount, reason: "folds", at: now };
    finishHandPlayers(state);
  }

  function finishHandPlayers(state) {
    state.botDueAt = null;
    state.seats.forEach(function (player, seat) {
      if (!player) return;
      if (player.stack <= 0 && state.settings.mode === "ring" && player.isBot) {
        player.stack = state.settings.refillAmount;
        player.ready = true;
      } else if (player.stack <= 0) player.ready = false;
      else if (!player.leaving) player.ready = true;
      if (player.isBot && Array.isArray(player.cards) && player.cards.length === 2) player.revealed = true;
      if (state.settings.mode === "ring" && !player.isBot && player.nick) {
        if (player.leaving) {
          addWalletAdjustment(state, player.nick, player.stack, "cash_out");
          delete state.ringStacks[player.nick];
        } else {
          state.ringStacks[player.nick] = clamp(
            player.stack,
            0,
            100000000,
            state.settings.startingStack
          );
        }
      }
      player.waiting = true;
      if (player.leaving) state.seats[seat] = null;
    });
  }

  function payoutShowdown(state, now) {
    var live = livePlayers(state);
    live.forEach(function (player) {
      player.revealed = true;
      player.evaluation = evaluateSeven(player.cards.concat(state.board));
    });
    var layers = buildSidePots(handPlayers(state));
    layers.refunds.forEach(function (refund) {
      var player = state.seats[refund.seat];
      if (player) player.stack += refund.amount;
    });
    var showdown = live.map(function (player) {
      return {
        seat: player.seat,
        nick: player.nick,
        cards: player.cards.slice(),
        category: player.evaluation.category,
        name: player.evaluation.name,
        tiebreak: player.evaluation.tiebreak.slice()
      };
    });
    layers.pots.forEach(function (pot) {
      var candidates = pot.eligible.map(function (seat) { return state.seats[seat]; }).filter(Boolean);
      var winners = [];
      var best = null;
      candidates.forEach(function (player) {
        if (!best || compareEvaluations(player.evaluation, best) > 0) {
          best = player.evaluation;
          winners = [player];
        } else if (compareEvaluations(player.evaluation, best) === 0) {
          winners.push(player);
        }
      });
      var chipUnit = normalizedChipUnit(state.settings.chipUnit);
      var share = winners.length
        ? Math.floor(pot.amount / winners.length / chipUnit) * chipUnit
        : 0;
      winners.forEach(function (winner) {
        winner.stack += share;
        winner.winAmount += share;
      });
      var remainder = winners.length ? pot.amount - share * winners.length : 0;
      var order = clockwiseWinnerOrder(winners.map(function (winner) { return winner.seat; }), state.buttonSeat, MAX_SEATS);
      for (var i = 0; i < Math.floor(remainder / chipUnit); i++) {
        var oddWinner = state.seats[order[i % order.length]];
        oddWinner.stack += chipUnit;
        oddWinner.winAmount += chipUnit;
      }
      pot.winners = winners.map(function (winner) { return winner.seat; });
    });
    state.pots = layers.pots;
    state.showdown = showdown;
    state.actorSeat = null;
    state.actionDeadline = null;
    state.pendingSeats = [];
    state.phase = state.settings.mode !== "ring" &&
      state.seats.filter(function (player) { return !!player && !player.leaving && player.stack > 0; }).length <= 1
      ? "tournament_end"
      : "hand_end";
    state.lastEvent = {
      type: "showdown",
      winners: layers.pots.map(function (pot) { return pot.winners.slice(); }),
      at: now
    };
    finishHandPlayers(state);
  }

  function runoutToShowdown(state, now) {
    while (state.board.length < 5) {
      if (state.board.length === 0) burnAndDeal(state, 3);
      else burnAndDeal(state, 1);
    }
    payoutShowdown(state, now);
  }

  function beginStreet(state, phase, now) {
    state.phase = phase;
    state.currentBet = 0;
    state.lastFullRaiseSize = state.settings.bigBlind;
    handPlayers(state).forEach(function (player) {
      player.streetBet = 0;
      player.lastActionBet = null;
      if (player.inHand && !player.folded) player.lastAction = "";
    });
    if (phase === "flop") burnAndDeal(state, 3);
    else burnAndDeal(state, 1);
    var capable = actionablePlayers(state);
    if (capable.length < 2) {
      runoutToShowdown(state, now);
      return;
    }
    var first = nextActionSeat(state, state.buttonSeat);
    state.pendingSeats = first == null ? [] : orderedSeats(state, first, function (player) {
      return player.inHand && !player.folded && !player.allIn && player.stack > 0;
    });
    assignActor(state, now);
  }

  function completeStreet(state, now) {
    if (state.phase === "preflop") beginStreet(state, "flop", now);
    else if (state.phase === "flop") beginStreet(state, "turn", now);
    else if (state.phase === "turn") beginStreet(state, "river", now);
    else payoutShowdown(state, now);
  }

  function settleProgress(state, now) {
    var live = livePlayers(state);
    if (live.length === 1) {
      finishByFold(state, live[0], now);
      return;
    }
    assignActor(state, now);
    if (!state.pendingSeats.length) completeStreet(state, now);
  }

  function appendActionHistory(state, entry) {
    if (!Array.isArray(state.actionHistory)) state.actionHistory = [];
    state.actionHistory.push({
      seq: Math.max(0, integer(entry.seq, 0)),
      handNo: Math.max(0, integer(entry.handNo, state.handNo)),
      phase: text(entry.phase, 16),
      seat: Math.max(0, integer(entry.seat, 0)),
      nick: text(entry.nick, 40),
      displayName: text(entry.displayName || entry.nick, 40),
      isBot: entry.isBot === true,
      action: text(entry.action, 20),
      amount: Math.max(0, integer(entry.amount, 0)),
      potBefore: Math.max(0, integer(entry.potBefore, 0)),
      potAfter: Math.max(0, integer(entry.potAfter, 0)),
      at: Math.max(0, integer(entry.at, 0))
    });
    if (state.actionHistory.length > ACTION_HISTORY_LIMIT) {
      state.actionHistory.splice(0, state.actionHistory.length - ACTION_HISTORY_LIMIT);
    }
  }

  function applyPlayerAction(state, player, action, amount, now) {
    var phaseBefore = state.phase;
    var potBefore = potTotal(state);
    var legal = legalActionsForPlayer(state, player);
    if (legal.actions.indexOf(action) < 0) return { ok: false, reason: "illegal_action" };
    var previousBet = state.currentBet;
    var fullRaise = false;
    var increased = false;
    var target;
    if (action === "fold") {
      player.folded = true;
      player.lastAction = "fold";
      player.lastActionBet = state.currentBet;
      removePending(state, player.seat);
    } else if (action === "check") {
      if (legal.callAmount !== 0) return { ok: false, reason: "cannot_check" };
      player.lastAction = "check";
      player.lastActionBet = state.currentBet;
      removePending(state, player.seat);
    } else if (action === "call") {
      postChips(player, legal.callAmount);
      player.lastAction = player.allIn ? "allin" : "call";
      player.lastActionBet = state.currentBet;
      removePending(state, player.seat);
    } else {
      target = integer(amount, NaN);
      if (action === "allin") target = player.streetBet + player.stack;
      if (!isFinite(target)) return { ok: false, reason: "amount" };
      if (
        action !== "allin" &&
        !isChipMultiple(target, state.settings.chipUnit)
      ) {
        return { ok: false, reason: "chip_unit" };
      }
      var maxTo = player.streetBet + player.stack;
      if (target <= player.streetBet || target > maxTo) return { ok: false, reason: "amount" };
      if (target <= state.currentBet) {
        if (action !== "allin") return { ok: false, reason: "amount" };
        postChips(player, Math.min(player.stack, state.currentBet - player.streetBet));
        player.lastAction = "allin";
        player.lastActionBet = state.currentBet;
        removePending(state, player.seat);
      } else {
        if (!hasBettableOpponent(state, player)) return { ok: false, reason: "no_raise_target" };
        var raiseSize = target - state.currentBet;
        if (state.currentBet === 0) {
          if (action !== "bet" && action !== "allin") return { ok: false, reason: "use_bet" };
          if (target < state.settings.bigBlind && target !== maxTo) return { ok: false, reason: "minimum_bet" };
          fullRaise = target >= state.settings.bigBlind;
        } else {
          if (action !== "raise" && action !== "allin") return { ok: false, reason: "use_raise" };
          if (!canPlayerRaise(state, player)) return { ok: false, reason: "raise_not_reopened" };
          if (raiseSize < state.lastFullRaiseSize && target !== maxTo) return { ok: false, reason: "minimum_raise" };
          fullRaise = raiseSize >= state.lastFullRaiseSize;
        }
        postChips(player, target - player.streetBet);
        state.currentBet = target;
        increased = true;
        if (fullRaise) state.lastFullRaiseSize = state.currentBet === target && previousBet === 0
          ? target
          : target - previousBet;
        player.lastAction = player.allIn ? "allin" : (previousBet === 0 ? "bet" : "raise");
        player.lastActionBet = state.currentBet;
        removePending(state, player.seat);
        pendingAfterIncrease(state, player.seat, fullRaise);
      }
    }
    state.actionSeq += 1;
    appendActionHistory(state, {
      seq: state.actionSeq,
      handNo: state.handNo,
      phase: phaseBefore,
      seat: player.seat,
      nick: player.nick,
      displayName: player.displayName,
      isBot: player.isBot,
      action: player.lastAction,
      amount: player.streetBet,
      potBefore: potBefore,
      potAfter: potTotal(state),
      at: now
    });
    state.lastEvent = {
      type: "action",
      nick: player.nick,
      action: player.lastAction,
      amount: player.streetBet,
      fullRaise: increased ? fullRaise : false,
      at: now
    };
    settleProgress(state, now);
    return { ok: true };
  }

  function chooseButton(state, active, context) {
    if (active.length === 2) {
      if (state.previousBigBlindSeat != null && state.seats[state.previousBigBlindSeat] &&
          active.some(function (player) { return player.seat === state.previousBigBlindSeat; })) {
        return state.previousBigBlindSeat;
      }
      if (state.buttonSeat != null && active.some(function (player) { return player.seat === state.buttonSeat; })) {
        return state.buttonSeat;
      }
      return active[0].seat;
    }
    if (state.buttonSeat == null) {
      var randomInt = context && typeof context.randomInt === "function" ? context.randomInt : defaultRandomInt;
      return active[integer(randomInt(active.length), 0)].seat;
    }
    return (state.buttonSeat + 1) % MAX_SEATS;
  }

  function startHand(state, now, context) {
    updateBlindLevel(state, now);
    var active = state.seats.filter(function (player) {
      return !!player && !player.leaving && player.stack > 0;
    });
    var eligible = state.seats.filter(function (player) {
      return !!player && !player.leaving && player.stack > 0;
    });
    if (eligible.length < 2 || active.length < 2) return { ok: false, reason: "not_enough_players" };
    state.buttonSeat = chooseButton(state, active, context);
    var headsUp = active.length === 2;
    state.smallBlindSeat = headsUp
      ? state.buttonSeat
      : nextSeatMatching(state, state.buttonSeat, function (player) { return !player.leaving && player.stack > 0; });
    state.bigBlindSeat = nextSeatMatching(state, state.smallBlindSeat, function (player) { return !player.leaving && player.stack > 0; });
    if (state.smallBlindSeat == null || state.bigBlindSeat == null) return { ok: false, reason: "blinds" };
    state.previousBigBlindSeat = state.bigBlindSeat;
    state.handNo += 1;
    state.phase = "preflop";
    state.board = [];
    state.burn = [];
    state.deck = shuffleDeck(context && context.randomInt);
    state.currentBet = state.settings.bigBlind;
    state.lastFullRaiseSize = state.settings.bigBlind;
    state.pots = [];
    state.showdown = [];
    state.actionHistory = [];
    state.botDueAt = null;
    state.seats.forEach(function (player) {
      if (!player) return;
      player.inHand = !player.leaving && player.stack > 0;
      player.waiting = !player.inHand;
      player.folded = false;
      player.allIn = false;
      player.streetBet = 0;
      player.totalBet = 0;
      player.cards = [];
      player.revealed = false;
      player.lastAction = "";
      player.lastActionBet = null;
      player.winAmount = 0;
      player.evaluation = null;
      player.ready = false;
    });
    postChips(state.seats[state.smallBlindSeat], state.settings.smallBlind);
    state.seats[state.smallBlindSeat].lastAction = "small_blind";
    postChips(state.seats[state.bigBlindSeat], state.settings.bigBlind);
    state.seats[state.bigBlindSeat].lastAction = "big_blind";
    var firstDealSeat = nextLiveSeat(state, state.buttonSeat);
    var dealOrder = orderedSeats(state, firstDealSeat, function (player) { return player.inHand; });
    for (var round = 0; round < 2; round++) {
      dealOrder.forEach(function (seat) { state.seats[seat].cards.push(dealCard(state)); });
    }
    var firstActor = headsUp ? state.smallBlindSeat : nextActionSeat(state, state.bigBlindSeat);
    state.pendingSeats = firstActor == null ? [] : orderedSeats(state, firstActor, function (player) {
      return player.inHand && !player.folded && !player.allIn && player.stack > 0;
    });
    state.lastEvent = {
      type: "hand_started",
      handNo: state.handNo,
      blindLevel: state.blindLevel,
      at: now
    };
    assignActor(state, now);
    if (!state.pendingSeats.length) runoutToShowdown(state, now);
    return { ok: true };
  }

  function rememberRequest(state, requestId) {
    requestId = text(requestId, 140);
    if (!requestId) return;
    state.recentRequestIds.push(requestId);
    if (state.recentRequestIds.length > 128) state.recentRequestIds.splice(0, state.recentRequestIds.length - 128);
  }

  function reserveBotIdentity(state) {
    var sequence = Math.max(1, integer(state.nextBotSeq, 1));
    var botId;
    var displayName;
    do {
      botId = "bot-" + sequence;
      displayName = BOT_DISPLAY_NAME + " " + sequence;
      sequence += 1;
    } while (botById(state, botId) || anyPlayerByNick(state, displayName));
    state.nextBotSeq = sequence;
    return { botId: botId, displayName: displayName };
  }

  function command(state, cmd, context) {
    context = context || {};
    cmd = cmd || {};
    if (!validState(state)) return { ok: false, state: state, changed: false, reason: "invalid_state" };
    var requestId = text(cmd.requestId, 140);
    if (requestId && state.recentRequestIds.indexOf(requestId) >= 0) {
      return { ok: true, state: state, changed: false, reason: "duplicate" };
    }
    var now = Math.max(0, integer(context.now, Date.now()));
    var type = text(cmd.type, 20);
    var nick = text(cmd.nick, 40);
    var next = ensureAdditiveState(clone(state), now);
    var player;
    var changed = false;
    var result = { ok: false, reason: "command" };
    try {
      if (type === "join") {
        if (!nick) result = { ok: false, reason: "nick" };
        else if (playerByNick(next, nick)) {
          player = playerByNick(next, nick);
          var requestedMoveSeat = integer(cmd.seat, -1);
          if (requestedMoveSeat >= 0 && requestedMoveSeat < MAX_SEATS && requestedMoveSeat !== player.seat) {
            if (PLAYING_PHASES[next.phase]) result = { ok: false, reason: "hand_active" };
            else if (next.seats[requestedMoveSeat]) result = { ok: false, reason: "seat_taken" };
            else {
              next.seats[player.seat] = null;
              player.seat = requestedMoveSeat;
              player.leaving = false;
              next.seats[requestedMoveSeat] = player;
              next.lastEvent = { type: "seat_moved", nick: nick, seat: requestedMoveSeat, at: now };
              result = { ok: true };
              changed = true;
            }
          } else {
            player.leaving = false;
            result = { ok: true, reason: "already_joined" };
            changed = true;
          }
        } else if (anyPlayerByNick(next, nick)) {
          result = { ok: false, reason: "nick_reserved" };
        } else if (next.settings.mode === "ring" && botPlayers(next).length > 0) {
          result = { ok: false, reason: "practice_ai_only" };
        } else if (occupiedPlayers(next).length >= next.settings.maxPlayers) {
          result = { ok: false, reason: "table_full" };
        } else {
          var requestedJoinSeat = integer(cmd.seat, -1);
          var seat = requestedJoinSeat >= 0 && requestedJoinSeat < MAX_SEATS
            ? requestedJoinSeat
            : next.seats.indexOf(null);
          if (seat < 0) result = { ok: false, reason: "table_full" };
          else if (next.seats[seat]) result = { ok: false, reason: "seat_taken" };
          else {
            var hasSavedRingStack = next.settings.mode === "ring" &&
              own(next.ringStacks, nick) && Number(next.ringStacks[nick]) > 0;
            var joinStack = next.settings.mode === "ring"
              ? (hasSavedRingStack
                ? clamp(next.ringStacks[nick], 0, 100000000, next.settings.startingStack)
                : requestedRingBuyIn(next, cmd))
              : next.settings.startingStack;
            next.seats[seat] = createPlayer(nick, seat, joinStack, now);
            if (next.settings.mode === "ring") {
              next.ringStacks[nick] = joinStack;
              if (next.settings.assetBacked === true && !hasSavedRingStack) {
                addWalletAdjustment(next, nick, -joinStack, "buy_in");
              }
              if (humanPlayers(next).length >= 2) convertRingTableToAssetBacked(next);
            }
            next.lastEvent = { type: "joined", nick: nick, seat: seat, at: now };
            result = { ok: true };
            changed = true;
          }
        }
      } else if (type === "join_request") {
        var target = practiceJoinTarget(next);
        if (!nick) result = { ok: false, reason: "nick" };
        else if (!target) result = { ok: false, reason: "request_unavailable" };
        else if (playerByNick(next, nick)) result = { ok: false, reason: "already_joined" };
        else if (anyPlayerByNick(next, nick)) result = { ok: false, reason: "nick_reserved" };
        else if (occupiedPlayers(next).length >= next.settings.maxPlayers || emptySeatIndexes(next).length <= 0) {
          result = { ok: false, reason: "table_full" };
        } else if (pendingJoinRequest(next, nick, target.nick)) {
          result = { ok: true, reason: "already_requested" };
        } else {
          next.pendingJoinRequests.push({
            nick: nick,
            targetNick: target.nick,
            requestedAt: now,
            expiresAt: now + JOIN_REQUEST_TTL_MS
          });
          next.lastEvent = { type: "join_requested", nick: nick, targetNick: target.nick, at: now };
          result = { ok: true };
          changed = true;
        }
      } else if (type === "resolve_join_request") {
        var requester = text(cmd.requester, 40);
        var accepted = cmd.accepted === true;
        player = playerByNick(next, nick);
        var pending = pendingJoinRequest(next, requester, nick);
        if (!nick || !requester) result = { ok: false, reason: "nick" };
        else if (!player || player.isBot) result = { ok: false, reason: "not_joined" };
        else if (!pending) result = { ok: false, reason: "request_missing" };
        else {
          removeJoinRequest(next, requester, nick);
          if (!accepted) {
            next.lastEvent = { type: "join_declined", nick: requester, targetNick: nick, at: now };
            result = { ok: true };
            changed = true;
          } else if (playerByNick(next, requester)) {
            next.lastEvent = { type: "join_accepted", nick: requester, targetNick: nick, reason: "already_joined", at: now };
            result = { ok: true };
            changed = true;
          } else if (anyPlayerByNick(next, requester)) {
            result = { ok: false, reason: "nick_reserved" };
          } else if (occupiedPlayers(next).length >= next.settings.maxPlayers) {
            result = { ok: false, reason: "table_full" };
          } else {
            var acceptedSeat = randomEmptySeat(next, context.randomInt);
            if (acceptedSeat < 0) result = { ok: false, reason: "table_full" };
            else {
              var acceptedPlayer = createPlayer(requester, acceptedSeat, next.settings.startingStack, now);
              acceptedPlayer.ready = true;
              if (PLAYING_PHASES[next.phase]) {
                acceptedPlayer.waiting = false;
                acceptedPlayer.inHand = false;
                acceptedPlayer.folded = false;
                acceptedPlayer.cards = [];
              }
              next.seats[acceptedSeat] = acceptedPlayer;
              if (next.settings.mode === "ring") next.ringStacks[requester] = acceptedPlayer.stack;
              next.lastEvent = {
                type: "join_accepted",
                nick: requester,
                targetNick: nick,
                seat: acceptedSeat,
                at: now
              };
              result = { ok: true };
              changed = true;
            }
          }
        }
      } else if (type === "leave") {
        player = playerByNick(next, nick);
        if (!player) result = { ok: true, reason: "not_joined" };
        else if (PLAYING_PHASES[next.phase] && player.inHand && !player.folded) {
          player.leaving = true;
          if (player.seat === next.actorSeat) {
            result = applyPlayerAction(next, player, "fold", null, now);
          } else {
            player.folded = true;
            player.lastAction = "fold";
            removePending(next, player.seat);
            next.lastEvent = { type: "left", nick: nick, at: now };
            settleProgress(next, now);
            result = { ok: true };
          }
          if (!PLAYING_PHASES[next.phase] && next.seats[player.seat] === player) {
            next.seats[player.seat] = null;
          }
          changed = result.ok;
        } else {
          if (next.settings.mode === "ring" && !player.isBot && player.nick) {
            addWalletAdjustment(next, player.nick, player.stack, "cash_out");
            delete next.ringStacks[player.nick];
          }
          next.seats[player.seat] = null;
          next.lastEvent = { type: "left", nick: nick, at: now };
          result = { ok: true };
          changed = true;
        }
      } else if (type === "ready") {
        player = playerByNick(next, nick);
        if (!player) result = { ok: false, reason: "not_joined" };
        else if (PLAYING_PHASES[next.phase]) result = { ok: false, reason: "hand_active" };
        else if (player.stack <= 0) result = {
          ok: false,
          reason: next.settings.mode === "ring" ? "refill_required" : "eliminated"
        };
        else {
          player.ready = cmd.ready == null ? !player.ready : !!cmd.ready;
          next.lastEvent = { type: "ready", nick: nick, ready: player.ready, at: now };
          result = { ok: true };
          changed = true;
        }
      } else if (type === "refill") {
        player = playerByNick(next, nick);
        if (next.settings.mode !== "ring") result = { ok: false, reason: "ring_only" };
        else if (context.internalRefill !== true) result = { ok: false, reason: "internal" };
        else if (!player || player.isBot) result = { ok: false, reason: "not_joined" };
        else if (PLAYING_PHASES[next.phase]) result = { ok: false, reason: "hand_active" };
        else if (player.stack > 0) result = { ok: false, reason: "refill_not_needed" };
        else {
          player.stack = next.settings.refillAmount;
          player.ready = true;
          player.waiting = true;
          player.inHand = false;
          player.folded = false;
          player.allIn = false;
          player.streetBet = 0;
          player.totalBet = 0;
          player.cards = [];
          player.revealed = false;
          player.lastAction = "";
          player.lastActionBet = null;
          player.winAmount = 0;
          next.ringStacks[nick] = next.settings.refillAmount;
          next.lastEvent = {
            type: "ring_refilled",
            nick: nick,
            amount: next.settings.refillAmount,
            at: now
          };
          result = { ok: true };
          changed = true;
        }
      } else if (type === "rebuy") {
        player = playerByNick(next, nick);
        if (next.settings.mode !== "ring") result = { ok: false, reason: "ring_only" };
        else if (!player || player.isBot) result = { ok: false, reason: "not_joined" };
        else if (PLAYING_PHASES[next.phase]) result = { ok: false, reason: "hand_active" };
        else if (player.stack > 0) result = { ok: false, reason: "refill_not_needed" };
        else {
          var rebuyAmount = requestedRingBuyIn(next, cmd);
          player.stack = rebuyAmount;
          player.ready = true;
          player.waiting = true;
          player.inHand = false;
          player.folded = false;
          player.allIn = false;
          player.streetBet = 0;
          player.totalBet = 0;
          player.cards = [];
          player.revealed = false;
          player.lastAction = "";
          player.lastActionBet = null;
          player.winAmount = 0;
          next.ringStacks[nick] = rebuyAmount;
          addWalletAdjustment(next, nick, -rebuyAmount, "rebuy");
          next.lastEvent = {
            type: "ring_rebuy",
            nick: nick,
            amount: rebuyAmount,
            at: now
          };
          result = { ok: true };
          changed = true;
        }
      } else if (type === "settings") {
        if (nick !== next.ownerNick) result = { ok: false, reason: "owner" };
        else if (PLAYING_PHASES[next.phase] || next.handNo > 0) result = { ok: false, reason: "settings_locked" };
        else {
          var sb = next.settings.mode === "ring"
            ? next.settings.initialSmallBlind
            : roundToChipUnit(
              clamp(
                cmd.smallBlind,
                next.settings.chipUnit,
                1000000,
                next.settings.initialSmallBlind
              ),
              next.settings.chipUnit
            );
          var bb = next.settings.mode === "ring"
            ? next.settings.initialBigBlind
            : roundToChipUnit(
              clamp(cmd.bigBlind, sb * 2, 2000000, next.settings.initialBigBlind),
              next.settings.chipUnit
            );
          next.settings.startingStack = next.settings.mode === "ring"
            ? next.settings.startingStack
            : roundToChipUnit(
              clamp(
                cmd.startingStack,
                bb * 10,
                100000000,
                next.settings.startingStack
              ),
              next.settings.chipUnit
            );
          next.settings.initialSmallBlind = sb;
          next.settings.initialBigBlind = bb;
          next.settings.smallBlind = sb;
          next.settings.bigBlind = bb;
          next.settings.actionMs = clamp(cmd.actionMs, 5000, 120000, next.settings.actionMs);
          next.lastFullRaiseSize = bb;
          next.lastEvent = { type: "settings", at: now };
          result = { ok: true };
          changed = true;
        }
      } else if (type === "add_bot") {
        if (nick !== next.ownerNick) result = { ok: false, reason: "owner" };
        else if (next.phase !== "waiting" || next.handNo !== 0) result = { ok: false, reason: "bots_locked" };
        else if (humanPlayers(next).length !== 1) result = { ok: false, reason: "bots_solo_only" };
        else {
          if (occupiedPlayers(next).length >= next.settings.maxPlayers) {
            result = { ok: false, reason: "table_full" };
          } else {
            var requestedSeat = integer(cmd.seat, -1);
            var botSeat = requestedSeat >= 0 && requestedSeat < MAX_SEATS
              ? requestedSeat
              : next.seats.indexOf(null);
            if (botSeat < 0) result = { ok: false, reason: "table_full" };
            else if (next.seats[botSeat]) result = { ok: false, reason: "seat_taken" };
            else {
              convertRingTableToPractice(next);
              var identity = reserveBotIdentity(next);
              var botPersonality = chooseBotPersonality(next, context.randomInt);
              next.seats[botSeat] = createPlayer(identity.displayName, botSeat, next.settings.startingStack, now, {
                isBot: true,
                botId: identity.botId,
                botPersonality: botPersonality,
                displayName: identity.displayName
              });
              next.lastEvent = {
                type: "bot_added",
                seat: botSeat,
                botId: identity.botId,
                botPersonality: botPersonality,
                displayName: identity.displayName,
                at: now
              };
              result = { ok: true };
              changed = true;
            }
          }
        }
      } else if (type === "remove_bot") {
        if (nick !== next.ownerNick) result = { ok: false, reason: "owner" };
        else if (next.phase !== "waiting" || next.handNo !== 0) result = { ok: false, reason: "bots_locked" };
        else {
          player = botById(next, cmd.botId);
          if (!player) result = { ok: false, reason: "bot_not_found" };
          else {
            next.seats[player.seat] = null;
            next.botDueAt = null;
            next.lastEvent = {
              type: "bot_removed",
              seat: player.seat,
              botId: player.botId,
              botPersonality: player.botPersonality,
              displayName: player.displayName,
              at: now
            };
            result = { ok: true };
            changed = true;
          }
        }
      } else if (type === "start") {
        if (PLAYING_PHASES[next.phase]) result = { ok: false, reason: "hand_active" };
        else if (next.phase === "tournament_end") result = { ok: false, reason: "tournament_end" };
        else {
          result = startHand(next, now, context);
          changed = result.ok;
        }
      } else if (type === "act") {
        player = playerByNick(next, nick);
        if (!player) result = { ok: false, reason: "not_joined" };
        else if (player.seat !== next.actorSeat) result = { ok: false, reason: "turn" };
        else {
          result = applyPlayerAction(next, player, text(cmd.action, 16).toLowerCase(), cmd.amount, now);
          changed = result.ok;
        }
      } else if (type === "bot_act") {
        if (context.internalBot !== true) result = { ok: false, reason: "internal" };
        else {
          player = botById(next, cmd.botId);
          if (!player) result = { ok: false, reason: "bot_not_found" };
          else if (player.seat !== next.actorSeat) result = { ok: false, reason: "turn" };
          else if (next.actionDeadline != null && now >= next.actionDeadline) {
            var expiredLegal = legalActionsForPlayer(next, player);
            var expiredAction = expiredLegal.actions.indexOf("check") >= 0 ? "check" : "fold";
            result = applyPlayerAction(next, player, expiredAction, null, now);
            if (result.ok) {
              next.lastEvent.timeout = true;
              changed = true;
            }
          }
          else if (next.botDueAt != null && now < next.botDueAt) result = { ok: false, reason: "not_due" };
          else {
            result = applyPlayerAction(next, player, text(cmd.action, 16).toLowerCase(), cmd.amount, now);
            changed = result.ok;
          }
        }
      } else if (type === "tick") {
        if (!PLAYING_PHASES[next.phase] || next.actorSeat == null || next.actionDeadline == null || now < next.actionDeadline) {
          result = { ok: true, reason: "not_due" };
        } else {
          player = next.seats[next.actorSeat];
          var legal = legalActionsForPlayer(next, player);
          var timeoutAction = legal.actions.indexOf("check") >= 0 ? "check" : "fold";
          result = applyPlayerAction(next, player, timeoutAction, null, now);
          if (result.ok) {
            next.lastEvent.timeout = true;
            changed = true;
          }
        }
      } else {
        result = { ok: false, reason: "command" };
      }
    } catch (error) {
      return {
        ok: false,
        state: state,
        changed: false,
        reason: error && error.message ? text(error.message, 80) : "engine"
      };
    }
    if (!result.ok) return { ok: false, state: state, changed: false, reason: result.reason || "rejected" };
    if (changed) rememberRequest(next, requestId);
    return {
      ok: true,
      state: changed ? next : state,
      changed: changed,
      reason: result.reason,
      event: changed ? clone(next.lastEvent) : undefined
    };
  }

  function publicPlayer(player, viewerPlayer, revealAll) {
    if (!player) return null;
    var out = {
      seat: player.seat,
      nick: player.nick,
      displayName: text(player.displayName || player.nick, 40),
      isBot: player.isBot === true,
      botId: player.isBot ? text(player.botId, 40) : null,
      botPersonality: player.isBot
        ? normalizeBotPersonality(player.botPersonality) || legacyBotPersonality(player, player.seat)
        : null,
      stack: player.stack,
      ready: !!player.ready,
      waiting: !!player.waiting,
      leaving: !!player.leaving,
      inHand: !!player.inHand,
      folded: !!player.folded,
      allIn: !!player.allIn,
      streetBet: player.streetBet,
      totalBet: player.totalBet,
      lastAction: player.lastAction || "",
      lastActionBet: player.lastActionBet == null ? null : player.lastActionBet,
      winAmount: player.winAmount || 0,
      cardCount: player.inHand && player.cards.length ? player.cards.length : 0
    };
    if ((viewerPlayer && player.seat === viewerPlayer.seat) ||
        (revealAll && player.revealed && (!player.folded || player.isBot))) {
      out.cards = player.cards.slice();
    }
    if (player.revealed && player.evaluation) {
      out.handName = player.evaluation.name;
      out.handCategory = player.evaluation.category;
    }
    return out;
  }

  function safeEvent(event) {
    if (!event || typeof event !== "object") return null;
    var allowed = [
      "type", "nick", "seat", "ready", "handNo", "action", "amount",
      "fullRaise", "timeout", "winners", "reason", "at", "botId",
      "botPersonality", "displayName", "targetNick"
    ];
    var out = {};
    allowed.forEach(function (key) {
      if (own(event, key)) out[key] = clone(event[key]);
    });
    return out;
  }

  function safeActionHistory(history) {
    if (!Array.isArray(history)) return [];
    return history.slice(-ACTION_HISTORY_LIMIT).map(function (entry) {
      entry = entry || {};
      return {
        seq: Math.max(0, integer(entry.seq, 0)),
        handNo: Math.max(0, integer(entry.handNo, 0)),
        phase: text(entry.phase, 16),
        seat: Math.max(0, integer(entry.seat, 0)),
        nick: text(entry.nick, 40),
        displayName: text(entry.displayName || entry.nick, 40),
        isBot: entry.isBot === true,
        action: text(entry.action, 20),
        amount: Math.max(0, integer(entry.amount, 0)),
        potBefore: Math.max(0, integer(entry.potBefore, 0)),
        potAfter: Math.max(0, integer(entry.potAfter, 0)),
        at: Math.max(0, integer(entry.at, 0))
      };
    });
  }

  function publicShowdown(state, revealAll) {
    if (!revealAll) return [];
    var out = Array.isArray(state.showdown) ? clone(state.showdown) : [];
    var includedSeats = {};
    out.forEach(function (entry) {
      if (entry && entry.seat != null) includedSeats[integer(entry.seat, -1)] = true;
    });
    state.seats.forEach(function (player) {
      if (!player || !player.isBot || !Array.isArray(player.cards) ||
          player.cards.length !== 2 || includedSeats[player.seat]) return;
      out.push({
        seat: player.seat,
        nick: player.nick,
        displayName: text(player.displayName || player.nick, 40),
        isBot: true,
        botPersonality: normalizeBotPersonality(player.botPersonality) || legacyBotPersonality(player, player.seat),
        cards: player.cards.slice(),
        folded: !!player.folded,
        testReveal: true,
        aiReveal: true
      });
    });
    return out;
  }

  function buildView(state, viewerPlayer, viewerNick, canManageBots) {
    var revealAll = state.phase === "hand_end" || state.phase === "tournament_end";
    var layers = PLAYING_PHASES[state.phase] ? buildSidePots(handPlayers(state)).pots : state.pots;
    var occupied = occupiedPlayers(state);
    var readyEligible = occupied.filter(function (player) {
      return player.stack > 0 && !player.leaving;
    });
    var viewerLegal = legalActionsForPlayer(state, viewerPlayer);
    var viewerHand = null;
    if (viewerPlayer && viewerPlayer.cards.length === 2 && state.board.length >= 3) {
      viewerHand = evaluateSeven(viewerPlayer.cards.concat(state.board));
    }
    var canStart = !PLAYING_PHASES[state.phase] && state.phase !== "tournament_end" &&
      !!viewerPlayer && !viewerPlayer.isBot && !viewerPlayer.leaving &&
      viewerPlayer.stack > 0 && readyEligible.length >= 2;
    var actorPlayer = state.actorSeat == null ? null : state.seats[state.actorSeat];
    var actorIsBot = !!(actorPlayer && actorPlayer.isBot);
    var buyInBounds = state.settings.mode === "ring"
      ? ringBuyInBounds(state)
      : { min: state.settings.startingStack, max: state.settings.startingStack, defaultAmount: state.settings.startingStack };
    var winnerNicks = [];
    state.pots.forEach(function (pot) {
      (pot.winners || []).forEach(function (seat) {
        var winner = state.seats[seat];
        if (winner && winnerNicks.indexOf(winner.nick) < 0) winnerNicks.push(winner.nick);
      });
    });
    return {
      schemaVersion: state.schemaVersion,
      roomId: state.roomId,
      ownerNick: state.ownerNick,
      viewerNick: viewerNick,
      phase: state.phase,
      settings: clone(state.settings),
      mode: state.settings.mode,
      tournamentSpeed: state.settings.tournamentSpeed,
      blindLevel: Math.max(0, integer(state.blindLevel, 0)),
      nextBlindAt: state.nextBlindAt == null ? null : Math.max(0, integer(state.nextBlindAt, 0)),
      canRefill: state.settings.mode === "ring" && !!viewerPlayer &&
        !viewerPlayer.isBot && viewerPlayer.stack <= 0 && !PLAYING_PHASES[state.phase],
      refillAmount: state.settings.refillAmount,
      buyInMin: buyInBounds.min,
      buyInMax: buyInBounds.max,
      buyInDefault: buyInBounds.defaultAmount,
      dailyRefillLimit: state.settings.dailyRefillLimit,
      seats: state.seats.map(function (player) { return publicPlayer(player, viewerPlayer, revealAll); }),
      handNo: state.handNo,
      handId: String(state.handNo),
      buttonSeat: state.buttonSeat,
      smallBlindSeat: state.smallBlindSeat,
      bigBlindSeat: state.bigBlindSeat,
      actorSeat: state.actorSeat,
      actingSeat: state.actorSeat,
      actionDeadline: state.actionDeadline,
      deadlineAt: state.actionDeadline,
      actorIsBot: actorIsBot,
      botDueAt: actorIsBot && state.botDueAt != null ? Math.max(0, integer(state.botDueAt, 0)) : null,
      actionDurationMs: state.settings.actionMs,
      botPersonality: viewerPlayer && viewerPlayer.isBot
        ? normalizeBotPersonality(viewerPlayer.botPersonality) ||
          legacyBotPersonality(viewerPlayer, viewerPlayer.seat)
        : null,
      board: state.board.slice(),
      heroCards: viewerPlayer ? viewerPlayer.cards.slice() : [],
      currentBet: state.currentBet,
      lastFullRaiseSize: state.lastFullRaiseSize,
      pot: potTotal(state),
      pots: layers.map(function (pot) {
        return {
          amount: pot.amount,
          eligible: pot.eligible.slice(),
          winners: Array.isArray(pot.winners) ? pot.winners.slice() : []
        };
      }),
      showdown: publicShowdown(state, revealAll),
      winners: winnerNicks,
      legalActions: viewerLegal,
      viewer: {
        seat: viewerPlayer ? viewerPlayer.seat : null,
        cards: viewerPlayer ? viewerPlayer.cards.slice() : [],
        legalActions: viewerLegal,
        toCall: viewerLegal.callAmount,
        minBet: viewerLegal.minBet,
        minRaise: viewerLegal.minRaiseTo,
        maxRaise: viewerLegal.maxRaiseTo,
        deadlineAt: state.actionDeadline,
        actionDurationMs: state.settings.actionMs,
        handName: viewerHand ? viewerHand.name : ""
      },
      canReady: false,
      canStart: canStart,
      canNext: state.phase === "hand_end" && canStart,
      canManageBots: canManageBots === true && state.phase === "waiting" && state.handNo === 0,
      pendingJoinRequests: state.pendingJoinRequests.map(function (request) {
        return {
          nick: request.nick,
          targetNick: request.targetNick,
          requestedAt: request.requestedAt,
          expiresAt: request.expiresAt
        };
      }),
      lastEvent: safeEvent(state.lastEvent),
      actionSeq: state.actionSeq,
      actionHistory: safeActionHistory(state.actionHistory)
    };
  }

  function view(state, viewerNick) {
    if (!validState(state)) return null;
    viewerNick = text(viewerNick, 40);
    var viewerPlayer = playerByNick(state, viewerNick);
    return buildView(state, viewerPlayer, viewerNick, viewerNick === state.ownerNick);
  }

  function botView(state, botId) {
    if (!validState(state)) return null;
    var viewerPlayer = botById(state, botId);
    if (!viewerPlayer) return null;
    return buildView(
      state,
      viewerPlayer,
      text(viewerPlayer.displayName || viewerPlayer.nick, 40),
      false
    );
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_SEATS: MAX_SEATS,
    BOT_PERSONALITIES: clone(BOT_PERSONALITIES),
    createTable: createTable,
    command: command,
    view: view,
    botView: botView,
    legalActions: legalActions,
    makeDeck: makeDeck,
    shuffleDeck: shuffleDeck,
    evaluateFive: evaluateFive,
    evaluateSeven: evaluateSeven,
    compareEvaluations: compareEvaluations,
    buildSidePots: buildSidePots,
    clockwiseWinnerOrder: clockwiseWinnerOrder
  };
});
