/*
 * Texas Hold'em client controller.
 *
 * Integration contract
 * --------------------
 * Screen/root: #holdemgame, #holdem-stage
 * Readouts: #holdem-status, #holdem-connection, #holdem-phase,
 *   #holdem-blinds, #holdem-hand-number, #holdem-pot,
 *   #holdem-pot-amount, #holdem-side-pots, #holdem-board,
 *   #holdem-seats, #holdem-announcer, #holdem-people-count
 * Waiting UI: #holdem-lobby, #holdem-lobby-title,
 *   #holdem-lobby-roster, #holdem-ready-btn, #holdem-start-btn,
 *   #holdem-next-btn, #holdem-bot-controls,
 *   #holdem-bot-add-btn, #holdem-bot-remove-btn, #holdem-bot-fill-btn,
 *   #holdem-bot-count
 * Action UI: #holdem-action-panel, #holdem-action-label,
 *   #holdem-hand-name, #holdem-timer-ring, #holdem-timer,
 *   #holdem-raise-panel, #holdem-raise-slider,
 *   #holdem-raise-amount, #holdem-fold-btn, #holdem-check-btn,
 *   #holdem-call-btn, #holdem-call-amount, #holdem-bet-btn,
 *   #holdem-raise-btn, #holdem-allin-btn
 * Utility/chat: #holdem-settings-btn, #holdem-people-btn,
 *   #holdem-rules-btn, #holdem-leave-btn, #holdem-chat-input,
 *   #holdem-chat-send, #holdem-chat-overlay
 * Quick bet buttons: [data-holdem-bet="half|three-quarter|pot|allin"]
 *
 * Seat/card classes intentionally match the Hold'em stylesheet:
 *   .holdem-seat[data-relative-seat="0".."5"], .holdem-seat-avatar,
 *   .holdem-seat-name, .holdem-seat-stack, .holdem-seat-badges,
 *   .holdem-hole-cards, and .holdem-card.red|black|back|empty.
 *
 * Network contract
 * ----------------
 * The server is authoritative. Every request goes through
 * Db.holdemInvoke(auth, endpointAction, payload), with roomId from
 * api.roomId(). Poker moves use endpoint action "act" and a public
 * payload field `move` (fold/check/call/bet/raise/allin).
 *
 * Realtime broadcasts contain only a version hint. Personalized
 * snapshots (including this viewer's hole cards) are fetched directly;
 * this controller deliberately ignores any snapshot/cards attached to
 * a public holdem_refresh message.
 *
 * A local HoldemEngine is used only when #holdemgame explicitly has
 * data-holdem-demo="true". It is never an online authority.
 */
window.TexasHoldem = (function () {
  "use strict";

  var MAX_SEATS = 6;
  var POLL_MS = 5000;
  var CLOCK_MS = 250;
  var REFRESH_DEBOUNCE_MS = 90;
  var AUTO_NEXT_HAND_MS = 5000;
  var RESULT_CARDS_FIRST_MS = 900;
  var RESULT_BOARD_REVEAL_STEP_MS = 900;
  var RESULT_SETTLE_MS = 1600;
  var BOT_PERSONALITY_LABELS = {
    tight_passive: "타이트 패시브",
    tight_aggressive: "타이트 어그레시브",
    loose_passive: "루즈 패시브",
    loose_aggressive: "루즈 어그레시브"
  };

  var api = null;
  var active = false;
  var connected = true;
  var joined = false;
  var hasSnapshot = false;
  var lastError = "";
  var state = emptyState();
  var rawSnapshot = null;
  var moneyUnitMode = "chips";
  var settingsOpen = false;

  var pollId = null;
  var clockId = null;
  var refreshTimer = null;
  var botTimer = null;
  var botTimerKey = "";
  var botSentKey = "";
  var botRetryAt = 0;
  var requestCounter = 0;
  var responseCounter = 0;
  var lastAppliedResponse = 0;
  var pendingCount = 0;
  var pendingUiCount = 0;
  var pendingAction = "";
  var requests = Object.create(null);
  var lifecycleGeneration = 0;
  var tickSentKey = "";
  var tickRetryAt = 0;
  var lastPresenceKey = "";
  var lastAnnouncementKey = "";
  var raiseValue = 0;
  var raiseRangeKey = "";
  var raiseMenuOpen = false;
  var actionMenuKey = "";
  var autoNextTimer = null;
  var autoNextKey = "";
  var autoNextDueAt = 0;
  var autoReadyTimer = null;
  var autoReadyKey = "";
  var resultFlow = null;

  var boundRoot = null;
  var demoState = null;
  var demoVersion = 0;

  function $(id) {
    return typeof document !== "undefined" ? document.getElementById(id) : null;
  }

  function root() {
    return $("holdemgame");
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function own(value, key) {
    return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
  }

  function firstDefined() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return undefined;
  }

  function firstObject() {
    for (var i = 0; i < arguments.length; i++) {
      if (isObject(arguments[i])) return arguments[i];
    }
    return {};
  }

  function finite(value, fallback) {
    var number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function integer(value, fallback) {
    var number = finite(value, NaN);
    return Number.isFinite(number) ? Math.floor(number) : fallback;
  }

  function nonnegative(value, fallback) {
    var number = finite(value, NaN);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function bool(value, fallback) {
    if (value === true || value === false) return value;
    return fallback;
  }

  function text(value, max) {
    return String(value == null ? "" : value).trim().slice(0, max || 120);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  function setText(id, value) {
    var element = $(id);
    if (element && element.textContent !== String(value == null ? "" : value)) {
      element.textContent = String(value == null ? "" : value);
    }
  }

  function show(id, visible) {
    var element = $(id);
    if (element) element.classList.toggle("hidden", !visible);
  }

  function disable(id, disabled) {
    var element = $(id);
    if (element) element.disabled = !!disabled;
  }

  function me() {
    var person = api && typeof api.me === "function" ? api.me() : null;
    return isObject(person) ? person : { nick: "" };
  }

  function auth() {
    var value = api && typeof api.galleryAuth === "function" ? api.galleryAuth() : null;
    return isObject(value) ? value : { nick: me().nick || "", hash: "" };
  }

  function roomId() {
    var value = api && typeof api.roomId === "function" ? api.roomId() : "";
    if (!value) {
      var authValue = auth();
      value = authValue.roomId || "";
    }
    if (!value) {
      var screen = root();
      value = screen && screen.dataset ? screen.dataset.roomId || "" : "";
    }
    return text(value, 80);
  }

  function roomName() {
    var value = api && typeof api.roomName === "function" ? api.roomName() : "";
    return text(value, 80);
  }

  function roomGame() {
    var value = api && typeof api.roomGame === "function" ? api.roomGame() : "holdem";
    return text(value, 40);
  }

  function emptyState() {
    var seats = [];
    for (var i = 0; i < MAX_SEATS; i++) seats.push(null);
    return {
      version: 0,
      phase: "loading",
      status: "loading",
      handId: "",
      handNumber: 0,
      mode: "tournament",
      tournamentSpeed: "normal",
      blindLevel: 0,
      nextBlindAt: 0,
      seats: seats,
      heroSeat: -1,
      perspectiveSeat: 0,
      heroCards: [],
      revealedCards: [null, null, null, null, null, null],
      board: [],
      pot: 0,
      sidePots: [],
      dealerSeat: -1,
      smallBlindSeat: -1,
      bigBlindSeat: -1,
      smallBlind: 0,
      bigBlind: 0,
      ante: 0,
      actingSeat: -1,
      actingNick: "",
      deadlineAt: 0,
      actionDurationMs: 0,
      legal: Object.create(null),
      toCall: 0,
      minBet: 0,
      minRaise: 0,
      maxRaise: 0,
      raiseStep: 1,
      heroReady: false,
      canReady: false,
      canStart: false,
      canNext: false,
      canManageBots: false,
      canRefill: false,
      refillAmount: 0,
      dailyRefillLimit: 0,
      refillsUsedToday: 0,
      refillsRemainingToday: 0,
      refillStatusKnown: false,
      botCount: 0,
      actorIsBot: false,
      botDueAt: 0,
      actionSeq: 0,
      ownerNick: "",
      winners: [],
      showdown: [],
      handName: "",
      message: ""
    };
  }

  function phaseKey(value) {
    var key = text(value, 32).toLowerCase().replace(/[\s-]+/g, "_");
    var aliases = {
      idle: "waiting",
      lobby: "waiting",
      ready: "waiting",
      pre_flop: "preflop",
      betting_preflop: "preflop",
      betting_flop: "flop",
      betting_turn: "turn",
      betting_river: "river",
      hand_end: "complete",
      tournament_end: "complete",
      hand_complete: "complete",
      hand_over: "complete",
      finished: "complete",
      result: "complete"
    };
    return aliases[key] || key || "waiting";
  }

  function phaseLabel(phase) {
    return {
      loading: "연결 중",
      waiting: "대기 중",
      preflop: "프리플랍",
      flop: "플랍",
      turn: "턴",
      river: "리버",
      showdown: "쇼다운",
      complete: "핸드 종료"
    }[phase] || "텍사스 홀덤";
  }

  function isHandActive(phase) {
    return phase === "preflop" || phase === "flop" ||
      phase === "turn" || phase === "river";
  }

  function isBetweenHands(phase) {
    return phase === "complete" || phase === "showdown";
  }

  function toTimestamp(value) {
    if (value == null || value === "") return 0;
    if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value))) {
      var numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return 0;
      return numeric < 100000000000 ? numeric * 1000 : numeric;
    }
    var parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatChips(value) {
    var amount = Math.max(0, Math.round(nonnegative(value, 0)));
    if (moneyUnitMode === "bb" && state && state.bigBlind > 0) {
      var bbValue = amount / state.bigBlind;
      var digits = bbValue >= 100 || Number.isInteger(bbValue) ? 0 : bbValue >= 10 ? 1 : 2;
      return Number(bbValue.toFixed(digits)).toLocaleString("ko-KR") + "BB";
    }
    try {
      return new Intl.NumberFormat("ko-KR").format(amount);
    } catch (_error) {
      return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
  }

  function safeSeat(value) {
    var seat = integer(value, -1);
    return seat >= 0 && seat < MAX_SEATS ? seat : -1;
  }

  function normalizeSuit(value) {
    var key = text(value, 16).toLowerCase();
    var suits = {
      s: "s", spade: "s", spades: "s", "♠": "s", "♠︎": "s",
      h: "h", heart: "h", hearts: "h", "♥": "h", "♥︎": "h",
      d: "d", diamond: "d", diamonds: "d", "♦": "d", "♦︎": "d",
      c: "c", club: "c", clubs: "c", "♣": "c", "♣︎": "c"
    };
    return suits[key] || "";
  }

  function normalizeRank(value) {
    var key = text(value, 8).toUpperCase();
    var ranks = {
      ACE: "A", KING: "K", QUEEN: "Q", JACK: "J",
      T: "10", TEN: "10"
    };
    key = ranks[key] || key;
    return /^(?:[2-9]|10|[JQKA])$/.test(key) ? key : "";
  }

  function normalizeCard(value) {
    var rank = "", suit = "";
    if (typeof value === "string") {
      var compact = value.trim().replace(/\s+/g, "");
      var ascii = compact.match(/^(10|[2-9TJQKA])([SHDC])$/i);
      var symbols = compact.match(/^(10|[2-9TJQKA])([♠♥♦♣])$/i);
      if (ascii || symbols) {
        rank = normalizeRank((ascii || symbols)[1]);
        suit = normalizeSuit((ascii || symbols)[2]);
      }
    } else if (isObject(value)) {
      rank = normalizeRank(firstDefined(value.rank, value.value, value.r));
      suit = normalizeSuit(firstDefined(value.suit, value.s));
    }
    return rank && suit ? { rank: rank, suit: suit } : null;
  }

  function normalizeCards(value, limit) {
    if (!Array.isArray(value)) return [];
    var cards = [];
    for (var i = 0; i < value.length && cards.length < limit; i++) {
      var card = normalizeCard(value[i]);
      if (card) cards.push(card);
    }
    return cards;
  }

  function canonicalMove(value) {
    var raw = text(value, 24).toLowerCase().replace(/[\s-]+/g, "_");
    var aliases = {
      all_in: "allin",
      all: "allin",
      pass: "check",
      match: "call",
      wager: "bet",
      increase: "raise"
    };
    return aliases[raw] || raw;
  }

  function canonicalSeatAction(value) {
    var raw = text(value, 24).toLowerCase().replace(/[\s-]+/g, "_");
    var aliases = {
      all_in: "allin",
      small: "small_blind",
      sb: "small_blind",
      big: "big_blind",
      bb: "big_blind",
      match: "call",
      increase: "raise"
    };
    var canonical = aliases[raw] || raw;
    return /^(fold|check|call|bet|raise|allin|small_blind|big_blind)$/.test(canonical)
      ? canonical
      : "";
  }

  function addLegal(target, move, detail) {
    var canonical = canonicalMove(move);
    if (!/^(fold|check|call|bet|raise|allin)$/.test(canonical)) return;
    if (detail === false || detail == null) return;
    var config = isObject(detail) ? detail : {};
    target[canonical] = {
      move: canonical,
      amount: nonnegative(firstDefined(config.amount, config.toCall, config.call), 0),
      min: nonnegative(firstDefined(config.min, config.minimum, config.minAmount), 0),
      max: nonnegative(firstDefined(config.max, config.maximum, config.maxAmount), 0)
    };
  }

  function normalizeLegal(value) {
    var legal = Object.create(null);
    if (Array.isArray(value)) {
      value.forEach(function (entry) {
        if (typeof entry === "string") addLegal(legal, entry, true);
        else if (isObject(entry)) {
          addLegal(legal, firstDefined(entry.move, entry.action, entry.type), entry);
        }
      });
    } else if (isObject(value)) {
      if (Array.isArray(value.actions)) {
        var nested = normalizeLegal(value.actions);
        Object.keys(nested).forEach(function (key) { legal[key] = nested[key]; });
      }
      Object.keys(value).forEach(function (key) {
        if (key !== "actions") addLegal(legal, key, value[key]);
      });
    }
    return legal;
  }

  function normalizeSeat(entry, fallbackIndex) {
    if (!isObject(entry)) return null;
    var nick = text(firstDefined(entry.nick, entry.nickname, entry.name, entry.player), 40);
    var displayName = text(firstDefined(entry.displayName, entry.label, nick), 40);
    if (!nick && entry.empty !== false) return null;
    var status = text(firstDefined(entry.status, entry.state), 32).toLowerCase();
    var seatIndex = safeSeat(firstDefined(entry.seat, entry.index, entry.position, fallbackIndex));
    if (seatIndex < 0) seatIndex = fallbackIndex;
    return {
      seat: seatIndex,
      nick: nick,
      displayName: displayName || nick,
      isBot: !!firstDefined(entry.isBot, entry.bot, entry.kind === "bot"),
      botId: text(firstDefined(entry.botId, entry.botID), 40),
      botPersonality: normalizeBotPersonality(firstDefined(entry.botPersonality, entry.personality)),
      stack: nonnegative(firstDefined(entry.stack, entry.chips, entry.balance), 0),
      bet: nonnegative(firstDefined(entry.bet, entry.streetBet, entry.roundBet, entry.currentBet, entry.wager), 0),
      totalBet: nonnegative(firstDefined(entry.totalBet, entry.committed), 0),
      ready: !!firstDefined(entry.ready, entry.isReady, false),
      folded: !!firstDefined(entry.folded, status === "folded" || status === "fold"),
      allIn: !!firstDefined(entry.allIn, entry.allin, status === "allin" || status === "all_in"),
      lastAction: canonicalSeatAction(firstDefined(entry.lastAction, entry.recentAction, entry.action)),
      away: !!firstDefined(entry.away, entry.disconnected, status === "away" || status === "disconnected"),
      sittingOut: !!firstDefined(entry.sittingOut, entry.spectator, status === "sitting_out"),
      inHand: bool(firstDefined(entry.inHand, entry.playing), status !== "out"),
      cardCount: clamp(integer(firstDefined(entry.cardCount, entry.holeCardCount, entry.hasCards ? 2 : 0), 0), 0, 2),
      status: status,
      handName: text(firstDefined(entry.handName, entry.handLabel), 80),
      winner: !!firstDefined(entry.winner, entry.isWinner, false)
    };
  }

  function normalizeBotPersonality(value) {
    value = text(value, 32).toLowerCase().replace(/-/g, "_");
    return Object.prototype.hasOwnProperty.call(BOT_PERSONALITY_LABELS, value) ? value : "";
  }

  function botPersonalityLabel(value) {
    return BOT_PERSONALITY_LABELS[normalizeBotPersonality(value)] || "";
  }

  function botPersonalityAvatar(value) {
    var personality = normalizeBotPersonality(value);
    return personality
      ? "assets/holdem/ai-avatar-" + personality.replace(/_/g, "-") + ".png"
      : "";
  }

  function normalizePots(table) {
    var main = nonnegative(firstDefined(
      table.totalPot,
      isObject(table.pot) ? table.pot.amount : table.pot,
      table.potAmount
    ), NaN);
    var source = Array.isArray(table.pots) ? table.pots :
      Array.isArray(table.sidePots) ? table.sidePots : [];
    var amounts = source.map(function (pot) {
      return nonnegative(isObject(pot) ? firstDefined(pot.amount, pot.chips, pot.value) : pot, 0);
    }).filter(function (amount) { return amount > 0; });
    if (!Number.isFinite(main)) {
      main = amounts.reduce(function (sum, amount) { return sum + amount; }, 0);
    }
    var sides = Array.isArray(table.sidePots)
      ? amounts
      : amounts.length > 1 ? amounts.slice(1) : [];
    return { total: Math.max(0, main), sides: sides };
  }

  function winnerNicks(table) {
    var value = firstDefined(table.winners, table.winnerNicks, table.winner);
    if (!Array.isArray(value)) value = value == null ? [] : [value];
    return value.map(function (entry) {
      return text(isObject(entry) ? firstDefined(entry.nick, entry.nickname, entry.name) : entry, 40);
    }).filter(Boolean);
  }

  function normalizeSnapshot(input, versionHint) {
    var raw = isObject(input) ? input : {};
    var table = firstObject(raw.table, raw.public, raw.state, raw);
    var viewer = firstObject(raw.viewer, raw.private, raw.me, table.viewer, table.private);
    var seatSource = Array.isArray(table.seats) ? table.seats :
      Array.isArray(table.players) ? table.players : [];
    var seats = [];
    for (var empty = 0; empty < MAX_SEATS; empty++) seats.push(null);

    seatSource.slice(0, MAX_SEATS).forEach(function (entry, index) {
      var seat = normalizeSeat(entry, index);
      if (seat && seat.seat >= 0 && seat.seat < MAX_SEATS) seats[seat.seat] = seat;
    });

    var nick = text(me().nick, 40);
    var heroSeat = safeSeat(firstDefined(
      viewer.seat,
      viewer.seatIndex,
      raw.viewerSeat,
      raw.heroSeat,
      table.viewerSeat
    ));
    if (heroSeat < 0 && nick) {
      for (var i = 0; i < seats.length; i++) {
        if (seats[i] && seats[i].nick === nick) { heroSeat = i; break; }
      }
    }

    // Only the personalized viewer object/top-level personalized field may
    // supply hole-card faces. Opponent seat objects are never inspected for
    // card values, even if a buggy server accidentally includes them.
    var heroCards = normalizeCards(firstDefined(
      viewer.holeCards,
      viewer.cards,
      raw.heroCards,
      raw.holeCards,
      table.heroCards
    ), 2);
    if (heroSeat >= 0 && seats[heroSeat] && !seats[heroSeat].cardCount && heroCards.length) {
      seats[heroSeat].cardCount = heroCards.length;
    }

    var legal = normalizeLegal(firstDefined(
      viewer.legalActions,
      viewer.legalMoves,
      viewer.actions,
      raw.legalActions,
      raw.legalMoves,
      table.legalActions
    ));
    var actionInfo = firstObject(viewer.action, viewer.betting, raw.actionInfo, table.actionInfo, table.betting);
    var settings = firstObject(table.settings, raw.settings);
    var ringRefill = firstObject(table.ringRefill, raw.ringRefill, viewer.ringRefill);
    var mode = text(firstDefined(table.mode, raw.mode, settings.mode), 24).toLowerCase() === "ring"
      ? "ring"
      : "tournament";
    var tournamentSpeed = text(firstDefined(
      table.tournamentSpeed,
      raw.tournamentSpeed,
      settings.tournamentSpeed
    ), 24).toLowerCase() === "turbo" ? "turbo" : "normal";
    var refillsRemainingValue = firstDefined(
      ringRefill.remainingToday,
      ringRefill.remaining,
      table.refillsRemainingToday,
      raw.refillsRemainingToday
    );
    var pots = normalizePots(table);
    var actingSeat = safeSeat(firstDefined(
      table.actingSeat,
      table.currentSeat,
      table.turnSeat,
      table.toActSeat,
      raw.actingSeat
    ));
    var actingNick = text(firstDefined(
      table.actingNick,
      table.currentPlayer,
      table.turnNick,
      actingSeat >= 0 && seats[actingSeat] ? seats[actingSeat].nick : ""
    ), 40);
    var dealerSeat = safeSeat(firstDefined(table.dealerSeat, table.buttonSeat, table.dealer));
    var phase = phaseKey(firstDefined(table.phase, table.street, table.status));
    var revealedCards = [null, null, null, null, null, null];
    var showdownRows = [];
    if ((phase === "complete" || phase === "showdown") && Array.isArray(table.showdown)) {
      table.showdown.forEach(function (entry) {
        if (!isObject(entry)) return;
        var revealedSeat = safeSeat(firstDefined(entry.seat, entry.index, entry.position));
        var cards = normalizeCards(entry.cards, 2);
        if (revealedSeat >= 0) {
          revealedCards[revealedSeat] = cards;
          showdownRows.push({
            seat: revealedSeat,
            nick: text(firstDefined(entry.nick, entry.nickname, entry.name), 40),
            displayName: text(firstDefined(entry.displayName, entry.label, entry.nick, entry.nickname), 40),
            cards: cards,
            handName: text(firstDefined(entry.handName, entry.handLabel, entry.name), 80),
            handCategory: integer(firstDefined(entry.handCategory, entry.category), -1),
            folded: !!firstDefined(entry.folded, false),
            testReveal: !!firstDefined(entry.testReveal, entry.aiReveal, false)
          });
        }
      });
    }
    var canReadyValue = firstDefined(viewer.canReady, raw.canReady, table.canReady);
    var canStartValue = firstDefined(viewer.canStart, raw.canStart, table.canStart);
    var canNextValue = firstDefined(
      viewer.canNext,
      viewer.canNextHand,
      raw.canNext,
      raw.canNextHand,
      table.canNext,
      table.canNextHand
    );
    var canManageBotsValue = firstDefined(
      viewer.canManageBots,
      raw.canManageBots,
      table.canManageBots
    );
    var hero = heroSeat >= 0 ? seats[heroSeat] : null;
    var botCount = seats.filter(function (seat) { return !!(seat && seat.isBot); }).length;
    var actorSeatEntry = actingSeat >= 0 ? seats[actingSeat] : null;

    var normalized = {
      version: Math.max(0, integer(firstDefined(versionHint, raw.version, table.version, table.rev), 0)),
      phase: phase,
      status: text(firstDefined(table.status, raw.status, phase), 32),
      handId: text(firstDefined(table.handId, table.handKey, table.handNumber, table.handNo, raw.handId), 80),
      handNumber: Math.max(0, integer(firstDefined(table.handNumber, table.handNo, table.hand), 0)),
      mode: mode,
      tournamentSpeed: tournamentSpeed,
      blindLevel: Math.max(0, integer(firstDefined(table.blindLevel, raw.blindLevel), 0)),
      nextBlindAt: toTimestamp(firstDefined(table.nextBlindAt, raw.nextBlindAt)),
      seats: seats,
      heroSeat: heroSeat,
      perspectiveSeat: heroSeat >= 0 ? heroSeat :
        safeSeat(firstDefined(viewer.perspectiveSeat, table.perspectiveSeat, dealerSeat, 0)),
      heroCards: heroCards,
      revealedCards: revealedCards,
      board: normalizeCards(firstDefined(table.board, table.communityCards, table.community), 5),
      pot: pots.total,
      sidePots: pots.sides,
      dealerSeat: dealerSeat,
      smallBlindSeat: safeSeat(firstDefined(table.smallBlindSeat, table.sbSeat)),
      bigBlindSeat: safeSeat(firstDefined(table.bigBlindSeat, table.bbSeat)),
      smallBlind: nonnegative(firstDefined(
        table.smallBlind,
        table.blinds && table.blinds.small,
        table.settings && table.settings.smallBlind
      ), 0),
      bigBlind: nonnegative(firstDefined(
        table.bigBlind,
        table.blinds && table.blinds.big,
        table.settings && table.settings.bigBlind
      ), 0),
      ante: nonnegative(firstDefined(
        table.ante,
        table.blinds && table.blinds.ante,
        table.settings && table.settings.ante
      ), 0),
      actingSeat: actingSeat,
      actingNick: actingNick,
      deadlineAt: toTimestamp(firstDefined(
        viewer.deadlineAt,
        table.deadlineAt,
        table.actionDeadlineAt,
        table.turnDeadlineAt,
        table.turnDeadline
      )),
      actionDurationMs: nonnegative(firstDefined(
        viewer.actionDurationMs,
        table.actionDurationMs,
        table.turnTimeMs,
        table.actionSeconds != null ? Number(table.actionSeconds) * 1000 : null
      ), 0),
      legal: legal,
      toCall: nonnegative(firstDefined(
        actionInfo.toCall,
        actionInfo.callAmount,
        viewer.toCall,
        legal.call && legal.call.amount
      ), 0),
      minBet: nonnegative(firstDefined(
        actionInfo.minBet,
        viewer.minBet,
        legal.bet && legal.bet.min
      ), 0),
      minRaise: nonnegative(firstDefined(
        actionInfo.minRaiseTo,
        actionInfo.minRaise,
        viewer.minRaise,
        legal.raise && legal.raise.min
      ), 0),
      maxRaise: nonnegative(firstDefined(
        actionInfo.maxRaiseTo,
        actionInfo.maxRaise,
        viewer.maxRaise,
        legal.raise && legal.raise.max,
        legal.bet && legal.bet.max,
        hero && hero.stack
      ), 0),
      raiseStep: Math.max(1, integer(firstDefined(
        actionInfo.step,
        actionInfo.raiseStep,
        table.bigBlind,
        table.blinds && table.blinds.big,
        1
      ), 1)),
      heroReady: !!(hero && hero.ready),
      canReady: bool(canReadyValue, phase === "waiting" && !!hero),
      canStart: bool(canStartValue, false),
      canNext: bool(canNextValue, false),
      canManageBots: bool(canManageBotsValue, false),
      canRefill: bool(firstDefined(
        ringRefill.canRefill,
        table.canRefill,
        raw.canRefill
      ), false),
      refillAmount: nonnegative(firstDefined(
        ringRefill.amount,
        table.refillAmount,
        settings.refillAmount
      ), 0),
      dailyRefillLimit: Math.max(0, integer(firstDefined(
        ringRefill.dailyLimit,
        table.dailyRefillLimit,
        settings.dailyRefillLimit
      ), 0)),
      refillsUsedToday: Math.max(0, integer(firstDefined(
        ringRefill.usedToday,
        ringRefill.used,
        table.refillsUsedToday
      ), 0)),
      refillsRemainingToday: Math.max(0, integer(refillsRemainingValue, 0)),
      refillStatusKnown: refillsRemainingValue !== undefined && refillsRemainingValue !== null,
      botCount: Math.max(0, integer(firstDefined(table.botCount, raw.botCount), botCount)),
      actorIsBot: bool(firstDefined(table.actorIsBot, raw.actorIsBot), !!(actorSeatEntry && actorSeatEntry.isBot)),
      botDueAt: toTimestamp(firstDefined(table.botDueAt, table.nextWakeAt, raw.botDueAt)),
      actionSeq: Math.max(0, integer(firstDefined(table.actionSeq, raw.actionSeq), 0)),
      ownerNick: text(firstDefined(table.ownerNick, table.owner, raw.ownerNick), 40),
      winners: winnerNicks(table),
      showdown: showdownRows,
      handName: text(firstDefined(viewer.handName, viewer.bestHandName, raw.handName), 80),
      message: text(firstDefined(raw.message, table.message, table.announcement, table.resultText), 160)
    };

    if (!normalized.handNumber && /^\d+$/.test(normalized.handId)) {
      normalized.handNumber = Number(normalized.handId);
    }
    return normalized;
  }

  function applySnapshot(snapshot, versionHint, responseOrder) {
    if (!isObject(snapshot)) return false;
    var next = normalizeSnapshot(snapshot, versionHint);
    if (next.version && state.version && next.version < state.version) return false;
    if ((!next.version || next.version === state.version) &&
        responseOrder && responseOrder < lastAppliedResponse) return false;

    var previousDeadlineKey = state.version + ":" + state.deadlineAt;
    var nextDeadlineKey = next.version + ":" + next.deadlineAt;
    syncResultFlow(state, next);
    state = next;
    rawSnapshot = snapshot;
    hasSnapshot = true;
    joined = joined || next.heroSeat >= 0 || next.phase !== "loading";
    lastError = "";
    if (responseOrder) lastAppliedResponse = responseOrder;
    if (previousDeadlineKey !== nextDeadlineKey) {
      tickSentKey = "";
      tickRetryAt = 0;
    }
    render();
    return true;
  }

  function resultKeyOf(snapshot) {
    if (!snapshot || snapshot.phase !== "complete") return "";
    return [
      snapshot.handId || snapshot.handNumber || "hand",
      snapshot.handNumber || 0,
      snapshot.winners.join("|")
    ].join(":");
  }

  function winnerSeatMap(snapshot) {
    var winners = Object.create(null);
    if (!snapshot || !Array.isArray(snapshot.seats)) return winners;
    var nicks = Object.create(null);
    (snapshot.winners || []).forEach(function (nick) { nicks[nick] = true; });
    snapshot.seats.forEach(function (seat, index) {
      if (seat && (seat.winner || nicks[seat.nick])) winners[index] = true;
    });
    return winners;
  }

  function syncResultFlow(previous, next) {
    var key = resultKeyOf(next);
    if (!key) {
      resultFlow = null;
      return;
    }
    if (resultFlow && resultFlow.key === key) return;
    var now = Date.now();
    var fromStacks = [];
    var toStacks = [];
    var nextBoardCount = Array.isArray(next.board) ? clamp(next.board.length, 0, 5) : 0;
    var previousBoardCount = previous && Array.isArray(previous.board) ? clamp(previous.board.length, 0, 5) : 0;
    var initialBoardCount = Math.min(nextBoardCount, Math.max(previousBoardCount, Math.min(3, nextBoardCount)));
    var hiddenCommunityCards = Math.max(0, nextBoardCount - initialBoardCount);
    var cardsFirstMs = RESULT_CARDS_FIRST_MS + (RESULT_BOARD_REVEAL_STEP_MS * hiddenCommunityCards);
    for (var i = 0; i < MAX_SEATS; i++) {
      fromStacks[i] = previous && previous.seats[i] ? previous.seats[i].stack : null;
      toStacks[i] = next.seats[i] ? next.seats[i].stack : null;
    }
    resultFlow = {
      key: key,
      startedAt: now,
      initialBoardCount: initialBoardCount,
      hiddenCommunityCards: hiddenCommunityCards,
      cardsUntil: now + cardsFirstMs,
      settleStart: now + cardsFirstMs,
      settleEnd: now + cardsFirstMs + RESULT_SETTLE_MS,
      potFrom: Math.max(nonnegative(previous && previous.pot, 0), nonnegative(next && next.pot, 0)),
      fromStacks: fromStacks,
      toStacks: toStacks,
      winnerSeats: winnerSeatMap(next)
    };
  }

  function resultStage() {
    if (state.phase !== "complete") return "none";
    if (!resultFlow) return "announced";
    return Date.now() < resultFlow.cardsUntil ? "cards" : "announced";
  }

  function resultBoardVisibleCount() {
    var count = Array.isArray(state.board) ? clamp(state.board.length, 0, 5) : 0;
    if (state.phase !== "complete" || !resultFlow) return count;
    var visible = clamp(resultFlow.initialBoardCount, 0, count);
    var elapsed = Math.max(0, Date.now() - resultFlow.startedAt);
    var revealedAfterStart = Math.floor(elapsed / RESULT_BOARD_REVEAL_STEP_MS);
    return clamp(visible + revealedAfterStart, 0, count);
  }

  function settleRatio() {
    if (!resultFlow || state.phase !== "complete") return 1;
    if (Date.now() < resultFlow.settleStart) return 0;
    return clamp((Date.now() - resultFlow.settleStart) / RESULT_SETTLE_MS, 0, 1);
  }

  function easeOutCubic(ratio) {
    ratio = clamp(ratio, 0, 1);
    return 1 - Math.pow(1 - ratio, 3);
  }

  function animatedPotAmount() {
    if (state.phase !== "complete" || !resultFlow) return state.pot;
    return Math.round(resultFlow.potFrom * (1 - easeOutCubic(settleRatio())));
  }

  function animatedStackAmount(seatIndex, fallback) {
    if (state.phase !== "complete" || !resultFlow || !resultFlow.winnerSeats[seatIndex]) return fallback;
    var from = resultFlow.fromStacks[seatIndex];
    var to = resultFlow.toStacks[seatIndex];
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return fallback;
    return Math.round(from + (to - from) * easeOutCubic(settleRatio()));
  }

  function animatedWinAmount(seatIndex) {
    if (!resultFlow || !resultFlow.winnerSeats[seatIndex]) return 0;
    var from = resultFlow.fromStacks[seatIndex];
    var to = resultFlow.toStacks[seatIndex];
    return Number.isFinite(from) && Number.isFinite(to) && to > from ? to - from : 0;
  }

  function requestId(prefix, stableSuffix) {
    requestCounter += 1;
    var cleanPrefix = String(prefix || "r").replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 12) || "r";
    var suffix = stableSuffix
      ? String(stableSuffix).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 54)
      : Date.now().toString(36) + ":" + requestCounter.toString(36) + ":" +
        Math.floor(Math.random() * 0x1000000).toString(36);
    return ("h:" + cleanPrefix + ":" + suffix).slice(0, 100);
  }

  function demoMode() {
    var screen = root();
    return !!(screen && screen.dataset && screen.dataset.holdemDemo === "true");
  }

  function demoInvoke(endpointAction, payload) {
    var engine = window.HoldemEngine;
    if (!engine || typeof engine.createTable !== "function" ||
        typeof engine.command !== "function" || typeof engine.view !== "function") {
      return Promise.resolve({ ok: false, reason: "unavailable" });
    }
    var person = me();
    if (!demoState) {
      var demoGame = roomGame();
      demoState = engine.createTable({
        roomId: roomId() || "demo",
        ownerNick: person.nick || "나",
        mode: demoGame === "holdem_ring" ? "ring" : "tournament",
        tournamentSpeed: demoGame === "holdem_turbo" ? "turbo" : "normal"
      });
      demoVersion = 0;
    }
    if (endpointAction === "snapshot") {
      return Promise.resolve({
        ok: true,
        version: demoVersion,
        snapshot: engine.view(demoState, person.nick || "나")
      });
    }
    var command = Object.assign({}, payload || {});
    if (endpointAction === "bot_step") {
      var actor = demoState && demoState.actorSeat != null
        ? demoState.seats[demoState.actorSeat]
        : null;
      var ai = window.HoldemAI;
      if (!actor || !actor.isBot || !actor.botId || !ai ||
          typeof ai.decide !== "function" || typeof engine.botView !== "function") {
        return Promise.resolve({
          ok: false,
          reason: "bot_not_due",
          version: demoVersion,
          snapshot: engine.view(demoState, person.nick || "나")
        });
      }
      var observation = engine.botView(demoState, actor.botId);
      var decision = ai.decide(observation, {
        randomInt: function (max) { return Math.floor(Math.random() * max); }
      });
      command = {
        type: "bot_act",
        botId: actor.botId,
        action: decision.action,
        amount: decision.amount,
        requestId: "demo-bot:" + String(demoState.handNo) + ":" + String(demoState.actionSeq)
      };
    } else {
      command.type = endpointAction;
      command.nick = person.nick || "나";
      command.requestId = payload.requestId;
      if (endpointAction === "act") command.action = payload.move;
    }
    var result = engine.command(demoState, command, {
      now: Date.now(),
      randomInt: function (max) { return Math.floor(Math.random() * max); },
      internalBot: endpointAction === "bot_step",
      internalRefill: endpointAction === "refill"
    });
    if (result && result.state) demoState = result.state;
    if (result && result.changed) demoVersion += 1;
    return Promise.resolve({
      ok: !!(result && result.ok),
      reason: result && result.reason,
      version: demoVersion,
      snapshot: engine.view(demoState, person.nick || "나")
    });
  }

  function transport(endpointAction, payload) {
    if (demoMode()) return demoInvoke(endpointAction, payload);
    if (!window.Db || typeof Db.holdemInvoke !== "function") {
      return Promise.resolve({ ok: false, reason: "unavailable" });
    }
    return Promise.resolve(Db.holdemInvoke(auth(), endpointAction, payload));
  }

  function reasonMessage(reason, fallback) {
    var messages = {
      unavailable: "홀덤 서버를 사용할 수 없어요.",
      auth: "로그인 정보를 확인해 주세요.",
      invalid_room: "유효하지 않은 홀덤 방이에요.",
      invalid_request_id: "요청을 다시 시도해 주세요.",
      not_found: "테이블을 준비하는 중이에요.",
      owner: "방장만 테이블 설정을 바꿀 수 있어요.",
      conflict: "상태가 바뀌어 새로 불러왔어요.",
      network: "서버 연결을 확인해 주세요.",
      server: "홀덤 서버에서 오류가 났어요.",
      server_config: "홀덤 서버를 준비하는 중이에요.",
      table_full: "테이블의 여섯 자리가 모두 찼어요.",
      full: "테이블의 여섯 자리가 모두 찼어요.",
      seat_taken: "이미 다른 사람이 앉은 자리예요.",
      min_players: "두 명 이상 준비해야 시작할 수 있어요.",
      not_enough_players: "두 명 이상 준비해야 시작할 수 있어요.",
      not_ready: "참가자 준비 상태를 확인해 주세요.",
      not_turn: "지금은 내 차례가 아니에요.",
      turn: "지금은 내 차례가 아니에요.",
      illegal_action: "현재 선택할 수 없는 액션이에요.",
      amount: "베팅 금액을 확인해 주세요.",
      minimum_bet: "최소 베팅 금액 이상을 선택해 주세요.",
      minimum_raise: "최소 레이즈 금액 이상을 선택해 주세요.",
      raise_not_reopened: "숏 올인만으로는 아직 레이즈 권리가 다시 열리지 않았어요.",
      no_raise_target: "추가 베팅을 받을 상대가 없어 레이즈할 수 없어요.",
      hand_active: "현재 핸드가 끝난 뒤 다시 시도해 주세요.",
      bots_locked: "AI 구성은 첫 핸드를 시작하기 전에만 바꿀 수 있어요.",
      bot_not_found: "제거할 AI를 찾지 못했어요.",
      bot_not_due: "AI 차례가 바뀌어 새 상태를 불러왔어요.",
      bot_turn: "AI 차례가 바뀌어 새 상태를 불러왔어요.",
      not_due: "아직 행동 시간이 되지 않았어요.",
      nick_reserved: "AI와 같은 이름은 이 테이블에서 사용할 수 없어요.",
      reserved_nick: "AI 전용 이름은 참가자 이름으로 사용할 수 없어요.",
      tournament_end: "마지막 플레이어가 남아 테이블이 종료됐어요.",
      refill_required: "칩을 충전한 뒤 다시 준비할 수 있어요.",
      ring_only: "자산안심 링게임에서만 충전할 수 있어요.",
      refill_not_needed: "보유한 플레이 칩이 남아 있어요.",
      refill_limit: "오늘 사용할 수 있는 충전 3회를 모두 사용했어요.",
      stale: "상태가 바뀌어 새로 불러왔어요."
    };
    return messages[text(reason, 80)] || text(fallback, 140) || "요청을 처리하지 못했어요.";
  }

  function broadcastRefresh(version, request, reason) {
    if (!api || typeof api.send !== "function") return;
    // Strict allow-list: never add snapshot, board, seats, or cards here.
    api.send({
      t: "holdem_refresh",
      by: text(me().nick, 40),
      version: Math.max(0, integer(version, state.version || 0)),
      handId: text(state.handId, 80),
      requestId: text(request, 100),
      reason: text(reason, 24)
    });
  }

  function finishRequest(key, promise, value, failed, requestStore, generation, uiRequest) {
    if (requestStore[key] === promise) delete requestStore[key];
    if (generation === lifecycleGeneration) {
      pendingCount = Math.max(0, pendingCount - 1);
      if (uiRequest) pendingUiCount = Math.max(0, pendingUiCount - 1);
      if (!pendingUiCount) pendingAction = "";
      renderControls();
    }
    if (failed) throw value;
    return value;
  }

  function cleanupStaleJoin(response, callRoom, callAuth) {
    if (!response || !response.ok || !callRoom || !callAuth || !callAuth.nick) return;
    if (active && roomId() === callRoom && auth().nick === callAuth.nick) return;
    if (!window.Db || typeof Db.holdemInvoke !== "function") return;
    var cleanupId = requestId("leave");
    Promise.resolve(Db.holdemInvoke(callAuth, "leave", {
      roomId: callRoom,
      requestId: cleanupId,
      expectedVersion: Math.max(0, integer(response.version, 0))
    })).catch(function () {});
  }

  function invoke(endpointAction, payload, options) {
    options = options || {};
    var key = options.key || endpointAction;
    if (requests[key]) return requests[key];
    if (!active && !options.allowInactive) return Promise.resolve({ ok: false, reason: "inactive" });

    var currentRoom = roomId();
    if (!currentRoom && !demoMode()) {
      lastError = "홀덤 방 정보를 찾지 못했어요.";
      renderConnection();
      return Promise.resolve({ ok: false, reason: "invalid_room" });
    }
    var generation = lifecycleGeneration;
    var callAuth = auth();
    var requestStore = requests;
    var order = ++responseCounter;
    var beforeVersion = state.version;
    var req = options.requestId || requestId(endpointAction);
    var body = Object.assign({}, payload || {});
    body.roomId = currentRoom || "demo";
    body.requestId = req;
    if (body.expectedVersion == null) body.expectedVersion = beforeVersion;

    var uiRequest = options.ui !== false;
    pendingCount += 1;
    if (uiRequest) {
      pendingUiCount += 1;
      pendingAction = options.label || endpointAction;
    }
    renderControls();

    var promise = transport(endpointAction, body).then(function (response) {
      response = isObject(response) ? response : { ok: false, reason: "invalid_response" };
      if (
        generation !== lifecycleGeneration ||
        !active ||
        roomId() !== currentRoom
      ) {
        if (endpointAction === "join") cleanupStaleJoin(response, currentRoom, callAuth);
        return { ok: false, stale: true, response: response };
      }
      var applied = applySnapshot(response.snapshot, response.version, order);
      if (!response.ok) {
        var message = reasonMessage(response.reason, response.msg);
        if (!options.silent) {
          lastError = message;
          if (api && typeof api.toast === "function") api.toast(message, 3000);
          renderConnection();
        }
        if (response.reason === "conflict" || response.reason === "stale") scheduleRefresh("conflict", true);
        return { ok: false, response: response, applied: applied };
      }

      joined = joined || endpointAction === "join";
      var version = Math.max(0, integer(response.version, state.version));
      var changed = version > beforeVersion;
      if (options.broadcast !== false && changed && endpointAction !== "snapshot") {
        broadcastRefresh(version, req, endpointAction);
        if (api && typeof api.roomChanged === "function") api.roomChanged();
      }
      if (!applied && endpointAction !== "leave") scheduleRefresh(endpointAction, false);
      return { ok: true, response: response, applied: applied, changed: changed };
    }, function (error) {
      if (
        generation !== lifecycleGeneration ||
        !active ||
        roomId() !== currentRoom
      ) {
        return { ok: false, stale: true, reason: "inactive", error: error };
      }
      var message = reasonMessage("network", error && error.message);
      if (!options.silent) {
        lastError = message;
        if (api && typeof api.toast === "function") api.toast(message, 3000);
        renderConnection();
      }
      return { ok: false, reason: "network", error: error };
    });
    requestStore[key] = promise;
    return promise.then(
      function (value) {
        return finishRequest(key, promise, value, false, requestStore, generation, uiRequest);
      },
      function (error) {
        return finishRequest(key, promise, error, true, requestStore, generation, uiRequest);
      }
    );
  }

  function refreshSnapshot(reason, force) {
    if (!active) return Promise.resolve({ ok: false, reason: "inactive" });
    if (requests.snapshot && !force) return requests.snapshot;
    return invoke("snapshot", { reason: text(reason, 24) }, {
      key: "snapshot",
      ui: false,
      silent: true,
      broadcast: false
    });
  }

  function scheduleRefresh(reason, force) {
    if (!active) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refreshSnapshot(reason || "refresh", !!force);
    }, REFRESH_DEBOUNCE_MS);
  }

  function joinTable(preferredSeat) {
    var payload = {};
    var seat = safeSeat(preferredSeat);
    if (seat >= 0) payload.seat = seat;
    return invoke("join", payload, {
      key: "join",
      label: "join",
      broadcast: true
    }).then(function (result) {
      if (result && result.stale) return result;
      return refreshSnapshot(result && result.ok ? "joined" : "join_retry", true);
    });
  }

  function performMove(move, amount) {
    move = canonicalMove(move);
    if (!state.legal[move] || requests.move) return;
    var payload = {
      move: move,
      expectedVersion: state.version,
      handId: state.handId
    };
    if ((move === "bet" || move === "raise") && Number.isFinite(Number(amount))) {
      payload.amount = Math.max(0, Math.round(Number(amount)));
    }
    invoke("act", payload, {
      key: "move",
      label: move,
      broadcast: true
    });
  }

  function sizedMove() {
    if (state.legal.bet) return "bet";
    if (state.legal.raise) return "raise";
    return "";
  }

  function performSizedMove(amount) {
    var move = sizedMove();
    if (move) performMove(move, amount);
  }

  function autoStartNick() {
    for (var i = 0; i < state.seats.length; i++) {
      var seat = state.seats[i];
      if (seat && !seat.isBot && seat.stack > 0 && !seat.away) return seat.nick;
    }
    return "";
  }

  function clearAutoNextHand() {
    if (autoNextTimer) {
      clearTimeout(autoNextTimer);
      autoNextTimer = null;
    }
    autoNextKey = "";
    autoNextDueAt = 0;
  }

  function clearAutoReadyForNextHand() {
    if (autoReadyTimer) {
      clearTimeout(autoReadyTimer);
      autoReadyTimer = null;
    }
    autoReadyKey = "";
  }

  function autoReadyForNextHand(key) {
    autoReadyTimer = null;
    if (!active || state.phase !== "complete" || state.heroSeat < 0) return;
    if (state.heroReady || !state.canReady || autoReadyKey !== key || requests.ready) return;
    invoke("ready", {
      ready: true,
      expectedVersion: state.version
    }, {
      key: "ready",
      label: "auto_ready",
      broadcast: true,
      silent: true,
      ui: false,
      requestId: requestId("autoready", key)
    });
  }

  function scheduleAutoReadyForNextHand() {
    if (state.phase !== "complete" || state.heroSeat < 0 || state.heroReady || !state.canReady || requests.ready) {
      clearAutoReadyForNextHand();
      return;
    }
    var key = String(state.handId || state.handNumber || state.version) + ":" + String(state.version) + ":ready";
    if (autoReadyKey === key && autoReadyTimer) return;
    clearAutoReadyForNextHand();
    autoReadyKey = key;
    autoReadyTimer = setTimeout(function () { autoReadyForNextHand(key); }, 500);
  }

  function autoStartHand(key) {
    autoNextTimer = null;
    if (!active || state.phase !== "complete" || !state.canStart || autoNextKey !== key) return;
    if (text(me().nick, 40) !== autoStartNick()) return;
    invoke("start", {
      expectedVersion: state.version
    }, {
      key: "start",
      label: "auto_start",
      broadcast: true,
      requestId: requestId("autostart", key)
    });
  }

  function scheduleAutoNextHand() {
    if (state.phase !== "complete" || !state.canStart || text(me().nick, 40) !== autoStartNick()) {
      clearAutoNextHand();
      return;
    }
    var key = String(state.handId || state.handNumber || state.version) + ":" + String(state.version);
    if (autoNextKey === key && autoNextTimer) return;
    clearAutoNextHand();
    autoNextKey = key;
    autoNextDueAt = Date.now() + AUTO_NEXT_HAND_MS;
    autoNextTimer = setTimeout(function () { autoStartHand(key); }, AUTO_NEXT_HAND_MS);
  }

  function setReady() {
    invoke("ready", {
      ready: !state.heroReady,
      expectedVersion: state.version
    }, { key: "ready", label: "ready", broadcast: true });
  }

  function startHand() {
    invoke("start", {
      expectedVersion: state.version
    }, { key: "start", label: "start", broadcast: true });
  }

  function refillRingChips() {
    if (!state.canRefill || requests.refill) return;
    invoke("refill", {
      expectedVersion: state.version
    }, {
      key: "refill",
      label: "refill",
      broadcast: true
    });
  }

  function addBot(options) {
    options = options || {};
    if (!state.canManageBots || state.botCount >= MAX_SEATS) return;
    return invoke("add_bot", {
      expectedVersion: state.version
    }, {
      key: "bot_manage",
      label: "bot",
      broadcast: true
    }).then(function (result) {
      if (!options.silent && result && result.ok && api && typeof api.toast === "function") {
        api.toast("AI를 추가했어요.", 2200);
      }
      return result;
    });
  }

  function addFiveBots() {
    if (!state.canManageBots || requests.bot_manage) return;
    function step() {
      var occupiedSeats = state.seats.filter(Boolean).length;
      var remaining = Math.min(5 - state.botCount, MAX_SEATS - occupiedSeats);
      if (!state.canManageBots || remaining <= 0) return Promise.resolve();
      return addBot({ silent: true }).then(function (result) {
        if (!result || !result.ok) return result;
        return step();
      });
    }
    return step().then(function () {
      if (api && typeof api.toast === "function") {
        api.toast("AI를 5명까지 채웠어요.", 2200);
      }
    });
  }

  function removeBot() {
    if (!state.canManageBots || state.botCount <= 0) return;
    var bot = null;
    for (var seatIndex = state.seats.length - 1; seatIndex >= 0; seatIndex--) {
      if (state.seats[seatIndex] && state.seats[seatIndex].isBot) {
        bot = state.seats[seatIndex];
        break;
      }
    }
    if (!bot) return;
    invoke("remove_bot", {
      botId: bot.botId,
      seat: bot.seat,
      expectedVersion: state.version
    }, {
      key: "bot_manage",
      label: "bot",
      broadcast: true
    }).then(function (result) {
      if (result && result.ok && api && typeof api.toast === "function") {
        api.toast("AI 한 명을 제거했어요.", 2200);
      }
    });
  }

  function clearBotTimer() {
    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
    botTimerKey = "";
  }

  function botTurnKey() {
    if (!state.actorIsBot || state.actingSeat < 0 || !isHandActive(state.phase)) return "";
    return state.version + ":" + state.handId + ":" + state.actionSeq + ":" + state.actingSeat;
  }

  function requestBotStep(key) {
    if (!active || key !== botTurnKey()) return;
    botTimer = null;
    botTimerKey = "";
    botSentKey = key;
    botRetryAt = Date.now() + 2500;
    invoke("bot_step", {
      expectedVersion: state.version,
      handId: state.handId,
      actionSeq: state.actionSeq
    }, {
      key: "bot_step",
      requestId: requestId("bot", key),
      ui: false,
      silent: true,
      broadcast: true
    }).then(function (result) {
      if (!result || !result.ok) {
        scheduleRefresh("bot_retry", true);
        scheduleBotStep();
      }
    });
  }

  function scheduleBotStep() {
    var key = botTurnKey();
    if (!active || !key) {
      clearBotTimer();
      botSentKey = "";
      botRetryAt = 0;
      return;
    }
    if (botTimer && botTimerKey === key) return;
    if (botTimer) clearBotTimer();
    var dueAt = state.botDueAt || (Date.now() + 800);
    if (botSentKey === key && Date.now() < botRetryAt) dueAt = botRetryAt;
    else if (botSentKey !== key) {
      botSentKey = "";
      botRetryAt = 0;
    }
    var delay = clamp(dueAt - Date.now(), 0, 5000);
    botTimerKey = key;
    botTimer = setTimeout(function () { requestBotStep(key); }, delay);
  }

  function requestDeadlineTick() {
    if (!active || !state.deadlineAt || Date.now() < state.deadlineAt) return;
    var key = state.version + ":" + state.handId + ":" + state.deadlineAt;
    if (tickSentKey === key && Date.now() < tickRetryAt) return;
    tickSentKey = key;
    tickRetryAt = Date.now() + 3500;
    invoke("tick", {
      expectedVersion: state.version,
      deadlineAt: state.deadlineAt,
      handId: state.handId
    }, {
      key: "tick",
      requestId: requestId("tick", String(state.version) + ":" + String(Math.round(state.deadlineAt))),
      ui: false,
      silent: true,
      broadcast: true
    }).then(function (result) {
      if (!result || !result.ok) {
        tickSentKey = "";
        tickRetryAt = Date.now() + 2000;
      }
    });
  }

  function cardSuitSvg(suitKey) {
    var shapes = {
      s: '<path d="M50 7C82 36 92 51 92 67C92 81 82 89 70 89C61 89 54 84 50 76C46 84 39 89 30 89C18 89 8 81 8 67C8 51 18 36 50 7Z"></path><path d="M42 66H58C58 78 64 88 75 95H25C36 88 42 78 42 66Z"></path>',
      h: '<path d="M50 89C18 60 8 45 8 28C8 15 18 7 31 7C40 7 47 13 50 21C53 13 60 7 69 7C82 7 92 15 92 28C92 45 82 60 50 89Z"></path>',
      d: '<path d="M50 4L93 50L50 96L7 50Z"></path>',
      c: '<circle cx="50" cy="27" r="22"></circle><circle cx="29" cy="55" r="22"></circle><circle cx="71" cy="55" r="22"></circle><path d="M42 60H58C58 74 64 86 76 94H24C36 86 42 74 42 60Z"></path>'
    };
    return '<svg class="holdem-card-suit-svg" viewBox="0 0 100 100" focusable="false" aria-hidden="true">' +
      (shapes[suitKey] || "") + '</svg>';
  }

  function cardHtml(card, kind) {
    if (kind === "back") {
      return '<span class="holdem-card back" role="img" aria-label="비공개 카드"></span>';
    }
    if (!card) {
      return '<span class="holdem-card empty" aria-hidden="true"></span>';
    }
    var suits = {
      s: { mark: "♠", label: "스페이드", color: "black" },
      h: { mark: "♥", label: "하트", color: "red" },
      d: { mark: "♦", label: "다이아몬드", color: "red" },
      c: { mark: "♣", label: "클럽", color: "black" }
    };
    var suit = suits[card.suit];
    if (!suit) return cardHtml(null, "empty");
    return '<span class="holdem-card ' + suit.color + '" data-suit="' + card.suit +
      '" data-rank="' + esc(card.rank) +
      '" role="img" aria-label="' + esc(suit.label + " " + card.rank) + '">' +
      '<span class="holdem-card-rank rank" aria-hidden="true">' + esc(card.rank) + '</span>' +
      '<span class="holdem-card-suit suit" aria-hidden="true">' + suit.mark + '</span>' +
      '<span class="holdem-card-mark mark" aria-hidden="true">' + cardSuitSvg(card.suit) + '</span>' +
      '</span>';
  }

  function relativeSeat(absolute, perspective) {
    return ((absolute - perspective) % MAX_SEATS + MAX_SEATS) % MAX_SEATS;
  }

  function initialFor(nick) {
    var chars;
    try { chars = Array.from(nick || ""); } catch (_error) { chars = String(nick || "").split(""); }
    return chars.length ? chars[0] : "＋";
  }

  function seatStatus(seat) {
    if (!seat) return "빈 자리";
    if (seat.isBot && seat.seat === state.actingSeat) return "생각 중";
    if (seat.folded) return "폴드";
    if (seat.allIn) return "올인";
    if (seat.away) return "연결 끊김";
    if (seat.sittingOut) return "대기";
    if (seat.bet > 0) return "베팅 " + formatChips(seat.bet);
    if (seat.ready && state.phase === "waiting") return "준비";
    return "";
  }

  function seatActionLabel(seat) {
    if (!seat || !seat.lastAction || state.phase === "waiting") return "";
    var amount = seat.bet > 0 ? " " + formatChips(seat.bet) : "";
    var labels = {
      fold: "폴드",
      check: "체크",
      call: "콜" + amount,
      bet: "베팅" + amount,
      raise: "레이즈" + amount,
      allin: "올인",
      small_blind: "SB " + formatChips(seat.bet || state.smallBlind),
      big_blind: "BB " + formatChips(seat.bet || state.bigBlind)
    };
    return labels[seat.lastAction] || "";
  }

  function seatActionClass(seat) {
    return seat && seat.lastAction ? "action-" + seat.lastAction.replace(/_/g, "-") : "";
  }

  function timerSnapshot() {
    if (!state.deadlineAt || state.actingSeat < 0) {
      return { seconds: 0, ratio: 0, urgent: false, active: false };
    }
    var remaining = Math.max(0, state.deadlineAt - Date.now());
    var duration = state.actionDurationMs || Math.max(1000, state.deadlineAt - (Date.now() - 1000));
    return {
      seconds: Math.max(0, Math.ceil(remaining / 1000)),
      ratio: clamp(remaining / duration, 0, 1),
      urgent: remaining <= 10000,
      active: true
    };
  }

  function renderSeatTimers() {
    var screen = root();
    if (!screen || !screen.querySelectorAll) return;
    var info = timerSnapshot();
    var timers = screen.querySelectorAll(".holdem-seat-turn-timer");
    for (var i = 0; i < timers.length; i++) {
      var timer = timers[i];
      timer.textContent = info.active ? String(info.seconds) : "";
      timer.classList.toggle("urgent", info.urgent);
      timer.style.setProperty("--holdem-seat-timer-ratio", String(info.ratio));
    }
  }

  function renderSettings() {
    show("holdem-settings-panel", settingsOpen);
    var settingsButton = $("holdem-settings-btn");
    if (settingsButton) settingsButton.setAttribute("aria-expanded", settingsOpen ? "true" : "false");
    var unitToggle = $("holdem-unit-toggle");
    var isBb = moneyUnitMode === "bb";
    setText("holdem-unit-label", isBb ? "BB \uB2E8\uC704" : "\uCE69 \uB2E8\uC704");
    if (unitToggle) {
      unitToggle.setAttribute("aria-pressed", isBb ? "true" : "false");
      unitToggle.textContent = isBb ? "\uCE69" : "BB";
    }
  }

  function setMoneyUnitMode(mode) {
    var nextMode = mode === "bb" ? "bb" : "chips";
    if (moneyUnitMode === nextMode) {
      renderSettings();
      return;
    }
    moneyUnitMode = nextMode;
    renderHeader();
    renderSeats();
    renderHandResult();
    renderControls();
    renderSettings();
  }

  function toggleMoneyUnitMode() {
    setMoneyUnitMode(moneyUnitMode === "bb" ? "chips" : "bb");
  }

  function renderSeats() {
    var box = $("holdem-seats");
    if (!box) return;
    var perspective = state.perspectiveSeat >= 0 ? state.perspectiveSeat : 0;
    var nick = text(me().nick, 40);
    var winners = Object.create(null);
    state.winners.forEach(function (winner) { winners[winner] = true; });
    var html = [];

    for (var absolute = 0; absolute < MAX_SEATS; absolute++) {
      var seat = state.seats[absolute];
      var relative = relativeSeat(absolute, perspective);
      var isMe = !!(seat && nick && seat.nick === nick);
      var isActive = absolute === state.actingSeat;
      var classes = ["holdem-seat"];
      if (!seat) classes.push("is-empty");
      if (isMe) classes.push("is-me");
      if (isActive) classes.push("is-active");
      if (seat && seat.folded) classes.push("is-folded");
      if (seat && seat.allIn) classes.push("is-allin");
      if (seat && seat.away) classes.push("is-away");
      if (seat && seat.isBot) classes.push("is-bot");
      var isWinner = !!(seat && (seat.winner || winners[seat.nick]));
      if (isWinner) classes.push("is-winner");

      var name = seat ? (seat.displayName || seat.nick) : "빈 자리";
      var status = seatStatus(seat);
      var actionLabel = seatActionLabel(seat);
      var actionClass = seatActionClass(seat);
      var personalityLabel = seat && seat.isBot
        ? botPersonalityLabel(seat.botPersonality)
        : "";
      var avatarSrc = seat && seat.isBot
        ? botPersonalityAvatar(seat.botPersonality)
        : "";
      var displayStack = seat ? animatedStackAmount(absolute, seat.stack) : 0;
      var label = name + (seat ? ", 칩 " + formatChips(displayStack) : "") +
        (seat && seat.isBot ? ", AI, " + personalityLabel : "") +
        (status ? ", " + status : "") + (isActive ? ", 행동 차례" : "");
      var badges = "";
      if (absolute === state.dealerSeat) badges += "<span>D</span>";
      if (absolute === state.smallBlindSeat) badges += "<span>SB</span>";
      if (absolute === state.bigBlindSeat) badges += "<span>BB</span>";
      if (seat && seat.isBot) badges += '<span class="holdem-badge-ai">AI</span>';

      var holes = "";
      if (seat) {
        if (isMe && state.heroCards.length) {
          holes = state.heroCards.map(function (card) { return cardHtml(card); }).join("");
        } else if (state.revealedCards[absolute] && state.revealedCards[absolute].length) {
          holes = state.revealedCards[absolute].map(function (card) { return cardHtml(card); }).join("");
        } else {
          var count = seat.cardCount || (isHandActive(state.phase) && seat.inHand && !seat.folded ? 2 : 0);
          for (var cardIndex = 0; cardIndex < count; cardIndex++) holes += cardHtml(null, "back");
        }
      }
      var resultBadge = "";
      if (seat && isWinner && state.phase === "complete" && resultStage() !== "cards") {
        var won = animatedWinAmount(absolute);
        resultBadge = '<div class="holdem-winner-result" aria-hidden="true">' +
          (won > 0 ? '<span class="holdem-win-gain">+' + esc(formatChips(won)) + '</span>' : "") +
          '<strong>WINNER</strong>' +
          '<small>' + esc(resultHandLabel(absolute)) + '</small>' +
        '</div>';
      }

      html.push(
        '<article class="' + classes.join(" ") + '" data-seat="' + absolute +
        '" data-relative-seat="' + relative + '" aria-label="' + esc(label) + '">' +
          '<div class="holdem-hole-cards">' + holes + '</div>' +
          resultBadge +
          '<div class="holdem-seat-avatar" aria-hidden="true">' +
            (avatarSrc ? '<img src="' + esc(avatarSrc) + '" alt="">' : esc(initialFor(name))) +
          '</div>' +
          '<div class="holdem-seat-badges" aria-hidden="true">' + badges + '</div>' +
          '<strong class="holdem-seat-name">' + esc(name) + '</strong>' +
          (personalityLabel
            ? '<span class="holdem-seat-personality">' + esc(personalityLabel) + '</span>'
            : "") +
          (seat ? '<span class="holdem-seat-stack">' + formatChips(displayStack) + '</span>' : "") +
          (isActive && state.deadlineAt
            ? '<span class="holdem-seat-turn-timer" data-holdem-seat-timer="' + absolute + '"></span>'
            : "") +
          (actionLabel ? '<span class="holdem-seat-action ' + esc(actionClass) + '">' + esc(actionLabel) + '</span>' : "") +
          (seat && seat.bet > 0 ? '<span class="holdem-seat-bet">BET ' + formatChips(seat.bet) + '</span>' : "") +
          (status ? '<span class="holdem-seat-status">' + esc(status) + '</span>' : "") +
        '</article>'
      );
    }
    box.innerHTML = html.join("");
  }

  function renderBoard() {
    var board = $("holdem-board");
    if (!board) return;
    var html = "";
    var visibleCount = resultBoardVisibleCount();
    for (var i = 0; i < 5; i++) html += cardHtml(i < visibleCount ? state.board[i] : null);
    board.innerHTML = html;
    board.setAttribute("aria-label", visibleCount
      ? "커뮤니티 카드 " + visibleCount + "장"
      : "커뮤니티 카드 없음");
  }

  function renderLobbyRoster() {
    var box = $("holdem-lobby-roster");
    if (!box) return;
    var html = [];
    for (var i = 0; i < MAX_SEATS; i++) {
      var seat = state.seats[i];
      if (!seat) {
        html.push('<div class="holdem-lobby-player empty"><span>' + (i + 1) +
          '번 자리</span><small>빈 자리</small></div>');
      } else {
        var ready = seat.ready ? "준비" : "대기";
        var lobbyPersonality = seat.isBot
          ? botPersonalityLabel(seat.botPersonality)
          : "";
        var botMeta = lobbyPersonality
          ? ' · <span class="holdem-bot-personality">' +
            esc(lobbyPersonality) + '</span>'
          : "";
        html.push('<div class="holdem-lobby-player' + (seat.ready ? " ready" : "") +
          (seat.isBot ? " is-bot" : "") + '">' +
          '<span>' + esc(seat.displayName || seat.nick) + botMeta + '</span><small>' +
          formatChips(seat.stack) + " · " + ready + '</small></div>');
      }
    }
    box.innerHTML = html.join("");
  }

  function resultWinnerText() {
    if (!state.winners.length) return "핸드 종료";
    if (state.winners.length === 1) return state.winners[0] + " 승리";
    return state.winners.join(", ") + " 승리";
  }

  function showdownRowForSeat(seatIndex) {
    if (!Array.isArray(state.showdown)) return null;
    for (var i = 0; i < state.showdown.length; i++) {
      if (state.showdown[i] && state.showdown[i].seat === seatIndex) return state.showdown[i];
    }
    return null;
  }

  function resultHandLabel(seatIndex) {
    var row = showdownRowForSeat(seatIndex);
    if (row && row.handName) return row.handName;
    if (row && row.folded) return "\uD3F4\uB4DC \uACF5\uAC1C";
    return "\uC0C1\uB300 \uD3F4\uB4DC \uC2B9\uB9AC";
  }

  function resultSeatCards() {
    var rows = [];
    for (var i = 0; i < state.revealedCards.length; i++) {
      var cards = state.revealedCards[i];
      var seat = state.seats[i];
      var row = showdownRowForSeat(i);
      if (!seat || !cards || !cards.length) continue;
      rows.push({
        seat: i,
        nick: seat.displayName || seat.nick,
        stack: seat.stack,
        winner: state.winners.indexOf(seat.nick) >= 0,
        handName: row && row.handName ? row.handName : resultHandLabel(i),
        cards: cards
      });
    }
    return rows;
  }

  function renderHandResult() {
    var panel = $("holdem-result");
    if (!panel) return;
    panel.classList.add("hidden");
  }

  function renderHeader() {
    var modeLabel = state.mode === "ring"
      ? "6-MAX · 자산안심 링게임"
      : "6-MAX · " + (state.tournamentSpeed === "turbo" ? "터보" : "일반") + " 토너먼트";
    var modeDescription = state.mode === "ring"
      ? "계정 보유 자산에는 영향이 없는 방 전용 플레이 칩입니다. 전원 10,000칩으로 시작하고 블라인드는 50/100으로 고정됩니다."
      : "전원 10,000칩으로 시작하며 " +
        (state.tournamentSpeed === "turbo" ? "5분" : "10분") +
        "마다 블라인드가 올라갑니다. 마지막 한 명이 남으면 우승합니다.";
    setText("holdem-mode-label", modeLabel);
    setText("holdem-mode-description", modeDescription);
    setText("holdem-phase", phaseLabel(state.phase));
    setText("holdem-blinds",
      "SB " + formatChips(state.smallBlind) + " · BB " + formatChips(state.bigBlind) +
      (state.ante ? " · ANTE " + formatChips(state.ante) : "") +
      (state.mode === "tournament" ? " · LV " + (state.blindLevel + 1) : ""));
    setText("holdem-hand-number", "HAND " + (state.handNumber || state.handId || 0));
    setText("holdem-pot-amount", formatChips(animatedPotAmount()));
    setText("holdem-side-pots", state.sidePots.length
      ? state.sidePots.map(function (amount, index) {
          return "사이드 " + (index + 1) + " " + formatChips(amount);
        }).join(" · ")
      : "");
    var occupied = state.seats.filter(Boolean).length;
    var roster = api && typeof api.roster === "function" ? api.roster() : [];
    setText("holdem-people-count", Math.max(occupied, Array.isArray(roster) ? roster.length : 0));
    if (roomName()) setText("holdem-lobby-title", roomName());
    renderSettings();
  }

  function renderConnection() {
    var element = $("holdem-connection");
    if (!element) return;
    element.classList.remove("ready", "error");
    var message;
    if (demoMode()) {
      message = "이 기기에서 홀덤 UI를 연습 중이에요";
      element.classList.add("ready");
    } else if (!connected) {
      message = "실시간 연결이 끊겼어요 · 서버 상태를 확인 중";
      element.classList.add("error");
    } else if (lastError) {
      message = lastError;
      element.classList.add("error");
    } else if (!hasSnapshot || pendingAction === "join") {
      message = "안전한 서버 테이블에 연결하고 있어요";
    } else {
      message = "";
    }
    element.classList.toggle("hidden", !message);
    if (element.textContent !== message) element.textContent = message;

    var status = state.phase === "loading"
      ? "테이블 연결 중"
      : phaseLabel(state.phase) + (pendingAction && pendingAction !== "join" ? " · 처리 중" : "");
    setText("holdem-status", status);
  }

  function announcement() {
    if (state.message) return state.message;
    if (state.phase === "loading") return "안전한 테이블에 연결하고 있어요";
    if (state.phase === "waiting") {
      var readyCount = state.seats.filter(function (seat) { return seat && seat.ready; }).length;
      return readyCount + "명 준비 · 두 명 이상 준비하면 시작할 수 있어요";
    }
    if (state.mode === "ring" && state.heroSeat >= 0 &&
        state.seats[state.heroSeat] && state.seats[state.heroSeat].stack <= 0) {
      return state.canRefill
        ? "플레이 칩을 충전하면 다음 핸드에 참여할 수 있어요"
        : "오늘 사용할 수 있는 충전 횟수를 모두 사용했어요";
    }
    if (state.winners.length) return state.winners.join(", ") + "님이 팟을 가져갔어요";
    if (state.actingSeat === state.heroSeat && Object.keys(state.legal).length) return "내 차례입니다";
    if (state.actorIsBot && state.actingNick) return state.actingNick + "님이 생각 중이에요";
    if (state.actingNick) return state.actingNick + "님 차례";
    if (isBetweenHands(state.phase)) return "핸드가 끝났어요";
    return phaseLabel(state.phase) + " 진행 중";
  }

  function renderAnnouncer() {
    var message = announcement();
    var key = state.version + ":" + message;
    if (key !== lastAnnouncementKey) {
      setText("holdem-announcer", message);
      lastAnnouncementKey = key;
    }
  }

  function raiseBounds() {
    var minimum = state.legal.raise && state.legal.raise.min ||
      state.legal.bet && state.legal.bet.min ||
      state.minRaise || state.minBet || state.bigBlind || 1;
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    var maximum = state.legal.raise && state.legal.raise.max ||
      state.legal.bet && state.legal.bet.max ||
      state.maxRaise || hero && hero.stack || minimum;
    minimum = Math.max(1, Math.round(minimum));
    maximum = Math.max(minimum, Math.round(maximum));
    return { min: minimum, max: maximum, step: Math.max(1, state.raiseStep || 1) };
  }

  function setRaiseValue(value) {
    var slider = $("holdem-raise-slider");
    if (!slider) return;
    var bounds = raiseBounds();
    raiseValue = clamp(Math.round(finite(value, bounds.min)), bounds.min, bounds.max);
    slider.value = String(raiseValue);
    setText("holdem-raise-amount", formatChips(raiseValue));
  }

  function syncRaiseControls() {
    var slider = $("holdem-raise-slider");
    if (!slider) return;
    var bounds = raiseBounds();
    var key = state.handId + ":" + state.version + ":" + bounds.min + ":" + bounds.max + ":" + bounds.step;
    slider.min = String(bounds.min);
    slider.max = String(bounds.max);
    slider.step = String(bounds.step);
    if (raiseRangeKey !== key || raiseValue < bounds.min || raiseValue > bounds.max) {
      raiseRangeKey = key;
      setRaiseValue(bounds.min);
    } else {
      setRaiseValue(raiseValue);
    }
  }

  function quickBetTarget(kind) {
    var bounds = raiseBounds();
    var target = bounds.min;
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    var raising = !!state.legal.raise;
    var matchedBet = raising ? nonnegative(hero && hero.bet, 0) + state.toCall : 0;
    var potAfterCall = state.pot + (raising ? state.toCall : 0);
    if (kind === "half") target = matchedBet + Math.round(potAfterCall * 0.5);
    else if (kind === "three-quarter") target = matchedBet + Math.round(potAfterCall * 0.75);
    else if (kind === "pot") target = matchedBet + Math.round(potAfterCall);
    else if (kind === "allin") target = bounds.max;
    return clamp(target, bounds.min, bounds.max);
  }

  function quickBetLabel(kind) {
    return {
      half: "1/2 팟",
      "three-quarter": "3/4 팟",
      pot: "팟",
      allin: "올인"
    }[kind] || "레이즈";
  }

  function syncQuickBetButtons() {
    var buttons = root() ? root().querySelectorAll("[data-holdem-bet]") : [];
    for (var i = 0; i < buttons.length; i++) {
      var kind = buttons[i].getAttribute("data-holdem-bet");
      var amount = kind === "allin" && state.legal.allin ? "" : formatChips(quickBetTarget(kind));
      buttons[i].innerHTML = (amount ? '<span>' + esc(amount) + '</span>' : "") +
        '<strong>' + esc(quickBetLabel(kind)) + '</strong>';
    }
  }

  function renderControls() {
    var waiting = state.phase === "waiting";
    var completed = state.phase === "complete";
    var moves = ["fold", "check", "call", "bet", "raise", "allin"];
    var hasMove = moves.some(function (move) { return !!state.legal[move]; });
    var busy = pendingUiCount > 0;
    var isOwner = !!(text(me().nick, 40) && text(me().nick, 40) === state.ownerNick);
    var canManageBots = isOwner && state.canManageBots;
    var occupiedSeats = state.seats.filter(Boolean).length;
    var canSize = !!(state.legal.bet || state.legal.raise);
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    var needsRefill = state.mode === "ring" && !!hero && hero.stack <= 0 &&
      !isHandActive(state.phase);
    var menuKey = state.handId + ":" + state.version + ":" + state.actionSeq + ":" +
      state.actingSeat + ":" + (canSize ? sizedMove() : "none");
    if (menuKey !== actionMenuKey) {
      actionMenuKey = menuKey;
      raiseMenuOpen = false;
    }
    if (!hasMove || !canSize) raiseMenuOpen = false;

    show("holdem-lobby", waiting);
    show("holdem-bot-controls", canManageBots);
    show("holdem-bot-note", canManageBots);
    setText("holdem-bot-count", "AI " + state.botCount + "명");
    disable("holdem-bot-add-btn", busy || !canManageBots || occupiedSeats >= MAX_SEATS);
    disable("holdem-bot-fill-btn", busy || !canManageBots || state.botCount >= 5 || occupiedSeats >= MAX_SEATS);
    disable("holdem-bot-remove-btn", busy || !canManageBots || state.botCount <= 0);
    show("holdem-ready-btn", waiting && state.heroSeat >= 0 && state.canReady);
    show("holdem-start-btn", waiting && state.canStart);
    show("holdem-next-btn", false);
    var readyButton = $("holdem-ready-btn");
    if (readyButton) {
      readyButton.setAttribute("aria-pressed", state.heroReady ? "true" : "false");
      readyButton.textContent = state.heroReady ? "준비 취소" : "준비";
    }
    disable("holdem-ready-btn", busy);
    disable("holdem-start-btn", busy);
    disable("holdem-next-btn", busy);
    show("holdem-refill-panel", needsRefill);
    var refillButton = $("holdem-refill-btn");
    if (refillButton) {
      refillButton.textContent = formatChips(state.refillAmount || 10000) + " 충전";
      refillButton.disabled = busy || !state.canRefill;
    }
    if (needsRefill) {
      var refillStatus = state.refillStatusKnown
        ? (state.refillsRemainingToday > 0
          ? "오늘 " + state.refillsRemainingToday + "회 남음 · 충전해도 계정 자산에는 영향이 없어요"
          : "오늘 충전 3회를 모두 사용했어요")
        : "하루 최대 " + (state.dailyRefillLimit || 3) + "회 충전할 수 있어요";
      setText("holdem-refill-status", refillStatus);
    }

    show("holdem-action-panel", hasMove);
    moves.forEach(function (move) {
      var id = move === "allin" ? "holdem-allin-btn" : "holdem-" + move + "-btn";
      var visible = hasMove && !!state.legal[move];
      if (move === "allin" && canSize) visible = false;
      show(id, visible);
      disable(id, busy || !state.legal[move]);
    });
    setText("holdem-call-amount", state.toCall ? formatChips(state.toCall) : "");
    setText("holdem-action-label", state.actingSeat === state.heroSeat ? "내 차례" : "행동 선택");
    setText("holdem-hand-name", state.handName || "패를 확인하세요");

    show("holdem-raise-panel", hasMove && canSize && raiseMenuOpen);
    if (canSize) syncRaiseControls();
    if (canSize) syncQuickBetButtons();
    var slider = $("holdem-raise-slider");
    if (slider) slider.disabled = busy;
    var quick = root() ? root().querySelectorAll("[data-holdem-bet]") : [];
    for (var i = 0; i < quick.length; i++) quick[i].disabled = busy;

    var screen = root();
    if (screen) {
      screen.classList.toggle("is-requesting", busy);
      screen.classList.toggle("is-actioning", hasMove);
      screen.classList.toggle("is-raise-menu-open", hasMove && canSize && raiseMenuOpen);
    }
    renderConnection();
  }

  function renderTimer() {
    renderAutoNextCountdown();
    renderSeatTimers();
    renderSettlementAnimation();
    var timer = $("holdem-timer");
    if (!timer) return;
    if (!state.deadlineAt) {
      timer.textContent = "--";
      timer.classList.remove("urgent");
      return;
    }
    var info = timerSnapshot();
    var remaining = Math.max(0, state.deadlineAt - Date.now());
    timer.textContent = String(info.seconds);
    timer.classList.toggle("urgent", info.urgent);
    var ring = $("holdem-timer-ring");
    if (ring) ring.style.setProperty("--holdem-timer-ratio", String(info.ratio));
    if (remaining <= 0) requestDeadlineTick();
  }

  function renderAutoNextCountdown() {
    var countdown = $("holdem-result-countdown");
    if (!countdown) return;
    if (state.phase !== "complete") {
      countdown.textContent = "";
      return;
    }
    if (!state.canStart) {
      countdown.textContent = "다음 핸드를 준비하고 있어요.";
      return;
    }
    var remaining = autoNextDueAt ? Math.max(0, autoNextDueAt - Date.now()) : AUTO_NEXT_HAND_MS;
    var seconds = Math.max(1, Math.ceil(remaining / 1000));
    countdown.textContent = seconds + "초 후 다음 핸드가 자동으로 시작됩니다.";
  }

  function syncResultClasses() {
    var screen = root();
    if (!screen) return;
    var stage = resultStage();
    var settling = !!(state.phase === "complete" && resultFlow &&
      Date.now() >= resultFlow.settleStart && Date.now() < resultFlow.settleEnd);
    screen.classList.toggle("is-result-cards-first", stage === "cards");
    screen.classList.toggle("is-result-announced", stage === "announced");
    screen.classList.toggle("is-settling-pot", settling);
  }

  function renderSettlementAnimation() {
    if (state.phase !== "complete") return;
    syncResultClasses();
    renderBoard();
    setText("holdem-pot-amount", formatChips(animatedPotAmount()));
    setText("holdem-result-pot", formatChips(animatedPotAmount()));
    for (var i = 0; i < MAX_SEATS; i++) {
      var seat = state.seats[i];
      if (!seat) continue;
      var node = root() && root().querySelector('.holdem-seat[data-seat="' + i + '"] .holdem-seat-stack');
      if (node) node.textContent = formatChips(animatedStackAmount(i, seat.stack));
    }
    if (resultStage() === "announced") renderHandResult();
  }

  function renderPlayers(box, hint) {
    if (!box) return;
    if (hint) {
      hint.className = "players-hint";
      hint.textContent = "홀덤 좌석과 현재 플레이 칩입니다. 한 테이블에는 최대 6명이 참가합니다.";
    }
    var byNick = Object.create(null);
    state.seats.forEach(function (seat, index) {
      if (seat && seat.nick) byNick[seat.nick] = { seat: seat, index: index };
    });
    var people = api && typeof api.roster === "function" ? api.roster() : [];
    if (!Array.isArray(people)) people = [];
    var names = people.map(function (person) { return text(person && person.nick, 40); }).filter(Boolean);
    Object.keys(byNick).forEach(function (nick) {
      if (names.indexOf(nick) < 0) names.push(nick);
    });
    box.innerHTML = names.map(function (nick) {
      var row = byNick[nick];
      var playerPersonality = row && row.seat.isBot
        ? botPersonalityLabel(row.seat.botPersonality)
        : "";
      var role = row
        ? (row.seat.isBot
          ? "AI" + (playerPersonality ? " · " + playerPersonality : "")
          : (row.index + 1) + "번 좌석")
        : "관전";
      var stack = row ? formatChips(row.seat.stack) : "";
      var mine = nick === text(me().nick, 40) ? ' <span class="mini-me">나</span>' : "";
      var away = row && row.seat.away ? ' <span class="mini-away">자리비움</span>' : "";
      return '<div class="prow"><span class="pname"><span class="rtag role-holdem">' +
        esc(role) + '</span>' + esc(row ? (row.seat.displayName || nick) : nick) + mine + away + '</span>' +
        (stack ? '<span class="holdem-player-stack">' + stack + '</span>' : "") +
        '</div>';
    }).join("") || '<p class="players-hint">아직 참가자가 없어요.</p>';
  }

  function render() {
    var screen = root();
    if (!screen) return;
    screen.dataset.phase = state.phase;
    screen.classList.toggle("is-playing", isHandActive(state.phase));
    screen.classList.toggle("is-showdown", isBetweenHands(state.phase));
    screen.classList.toggle("is-connected", connected);
    syncResultClasses();
    renderHeader();
    renderBoard();
    renderSeats();
    renderLobbyRoster();
    renderHandResult();
    renderAnnouncer();
    renderControls();
    renderTimer();
    scheduleBotStep();
    scheduleAutoReadyForNextHand();
    scheduleAutoNextHand();
  }

  function quickBet(kind) {
    if (kind === "allin" && state.legal.allin) {
      performMove("allin");
      return;
    }
    setRaiseValue(quickBetTarget(kind));
    performSizedMove(raiseValue);
  }

  function sendChat() {
    var input = $("holdem-chat-input");
    if (!input || !api) return;
    var value = text(input.value, 80);
    if (!value) return;
    var sent = false;
    if (typeof api.sendChat === "function") sent = api.sendChat(value) !== false;
    else if (typeof api.send === "function") {
      api.send({ t: "chat", game: "holdem", nick: text(me().nick, 40), text: value });
      sent = true;
    }
    if (sent) input.value = "";
  }

  function onRootClick(event) {
    var screen = root();
    if (!screen || !event.target || !event.target.closest) return;

    var seatElement = event.target.closest(".holdem-seat.is-empty");
    if (seatElement && screen.contains(seatElement)) {
      var targetSeat = safeSeat(seatElement.getAttribute("data-seat"));
      if (targetSeat >= 0 && !isHandActive(state.phase) && !requests.join) joinTable(targetSeat);
      return;
    }

    var button = event.target.closest("button");
    if (!button || !screen.contains(button)) return;
    var id = button.id;
    if (id === "holdem-settings-btn") {
      settingsOpen = !settingsOpen;
      renderSettings();
    } else if (id === "holdem-settings-close") {
      settingsOpen = false;
      renderSettings();
    } else if (id === "holdem-unit-toggle") {
      toggleMoneyUnitMode();
    } else if (id === "holdem-people-btn") {
      if (api && typeof api.openPlayers === "function") api.openPlayers();
    } else if (id === "holdem-rules-btn") {
      if (api && typeof api.openRules === "function") api.openRules();
      else if (api && typeof api.openMenu === "function") api.openMenu();
    } else if (id === "holdem-leave-btn") {
      if (api && typeof api.leaveRoom === "function") api.leaveRoom();
    } else if (id === "holdem-chat-send") {
      sendChat();
    } else if (id === "holdem-ready-btn") {
      setReady();
    } else if (id === "holdem-refill-btn") {
      refillRingChips();
    } else if (id === "holdem-bot-add-btn") {
      addBot();
    } else if (id === "holdem-bot-fill-btn") {
      addFiveBots();
    } else if (id === "holdem-bot-remove-btn") {
      removeBot();
    } else if (id === "holdem-start-btn" || id === "holdem-next-btn") {
      startHand();
    } else if (id === "holdem-fold-btn") {
      performMove("fold");
    } else if (id === "holdem-check-btn") {
      performMove("check");
    } else if (id === "holdem-call-btn") {
      performMove("call");
    } else if (id === "holdem-bet-btn") {
      if (!raiseMenuOpen && state.legal.bet) {
        raiseMenuOpen = true;
        renderControls();
      } else {
        performMove("bet", raiseValue);
      }
    } else if (id === "holdem-raise-btn") {
      if (!raiseMenuOpen && state.legal.raise) {
        raiseMenuOpen = true;
        renderControls();
      } else {
        performMove("raise", raiseValue);
      }
    } else if (id === "holdem-allin-btn") {
      performMove("allin");
    } else if (button.hasAttribute("data-holdem-bet")) {
      quickBet(button.getAttribute("data-holdem-bet"));
    }
  }

  function onRootInput(event) {
    if (event.target && event.target.id === "holdem-raise-slider") {
      setRaiseValue(event.target.value);
    }
  }

  function onRootKeydown(event) {
    if (event.key === "Escape" && settingsOpen) {
      settingsOpen = false;
      renderSettings();
      return;
    }
    if (event.target && event.target.id === "holdem-chat-input" &&
        event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      sendChat();
    }
  }

  function bindDom() {
    var screen = root();
    if (!screen) return false;
    if (boundRoot === screen) return true;
    if (boundRoot) {
      boundRoot.removeEventListener("click", onRootClick);
      boundRoot.removeEventListener("input", onRootInput);
      boundRoot.removeEventListener("keydown", onRootKeydown);
    }
    boundRoot = screen;
    boundRoot.addEventListener("click", onRootClick);
    boundRoot.addEventListener("input", onRootInput);
    boundRoot.addEventListener("keydown", onRootKeydown);
    return true;
  }

  function startTimers() {
    stopTimers();
    pollId = setInterval(function () {
      if (active && !requests.snapshot) refreshSnapshot("poll", false);
    }, POLL_MS);
    clockId = setInterval(function () {
      if (active) renderTimer();
    }, CLOCK_MS);
  }

  function stopTimers() {
    if (pollId) { clearInterval(pollId); pollId = null; }
    if (clockId) { clearInterval(clockId); clockId = null; }
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    clearAutoNextHand();
    clearAutoReadyForNextHand();
    clearBotTimer();
    resultFlow = null;
  }

  function enter(nextApi) {
    leave();
    api = nextApi;
    active = true;
    connected = true;
    joined = false;
    hasSnapshot = false;
    lastError = "";
    state = emptyState();
    rawSnapshot = null;
    lastAppliedResponse = 0;
    lastAnnouncementKey = "";
    tickSentKey = "";
    botSentKey = "";
    botRetryAt = 0;
    demoState = null;
    demoVersion = 0;
    resultFlow = null;
    if (!bindDom()) throw new Error("텍사스 홀덤 화면을 찾을 수 없습니다.");
    render();
    startTimers();
    joinTable();
  }

  function leave() {
    var previousAuth = auth();
    var previousRoom = roomId();
    var previousVersion = state.version;
    var wasJoined = active && joined;
    lifecycleGeneration += 1;
    stopTimers();
    active = false;

    if (wasJoined && previousRoom) {
      var req = requestId("leave");
      var body = {
        roomId: previousRoom,
        requestId: req,
        expectedVersion: previousVersion
      };
      var leavePromise;
      if (demoMode()) leavePromise = demoInvoke("leave", body);
      else if (window.Db && typeof Db.holdemInvoke === "function") {
        leavePromise = Promise.resolve(Db.holdemInvoke(previousAuth, "leave", body));
      }
      if (leavePromise) leavePromise.catch(function () {});
    }

    api = null;
    joined = false;
    hasSnapshot = false;
    lastError = "";
    requests = Object.create(null);
    pendingCount = 0;
    pendingUiCount = 0;
    pendingAction = "";
    state = emptyState();
    rawSnapshot = null;
    demoState = null;
    demoVersion = 0;
    botSentKey = "";
    botRetryAt = 0;
  }

  function onReady() {
    if (active) scheduleRefresh("ready", true);
  }

  function onConnection(isOnline) {
    connected = !!isOnline;
    renderConnection();
    if (connected && active) scheduleRefresh("reconnected", true);
  }

  function onMessage(message) {
    if (!message || message.t !== "holdem_refresh") return false;
    // Never consume message.snapshot/message.cards. The only safe reaction to
    // a public notification is a personalized server fetch.
    var hintedVersion = Math.max(0, integer(message.version, 0));
    if (!hasSnapshot || !hintedVersion || hintedVersion > state.version) {
      scheduleRefresh("broadcast", true);
    }
    return true;
  }

  function onPresence(list, options) {
    list = Array.isArray(list) ? list : [];
    var key = list.map(function (person) {
      return text(person && person.nick, 40) + ":" + (person && person.away ? "1" : "0");
    }).sort().join("|");
    renderHeader();
    if (key !== lastPresenceKey || options && options.expiredNick) {
      lastPresenceKey = key;
      scheduleRefresh("presence", false);
    }
  }

  function roomMeta() {
    var occupied = state.seats.filter(Boolean).length;
    if (isHandActive(state.phase)) {
      return {
        status: "게임중",
        summary: occupied + "/6명 · " + phaseLabel(state.phase) + " · 팟 " + formatChips(state.pot)
      };
    }
    if (isBetweenHands(state.phase)) {
      return {
        status: "끝",
        summary: occupied + "/6명 · 핸드 종료"
      };
    }
    var ready = state.seats.filter(function (seat) { return seat && seat.ready; }).length;
    return {
      status: "대기중",
      summary: occupied + "/6명 참가 · " + ready + "명 준비"
    };
  }

  function isBusy() {
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    return !!(hero && isHandActive(state.phase) && hero.inHand && !hero.folded);
  }

  function canChat() {
    return true;
  }

  function rules() {
    return {
      title: "텍사스 홀덤 규칙",
      html: '<div class="cm-rules holdem-rules">' +
        '<p class="rule-intro">Poker TDA 2024와 일반적인 국제 토너먼트 진행 원칙을 바탕으로 한 6인 노리밋 텍사스 홀덤입니다. 각자 받은 <b>홀 카드 2장</b>과 모두가 공유하는 커뮤니티 카드 5장 중 가장 좋은 5장 조합으로 승부하며, 실제 가치가 없는 플레이 칩만 사용합니다.</p>' +
        '<section class="cm-rule-section"><h3>1. 진행 순서</h3><ul class="cm-rule-list">' +
        '<li>딜러 버튼 왼쪽의 두 사람이 스몰 블라인드(SB)와 빅 블라인드(BB)를 냅니다.</li>' +
        '<li>프리플랍 → 플랍 3장 → 턴 1장 → 리버 1장 순서로 공개되며 각 단계마다 베팅합니다.</li>' +
        '<li>가능한 액션은 폴드, 체크, 콜, 벳, 레이즈, 올인입니다. 서버가 현재 가능한 액션과 최소 금액을 검증합니다.</li>' +
        '</ul></section>' +
        '<section class="cm-rule-section"><h3>2. 패 순위</h3><p>로열 플러시 · 스트레이트 플러시 · 포카드 · 풀하우스 · 플러시 · 스트레이트 · 트리플 · 투페어 · 원페어 · 하이카드 순입니다. 같은 조합이면 구성 카드의 높은 숫자를 차례로 비교합니다.</p></section>' +
        '<section class="cm-rule-section"><h3>3. 올인과 동률</h3><ul class="cm-rule-list">' +
        '<li>칩이 부족한 참가자가 올인하면 참가 자격에 따라 메인 팟과 사이드 팟이 나뉩니다.</li>' +
        '<li>숏 올인은 허용되지만 정상 최소 레이즈에 못 미치면 단독으로 베팅 권리를 다시 열지 않습니다. 여러 숏 올인의 누적액이 정상 레이즈 폭에 이르면 다시 레이즈할 수 있습니다.</li>' +
        '<li>완전히 같은 패는 팟을 나누며, 나눌 수 없는 남는 칩은 규칙상 먼저 받을 위치의 참가자에게 갑니다.</li>' +
        '</ul></section>' +
        '<p class="cm-rule-muted">공개 알림에는 카드 정보가 포함되지 않으며, 내 홀 카드는 인증된 개인 스냅샷에서만 표시됩니다.</p>' +
        '</div>'
    };
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
    get state() { return state; }
  };

  if (window.__HOLDEM_TEST__) {
    controller._test = {
      emptyState: emptyState,
      normalizeSnapshot: normalizeSnapshot,
      normalizeCard: normalizeCard,
      normalizeLegal: normalizeLegal,
      cardHtml: cardHtml,
      resultBoardVisibleCount: resultBoardVisibleCount,
      relativeSeat: relativeSeat,
      requestId: requestId,
      joinTable: joinTable,
      applySnapshot: applySnapshot,
      invoke: invoke,
      setApi: function (nextApi) { api = nextApi; },
      setActive: function (value) { active = !!value; },
      setState: function (nextState) { state = nextState; },
      getLifecycleGeneration: function () { return lifecycleGeneration; },
      getRawSnapshot: function () { return rawSnapshot; },
      constants: {
        maxSeats: MAX_SEATS,
        pollMs: POLL_MS,
        clockMs: CLOCK_MS,
        resultCardsFirstMs: RESULT_CARDS_FIRST_MS,
        resultBoardRevealStepMs: RESULT_BOARD_REVEAL_STEP_MS
      }
    };
  }

  return controller;
})();
