/*
 * Texas Hold'em client controller.
 *
 * Integration contract
 * --------------------
 * Screen/root: #holdemgame, #holdem-stage
 * Readouts: #holdem-status, #holdem-connection, #holdem-phase,
 *   #holdem-blinds, #holdem-hand-number, #holdem-pot,
 *   #holdem-pot-amount, #holdem-table-hint, #holdem-board,
 *   #holdem-table-start-btn, #holdem-seats, #holdem-announcer,
 *   #holdem-people-count
 * Waiting UI: #holdem-lobby, #holdem-lobby-title,
 *   #holdem-lobby-roster, #holdem-ready-btn, #holdem-start-btn,
 *   #holdem-bot-controls, #holdem-bot-add-btn, #holdem-bot-remove-btn, #holdem-bot-fill-btn,
 *   #holdem-bot-count
 * Action UI: #holdem-action-panel, #holdem-action-label,
 *   #holdem-hand-name, #holdem-timer-ring, #holdem-timer,
 *   #holdem-raise-panel, #holdem-raise-slider,
 *   #holdem-raise-amount, #holdem-fold-btn, #holdem-check-btn,
 *   #holdem-call-btn, #holdem-call-amount, #holdem-bet-btn,
 *   #holdem-raise-btn, #holdem-allin-btn
 * Utility/chat: #holdem-settings-btn, #holdem-people-btn,
 *   #holdem-hands-btn, #holdem-rank-btn, #holdem-leave-btn, #holdem-chat-input,
 *   #holdem-chat-send, #holdem-chat-toggle, #holdem-chat-overlay
 * Quick bet buttons: [data-holdem-bet="half|three-quarter|pot|two-pot|four-pot|eight-pot|allin"]
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
  var RESULT_FINAL_ACTION_MS = 2000;
  var RESULT_CARDS_FIRST_MS = 900;
  var RESULT_BOARD_REVEAL_STEP_MS = 900;
  var COMMUNITY_CARD_FLIP_MS = 620;
  var COMMUNITY_RIVER_FLIP_MS = 1800;
  var COMMUNITY_RIVER_OPEN_CUE_MS = 1400;
  var COMMUNITY_CARD_FLIP_STAGGER_MS = 120;
  var HOLDEM_SFX_POOL_SIZE = 2;
  var COMMUNITY_CARD_OPEN_SFX_SRC = "assets/holdem/community-card-open.mp3";
  var COMMUNITY_CARD_OPEN_SFX_VOLUME = 0.78;
  var TIMER_WARNING_SFX_SRC = "assets/warn.mp3";
  var TIMER_WARNING_SFX_VOLUME = 1;
  var TURN_START_SFX_SRC = "assets/holdem/my-turn.mp3";
  var TURN_START_SFX_VOLUME = 0.92;
  var ACTION_SFX_SOURCES = {
    fold: "assets/holdem/fold.mp3",
    check: "assets/holdem/check.mp3",
    call: "assets/holdem/call.mp3",
    bet: "assets/holdem/bet.mp3",
    raise: "assets/holdem/raise.mp3",
    allin: "assets/holdem/allin.mp3",
    winner: "assets/holdem/winner.mp3"
  };
  var ALLIN_BGM_SFX_SRC = "assets/holdem/allin-bgm.mp3";
  var ALLIN_BGM_SFX_VOLUME = 0.72;
  var ACTION_SFX_VOLUMES = {
    fold: 0.86,
    check: 0.86,
    call: 0.86,
    bet: 0.82,
    raise: 0.84,
    allin: 0.88,
    winner: 0.9
  };
  var RESULT_SETTLE_MS = 1600;
  var RESULT_REVIEW_MS = 4000;
  var PROFILE_AVATAR_STORAGE_PREFIX = "dongne_holdem_profile_avatar:";
  var PROFILE_AVATAR_SIZE = 256;
  var PROFILE_AVATAR_MAX_DATA_URL_LENGTH = 76000;
  var PROFILE_AVATAR_REFRESH_MS = 300000;
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
  var pendingMove = null;
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
  var profileDialogOpen = false;
  var profileWalletPending = false;
  var profileWallet = null;
  var profileWalletNick = "";
  var profileWalletRequestSeq = 0;
  var profileAssetPending = false;
  var profileAsset = null;
  var profileAssetNick = "";
  var profileAssetRequestSeq = 0;
  var profileTargetSeat = -1;
  var profileAvatarCache = Object.create(null);
  var profileAvatarRequestKey = "";
  var profileAvatarRequestSeq = 0;
  var profileAvatarFetchedAt = 0;
  var buyInDialogOpen = false;
  var buyInMode = "join";
  var buyInSeat = -1;
  var buyInValue = 0;
  var buyInWallet = null;
  var buyInWalletPending = false;
  var buyInWalletRequestSeq = 0;
  var autoBuyInKey = "";
  var autoSeatKey = "";
  var autoSeatSuppressed = false;
  var autoNextTimer = null;
  var autoNextKey = "";
  var autoNextDueAt = 0;
  var autoReadyTimer = null;
  var autoReadyKey = "";
  var leaveAfterHandRequested = false;
  var resultFlow = null;
  var boardRevealState = { key: "", cards: [], revealAt: [], delayMs: [], soundKeys: [] };
  var communityCardOpenSfxEls = [];
  var actionSfxEls = Object.create(null);
  var sfxPoolCursor = Object.create(null);
  var allinBgmSfxEl = null;
  var timerWarningSfxEls = [];
  var turnStartSfxEls = [];
  var holdemAudioContext = null;
  var holdemAudioBuffers = Object.create(null);
  var holdemAudioBufferPromises = Object.create(null);
  var holdemAudioUnlockBound = false;
  var holdemAudioUnlocking = false;
  var holdemAudioUnlocked = false;
  var holdemAudioUnlockEl = null;
  var communityCardOpenSoundTimers = [];
  var actionSoundTimers = [];
  var lastActionSoundKey = "";
  var lastAllinBgmKey = "";
  var lastWinnerSoundKey = "";
  var lastTimerWarningKey = "";
  var lastTurnSoundKey = "";
  var actionTagAnimationKeys = Object.create(null);
  var pendingActionTagAnimationKeys = Object.create(null);
  var suppressActionTagAnimations = false;
  var payoutParticleStreamKey = "";
  var payoutParticleCleanupTimer = null;
  var lastBoardHtml = "";
  var lastSeatsHtml = "";
  var lastSeatResultStage = "none";
  var communityRevealControlBlocked = false;

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
      chipUnit: 100,
      startingStack: 20000,
      blindLevel: 0,
      nextBlindAt: 0,
      seats: seats,
      heroSeat: -1,
      perspectiveSeat: 0,
      heroCards: [],
      revealedCards: [null, null, null, null, null, null],
      board: [],
      pot: 0,
      lastRake: 0,
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
      raiseStep: 100,
      heroReady: false,
      canReady: false,
      canStart: false,
      canNext: false,
      newGameBuyInRequired: false,
      canManageBots: false,
      pendingJoinRequests: [],
      assetBacked: false,
      practiceMode: false,
      canRefill: false,
      refillAmount: 0,
      buyInMin: 10000,
      buyInMax: 100000,
      buyInDefault: 30000,
      dailyRefillLimit: 0,
      refillsUsedToday: 0,
      refillsRemainingToday: 0,
      refillStatusKnown: false,
      botCount: 0,
      actorIsBot: false,
      botDueAt: 0,
      actionSeq: 0,
      actionHistory: [],
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
      return new Intl.NumberFormat("ko-KR").format(amount) + "\uC6D0";
    } catch (_error) {
      return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "\uC6D0";
    }
  }

  function formatAsset(value) {
    var amount = Math.max(0, Math.floor(Number(value) || 0));
    try {
      return new Intl.NumberFormat("ko-KR").format(amount) + "\uC6D0";
    } catch (_error) {
      return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "\uC6D0";
    }
  }

  function profileAvatarStorageKey(nick) {
    return PROFILE_AVATAR_STORAGE_PREFIX + encodeURIComponent(text(nick, 40));
  }

  function readProfileAvatar(nick) {
    nick = text(nick, 40);
    if (Object.prototype.hasOwnProperty.call(profileAvatarCache, nick)) {
      return profileAvatarCache[nick] || "";
    }
    if (typeof localStorage === "undefined") return "";
    try {
      return localStorage.getItem(profileAvatarStorageKey(nick)) || "";
    } catch (_error) {
      return "";
    }
  }

  function writeProfileAvatar(nick, dataUrl) {
    nick = text(nick, 40);
    profileAvatarCache[nick] = dataUrl || "";
    if (typeof localStorage === "undefined") return false;
    try {
      localStorage.setItem(profileAvatarStorageKey(nick), dataUrl);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function removeProfileAvatar(nick) {
    nick = text(nick, 40);
    profileAvatarCache[nick] = "";
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(profileAvatarStorageKey(nick));
    } catch (_error) {}
  }

  function persistProfileAvatar(nick, dataUrl) {
    var currentAuth = auth();
    nick = text(nick || currentAuth.nick || me().nick, 40);
    if (!nick || !currentAuth.hash || !window.Db || typeof Db.saveProfileAvatar !== "function") {
      return Promise.resolve({ ok: false, reason: "unavailable" });
    }
    return Promise.resolve(Db.saveProfileAvatar({
      nick: nick,
      hash: currentAuth.hash
    }, dataUrl || ""));
  }

  function cacheRemoteProfileAvatars(avatars) {
    if (!isObject(avatars)) return false;
    var changed = false;
    Object.keys(avatars).forEach(function (nick) {
      var key = text(nick, 40);
      if (!key) return;
      var avatar = text(avatars[nick], 90000);
      if (profileAvatarCache[key] !== avatar) {
        profileAvatarCache[key] = avatar;
        changed = true;
      }
      if (key === text(me().nick, 40)) {
        if (avatar) writeProfileAvatar(key, avatar);
        else removeProfileAvatar(key);
      }
    });
    return changed;
  }

  function profileAvatarNicksFromSnapshot(snapshot) {
    var seen = Object.create(null);
    var nicks = [];
    (snapshot && Array.isArray(snapshot.seats) ? snapshot.seats : []).forEach(function (seat) {
      var nick = text(seat && seat.nick, 40);
      if (!nick || seen[nick] || seat.isBot) return;
      seen[nick] = true;
      nicks.push(nick);
    });
    var mine = text(me().nick, 40);
    if (mine && !seen[mine]) nicks.push(mine);
    return nicks.sort();
  }

  function refreshProfileAvatars(snapshot, force) {
    if (!window.Db || typeof Db.getProfileAvatars !== "function") return;
    var nicks = profileAvatarNicksFromSnapshot(snapshot || state);
    if (!nicks.length) return;
    var now = Date.now();
    var key = nicks.join("\n");
    if (!force && key === profileAvatarRequestKey &&
        now - profileAvatarFetchedAt < PROFILE_AVATAR_REFRESH_MS) return;
    profileAvatarRequestKey = key;
    profileAvatarFetchedAt = now;
    var seq = ++profileAvatarRequestSeq;
    Promise.resolve(Db.getProfileAvatars(nicks)).then(function (result) {
      if (seq !== profileAvatarRequestSeq || !result || !result.ok) return;
      if (cacheRemoteProfileAvatars(result.avatars)) {
        renderSeats();
        if (profileDialogOpen) renderProfileDialog();
      }
    }, function () {});
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

  function communityCardKey(card) {
    return card && card.rank && card.suit ? String(card.rank) + String(card.suit) : "";
  }

  function holdemAssetUrl(path) {
    return window.AppShell && AppShell.assetUrl ? AppShell.assetUrl(path) : path;
  }

  function holdemSoundMuted() {
    try {
      return localStorage.getItem("omok_mute") === "1";
    } catch (e) {
      return false;
    }
  }

  function createHoldemAudio(src, volume) {
    if (!src || typeof Audio === "undefined") return null;
    var el = new Audio(holdemAssetUrl(src));
    el.preload = "auto";
    el.volume = volume;
    try {
      el.setAttribute("playsinline", "");
      el.setAttribute("webkit-playsinline", "");
      el.load();
    } catch (e) {}
    return el;
  }

  function ensureHoldemAudioContext() {
    if (holdemAudioContext) return holdemAudioContext;
    var AudioContextCtor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AudioContextCtor) return null;
    try {
      holdemAudioContext = new AudioContextCtor();
      return holdemAudioContext;
    } catch (e) {
      return null;
    }
  }

  function resumeHoldemAudioContext() {
    var context = ensureHoldemAudioContext();
    if (!context) return Promise.resolve(false);
    if (context.state === "running") return Promise.resolve(true);
    if (typeof context.resume !== "function") return Promise.resolve(false);
    try {
      var resumed = context.resume();
      return Promise.resolve(resumed).then(function () {
        return context.state === "running";
      }, function () {
        return false;
      });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function decodeHoldemAudioData(context, data) {
    try {
      var decoded = context.decodeAudioData(data.slice(0));
      if (decoded && typeof decoded.then === "function") return decoded;
    } catch (e) {}
    return new Promise(function (resolve, reject) {
      try {
        context.decodeAudioData(data.slice(0), resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  function loadHoldemAudioBuffer(key, src) {
    if (!key || !src || typeof fetch === "undefined") return null;
    if (holdemAudioBuffers[key]) return Promise.resolve(holdemAudioBuffers[key]);
    if (holdemAudioBufferPromises[key]) return holdemAudioBufferPromises[key];
    var context = ensureHoldemAudioContext();
    if (!context) return null;
    holdemAudioBufferPromises[key] = fetch(holdemAssetUrl(src), { cache: "force-cache" })
      .then(function (response) {
        if (!response || !response.ok) throw new Error("Holdem audio load failed");
        return response.arrayBuffer();
      })
      .then(function (data) {
        return decodeHoldemAudioData(context, data);
      })
      .then(function (buffer) {
        holdemAudioBuffers[key] = buffer;
        return buffer;
      })
      .catch(function () {
        delete holdemAudioBufferPromises[key];
        return null;
      });
    return holdemAudioBufferPromises[key];
  }

  function preloadHoldemAudioBuffers() {
    loadHoldemAudioBuffer("community-card-open", COMMUNITY_CARD_OPEN_SFX_SRC);
    loadHoldemAudioBuffer("timer-warning", TIMER_WARNING_SFX_SRC);
    loadHoldemAudioBuffer("turn-start", TURN_START_SFX_SRC);
    Object.keys(ACTION_SFX_SOURCES).forEach(function (kind) {
      loadHoldemAudioBuffer("action-" + kind, ACTION_SFX_SOURCES[kind]);
    });
  }

  function playHoldemAudioBuffer(key, volume) {
    var context = ensureHoldemAudioContext();
    var buffer = key ? holdemAudioBuffers[key] : null;
    if (!context || !buffer || context.state === "suspended") return false;
    try {
      var source = context.createBufferSource();
      var gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(context.destination);
      source.onended = function () {
        try { source.disconnect(); } catch (_sourceError) {}
        try { gain.disconnect(); } catch (_gainError) {}
      };
      source.start(0);
      return true;
    } catch (e) {
      return false;
    }
  }

  function ensureHoldemAudioPool(pool, src, volume, size) {
    if (typeof Audio === "undefined") return [];
    size = Math.max(1, integer(size, HOLDEM_SFX_POOL_SIZE));
    while (pool.length < size) {
      var el = createHoldemAudio(src, volume);
      if (!el) break;
      pool.push(el);
    }
    return pool;
  }

  function nextHoldemPoolAudio(key, pool) {
    if (!pool || !pool.length) return null;
    var start = Math.max(0, integer(sfxPoolCursor[key], 0)) % pool.length;
    for (var i = 0; i < pool.length; i++) {
      var index = (start + i) % pool.length;
      var candidate = pool[index];
      if (candidate && (candidate.paused || candidate.ended || candidate.currentTime <= 0)) {
        sfxPoolCursor[key] = (index + 1) % pool.length;
        return candidate;
      }
    }
    sfxPoolCursor[key] = (start + 1) % pool.length;
    return pool[start];
  }

  function playHoldemAudioElement(el, volume, retry) {
    if (!el) return false;
    try {
      el.pause();
      el.currentTime = 0;
      el.muted = false;
      el.volume = volume;
      if (el.readyState === 0 && typeof el.load === "function") el.load();
      var played = el.play();
      if (played && typeof played.catch === "function") {
        played.catch(function () {
          if (retry === false || !active || holdemSoundMuted()) return;
          setTimeout(function () {
            playHoldemAudioElement(el, volume, false);
          }, 80);
        });
      }
      return true;
    } catch (e) {
      if (retry !== false && active && !holdemSoundMuted()) {
        setTimeout(function () {
          playHoldemAudioElement(el, volume, false);
        }, 80);
      }
      return false;
    }
  }

  function playHoldemAudioPool(key, pool, volume) {
    return playHoldemAudioElement(nextHoldemPoolAudio(key, pool), volume, true);
  }

  function ensureCommunityCardOpenSfx() {
    return ensureHoldemAudioPool(
      communityCardOpenSfxEls,
      COMMUNITY_CARD_OPEN_SFX_SRC,
      COMMUNITY_CARD_OPEN_SFX_VOLUME,
      HOLDEM_SFX_POOL_SIZE
    );
  }

  function playCommunityCardOpenSfx() {
    if (!active || holdemSoundMuted()) return false;
    if (playHoldemAudioBuffer("community-card-open", COMMUNITY_CARD_OPEN_SFX_VOLUME)) return true;
    return playHoldemAudioPool("community-card-open", ensureCommunityCardOpenSfx(), COMMUNITY_CARD_OPEN_SFX_VOLUME);
  }

  function ensureActionSfx(kind) {
    var src = ACTION_SFX_SOURCES[kind];
    if (!src || typeof Audio === "undefined") return [];
    if (!actionSfxEls[kind]) {
      actionSfxEls[kind] = [];
    }
    return ensureHoldemAudioPool(actionSfxEls[kind], src, ACTION_SFX_VOLUMES[kind] || 0.85, HOLDEM_SFX_POOL_SIZE);
  }

  function ensureAllinBgmSfx() {
    if (typeof Audio === "undefined") return null;
    if (!allinBgmSfxEl) {
      allinBgmSfxEl = createHoldemAudio(ALLIN_BGM_SFX_SRC, ALLIN_BGM_SFX_VOLUME);
      if (allinBgmSfxEl) allinBgmSfxEl.loop = false;
    }
    return allinBgmSfxEl;
  }

  function ensureTimerWarningSfx() {
    return ensureHoldemAudioPool(
      timerWarningSfxEls,
      TIMER_WARNING_SFX_SRC,
      TIMER_WARNING_SFX_VOLUME,
      HOLDEM_SFX_POOL_SIZE
    );
  }

  function ensureTurnStartSfx() {
    return ensureHoldemAudioPool(
      turnStartSfxEls,
      TURN_START_SFX_SRC,
      TURN_START_SFX_VOLUME,
      HOLDEM_SFX_POOL_SIZE
    );
  }

  function playActionSfx(kind) {
    kind = ACTION_SFX_SOURCES[kind] ? kind : "";
    if (!active || !kind || holdemSoundMuted()) return false;
    if (playHoldemAudioBuffer("action-" + kind, ACTION_SFX_VOLUMES[kind] || 0.85)) return true;
    return playHoldemAudioPool("action-" + kind, ensureActionSfx(kind), ACTION_SFX_VOLUMES[kind] || 0.85);
  }

  function playAllinBgmSfx() {
    if (!active || holdemSoundMuted()) return false;
    var el = ensureAllinBgmSfx();
    if (!el) return false;
    el.loop = false;
    return playHoldemAudioElement(el, ALLIN_BGM_SFX_VOLUME, true);
  }

  function playTimerWarningSfx() {
    if (!active || holdemSoundMuted()) return false;
    if (playHoldemAudioBuffer("timer-warning", TIMER_WARNING_SFX_VOLUME)) return true;
    return playHoldemAudioPool("timer-warning", ensureTimerWarningSfx(), TIMER_WARNING_SFX_VOLUME);
  }

  function playTurnStartSfx() {
    if (!active || holdemSoundMuted()) return false;
    if (playHoldemAudioBuffer("turn-start", TURN_START_SFX_VOLUME)) return true;
    return playHoldemAudioPool("turn-start", ensureTurnStartSfx(), TURN_START_SFX_VOLUME);
  }

  function stopAllinBgmSfx() {
    if (!allinBgmSfxEl) return;
    try {
      allinBgmSfxEl.pause();
      allinBgmSfxEl.currentTime = 0;
    } catch (e) {}
  }

  function unbindHoldemAudioUnlock() {
    if (!holdemAudioUnlockBound || typeof document === "undefined") return;
    ["pointerdown", "touchend", "click"].forEach(function (eventName) {
      document.removeEventListener(eventName, unlockHoldemAudio, true);
    });
    holdemAudioUnlockBound = false;
  }

  function finishHoldemAudioUnlock(unlocked) {
    holdemAudioUnlocked = !!unlocked;
    holdemAudioUnlocking = false;
    if (holdemAudioUnlocked) unbindHoldemAudioUnlock();
  }

  function unlockHoldemAudioFallback() {
    if (typeof Audio === "undefined") {
      finishHoldemAudioUnlock(false);
      return;
    }
    if (!holdemAudioUnlockEl) {
      holdemAudioUnlockEl = createHoldemAudio(TURN_START_SFX_SRC, TURN_START_SFX_VOLUME);
    }
    var el = holdemAudioUnlockEl;
    if (!el) {
      finishHoldemAudioUnlock(false);
      return;
    }
    try {
      el.muted = true;
      el.volume = 0;
      var played = el.play();
      var finish = function (ok) {
        try {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
          el.volume = TURN_START_SFX_VOLUME;
        } catch (_error) {}
        finishHoldemAudioUnlock(ok);
      };
      if (played && typeof played.then === "function") {
        played.then(function () { finish(true); }, function () { finish(false); });
      } else {
        finish(true);
      }
    } catch (e) {
      finishHoldemAudioUnlock(false);
    }
  }

  function unlockHoldemAudio() {
    if (!active || holdemSoundMuted()) return;
    var context = ensureHoldemAudioContext();
    if (holdemAudioUnlocked && (!context || context.state === "running")) return;
    if (holdemAudioUnlocking) return;
    holdemAudioUnlocking = true;
    preloadHoldemAudioBuffers();
    resumeHoldemAudioContext().then(function (running) {
      if (running) {
        finishHoldemAudioUnlock(true);
        return;
      }
      unlockHoldemAudioFallback();
    });
  }

  function bindHoldemAudioUnlock() {
    if (holdemAudioUnlocked || holdemAudioUnlockBound || typeof document === "undefined") return;
    holdemAudioUnlockBound = true;
    ["pointerdown", "touchend", "click"].forEach(function (eventName) {
      document.addEventListener(eventName, unlockHoldemAudio, true);
    });
  }

  function scheduleActionSfx(kind, delayMs) {
    var timer = setTimeout(function () {
      var index = actionSoundTimers.indexOf(timer);
      if (index >= 0) actionSoundTimers.splice(index, 1);
      playActionSfx(kind);
    }, Math.max(0, integer(delayMs, 0)));
    actionSoundTimers.push(timer);
  }

  function scheduleAllinBgmSfx(delayMs) {
    var timer = setTimeout(function () {
      var index = actionSoundTimers.indexOf(timer);
      if (index >= 0) actionSoundTimers.splice(index, 1);
      playAllinBgmSfx();
    }, Math.max(0, integer(delayMs, 0)));
    actionSoundTimers.push(timer);
  }

  function clearCommunityCardOpenSoundTimers() {
    for (var i = 0; i < communityCardOpenSoundTimers.length; i++) {
      clearTimeout(communityCardOpenSoundTimers[i]);
    }
    communityCardOpenSoundTimers = [];
  }

  function clearActionSoundTimers() {
    for (var i = 0; i < actionSoundTimers.length; i++) {
      clearTimeout(actionSoundTimers[i]);
    }
    actionSoundTimers = [];
  }

  function scheduleCommunityCardOpenSfx(card, index, delayMs) {
    var key = communityCardKey(card);
    if (!key) return;
    var soundKey = String(index) + ":" + key;
    boardRevealState.soundKeys = Array.isArray(boardRevealState.soundKeys)
      ? boardRevealState.soundKeys
      : [];
    if (boardRevealState.soundKeys.indexOf(soundKey) >= 0) return;
    boardRevealState.soundKeys.push(soundKey);
    var openCueMs = index === 4 ? COMMUNITY_RIVER_OPEN_CUE_MS : 0;
    var timer = setTimeout(function () {
      var timerIndex = communityCardOpenSoundTimers.indexOf(timer);
      if (timerIndex >= 0) communityCardOpenSoundTimers.splice(timerIndex, 1);
      playCommunityCardOpenSfx();
    }, Math.max(0, integer(delayMs, 0) + openCueMs));
    communityCardOpenSoundTimers.push(timer);
  }

  function syncAudio() {
    if (holdemSoundMuted()) return;
    ensureHoldemAudioContext();
    preloadHoldemAudioBuffers();
  }

  function boardRevealKey(snapshot) {
    if (!snapshot) return "";
    return String(snapshot.handId || snapshot.handNumber || (snapshot.board && snapshot.board.length ? snapshot.version : snapshot.phase) || "");
  }

  function syncBoardRevealKey() {
    var key = boardRevealKey(state);
    if (boardRevealState.key === key) return;
    clearCommunityCardOpenSoundTimers();
    boardRevealState = { key: key, cards: [], revealAt: [], delayMs: [], soundKeys: [] };
    lastBoardHtml = "";
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
      leaving: !!firstDefined(entry.leaving, entry.leaveAfterHand, entry.pendingLeave, status === "leaving"),
      leavingIntent: text(firstDefined(entry.leavingIntent, entry.leaveIntent, entry.pendingIntent), 24),
      sittingOut: !!firstDefined(entry.sittingOut, entry.spectator, status === "sitting_out"),
      inHand: bool(firstDefined(entry.inHand, entry.playing), status !== "out"),
      cardCount: clamp(integer(firstDefined(entry.cardCount, entry.holeCardCount, entry.hasCards ? 2 : 0), 0), 0, 2),
      status: status,
      handName: text(firstDefined(entry.handName, entry.handLabel), 80),
      winner: !!firstDefined(entry.winner, entry.isWinner, false),
      winAmount: nonnegative(firstDefined(entry.winAmount, entry.wonAmount, entry.payout), 0)
    };
  }

  function normalizeBotPersonality(value) {
    value = text(value, 32).toLowerCase().replace(/-/g, "_");
    return Object.prototype.hasOwnProperty.call(BOT_PERSONALITY_LABELS, value) ? value : "";
  }

  function normalizeJoinRequests(value) {
    if (!Array.isArray(value)) return [];
    var now = Date.now();
    var seen = Object.create(null);
    return value.map(function (entry) {
      entry = isObject(entry) ? entry : {};
      var nick = text(firstDefined(entry.nick, entry.requester, entry.player), 40);
      var targetNick = text(firstDefined(entry.targetNick, entry.target, entry.ownerNick), 40);
      var requestedAt = toTimestamp(firstDefined(entry.requestedAt, entry.at));
      var expiresAt = toTimestamp(firstDefined(entry.expiresAt, entry.until));
      var key = nick + "\n" + targetNick;
      if (!nick || !targetNick || seen[key] || (expiresAt && expiresAt <= now)) return null;
      seen[key] = true;
      return {
        nick: nick,
        targetNick: targetNick,
        requestedAt: requestedAt,
        expiresAt: expiresAt
      };
    }).filter(Boolean);
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

  function hasAllInSidePot(table) {
    var seatSource = Array.isArray(table.seats) ? table.seats :
      Array.isArray(table.players) ? table.players : [];
    var highestCommitted = 0;
    var allInCaps = [];
    seatSource.forEach(function (entry) {
      if (!isObject(entry)) return;
      var status = text(firstDefined(entry.status, entry.state), 32).toLowerCase();
      var folded = !!firstDefined(entry.folded, status === "folded" || status === "fold");
      var inHand = bool(firstDefined(entry.inHand, entry.playing), status !== "out");
      var committed = nonnegative(firstDefined(entry.totalBet, entry.committed), 0);
      if (!inHand || folded || committed <= 0) return;
      highestCommitted = Math.max(highestCommitted, committed);
      var stack = nonnegative(firstDefined(entry.stack, entry.chips, entry.balance), 0);
      var allIn = !!firstDefined(entry.allIn, entry.allin, status === "allin" || status === "all_in" || stack === 0);
      if (allIn) allInCaps.push(committed);
    });
    return allInCaps.some(function (cap) { return highestCommitted > cap; });
  }

  function normalizePots(table) {
    var main = nonnegative(firstDefined(
      table.totalPot,
      isObject(table.pot) ? table.pot.amount : table.pot,
      table.potAmount
    ), NaN);
    var explicitSideSource = Array.isArray(table.sidePots) ? table.sidePots : null;
    var source = Array.isArray(table.pots) ? table.pots :
      explicitSideSource ? explicitSideSource : [];
    var amounts = source.map(function (pot) {
      return nonnegative(isObject(pot) ? firstDefined(pot.amount, pot.chips, pot.value) : pot, 0);
    }).filter(function (amount) { return amount > 0; });
    if (!Number.isFinite(main)) {
      main = amounts.reduce(function (sum, amount) { return sum + amount; }, 0);
    }
    var sides = explicitSideSource
      ? explicitSideSource.map(function (pot) {
          return nonnegative(isObject(pot) ? firstDefined(pot.amount, pot.chips, pot.value) : pot, 0);
        }).filter(function (amount) { return amount > 0; })
      : amounts.length > 1 && hasAllInSidePot(table) ? amounts.slice(1) : [];
    return { total: Math.max(0, main), sides: sides };
  }

  function winnerNicks(table, seats) {
    var found = [];

    function addNick(value) {
      var nick = text(value, 40);
      if (nick && found.indexOf(nick) < 0) found.push(nick);
    }

    function addWinner(entry) {
      if (Array.isArray(entry)) {
        entry.forEach(addWinner);
        return;
      }
      if (isObject(entry)) {
        var entryNick = firstDefined(entry.nick, entry.nickname, entry.name);
        if (entryNick != null) {
          addNick(entryNick);
          return;
        }
        entry = firstDefined(entry.seat, entry.index, entry.position);
      }
      if (typeof entry === "number") {
        var seatIndex = safeSeat(entry);
        if (seatIndex >= 0 && seats && seats[seatIndex]) addNick(seats[seatIndex].nick);
        return;
      }
      addNick(entry);
    }

    addWinner(firstDefined(table.winners, table.winnerNicks, table.winner));
    if (!found.length && Array.isArray(table.pots)) {
      table.pots.forEach(function (pot) {
        if (isObject(pot)) addWinner(firstDefined(pot.winners, pot.winnerSeats, pot.winner));
      });
    }
    if (!found.length) {
      var lastEvent = firstObject(table.lastEvent, table.event);
      addWinner(firstDefined(lastEvent.nick, lastEvent.winners, lastEvent.winner));
    }
    if (!found.length && Array.isArray(seats)) {
      seats.forEach(function (seat) {
        if (seat && (seat.winner || seat.winAmount > 0)) addNick(seat.nick);
      });
    }
    return found;
  }

  function normalizeActionHistory(value) {
    if (!Array.isArray(value)) return [];
    return value.map(function (entry) {
      entry = isObject(entry) ? entry : {};
      return {
        seq: Math.max(0, integer(entry.seq, 0)),
        handNo: Math.max(0, integer(entry.handNo, 0)),
        phase: text(entry.phase, 16),
        seat: safeSeat(entry.seat),
        nick: text(entry.nick, 40),
        displayName: text(firstDefined(entry.displayName, entry.nick), 40),
        isBot: entry.isBot === true,
        action: canonicalSeatAction(firstDefined(entry.action, entry.move, entry.type)),
        amount: nonnegative(entry.amount, 0),
        potBefore: nonnegative(entry.potBefore, 0),
        potAfter: nonnegative(entry.potAfter, 0),
        at: toTimestamp(entry.at)
      };
    }).filter(function (entry) {
      return entry.seat >= 0 && entry.action;
    }).slice(-12);
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
    var assetBacked = mode === "ring" &&
      !!firstDefined(settings.assetBacked, table.assetBacked, raw.assetBacked, false);

    var normalized = {
      version: Math.max(0, integer(firstDefined(versionHint, raw.version, table.version, table.rev), 0)),
      phase: phase,
      status: text(firstDefined(table.status, raw.status, phase), 32),
      handId: text(firstDefined(table.handId, table.handKey, table.handNumber, table.handNo, raw.handId), 80),
      handNumber: Math.max(0, integer(firstDefined(table.handNumber, table.handNo, table.hand), 0)),
      mode: mode,
      tournamentSpeed: tournamentSpeed,
      chipUnit: Math.max(100, Math.round(integer(firstDefined(
        settings.chipUnit,
        actionInfo.step,
        actionInfo.raiseStep,
        100
      ), 100) / 100) * 100),
      startingStack: nonnegative(firstDefined(
        settings.startingStack,
        table.startingStack,
        raw.startingStack,
        20000
      ), 20000),
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
      lastRake: nonnegative(firstDefined(table.lastRake, raw.lastRake), 0),
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
      raiseStep: Math.max(100, Math.round(integer(firstDefined(
        actionInfo.step,
        actionInfo.raiseStep,
        settings.chipUnit,
        table.bigBlind,
        table.blinds && table.blinds.big,
        100
      ), 100) / 100) * 100),
      heroReady: !!(hero && hero.ready),
      canReady: bool(canReadyValue, phase === "waiting" && !!hero),
      canStart: bool(canStartValue, false),
      canNext: bool(canNextValue, false),
      newGameBuyInRequired: bool(firstDefined(
        table.newGameBuyInRequired,
        raw.newGameBuyInRequired
      ), false),
      canManageBots: bool(canManageBotsValue, false),
      pendingJoinRequests: normalizeJoinRequests(firstDefined(
        table.pendingJoinRequests,
        raw.pendingJoinRequests,
        viewer.pendingJoinRequests
      )),
      assetBacked: assetBacked,
      practiceMode: mode === "ring" && botCount > 0 && !assetBacked,
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
      buyInMin: nonnegative(firstDefined(
        table.buyInMin,
        raw.buyInMin,
        settings.buyInMin,
        table.bigBlind ? table.bigBlind * 10 : null,
        10000
      ), 10000),
      buyInMax: nonnegative(firstDefined(
        table.buyInMax,
        raw.buyInMax,
        settings.buyInMax,
        settings.startingStack,
        table.startingStack,
        20000
      ), 20000),
      buyInDefault: nonnegative(firstDefined(
        table.buyInDefault,
        raw.buyInDefault,
        settings.buyInDefault,
        settings.startingStack,
        table.startingStack,
        20000
      ), 20000),
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
      actionHistory: normalizeActionHistory(firstDefined(table.actionHistory, raw.actionHistory, viewer.actionHistory)),
      ownerNick: text(firstDefined(table.ownerNick, table.owner, raw.ownerNick), 40),
      winners: winnerNicks(table, seats),
      showdown: showdownRows,
      handName: text(firstDefined(viewer.handName, viewer.bestHandName, raw.handName), 80),
      message: text(firstDefined(raw.message, table.message, table.announcement, table.resultText), 160)
    };

    if (!normalized.handNumber && /^\d+$/.test(normalized.handId)) {
      normalized.handNumber = Number(normalized.handId);
    }
    normalized.buyInMax = Math.max(normalized.chipUnit, Math.round(normalized.buyInMax / normalized.chipUnit) * normalized.chipUnit);
    normalized.buyInMin = Math.max(normalized.chipUnit, Math.round(normalized.buyInMin / normalized.chipUnit) * normalized.chipUnit);
    if (normalized.buyInMin > normalized.buyInMax) normalized.buyInMin = normalized.buyInMax;
    normalized.buyInDefault = Math.max(normalized.buyInMin, Math.min(
      normalized.buyInMax,
      Math.round(normalized.buyInDefault / normalized.chipUnit) * normalized.chipUnit
    ));
    return normalized;
  }

  function applySnapshot(snapshot, versionHint, responseOrder) {
    if (!isObject(snapshot)) return false;
    var next = normalizeSnapshot(snapshot, versionHint);
    if (next.version && state.version && next.version < state.version) return false;
    if ((!next.version || next.version === state.version) &&
        responseOrder && responseOrder < lastAppliedResponse) return false;

    var confirmedPendingMove = pendingMove && next.version > pendingMove.version
      ? pendingMove
      : null;
    if (confirmedPendingMove) pendingMove = null;
    var hadSnapshot = hasSnapshot;
    var previousDeadlineKey = state.version + ":" + state.deadlineAt;
    var nextDeadlineKey = next.version + ":" + next.deadlineAt;
    var previousHandKey = String(state.handId || state.handNumber || "");
    var nextHandKey = String(next.handId || next.handNumber || "");
    syncResultFlow(state, next);
    syncActionSounds(state, next, hadSnapshot, confirmedPendingMove);
    syncTurnStartSound(state, next, hadSnapshot);
    if (previousHandKey && nextHandKey && previousHandKey !== nextHandKey) {
      actionTagAnimationKeys = Object.create(null);
      pendingActionTagAnimationKeys = Object.create(null);
    }
    suppressActionTagAnimations = !hadSnapshot;
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
    refreshProfileAvatars(next, false);
    render();
    maybeLeaveRoomAfterHand();
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

  function actionSoundKind(action) {
    action = canonicalSeatAction(action);
    if (action === "fold" || action === "check" || action === "call" || action === "bet" ||
        action === "raise" || action === "allin") return action;
    return "";
  }

  function latestActionSoundEntry(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.actionHistory) || !snapshot.actionHistory.length) return null;
    for (var i = snapshot.actionHistory.length - 1; i >= 0; i--) {
      var entry = snapshot.actionHistory[i];
      if (entry && actionSoundKind(entry.action)) return entry;
    }
    return null;
  }

  function actionSoundEntries(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.actionHistory) || !snapshot.actionHistory.length) return [];
    return snapshot.actionHistory.filter(function (entry) {
      return !!(entry && actionSoundKind(entry.action));
    });
  }

  function actionSoundEntryKey(entry, snapshot) {
    if (!entry) return "";
    return [
      entry.handNo || snapshot && snapshot.handNumber || snapshot && snapshot.handId || 0,
      entry.seq || 0,
      entry.seat,
      entry.action,
      entry.amount || 0
    ].join(":");
  }

  function actionTagEntryKey(entry, snapshot) {
    if (!entry || !snapshot) return "";
    var action = actionSoundKind(entry.action);
    var seatIndex = safeSeat(entry.seat);
    if (!action || seatIndex < 0) return "";
    var seat = Array.isArray(snapshot.seats) ? snapshot.seats[seatIndex] : null;
    var amount = seat && seat.bet > 0
      ? formatChips(seat.bet)
      : entry.amount > 0 ? formatChips(entry.amount) : "";
    return [
      snapshot.handId || snapshot.handNumber || "hand",
      entry.seq || action,
      seatIndex,
      action,
      amount || 0
    ].join(":");
  }

  function pendingMoveMatchesActionEntry(move, entry, snapshot) {
    if (!move || !entry || !snapshot) return false;
    var pendingSeat = safeSeat(move.seat);
    var confirmedSeat = safeSeat(entry.seat);
    if (pendingSeat < 0 || confirmedSeat !== pendingSeat) return false;

    var pendingAction = actionSoundKind(move.action);
    var confirmedAction = actionSoundKind(entry.action);
    var becameAllIn = confirmedAction === "allin" &&
      (pendingAction === "call" || pendingAction === "bet" || pendingAction === "raise");
    if (!pendingAction || !confirmedAction ||
        (pendingAction !== confirmedAction && !becameAllIn)) return false;

    var expectedSeq = Math.max(0, integer(move.actionSeq, 0)) + 1;
    var confirmedSeq = Math.max(0, integer(entry.seq, 0));
    if (confirmedSeq && confirmedSeq !== expectedSeq) return false;

    var pendingHand = String(move.handId || move.handNumber || "");
    var confirmedHand = String(snapshot.handId || snapshot.handNumber || "");
    if (pendingHand && confirmedHand && pendingHand !== confirmedHand) return false;

    var pendingAmount = Math.max(0, integer(move.amount, 0));
    var confirmedAmount = Math.max(0, integer(entry.amount, 0));
    if (pendingAmount && confirmedAmount && pendingAmount !== confirmedAmount) return false;
    return true;
  }

  function allinBgmKey(snapshot) {
    if (!snapshot) return "";
    return String(snapshot.handId || snapshot.handNumber || snapshot.version || "hand");
  }

  function syncActionSounds(previous, next, hadSnapshot, confirmedPendingMove) {
    var entries = actionSoundEntries(next);
    var latest = entries.length ? entries[entries.length - 1] : null;
    var latestKey = actionSoundEntryKey(latest, next);
    if (!hadSnapshot) {
      lastActionSoundKey = latestKey;
      if (latest && actionSoundKind(latest.action) === "allin") lastAllinBgmKey = allinBgmKey(next);
      lastWinnerSoundKey = resultKeyOf(next);
      return;
    }
    var firstNewIndex = -1;
    if (entries.length) {
      if (lastActionSoundKey) {
        for (var i = entries.length - 1; i >= 0; i--) {
          if (actionSoundEntryKey(entries[i], next) === lastActionSoundKey) {
            firstNewIndex = i + 1;
            break;
          }
        }
        if (firstNewIndex < 0) firstNewIndex = entries.length - 1;
      } else {
        var previousSeq = previous && previous.actionSeq ? previous.actionSeq : 0;
        firstNewIndex = 0;
        while (firstNewIndex < entries.length && integer(entries[firstNewIndex].seq, 0) <= previousSeq) {
          firstNewIndex += 1;
        }
      }
    }
    for (var entryIndex = firstNewIndex; entryIndex >= 0 && entryIndex < entries.length; entryIndex++) {
      var entry = entries[entryIndex];
      var entryKey = actionSoundEntryKey(entry, next);
      if (!entryKey || entryKey === lastActionSoundKey) continue;
      lastActionSoundKey = entryKey;
      var kind = actionSoundKind(entry.action);
      var actionTagKey = actionTagEntryKey(entry, next);
      if (actionTagKey) {
        if (pendingMoveMatchesActionEntry(confirmedPendingMove, entry, next)) {
          actionTagAnimationKeys[actionTagKey] = true;
        } else {
          pendingActionTagAnimationKeys[actionTagKey] = true;
        }
      }
      scheduleActionSfx(kind, (entryIndex - firstNewIndex) * 90);
      if (kind === "allin") {
        var bgmKey = allinBgmKey(next);
        if (bgmKey && bgmKey !== lastAllinBgmKey) {
          lastAllinBgmKey = bgmKey;
          scheduleAllinBgmSfx((entryIndex - firstNewIndex) * 90);
        }
      }
    }
    var winnerKey = resultKeyOf(next);
    if (winnerKey && winnerKey !== lastWinnerSoundKey) {
      lastWinnerSoundKey = winnerKey;
      var delay = resultFlow ? Math.max(0, resultFlow.cardsUntil - Date.now()) : 0;
      scheduleActionSfx("winner", delay);
    } else if (!winnerKey) {
      lastWinnerSoundKey = "";
    }
  }

  function turnStartSoundKey(snapshot) {
    if (!snapshot || !isHandActive(snapshot.phase)) return "";
    if (snapshot.heroSeat < 0 || snapshot.actingSeat !== snapshot.heroSeat) return "";
    return [
      snapshot.handId || snapshot.handNumber || "hand",
      snapshot.actionSeq || 0,
      snapshot.actingSeat,
      snapshot.deadlineAt
    ].join(":");
  }

  function syncTurnStartSound(previous, next, hadSnapshot) {
    var nextKey = turnStartSoundKey(next);
    if (!hadSnapshot) {
      lastTurnSoundKey = nextKey;
      return;
    }
    if (!nextKey) {
      lastTurnSoundKey = "";
      return;
    }
    var previousKey = turnStartSoundKey(previous);
    if (nextKey === previousKey || nextKey === lastTurnSoundKey) return;
    lastTurnSoundKey = nextKey;
    playTurnStartSfx();
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

  function hasSeatAction(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.seats)) return false;
    for (var i = 0; i < snapshot.seats.length; i++) {
      if (snapshot.seats[i] && seatActionLabel(snapshot.seats[i])) return true;
    }
    return false;
  }

  function syncResultFlow(previous, next) {
    var key = resultKeyOf(next);
    if (!key) {
      resultFlow = null;
      resetPayoutParticleStream();
      return;
    }
    if (resultFlow && resultFlow.key === key) return;
    resetPayoutParticleStream();
    var now = Date.now();
    var fromStacks = [];
    var toStacks = [];
    var nextBoardCount = Array.isArray(next.board) ? clamp(next.board.length, 0, 5) : 0;
    var previousBoardCount = previous && Array.isArray(previous.board) ? clamp(previous.board.length, 0, 5) : 0;
    var initialBoardCount = Math.min(nextBoardCount, Math.max(previousBoardCount, Math.min(3, nextBoardCount)));
    var hiddenCommunityCards = Math.max(0, nextBoardCount - initialBoardCount);
    var riverRevealHoldMs = nextBoardCount === 5 && initialBoardCount < 5
      ? Math.max(0, COMMUNITY_RIVER_FLIP_MS - RESULT_BOARD_REVEAL_STEP_MS)
      : 0;
    var cardsFirstMs = RESULT_CARDS_FIRST_MS +
      (RESULT_BOARD_REVEAL_STEP_MS * hiddenCommunityCards) + riverRevealHoldMs;
    var finalActionMs = previous && isHandActive(previous.phase) && hasSeatAction(next)
      ? RESULT_FINAL_ACTION_MS
      : 0;
    var settleEnd = now + finalActionMs + cardsFirstMs + RESULT_SETTLE_MS;
    for (var i = 0; i < MAX_SEATS; i++) {
      fromStacks[i] = previous && previous.seats[i] ? previous.seats[i].stack : null;
      toStacks[i] = next.seats[i] ? next.seats[i].stack : null;
    }
    resultFlow = {
      key: key,
      startedAt: now,
      actionUntil: now + finalActionMs,
      revealStart: now + finalActionMs,
      initialBoardCount: initialBoardCount,
      hiddenCommunityCards: hiddenCommunityCards,
      cardsUntil: now + finalActionMs + cardsFirstMs,
      settleStart: now + finalActionMs + cardsFirstMs,
      settleEnd: settleEnd,
      reviewUntil: settleEnd + RESULT_REVIEW_MS,
      settlementReleased: false,
      transitionsReleased: false,
      potFrom: Math.max(nonnegative(previous && previous.pot, 0), nonnegative(next && next.pot, 0)),
      fromStacks: fromStacks,
      toStacks: toStacks,
      winnerSeats: winnerSeatMap(next)
    };
  }

  function resultStage() {
    if (state.phase !== "complete") return "none";
    if (!resultFlow) return "announced";
    if (Date.now() < resultFlow.actionUntil) return "action";
    return Date.now() < resultFlow.cardsUntil ? "cards" : "announced";
  }

  function resultTransitionDelayMs() {
    if (state.phase !== "complete" || !resultFlow) return 0;
    return Math.max(0, nonnegative(resultFlow.reviewUntil, resultFlow.settleEnd) - Date.now());
  }

  function resultTransitionReady() {
    return resultTransitionDelayMs() <= 0;
  }

  function resultSettlementDelayMs() {
    if (state.phase !== "complete" || !resultFlow) return 0;
    return Math.max(0, nonnegative(resultFlow.settleEnd, 0) - Date.now());
  }

  function resultSettlementReady() {
    return resultSettlementDelayMs() <= 0;
  }

  function resultBoardVisibleCount() {
    var count = Array.isArray(state.board) ? clamp(state.board.length, 0, 5) : 0;
    if (state.phase !== "complete" || !resultFlow) return count;
    var visible = clamp(resultFlow.initialBoardCount, 0, count);
    var elapsed = Math.max(0, Date.now() - resultFlow.revealStart);
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
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) return to - from;
    var seat = state.seats[seatIndex];
    return nonnegative(seat && seat.winAmount, 0);
  }

  function removePayoutParticleLayer() {
    if (payoutParticleCleanupTimer) {
      clearTimeout(payoutParticleCleanupTimer);
      payoutParticleCleanupTimer = null;
    }
    var stage = $("holdem-stage");
    if (stage && typeof stage.querySelector === "function") {
      var layer = stage.querySelector(".holdem-payout-particles");
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    }
    var screen = root();
    if (!screen || typeof screen.querySelectorAll !== "function") return;
    var receiving = screen.querySelectorAll(".holdem-seat.is-payout-receiving");
    for (var i = 0; i < receiving.length; i++) {
      receiving[i].classList.remove("is-payout-receiving");
    }
  }

  function resetPayoutParticleStream() {
    payoutParticleStreamKey = "";
    removePayoutParticleLayer();
  }

  function payoutParticleKey() {
    if (state.phase !== "complete" || !resultFlow || !state.winners.length) return "";
    return [
      resultFlow.key,
      resultFlow.potFrom,
      state.winners.join("|")
    ].join(":");
  }

  function centerInStage(node, stageRect) {
    if (!node || typeof node.getBoundingClientRect !== "function") return null;
    var rect = node.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - stageRect.left,
      y: rect.top + rect.height / 2 - stageRect.top
    };
  }

  function startPayoutParticleStream(key) {
    if (typeof document === "undefined") return false;
    var stage = $("holdem-stage");
    var pot = $("holdem-pot");
    if (!stage || !pot || typeof stage.getBoundingClientRect !== "function") return false;
    var stageRect = stage.getBoundingClientRect();
    var start = centerInStage(pot, stageRect);
    if (!start) return false;
    var targets = [];
    for (var seatIndex = 0; seatIndex < MAX_SEATS; seatIndex++) {
      if (!resultFlow.winnerSeats[seatIndex]) continue;
      var seatNode = root() && root().querySelector('.holdem-seat[data-seat="' + seatIndex + '"]');
      if (!seatNode) continue;
      var avatar = seatNode.querySelector(".holdem-seat-avatar") || seatNode;
      var end = centerInStage(avatar, stageRect);
      if (!end) continue;
      targets.push({ node: seatNode, end: end });
    }
    if (!targets.length) return false;
    removePayoutParticleLayer();
    var layer = document.createElement("div");
    layer.className = "holdem-payout-particles";
    layer.setAttribute("aria-hidden", "true");
    layer.dataset.payoutKey = key;
    stage.appendChild(layer);

    var particlesPerWinner = targets.length > 1 ? 9 : 14;
    var longestMs = 0;
    targets.forEach(function (target, targetIndex) {
      target.node.classList.add("is-payout-receiving");
      for (var i = 0; i < particlesPerWinner; i++) {
        var particle = document.createElement("span");
        particle.className = "holdem-payout-particle";
        var delay = targetIndex * 90 + i * 34 + Math.round(Math.random() * 44);
        var duration = 720 + Math.round(Math.random() * 280);
        var side = i % 2 ? 1 : -1;
        var drift = (i - (particlesPerWinner - 1) / 2) * 8;
        var midRatio = .42 + Math.random() * .22;
        var midX = start.x + (target.end.x - start.x) * midRatio + side * (22 + Math.random() * 34);
        var midY = start.y + (target.end.y - start.y) * midRatio - (30 + Math.random() * 58) + drift;
        var sizeSteps = [4.5, 5.8, 7.2, 9.4, 12.2];
        var size = sizeSteps[i % sizeSteps.length] + Math.random() * 1.15;
        particle.style.setProperty("--payout-start-x", start.x.toFixed(1) + "px");
        particle.style.setProperty("--payout-start-y", start.y.toFixed(1) + "px");
        particle.style.setProperty("--payout-mid-x", midX.toFixed(1) + "px");
        particle.style.setProperty("--payout-mid-y", midY.toFixed(1) + "px");
        particle.style.setProperty("--payout-end-x", target.end.x.toFixed(1) + "px");
        particle.style.setProperty("--payout-end-y", target.end.y.toFixed(1) + "px");
        particle.style.setProperty("--payout-size", size.toFixed(1) + "px");
        particle.style.setProperty("--payout-delay", delay + "ms");
        particle.style.setProperty("--payout-duration", duration + "ms");
        layer.appendChild(particle);
        longestMs = Math.max(longestMs, delay + duration);
      }
    });
    payoutParticleCleanupTimer = setTimeout(removePayoutParticleLayer, longestMs + 420);
    return true;
  }

  function maybeStartPayoutParticleStream() {
    if (state.phase !== "complete" || !resultFlow || resultFlow.potFrom <= 0) return;
    var now = Date.now();
    if (now < resultFlow.settleStart || now > resultFlow.settleEnd + 180) return;
    var key = payoutParticleKey();
    if (!key || key === payoutParticleStreamKey) return;
    if (startPayoutParticleStream(key)) payoutParticleStreamKey = key;
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
        tournamentSpeed: demoGame === "holdem_turbo" ? "turbo" : "normal",
        chipUnit: 100,
        startingStack: 20000,
        smallBlind: 100,
        bigBlind: 200,
        refillAmount: 20000,
        dailyRefillLimit: demoGame === "holdem_ring" ? 3 : 0
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
      chip_unit: "베팅 금액은 100원 단위로 선택해 주세요.",
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
      refill_required: "자동 충전 또는 재참가 후 다음 핸드에 참여할 수 있어요.",
      ring_only: "링게임에서만 충전할 수 있어요.",
      refill_not_needed: "보유한 테이블 금액이 남아 있어요.",
      refill_limit: "오늘 사용할 수 있는 충전 3회를 모두 사용했어요.",
      wallet_insufficient: "홀덤 자산이 이 방의 바이인보다 부족해요.",
      bots_solo_only: "AI 연습은 방에 혼자 있을 때만 사용할 수 있어요.",
      practice_ai_only: "AI 연습 중인 방에는 다른 사람이 함께할 수 없어요.",
      request_unavailable: "지금은 같이 플레이 요청을 보낼 수 없어요.",
      already_requested: "이미 같이 플레이 요청을 보냈어요.",
      request_missing: "요청이 만료됐어요. 다시 요청해 주세요.",
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

  function scheduleRefresh(reason, force, delayMs) {
    if (!active) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refreshSnapshot(reason || "refresh", !!force);
    }, delayMs == null ? REFRESH_DEBOUNCE_MS : clamp(integer(delayMs, 0), 0, 1000));
  }

  function joinTable(preferredSeat, buyInAmount) {
    var payload = {};
    var seat = safeSeat(preferredSeat);
    if (seat >= 0) payload.seat = seat;
    if (Number.isFinite(Number(buyInAmount)) && Number(buyInAmount) > 0) {
      payload.buyIn = Math.max(0, Math.round(Number(buyInAmount)));
    }
    return invoke("join", payload, {
      key: "join",
      label: "join",
      broadcast: true
    }).then(function (result) {
      if (result && result.stale) return result;
      if (result && result.ok) {
        autoSeatKey = "";
        autoSeatSuppressed = false;
      }
      return refreshSnapshot(result && result.ok ? "joined" : "join_retry", true).then(function (refreshResult) {
        if (result && result.ok) autoReadyAfterSeatJoin();
        return refreshResult;
      });
    });
  }

  function leaveTableForSpectate() {
    if (state.heroSeat < 0 || requests.seat_role) return Promise.resolve({ ok: false, reason: "not_joined" });
    autoSeatSuppressed = true;
    autoSeatKey = "";
    return invoke("leave", {
      expectedVersion: state.version,
      leaveIntent: "spectate"
    }, {
      key: "seat_role",
      label: "spectate",
      broadcast: true
    }).then(function (result) {
      if (result && result.stale) return result;
      return refreshSnapshot(result && result.ok ? "spectating" : "spectate_retry", true);
    });
  }

  function requestLeaveAfterHand() {
    if (state.heroSeat < 0 || requests.leave_after_hand) return Promise.resolve({ ok: false, reason: "not_joined" });
    var hero = state.seats[state.heroSeat];
    if (!hero || !isHandActive(state.phase) || !hero.inHand) {
      if (api && typeof api.leaveRoom === "function") api.leaveRoom();
      return Promise.resolve({ ok: true, reason: "leave_now" });
    }
    leaveAfterHandRequested = true;
    if (hero.leaving) {
      if (api && typeof api.toast === "function") {
        api.toast("나가기 예약 중이에요. 현재 핸드가 끝나면 나갑니다.", 2400);
      }
      return Promise.resolve({ ok: true, reason: "already_leaving" });
    }
    return invoke("leave", {
      expectedVersion: state.version,
      leaveIntent: "leave"
    }, {
      key: "leave_after_hand",
      label: "leave_after_hand",
      broadcast: true
    }).then(function (result) {
      if (result && result.stale) return result;
      if (result && result.ok && api && typeof api.toast === "function") {
        api.toast("나가기 예약됐어요. 현재 핸드가 끝나면 나갑니다.", 2600);
      }
      return refreshSnapshot(result && result.ok ? "leave_reserved" : "leave_retry", true);
    });
  }

  function maybeLeaveRoomAfterHand() {
    if (!leaveAfterHandRequested || !active || !api || typeof api.leaveRoom !== "function") return;
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    if (hero && hero.leaving && isHandActive(state.phase)) return;
    if (isBusy()) return;
    leaveAfterHandRequested = false;
    setTimeout(function () {
      if (active && api && typeof api.leaveRoom === "function") api.leaveRoom();
    }, 0);
  }

  function humanSeatCount() {
    return state.seats.filter(function (seat) { return seat && !seat.isBot; }).length;
  }

  function occupiedSeatCount() {
    return state.seats.filter(Boolean).length;
  }

  function firstEmptySeat() {
    for (var i = 0; i < state.seats.length; i++) {
      if (!state.seats[i]) return i;
    }
    return -1;
  }

  function ownJoinRequest() {
    var nick = text(me().nick, 40);
    for (var i = 0; i < state.pendingJoinRequests.length; i++) {
      if (state.pendingJoinRequests[i].nick === nick) return state.pendingJoinRequests[i];
    }
    return null;
  }

  function incomingJoinRequest() {
    var nick = text(me().nick, 40);
    for (var i = 0; i < state.pendingJoinRequests.length; i++) {
      if (state.pendingJoinRequests[i].targetNick === nick) return state.pendingJoinRequests[i];
    }
    return null;
  }

  function canRequestPracticeJoin() {
    return state.practiceMode && state.heroSeat < 0 && state.botCount > 0 &&
      humanSeatCount() === 1 && occupiedSeatCount() < MAX_SEATS;
  }

  function requestPracticeJoin() {
    if (!canRequestPracticeJoin() || requests.join_request || ownJoinRequest()) return;
    invoke("join_request", {}, {
      key: "join_request",
      label: "join_request",
      broadcast: true
    });
  }

  function resolvePracticeJoin(accepted) {
    var request = incomingJoinRequest();
    if (!request || requests.resolve_join_request) return;
    invoke("resolve_join_request", {
      requester: request.nick,
      accepted: accepted === true
    }, {
      key: "resolve_join_request",
      label: accepted ? "accept_join" : "decline_join",
      broadcast: true
    });
  }

  function seatedAloneWithBotsEnabled() {
    return state.heroSeat >= 0 && state.phase === "waiting" &&
      state.canManageBots && humanSeatCount() === 1;
  }

  function pendingMoveAmount(move, amount) {
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    if (!hero) return 0;
    if (move === "call") return hero.bet + Math.min(state.toCall, hero.stack);
    if (move === "allin") return hero.bet + hero.stack;
    if ((move === "bet" || move === "raise") && Number.isFinite(Number(amount))) {
      return Math.max(0, Math.round(Number(amount)));
    }
    return 0;
  }

  function pendingMoveAnimationKey(move) {
    if (!move) return "";
    return [
      state.handId || state.handNumber || "hand",
      "pending",
      move.requestId,
      move.seat,
      move.action,
      move.amount || 0
    ].join(":");
  }

  function clearPendingMove(request, shouldRender) {
    if (!pendingMove || (request && pendingMove.requestId !== request)) return false;
    pendingMove = null;
    if (shouldRender) renderSeats();
    return true;
  }

  function performMove(move, amount) {
    move = canonicalMove(move);
    if (!state.legal[move] || requests.move) return;
    var moveRequestId = requestId("act");
    var payload = {
      move: move,
      expectedVersion: state.version,
      handId: state.handId
    };
    if ((move === "bet" || move === "raise") && Number.isFinite(Number(amount))) {
      payload.amount = Math.max(0, Math.round(Number(amount)));
    }
    pendingMove = {
      requestId: moveRequestId,
      version: state.version,
      handId: state.handId,
      handNumber: state.handNumber,
      actionSeq: state.actionSeq,
      seat: state.heroSeat,
      action: move,
      amount: pendingMoveAmount(move, amount)
    };
    var animationKey = pendingMoveAnimationKey(pendingMove);
    if (animationKey) pendingActionTagAnimationKeys[animationKey] = true;
    renderSeats();
    var promise = invoke("act", payload, {
      key: "move",
      label: move,
      broadcast: true,
      requestId: moveRequestId
    });
    return Promise.resolve(promise).then(function (result) {
      clearPendingMove(moveRequestId, true);
      return result;
    }, function (error) {
      clearPendingMove(moveRequestId, true);
      throw error;
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

  function hasBustedHumanSeat() {
    if (state.mode !== "ring") return false;
    return state.seats.some(function (seat) {
      return !!(seat && !seat.isBot && !seat.leaving && seat.stack <= 0);
    });
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
    if (!resultTransitionReady()) {
      scheduleAutoReadyForNextHand();
      return;
    }
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
    autoReadyTimer = setTimeout(
      function () { autoReadyForNextHand(key); },
      Math.max(500, resultTransitionDelayMs())
    );
  }

  function autoStartHand(key) {
    autoNextTimer = null;
    if (!active || state.phase !== "complete" || !state.canStart ||
        state.newGameBuyInRequired || hasBustedHumanSeat() || autoNextKey !== key) return;
    if (!resultTransitionReady()) {
      scheduleAutoNextHand();
      return;
    }
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
    if (state.phase !== "complete" || !state.canStart || state.newGameBuyInRequired ||
        hasBustedHumanSeat() || text(me().nick, 40) !== autoStartNick()) {
      clearAutoNextHand();
      return;
    }
    var key = String(state.handId || state.handNumber || state.version) + ":next";
    if (autoNextKey === key && autoNextTimer) return;
    clearAutoNextHand();
    autoNextKey = key;
    var delay = Math.max(AUTO_NEXT_HAND_MS, resultTransitionDelayMs());
    autoNextDueAt = Date.now() + delay;
    autoNextTimer = setTimeout(function () { autoStartHand(key); }, delay);
  }

  function autoReadyAfterSeatJoin() {
    if (state.phase !== "waiting" || state.heroSeat < 0 || state.heroReady || !state.canReady || requests.ready) return;
    invoke("ready", {
      ready: true,
      expectedVersion: state.version
    }, {
      key: "ready",
      label: "auto_ready",
      broadcast: true,
      silent: true,
      ui: false,
      requestId: requestId("seatready", String(state.version) + ":" + state.heroSeat)
    });
  }

  function setReady() {
    invoke("ready", {
      ready: !state.heroReady,
      expectedVersion: state.version
    }, { key: "ready", label: "ready", broadcast: true });
  }

  function startHand() {
    if (state.phase === "complete" && !resultSettlementReady()) return;
    if (state.newGameBuyInRequired) {
      if (text(me().nick, 40) !== state.ownerNick) {
        if (api && typeof api.toast === "function") api.toast("방장이 새 게임 참가금액을 정하고 있어요.", 2200);
        return;
      }
      openBuyInDialog("new_game", state.heroSeat);
      return;
    }
    invoke("start", {
      expectedVersion: state.version
    }, { key: "start", label: "start", broadcast: true });
  }

  function heroRingStackRestored() {
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    return !!(hero && hero.stack > 0);
  }

  function reconcileRingStackMutation(result, reason) {
    if (result && result.stale) return Promise.resolve(result);
    return refreshSnapshot(reason, true).then(function () {
      if (heroRingStackRestored()) {
        return Object.assign({}, result || {}, { ok: true, restored: true });
      }
      return result || { ok: false, reason: "restore_unconfirmed" };
    });
  }

  function refillRingChips() {
    if (!state.canRefill || requests.refill) {
      return Promise.resolve({ ok: false, reason: "unavailable" });
    }
    return invoke("refill", {
      expectedVersion: state.version
    }, {
      key: "refill",
      label: "refill",
      broadcast: true
    }).then(function (result) {
      return reconcileRingStackMutation(result, "refill_confirm");
    });
  }

  function rebuyRingChips(amount) {
    if (requests.rebuy) return Promise.resolve({ ok: false, reason: "busy" });
    return invoke("rebuy", {
      amount: Math.max(0, Math.round(Number(amount) || 0)),
      expectedVersion: state.version
    }, {
      key: "rebuy",
      label: "rebuy",
      broadcast: true
    }).then(function (result) {
      return reconcileRingStackMutation(result, "rebuy_confirm");
    });
  }

  function addBot(options) {
    options = options || {};
    if (!state.canManageBots || state.botCount >= MAX_SEATS) return;
    var payload = {
      expectedVersion: state.version
    };
    var seat = safeSeat(options.seat);
    if (seat >= 0) payload.seat = seat;
    return invoke("add_bot", payload, {
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

  function requestHumanSeatJoin(seatIndex) {
    var targetSeat = safeSeat(seatIndex);
    if (targetSeat < 0 || state.seats[targetSeat]) return false;
    if (state.mode === "ring") {
      openBuyInDialog("join", targetSeat);
      return true;
    }
    if (!requests.join) {
      joinTable(targetSeat);
      return true;
    }
    return false;
  }

  function chooseEmptySeat(seatIndex) {
    var targetSeat = safeSeat(seatIndex);
    if (targetSeat < 0 || state.seats[targetSeat] || isHandActive(state.phase)) return;
    if (seatedAloneWithBotsEnabled()) {
      if (!requests.bot_manage) addBot({ seat: targetSeat });
      return;
    }
    requestHumanSeatJoin(targetSeat);
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
      s: '<path d="M50 5C80 32 91 48 91 65C91 79 81 87 69 87C60 87 54 82 50 74C46 82 40 87 31 87C19 87 9 79 9 65C9 48 20 32 50 5Z"></path><path d="M43 69H57C57 79 62 88 72 95H28C38 88 43 79 43 69Z"></path>',
      h: '<path d="M50 89C18 60 8 45 8 28C8 15 18 7 31 7C40 7 47 13 50 21C53 13 60 7 69 7C82 7 92 15 92 28C92 45 82 60 50 89Z"></path>',
      d: '<path d="M50 4L93 50L50 96L7 50Z"></path>',
      c: '<circle cx="50" cy="27" r="22"></circle><circle cx="29" cy="55" r="22"></circle><circle cx="71" cy="55" r="22"></circle><path d="M42 60H58C58 74 64 86 76 94H24C36 86 42 74 42 60Z"></path>'
    };
    return '<svg class="holdem-card-suit-svg" viewBox="0 0 100 100" focusable="false" aria-hidden="true">' +
      (shapes[suitKey] || "") + '</svg>';
  }

  function cardRankSvg(rank) {
    var ranks = {
      "A": { viewBox: "-0.85 37.48 79.93 73.58", d: "M51.33 98.24 L26.22 98.24 L22.73 110.06 L0.15 110.06 L27.05 38.48 L51.18 38.48 L78.08 110.06 L54.91 110.06 Z M46.75 82.76 L38.84 57.03 L31.02 82.76 Z" },
      "K": { viewBox: "6.42 37.48 77.88 73.58", d: "M7.42 38.48 L29.54 38.48 L29.54 65.53 L52.71 38.48 L82.13 38.48 L56.01 65.49 L83.3 110.06 L56.06 110.06 L40.97 80.62 L29.54 92.59 L29.54 110.06 L7.42 110.06 Z" },
      "Q": { viewBox: "3.54 36.26 78.9 82.86", d: "M70.9 99.61 C73.67 101.53 75.47 102.73 76.32 103.22 C77.59 103.94 79.3 104.77 81.45 105.71 L75.29 118.12 C72.2 116.62 69.14 114.84 66.11 112.77 C63.09 110.7 60.97 109.15 59.77 108.11 C54.88 110.22 48.76 111.28 41.41 111.28 C30.53 111.28 21.96 108.45 15.67 102.78 C8.25 96.08 4.54 86.65 4.54 74.51 C4.54 62.73 7.79 53.57 14.28 47.05 C20.78 40.52 29.85 37.26 41.5 37.26 C53.39 37.26 62.56 40.45 69.02 46.83 C75.48 53.21 78.71 62.34 78.71 74.22 C78.71 84.8 76.11 93.26 70.9 99.61 Z M53.96 88.28 C55.71 85.12 56.59 80.4 56.59 74.12 C56.59 66.89 55.25 61.74 52.56 58.64 C49.88 55.55 46.18 54 41.46 54 C37.06 54 33.5 55.58 30.76 58.74 C28.03 61.9 26.66 66.83 26.66 73.54 C26.66 81.35 27.99 86.83 30.66 89.99 C33.33 93.15 37 94.73 41.65 94.73 C43.15 94.73 44.56 94.58 45.9 94.29 C44.04 92.5 41.11 90.8 37.11 89.21 L40.58 81.25 C42.53 81.61 44.05 82.05 45.14 82.57 C46.23 83.09 48.36 84.46 51.51 86.67 C52.26 87.19 53.08 87.73 53.96 88.28 Z" },
      "J": { viewBox: "0.71 37.48 59.57 74.8", d: "M37.11 38.48 L59.28 38.48 L59.28 77.37 C59.28 85.53 58.55 91.74 57.1 96.01 C55.66 100.27 52.74 103.88 48.36 106.84 C43.99 109.8 38.38 111.28 31.54 111.28 C24.32 111.28 18.72 110.3 14.75 108.35 C10.77 106.4 7.71 103.54 5.54 99.78 C3.38 96.02 2.1 91.37 1.71 85.84 L22.85 82.96 C22.88 86.12 23.16 88.46 23.68 89.99 C24.2 91.52 25.08 92.76 26.32 93.7 C27.16 94.32 28.37 94.63 29.93 94.63 C32.41 94.63 34.22 93.71 35.38 91.87 C36.53 90.03 37.11 86.94 37.11 82.58 Z" },
      "10": { viewBox: "7.15 36.26 115.14 76.02", d: "M49.17 37.26 L49.17 110.06 L29.05 110.06 L29.05 62.35 C25.8 64.83 22.65 66.83 19.6 68.36 C16.56 69.89 12.74 71.35 8.15 72.75 L8.15 56.45 C14.93 54.26 20.18 51.64 23.93 48.58 C27.67 45.52 30.6 41.75 32.71 37.26 Z M62.8 73.97 C62.8 60.37 65.25 50.85 70.15 45.41 C75.05 39.97 82.51 37.26 92.54 37.26 C97.35 37.26 101.31 37.85 104.4 39.04 C107.49 40.23 110.02 41.77 111.97 43.68 C113.92 45.58 115.46 47.58 116.58 49.68 C117.71 51.78 118.61 54.23 119.29 57.03 C120.63 62.37 121.3 67.94 121.3 73.73 C121.3 86.72 119.1 96.22 114.71 102.25 C110.31 108.27 102.74 111.28 92 111.28 C85.98 111.28 81.11 110.32 77.4 108.4 C73.69 106.48 70.65 103.66 68.27 99.95 C66.54 97.31 65.2 93.71 64.24 89.14 C63.28 84.56 62.8 79.51 62.8 73.97 Z M82.53 74.02 C82.53 83.14 83.33 89.36 84.94 92.7 C86.56 96.04 88.89 97.71 91.95 97.71 C93.97 97.71 95.72 97 97.2 95.58 C98.68 94.17 99.77 91.93 100.47 88.87 C101.17 85.81 101.52 81.04 101.52 74.56 C101.52 65.06 100.72 58.67 99.1 55.4 C97.49 52.12 95.08 50.49 91.85 50.49 C88.57 50.49 86.19 52.16 84.72 55.49 C83.26 58.83 82.53 65.01 82.53 74.02 Z" },
      "9": { viewBox: "2.47 36.26 60.98 76.02", d: "M4.98 93.99 L24.76 91.5 C25.28 94.27 26.16 96.22 27.39 97.36 C28.63 98.5 30.14 99.07 31.93 99.07 C35.12 99.07 37.61 97.46 39.4 94.24 C40.71 91.86 41.68 86.83 42.33 79.15 C39.96 81.59 37.52 83.38 35.01 84.52 C32.5 85.66 29.61 86.23 26.32 86.23 C19.91 86.23 14.49 83.95 10.08 79.39 C5.67 74.84 3.47 69.08 3.47 62.11 C3.47 57.36 4.59 53.03 6.84 49.12 C9.08 45.21 12.17 42.26 16.11 40.26 C20.05 38.26 25 37.26 30.96 37.26 C38.12 37.26 43.86 38.48 48.19 40.94 C52.52 43.4 55.98 47.31 58.57 52.66 C61.16 58.02 62.45 65.09 62.45 73.88 C62.45 86.8 59.73 96.26 54.3 102.27 C48.86 108.28 41.32 111.28 31.69 111.28 C25.99 111.28 21.5 110.62 18.21 109.3 C14.93 107.98 12.19 106.05 10.01 103.52 C7.83 100.98 6.15 97.8 4.98 93.99 Z M41.6 62.06 C41.6 58.19 40.62 55.15 38.67 52.95 C36.72 50.76 34.34 49.66 31.54 49.66 C28.91 49.66 26.72 50.65 24.98 52.64 C23.23 54.62 22.36 57.6 22.36 61.57 C22.36 65.58 23.27 68.64 25.07 70.75 C26.88 72.87 29.13 73.93 31.84 73.93 C34.64 73.93 36.96 72.9 38.82 70.85 C40.67 68.8 41.6 65.87 41.6 62.06 Z" },
      "8": { viewBox: "3.1 36.26 60.5 76.02", d: "M16.06 71.58 C12.94 69.92 10.66 68.07 9.23 66.02 C7.28 63.22 6.3 59.99 6.3 56.35 C6.3 50.36 9.11 45.46 14.75 41.65 C19.14 38.72 24.95 37.26 32.18 37.26 C41.75 37.26 48.82 39.08 53.39 42.72 C57.97 46.37 60.25 50.96 60.25 56.49 C60.25 59.72 59.34 62.73 57.52 65.53 C56.15 67.61 54 69.63 51.07 71.58 C54.95 73.44 57.84 75.9 59.74 78.96 C61.65 82.01 62.6 85.4 62.6 89.11 C62.6 92.69 61.78 96.04 60.13 99.15 C58.49 102.25 56.47 104.65 54.08 106.35 C51.68 108.04 48.71 109.29 45.14 110.08 C41.58 110.88 37.78 111.28 33.74 111.28 C26.16 111.28 20.36 110.38 16.36 108.59 C12.35 106.8 9.31 104.17 7.23 100.68 C5.14 97.2 4.1 93.31 4.1 89.01 C4.1 84.81 5.08 81.26 7.03 78.34 C8.98 75.43 12 73.18 16.06 71.58 Z M25 57.52 C25 59.99 25.77 61.99 27.32 63.5 C28.87 65.01 30.92 65.77 33.5 65.77 C35.77 65.77 37.65 65.02 39.11 63.53 C40.58 62.03 41.31 60.09 41.31 57.71 C41.31 55.24 40.54 53.23 39.01 51.68 C37.48 50.14 35.53 49.37 33.15 49.37 C30.75 49.37 28.78 50.12 27.27 51.64 C25.76 53.15 25 55.11 25 57.52 Z M23.93 88.33 C23.93 91.49 24.89 94.07 26.81 96.07 C28.73 98.07 30.92 99.07 33.4 99.07 C35.77 99.07 37.91 98.06 39.79 96.02 C41.68 93.99 42.63 91.41 42.63 88.28 C42.63 85.12 41.67 82.54 39.77 80.52 C37.87 78.5 35.66 77.49 33.15 77.49 C30.68 77.49 28.52 78.47 26.68 80.42 C24.85 82.37 23.93 85.01 23.93 88.33 Z" },
      "7": { viewBox: "3.44 37.48 60.06 73.58", d: "M4.44 38.48 L62.5 38.48 L62.5 51.9 C57.45 56.46 53.24 61.39 49.85 66.7 C45.75 73.14 42.51 80.32 40.14 88.23 C38.25 94.38 36.98 101.66 36.33 110.06 L16.5 110.06 C18.07 98.37 20.52 88.57 23.88 80.66 C27.23 72.75 32.54 64.29 39.79 55.27 L4.44 55.27 Z" },
      "6": { viewBox: "3.2 36.26 60.98 76.02", d: "M61.67 54.59 L41.89 57.03 C41.37 54.26 40.5 52.31 39.28 51.17 C38.06 50.03 36.56 49.46 34.77 49.46 C31.54 49.46 29.04 51.09 27.25 54.35 C25.94 56.69 24.98 61.7 24.37 69.38 C26.74 66.98 29.18 65.19 31.69 64.04 C34.2 62.88 37.09 62.3 40.38 62.3 C46.76 62.3 52.16 64.58 56.57 69.14 C60.98 73.7 63.18 79.48 63.18 86.47 C63.18 91.19 62.07 95.51 59.84 99.41 C57.61 103.32 54.52 106.27 50.56 108.28 C46.61 110.28 41.65 111.28 35.69 111.28 C28.53 111.28 22.79 110.06 18.46 107.62 C14.13 105.18 10.67 101.28 8.08 95.92 C5.49 90.57 4.2 83.48 4.2 74.66 C4.2 61.74 6.92 52.27 12.35 46.26 C17.79 40.26 25.33 37.26 34.96 37.26 C40.66 37.26 45.16 37.92 48.46 39.23 C51.77 40.55 54.51 42.48 56.69 45.02 C58.87 47.56 60.53 50.75 61.67 54.59 Z M25.05 86.47 C25.05 90.35 26.03 93.38 27.98 95.58 C29.93 97.78 32.32 98.88 35.16 98.88 C37.76 98.88 39.94 97.88 41.7 95.9 C43.46 93.91 44.34 90.95 44.34 87.01 C44.34 82.98 43.42 79.9 41.6 77.78 C39.78 75.67 37.52 74.61 34.81 74.61 C32.05 74.61 29.73 75.63 27.86 77.69 C25.98 79.74 25.05 82.67 25.05 86.47 Z" },
      "5": { viewBox: "2.27 37.48 61.52 74.8", d: "M12.16 38.48 L59.38 38.48 L59.38 54.35 L27.39 54.35 L25.68 65.09 C27.9 64.05 30.09 63.26 32.25 62.74 C34.42 62.22 36.56 61.96 38.67 61.96 C45.83 61.96 51.64 64.13 56.1 68.46 C60.56 72.79 62.79 78.24 62.79 84.81 C62.79 89.44 61.65 93.88 59.35 98.14 C57.06 102.41 53.8 105.66 49.58 107.91 C45.37 110.16 39.97 111.28 33.4 111.28 C28.68 111.28 24.63 110.83 21.26 109.94 C17.9 109.04 15.03 107.71 12.67 105.93 C10.31 104.16 8.4 102.15 6.93 99.9 C5.47 97.66 4.25 94.86 3.27 91.5 L23.39 89.31 C23.88 92.53 25.02 94.98 26.81 96.66 C28.6 98.33 30.73 99.17 33.2 99.17 C35.97 99.17 38.26 98.12 40.06 96.02 C41.87 93.92 42.77 90.79 42.77 86.62 C42.77 82.36 41.86 79.23 40.04 77.25 C38.22 75.26 35.79 74.27 32.76 74.27 C30.84 74.27 28.99 74.74 27.2 75.68 C25.86 76.37 24.4 77.6 22.8 79.39 L5.86 76.95 Z" },
      "4": { viewBox: "1.05 36.26 64.55 74.8", d: "M38.28 96.68 L2.05 96.68 L2.05 80.32 L38.28 37.26 L55.62 37.26 L55.62 81.25 L64.6 81.25 L64.6 96.68 L55.62 96.68 L55.62 110.06 L38.28 110.06 Z M38.28 81.25 L38.28 58.72 L19.14 81.25 Z" },
      "3": { viewBox: "2.52 36.26 61.13 76.02", d: "M23.39 59.18 L4.59 55.81 C6.15 49.82 9.16 45.23 13.6 42.04 C18.04 38.85 24.33 37.26 32.47 37.26 C41.81 37.26 48.57 39 52.73 42.48 C56.9 45.96 58.98 50.34 58.98 55.62 C58.98 58.71 58.14 61.51 56.45 64.01 C54.75 66.52 52.2 68.72 48.78 70.61 C51.55 71.29 53.66 72.09 55.13 73 C57.5 74.46 59.35 76.39 60.67 78.78 C61.99 81.18 62.65 84.03 62.65 87.35 C62.65 91.52 61.56 95.52 59.38 99.34 C57.19 103.17 54.05 106.11 49.95 108.18 C45.85 110.25 40.46 111.28 33.79 111.28 C27.28 111.28 22.14 110.51 18.38 108.98 C14.62 107.45 11.53 105.22 9.11 102.27 C6.68 99.32 4.82 95.62 3.52 91.16 L23.39 88.53 C24.17 92.53 25.38 95.3 27.03 96.85 C28.67 98.4 30.76 99.17 33.3 99.17 C35.97 99.17 38.19 98.19 39.97 96.24 C41.74 94.29 42.63 91.68 42.63 88.43 C42.63 85.11 41.77 82.54 40.06 80.71 C38.35 78.89 36.04 77.98 33.11 77.98 C31.54 77.98 29.39 78.37 26.66 79.15 L27.69 64.94 C28.79 65.1 29.65 65.19 30.27 65.19 C32.88 65.19 35.05 64.36 36.79 62.7 C38.53 61.04 39.4 59.07 39.4 56.79 C39.4 54.61 38.75 52.86 37.45 51.56 C36.15 50.26 34.36 49.61 32.08 49.61 C29.74 49.61 27.83 50.32 26.37 51.73 C24.9 53.15 23.91 55.63 23.39 59.18 Z" },
      "2": { viewBox: "1.64 36.26 61.67 74.8", d: "M62.3 110.06 L2.64 110.06 C3.32 104.17 5.4 98.62 8.86 93.43 C12.33 88.24 18.83 82.11 28.37 75.05 C34.2 70.72 37.92 67.43 39.55 65.19 C41.18 62.94 41.99 60.81 41.99 58.79 C41.99 56.61 41.19 54.74 39.58 53.2 C37.96 51.65 35.94 50.88 33.5 50.88 C30.96 50.88 28.88 51.68 27.27 53.27 C25.66 54.87 24.58 57.68 24.02 61.72 L4.1 60.11 C4.88 54.51 6.32 50.14 8.4 47 C10.48 43.86 13.42 41.45 17.21 39.77 C21 38.09 26.25 37.26 32.96 37.26 C39.96 37.26 45.4 38.05 49.29 39.65 C53.18 41.24 56.24 43.69 58.47 47 C60.7 50.3 61.82 54 61.82 58.11 C61.82 62.47 60.54 66.63 57.98 70.61 C55.43 74.58 50.78 78.94 44.04 83.69 C40.04 86.46 37.36 88.4 36.01 89.5 C34.66 90.61 33.07 92.06 31.25 93.85 L62.3 93.85 Z" }
    };
    var rank = ranks[rank];
    return rank
      ? '<svg class="holdem-card-rank-svg" viewBox="' + rank.viewBox + '" focusable="false" aria-hidden="true"><path d="' + rank.d + '"></path></svg>'
      : "";
  }

  function cardHtml(card, kind, extraClass, extraAttrs) {
    var classSuffix = extraClass ? " " + extraClass : "";
    var attrs = extraAttrs || "";
    if (kind === "back") {
      return '<span class="holdem-card back' + classSuffix + '"' + attrs + ' role="img" aria-label="비공개 카드"></span>';
    }
    if (!card) {
      return '<span class="holdem-card empty' + classSuffix + '"' + attrs + ' aria-hidden="true"></span>';
    }
    var suits = {
      s: { mark: "♠", label: "스페이드", color: "black" },
      h: { mark: "♥", label: "하트", color: "red" },
      d: { mark: "♦", label: "다이아몬드", color: "red" },
      c: { mark: "♣", label: "클럽", color: "black" }
    };
    var suit = suits[card.suit];
    if (!suit) return cardHtml(null, "empty");
    return '<span class="holdem-card ' + suit.color + classSuffix + '" data-suit="' + card.suit +
      '" data-rank="' + esc(card.rank) +
      '"' + attrs + ' role="img" aria-label="' + esc(suit.label + " " + card.rank) + '">' +
      '<span class="holdem-card-rank rank" aria-hidden="true">' + cardRankSvg(card.rank) + '</span>' +
      '<span class="holdem-card-mark mark" aria-hidden="true">' + cardSuitSvg(card.suit) + '</span>' +
      '</span>';
  }

  function engineCardCode(card) {
    if (!card || !card.rank || !card.suit) return "";
    var rank = card.rank === "10" ? "T" : String(card.rank || "").toUpperCase();
    var suit = String(card.suit || "").toLowerCase();
    var code = rank + suit;
    return /^[2-9TJQKA][cdhs]$/.test(code) ? code : "";
  }

  function normalizeEngineCardCode(code) {
    code = String(code || "").trim();
    if (code.length !== 2) return "";
    return code.charAt(0).toUpperCase() + code.charAt(1).toLowerCase();
  }

  function engineCardRankValue(code) {
    code = normalizeEngineCardCode(code);
    var index = "23456789TJQKA".indexOf(code.charAt(0));
    return index >= 0 ? index + 2 : 0;
  }

  function relevantBestCardCodes(evaluation) {
    var relevant = Object.create(null);
    if (!evaluation || !Array.isArray(evaluation.cards)) return relevant;
    var category = Number(evaluation.category) || 0;
    if (category === 0) return relevant;
    var groupedRanks = [];
    if (category === 1 || category === 3 || category === 7) {
      groupedRanks = [evaluation.tiebreak[0]];
    } else if (category === 2 || category === 6) {
      groupedRanks = [evaluation.tiebreak[0], evaluation.tiebreak[1]];
    }
    evaluation.cards.forEach(function (rawCode) {
      var code = normalizeEngineCardCode(rawCode);
      if (!code) return;
      if (category === 0 || category === 4 || category === 5 || category === 8 ||
          groupedRanks.indexOf(engineCardRankValue(code)) >= 0) {
        relevant[code] = true;
      }
    });
    return relevant;
  }

  function heroCurrentHand() {
    if (!isHandActive(state.phase)) return null;
    if (!Array.isArray(state.heroCards) || state.heroCards.length < 2) return null;
    if (!Array.isArray(state.board) || state.board.length < 3) return null;
    var engine = window.HoldemEngine;
    if (!engine || typeof engine.evaluateSeven !== "function") return null;
    var cards = state.heroCards.concat(state.board).map(engineCardCode).filter(Boolean);
    if (cards.length < 5) return null;
    try {
      var evaluation = engine.evaluateSeven(cards);
      if (!evaluation || !evaluation.name) return null;
      var bestCards = relevantBestCardCodes(evaluation);
      var isHighCard = Number(evaluation.category) === 0;
      var holeCards = Object.create(null);
      var communityCards = Object.create(null);
      if (isHighCard) {
        state.heroCards.forEach(function (card, index) {
          if (engineCardCode(card)) holeCards[index] = true;
        });
      }
      state.board.forEach(function (card, index) {
        var code = engineCardCode(card);
        if (!isHighCard && code && bestCards[code]) communityCards[index] = true;
      });
      return { name: evaluation.name, holeCards: holeCards, communityCards: communityCards };
    } catch (error) {
      return null;
    }
  }

  function resultWinnerEvaluationForSeat(seatIndex) {
    if (state.phase !== "complete" || resultStage() !== "announced") return null;
    var seat = state.seats[seatIndex];
    if (!seat) return null;
    var winners = Object.create(null);
    state.winners.forEach(function (winner) { winners[winner] = true; });
    if (!(seat.winner || winners[seat.nick])) return null;
    if (!Array.isArray(state.board) || state.board.length < 3) return null;
    var holeCards = seatIndex === state.heroSeat && state.heroCards.length
      ? state.heroCards
      : state.revealedCards[seatIndex];
    if (!Array.isArray(holeCards) || holeCards.length < 2) return null;
    var engine = window.HoldemEngine;
    if (!engine || typeof engine.evaluateSeven !== "function") return null;
    var cards = holeCards.concat(state.board).map(engineCardCode).filter(Boolean);
    if (cards.length < 5) return null;
    try {
      var evaluation = engine.evaluateSeven(cards);
      if (!evaluation || !evaluation.name) return null;
      return {
        evaluation: evaluation,
        holeCards: holeCards,
        bestCards: relevantBestCardCodes(evaluation)
      };
    } catch (error) {
      return null;
    }
  }

  function resultWinningComboForSeat(seatIndex) {
    var winner = resultWinnerEvaluationForSeat(seatIndex);
    if (!winner) return null;
    var holeCards = Object.create(null);
    var matched = 0;
    winner.holeCards.forEach(function (card, index) {
      var code = engineCardCode(card);
      if (code && winner.bestCards[code]) {
        holeCards[index] = true;
        matched += 1;
      }
    });
    if (!matched) return null;
    return {
      name: winner.evaluation.name,
      holeCards: holeCards
    };
  }

  function resultWinningBoardCombo() {
    if (state.phase !== "complete" || resultStage() !== "announced") return null;
    var communityCards = Object.create(null);
    var matched = 0;
    for (var seatIndex = 0; seatIndex < MAX_SEATS; seatIndex++) {
      var winner = resultWinnerEvaluationForSeat(seatIndex);
      if (!winner) continue;
      state.board.forEach(function (card, index) {
        var code = engineCardCode(card);
        if (code && winner.bestCards[code]) {
          communityCards[index] = true;
          matched += 1;
        }
      });
    }
    return matched ? {
      name: "승리 조합",
      communityCards: communityCards,
      dimCommunityCards: true,
      resultCombo: true
    } : null;
  }

  function handRankCard(rank, suit) {
    return { rank: rank, suit: suit };
  }

  function handRankExample(cards) {
    return cards.map(function (card) {
      if (!card) return cardHtml(null);
      return cardHtml(handRankCard(card[0], card[1]));
    }).join("");
  }

  function handRankings() {
    var hands = [
      {
        name: "로열 스트레이트 플러시",
        desc: "같은 무늬 A, K, Q, J, 10",
        cards: [["A", "h"], ["K", "h"], ["Q", "h"], ["J", "h"], ["10", "h"]]
      },
      {
        name: "스트레이트 플러시",
        desc: "같은 무늬로 숫자가 연속된 5장",
        cards: [["9", "s"], ["8", "s"], ["7", "s"], ["6", "s"], ["5", "s"]]
      },
      {
        name: "포카드",
        desc: "같은 숫자 4장",
        cards: [["A", "h"], ["A", "d"], ["A", "c"], ["A", "s"], null]
      },
      {
        name: "풀하우스",
        desc: "같은 숫자 3장과 같은 숫자 2장",
        cards: [["K", "h"], ["K", "c"], ["K", "s"], ["8", "d"], ["8", "h"]]
      },
      {
        name: "플러시",
        desc: "같은 무늬 5장",
        cards: [["K", "c"], ["Q", "c"], ["9", "c"], ["8", "c"], ["5", "c"]]
      },
      {
        name: "스트레이트",
        desc: "무늬와 상관없이 숫자가 연속된 5장",
        cards: [["9", "h"], ["8", "s"], ["7", "d"], ["6", "c"], ["5", "d"]]
      },
      {
        name: "트리플",
        desc: "같은 숫자 3장",
        cards: [["J", "h"], ["J", "d"], ["J", "c"], null, null]
      },
      {
        name: "투 페어",
        desc: "같은 숫자 2장짜리 두 묶음",
        cards: [["Q", "h"], ["Q", "d"], ["7", "c"], ["7", "h"], null]
      },
      {
        name: "원 페어",
        desc: "같은 숫자 2장",
        cards: [["A", "c"], ["A", "s"], null, null, null]
      },
      {
        name: "하이 카드",
        desc: "아무 조합이 없을 때 가장 높은 카드",
        cards: [["K", "h"], null, null, null, null]
      }
    ];
    var html = '<div class="holdem-hand-rankings">' +
      '<div class="holdem-hand-rankings-head">' +
      '<strong>홀덤 족보</strong><span>A는 가장 낮은 1 또는 가장 높은 카드로 사용할 수 있어요.</span>' +
      '</div>' +
      '<div class="holdem-hand-rankings-body">' +
      '<div class="holdem-hand-strength" aria-hidden="true"><span>강함</span></div>' +
      '<ol class="holdem-hand-list">';
    hands.forEach(function (hand, index) {
      html += '<li class="holdem-hand-row">' +
        '<span class="holdem-hand-order">' + (index + 1) + '</span>' +
        '<div class="holdem-hand-copy"><strong>' + esc(hand.name) + '</strong><span>' + esc(hand.desc) + '</span></div>' +
        '<div class="holdem-hand-example" aria-hidden="true">' + handRankExample(hand.cards) + '</div>' +
        '</li>';
    });
    html += '</ol></div></div>';
    return {
      title: "홀덤 족보",
      html: html
    };
  }

  function relativeSeat(absolute, perspective) {
    return ((absolute - perspective) % MAX_SEATS + MAX_SEATS) % MAX_SEATS;
  }

  function avatarNameHtml(nick) {
    return '<span class="holdem-seat-avatar-name">' + esc(text(nick, 40) || "＋") + '</span>';
  }

  function profileTarget() {
    var nick = text(me().nick, 40);
    if (profileTargetSeat === -2 && nick) {
      for (var ownIndex = 0; ownIndex < state.seats.length; ownIndex++) {
        if (state.seats[ownIndex] && state.seats[ownIndex].nick === nick) return state.seats[ownIndex];
      }
      return { seat: -1, nick: nick, displayName: nick, stack: 0, isSpectatorProfile: true };
    }
    var seat = safeSeat(profileTargetSeat);
    if (seat >= 0 && state.seats[seat]) return state.seats[seat];
    for (var i = 0; i < state.seats.length; i++) {
      if (state.seats[i] && state.seats[i].nick === nick) return state.seats[i];
    }
    return null;
  }

  function profileTargetIsMe(seat) {
    return !!(seat && text(seat.nick, 40) && text(seat.nick, 40) === text(me().nick, 40));
  }

  function profileTargetAvatar(seat, isMine) {
    if (!seat) return "";
    if (seat.isBot) return botPersonalityAvatar(seat.botPersonality);
    return isMine ? readProfileAvatar(seat.nick) : readProfileAvatar(seat.nick);
  }

  function profileTargetAsset(seat, isMine) {
    if (isMine && profileWallet && Number.isFinite(Number(profileWallet.totalAssets))) {
      return Math.max(0, Math.floor(Number(profileWallet.totalAssets)));
    }
    if (!seat) return null;
    if (!seat.isBot && profileAsset && profileAssetNick === text(seat.nick, 40) &&
        Number.isFinite(Number(profileAsset.totalAssets))) {
      return Math.max(0, Math.floor(Number(profileAsset.totalAssets)));
    }
    if (!seat.isBot) return null;
    return Math.max(
      0,
      Math.floor(Number(seat.stack) || 0) + Math.floor(Number(seat.totalBet || seat.bet) || 0)
    );
  }

  function renderProfileWallet() {
    var balanceNode = $("holdem-profile-wallet-balance");
    var statusNode = $("holdem-profile-wallet-status");
    var recordButton = $("holdem-profile-asset-record-btn");
    if (!balanceNode && !statusNode && !recordButton) return;
    var target = profileTarget();
    var isMine = profileTargetIsMe(target);
    var isBot = !!(target && target.isBot);
    var totalAssets = profileTargetAsset(target, isMine);
    if (balanceNode) {
      balanceNode.textContent = (isMine && profileWalletPending) ||
          (!isMine && !isBot && profileAssetPending)
        ? "불러오는 중"
        : totalAssets == null
          ? "확인할 수 없음"
          : formatAsset(totalAssets);
    }
    if (statusNode) statusNode.textContent = "";
    if (isMine && totalAssets != null && !profileWalletPending &&
        window.HoldemAssetRecords && typeof HoldemAssetRecords.record === "function") {
      HoldemAssetRecords.record(text(me().nick, 40), totalAssets);
    }
    if (recordButton) {
      recordButton.disabled = !isMine || profileWalletPending || totalAssets == null ||
        !window.HoldemAssetRecords || typeof HoldemAssetRecords.open !== "function";
      recordButton.classList.toggle("hidden", !isMine);
    }
  }

  function loadProfileAsset(force) {
    var currentAuth = auth();
    var target = profileTarget();
    var nick = text(target && target.nick, 40);
    if (!target || target.isBot || profileTargetIsMe(target)) {
      profileAssetPending = false;
      profileAsset = null;
      profileAssetNick = "";
      renderProfileWallet();
      return Promise.resolve(null);
    }
    if (!force && (profileAssetPending || (profileAsset && profileAssetNick === nick))) {
      renderProfileWallet();
      return Promise.resolve(profileAsset);
    }
    if (!window.Db || typeof Db.getHoldemAssetRankingDetail !== "function" ||
        !currentAuth.hash || !text(currentAuth.nick || me().nick, 40) || !nick) {
      profileAssetPending = false;
      profileAsset = null;
      profileAssetNick = "";
      renderProfileWallet();
      return Promise.resolve(null);
    }
    var seq = ++profileAssetRequestSeq;
    profileAssetPending = true;
    profileAsset = null;
    profileAssetNick = nick;
    renderProfileWallet();
    return Promise.resolve(Db.getHoldemAssetRankingDetail(currentAuth, nick)).then(function (result) {
      if (seq !== profileAssetRequestSeq) return null;
      var detail = result && result.ok && result.detail && typeof result.detail === "object"
        ? result.detail
        : null;
      profileAssetPending = false;
      profileAsset = detail && Number.isFinite(Number(detail.totalAssets))
        ? { totalAssets: Math.max(0, Math.floor(Number(detail.totalAssets))) }
        : null;
      profileAssetNick = profileAsset ? nick : "";
      renderProfileWallet();
      return profileAsset;
    }, function () {
      if (seq !== profileAssetRequestSeq) return null;
      profileAssetPending = false;
      profileAsset = null;
      profileAssetNick = "";
      renderProfileWallet();
      return null;
    });
  }

  function loadProfileWallet(force) {
    var currentAuth = auth();
    var nick = text(currentAuth.nick || me().nick, 40);
    if (!force && (profileWalletPending || (profileWallet && profileWalletNick === nick))) {
      renderProfileWallet();
      return Promise.resolve(profileWallet);
    }
    if (!window.Db || typeof Db.getHoldemWallet !== "function" || !currentAuth.hash || !nick) {
      profileWallet = null;
      profileWalletNick = "";
      profileWalletPending = false;
      renderProfileWallet();
      return Promise.resolve(null);
    }
    var seq = ++profileWalletRequestSeq;
    profileWalletPending = true;
    renderProfileWallet();
    return Promise.resolve(Db.getHoldemWallet(currentAuth)).then(function (result) {
      if (seq !== profileWalletRequestSeq) return null;
      var wallet = result && result.ok && isObject(result.wallet) ? result.wallet : null;
      profileWalletPending = false;
      profileWallet = wallet && Number.isFinite(Number(wallet.balance))
        ? {
          balance: Math.max(0, Math.floor(Number(wallet.balance))),
          tableBalance: Math.max(0, Math.floor(Number(wallet.tableBalance) || 0)),
          totalAssets: Math.max(0, Math.floor(Number(wallet.totalAssets) || Number(wallet.balance)))
        }
        : null;
      profileWalletNick = profileWallet ? nick : "";
      renderProfileWallet();
      return profileWallet;
    }, function () {
      if (seq !== profileWalletRequestSeq) return null;
      profileWalletPending = false;
      profileWallet = null;
      profileWalletNick = "";
      renderProfileWallet();
      return null;
    });
  }

  function tableBuyInBounds(wallet) {
    var unit = Math.max(100, integer(state.chipUnit, 100));
    var tableMin = Math.max(unit, Math.round(nonnegative(state.buyInMin, unit) / unit) * unit);
    var tableMax = Math.max(tableMin, Math.round(nonnegative(state.buyInMax, state.startingStack || tableMin) / unit) * unit);
    var walletBalance = wallet && Number.isFinite(Number(wallet.balance))
      ? Math.max(0, Math.floor(Number(wallet.balance)))
      : tableMax;
    var max = Math.max(0, Math.min(tableMax, Math.floor(walletBalance / unit) * unit));
    var defaultAmount = Math.max(tableMin, Math.min(
      tableMax,
      Math.round(nonnegative(state.buyInDefault, tableMax) / unit) * unit
    ));
    if (max >= tableMin) defaultAmount = Math.min(defaultAmount, max);
    return {
      unit: unit,
      min: tableMin,
      max: tableMax,
      selectableMax: max,
      defaultAmount: defaultAmount,
      walletBalance: walletBalance
    };
  }

  function normalizeBuyInAmount(value) {
    var bounds = tableBuyInBounds(buyInWallet);
    var amount = Math.round(nonnegative(value, bounds.defaultAmount) / bounds.unit) * bounds.unit;
    var max = bounds.selectableMax >= bounds.min ? bounds.selectableMax : bounds.max;
    return Math.max(bounds.min, Math.min(max, amount));
  }

  function displayedBuyInBalance(bounds, newGame) {
    if (newGame || !buyInWallet) return null;
    var selected = normalizeBuyInAmount(buyInValue || bounds.defaultAmount);
    var walletBalance = Math.max(0, Math.floor(Number(buyInWallet.balance) || 0));
    return Math.max(0, walletBalance - selected);
  }

  function loadBuyInWallet() {
    var currentAuth = auth();
    if (!window.Db || typeof Db.getHoldemWallet !== "function" || !currentAuth.hash || !currentAuth.nick) {
      buyInWallet = { balance: state.buyInMax || state.startingStack || 0, tableBalance: 0, totalAssets: state.buyInMax || 0 };
      buyInWalletPending = false;
      renderBuyInDialog();
      return Promise.resolve(buyInWallet);
    }
    var seq = ++buyInWalletRequestSeq;
    buyInWalletPending = true;
    renderBuyInDialog();
    return Promise.resolve(Db.getHoldemWallet(currentAuth)).then(function (result) {
      if (seq !== buyInWalletRequestSeq) return null;
      var wallet = result && result.ok && isObject(result.wallet) ? result.wallet : null;
      buyInWalletPending = false;
      buyInWallet = wallet
        ? {
          balance: Math.max(0, Math.floor(Number(wallet.balance) || Number(wallet.availableBalance) || 0)),
          tableBalance: Math.max(0, Math.floor(Number(wallet.tableBalance) || 0)),
          totalAssets: Math.max(0, Math.floor(Number(wallet.totalAssets) || 0))
        }
        : null;
      if (buyInMode === "rebuy" && buyInWallet && buyInWallet.balance <= 0) {
        closeBuyInDialog();
        renderControls();
        return buyInWallet;
      }
      buyInValue = normalizeBuyInAmount(buyInValue);
      renderBuyInDialog();
      return buyInWallet;
    }, function () {
      if (seq !== buyInWalletRequestSeq) return null;
      buyInWalletPending = false;
      buyInWallet = null;
      renderBuyInDialog();
      return null;
    });
  }

  function openBuyInDialog(mode, seat) {
    if (state.phase === "complete" && !resultTransitionReady()) return false;
    buyInMode = mode === "rebuy" || mode === "new_game" ? mode : "join";
    buyInSeat = safeSeat(seat);
    buyInDialogOpen = true;
    buyInWallet = null;
    buyInWalletPending = false;
    buyInValue = tableBuyInBounds(null).defaultAmount;
    renderBuyInDialog();
    if (buyInMode !== "new_game") loadBuyInWallet();
    return true;
  }

  function closeBuyInDialog(options) {
    options = options || {};
    if (buyInMode === "join" && options.suppressAutoSeat) {
      autoSeatSuppressed = true;
      autoSeatKey = "";
    }
    buyInDialogOpen = false;
    buyInSeat = -1;
    buyInWalletPending = false;
    renderBuyInDialog();
  }

  function setBuyInValue(value) {
    buyInValue = normalizeBuyInAmount(value);
    renderBuyInDialog();
  }

  function confirmBuyInDialog() {
    if (!buyInDialogOpen || buyInWalletPending) {
      return Promise.resolve({ ok: false, reason: "unavailable" });
    }
    var bounds = tableBuyInBounds(buyInWallet);
    if (bounds.selectableMax < bounds.min) {
      closeBuyInDialog();
      renderControls();
      return Promise.resolve({ ok: false, reason: "wallet_insufficient" });
    }
    var amount = normalizeBuyInAmount(buyInValue);
    var action = buyInMode;
    var seat = buyInSeat;
    if (action === "rebuy") {
      buyInWalletPending = true;
      renderBuyInDialog();
      return rebuyRingChips(amount).then(function (result) {
        buyInWalletPending = false;
        autoBuyInKey = "";
        if (result && result.ok && heroRingStackRestored()) {
          closeBuyInDialog();
        } else {
          buyInDialogOpen = true;
          buyInMode = "rebuy";
          buyInSeat = seat;
          renderBuyInDialog();
        }
        return result;
      });
    }
    closeBuyInDialog();
    if (action === "new_game") {
      return invoke("start", {
        buyIn: amount,
        expectedVersion: state.version
      }, {
        key: "start",
        label: "new_game",
        broadcast: true
      });
    } else if (!requests.join) {
      return joinTable(seat, amount);
    }
    return Promise.resolve({ ok: false, reason: "busy" });
  }

  function spectateFromBuyInDialog() {
    var mode = buyInMode;
    closeBuyInDialog({ suppressAutoSeat: mode === "join" });
    if (mode === "rebuy" && state.heroSeat >= 0) leaveTableForSpectate();
  }

  function maybeAutoSeatJoin() {
    if (!active || !hasSnapshot || autoSeatSuppressed || buyInDialogOpen || requests.join) return;
    if (state.phase === "complete" && !resultTransitionReady()) return;
    if (state.phase === "loading" || state.heroSeat >= 0) {
      if (state.heroSeat >= 0) autoSeatKey = "";
      return;
    }
    var targetSeat = firstEmptySeat();
    if (targetSeat < 0) {
      autoSeatKey = "full";
      return;
    }
    var key = String(roomId()) + ":" + String(state.version) + ":" + String(targetSeat);
    if (autoSeatKey === key) return;
    autoSeatKey = key;
    requestHumanSeatJoin(targetSeat);
  }

  function renderBuyInDialog() {
    var backdrop = $("holdem-buyin-backdrop");
    if (!backdrop) return;
    var bounds = tableBuyInBounds(buyInWallet);
    var lacksAssets = !!buyInWallet && bounds.selectableMax < bounds.min;
    var newGame = buyInMode === "new_game";
    var title = newGame ? "새 게임 참가금액" :
      buyInMode === "rebuy" ? "다시 참여할 금액" : "착석 금액 선택";
    backdrop.classList.toggle("hidden", !buyInDialogOpen);
    backdrop.setAttribute("aria-hidden", buyInDialogOpen ? "false" : "true");
    setText("holdem-buyin-title", title);
    setText("holdem-buyin-range", formatChips(bounds.min) + " ~ " + formatChips(bounds.max));
    setText("holdem-buyin-balance", newGame
      ? "실제 자산 미사용"
      : buyInWalletPending
      ? "확인 중"
      : buyInWallet
        ? formatAsset(displayedBuyInBalance(bounds, newGame))
        : "확인 불가");
    setText("holdem-buyin-amount", formatChips(buyInValue || bounds.defaultAmount));
    setText("holdem-buyin-note", newGame
      ? "선택한 금액으로 모든 참가자와 AI가 동일하게 새 게임을 시작해요."
      : lacksAssets
      ? "보유 자산이 이 방의 최소 참가금보다 부족해요."
      : "선택한 금액만 테이블에 가져가고 나머지는 보유 자산에 남아요.");
    var slider = $("holdem-buyin-slider");
    if (slider) {
      slider.min = String(bounds.min);
      slider.max = String(Math.max(bounds.min, bounds.selectableMax || bounds.max));
      slider.step = String(bounds.unit);
      slider.value = String(normalizeBuyInAmount(buyInValue || bounds.defaultAmount));
      slider.disabled = buyInWalletPending || lacksAssets;
    }
    disable("holdem-buyin-confirm", buyInWalletPending || lacksAssets || (buyInMode === "join" && buyInSeat < 0));
    disable("holdem-buyin-spectate", buyInWalletPending && buyInMode === "rebuy");
    show("holdem-buyin-spectate", !newGame);
  }

  function maybeAutoOpenRebuyDialog() {
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    var needsRebuy = state.mode === "ring" && !!hero && hero.stack <= 0 && !isHandActive(state.phase);
    if (!needsRebuy || buyInDialogOpen || requests.rebuy || requests.refill) {
      if (!needsRebuy) autoBuyInKey = "";
      return;
    }
    if (!resultTransitionReady()) return;
    var resolution = state.canRefill ? "free" : "rebuy";
    var key = String(state.version) + ":" + String(state.heroSeat) + ":" +
      String(state.handId || state.handNumber) + ":" + resolution;
    if (autoBuyInKey === key) return;
    autoBuyInKey = key;
    if (state.canRefill) {
      refillRingChips().then(function (result) {
        if (!result || !result.ok) autoBuyInKey = "";
      });
      return;
    }
    openBuyInDialog("rebuy", state.heroSeat);
  }

  function releaseResultTransitions() {
    if (state.phase !== "complete" || !resultFlow || resultFlow.transitionsReleased ||
        !resultTransitionReady()) return;
    resultFlow.transitionsReleased = true;
    renderControls();
    maybeAutoSeatJoin();
    maybeAutoOpenRebuyDialog();
    scheduleAutoReadyForNextHand();
    scheduleAutoNextHand();
  }

  function releaseResultSettlement() {
    if (state.phase !== "complete" || !resultFlow || resultFlow.settlementReleased ||
        !resultSettlementReady()) return;
    resultFlow.settlementReleased = true;
    renderControls();
  }

  function renderProfileDialog() {
    var backdrop = $("holdem-profile-backdrop");
    if (!backdrop) return;
    var target = profileTarget();
    var isMine = profileTargetIsMe(target);
    var nick = text(target && (target.displayName || target.nick), 40) || text(me().nick, 40);
    var avatar = profileTargetAvatar(target, isMine);
    backdrop.classList.toggle("hidden", !profileDialogOpen);
    backdrop.setAttribute("aria-hidden", profileDialogOpen ? "false" : "true");
    setText("holdem-profile-nick", nick || "닉네임");
    setText("holdem-profile-title", isMine ? "내 프로필" : "프로필");
    var preview = $("holdem-profile-avatar-preview");
    if (preview) {
      preview.innerHTML = avatar
        ? '<img src="' + esc(avatar) + '" alt="">'
        : avatarNameHtml(nick);
    }
    var actions = root() && root().querySelector(".holdem-profile-photo-actions");
    if (actions) actions.classList.toggle("hidden", !isMine);
    var remove = $("holdem-profile-avatar-remove");
    if (remove) remove.disabled = !isMine || !avatar;
    setText(
      "holdem-profile-wallet-label",
      isMine ? "내 총자산" : target && target.isBot ? "연습칩" : "총자산"
    );
    var roleAction = $("holdem-profile-role-action");
    if (roleAction) {
      var seated = state.heroSeat >= 0;
      var canJoin = firstEmptySeat() >= 0 && !requests.join && !buyInDialogOpen;
      roleAction.classList.toggle("hidden", !isMine);
      roleAction.textContent = seated ? "관전하기" : "참석하기";
      roleAction.disabled = !isMine || pendingUiCount > 0 || (!seated && !canJoin);
    }
    renderProfileWallet();
  }

  function openProfileDialog(seat) {
    profileTargetSeat = safeSeat(seat);
    profileDialogOpen = true;
    renderProfileDialog();
    var target = profileTarget();
    if (profileTargetIsMe(target)) loadProfileWallet(true);
    else loadProfileAsset(true);
  }

  function joinFromProfileDialog() {
    if (state.heroSeat >= 0) return;
    var targetSeat = firstEmptySeat();
    if (targetSeat < 0) {
      if (api && typeof api.toast === "function") api.toast("빈 좌석이 없어요.", 2200);
      renderProfileDialog();
      return;
    }
    autoSeatSuppressed = false;
    autoSeatKey = "";
    closeProfileDialog();
    requestHumanSeatJoin(targetSeat);
  }

  function spectateFromProfileDialog() {
    if (state.heroSeat < 0) return;
    closeProfileDialog();
    leaveTableForSpectate();
  }

  function toggleProfileRole() {
    if (state.heroSeat >= 0) spectateFromProfileDialog();
    else joinFromProfileDialog();
  }

  function closeProfileDialog() {
    profileDialogOpen = false;
    profileAssetRequestSeq += 1;
    profileAssetPending = false;
    profileTargetSeat = -1;
    renderProfileDialog();
  }

  function resizeAvatarImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || "")) {
        reject(new Error("invalid_image"));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var image = new Image();
        image.onload = function () {
          var canvas = document.createElement("canvas");
          var size = PROFILE_AVATAR_SIZE;
          canvas.width = size;
          canvas.height = size;
          var context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("canvas"));
            return;
          }
          var scale = Math.max(size / image.width, size / image.height);
          var width = image.width * scale;
          var height = image.height * scale;
          context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
          var formats = ["image/webp", "image/jpeg"];
          var qualities = [0.84, 0.78, 0.72, 0.66, 0.6];
          var smallest = "";
          for (var formatIndex = 0; formatIndex < formats.length; formatIndex++) {
            for (var qualityIndex = 0; qualityIndex < qualities.length; qualityIndex++) {
              var candidate = canvas.toDataURL(formats[formatIndex], qualities[qualityIndex]);
              if (candidate.indexOf("data:" + formats[formatIndex]) !== 0) break;
              if (!smallest || candidate.length < smallest.length) smallest = candidate;
              if (candidate.length <= PROFILE_AVATAR_MAX_DATA_URL_LENGTH) {
                resolve(candidate);
                return;
              }
            }
          }
          if (smallest && smallest.length <= PROFILE_AVATAR_MAX_DATA_URL_LENGTH) {
            resolve(smallest);
            return;
          }
          reject(new Error("image_too_large"));
        };
        image.onerror = function () { reject(new Error("invalid_image")); };
        image.src = String(reader.result || "");
      };
      reader.onerror = function () { reject(new Error("read")); };
      reader.readAsDataURL(file);
    });
  }

  function updateProfileAvatarFromFile(file) {
    var nick = text(me().nick, 40);
    if (!nick) return;
    resizeAvatarImage(file).then(function (dataUrl) {
      if (!writeProfileAvatar(nick, dataUrl) && api && typeof api.toast === "function") {
        api.toast("사진을 저장할 공간이 부족해요.", 2600);
      }
      renderProfileDialog();
      renderSeats();
      persistProfileAvatar(nick, dataUrl).then(function (result) {
        if (result && result.ok) {
          refreshProfileAvatars(state, true);
        } else if (api && typeof api.toast === "function") {
          api.toast("사진을 서버에 저장하지 못했어요.", 2600);
        }
      }, function () {
        if (api && typeof api.toast === "function") api.toast("사진을 서버에 저장하지 못했어요.", 2600);
      });
    }, function () {
      if (api && typeof api.toast === "function") api.toast("이미지 파일을 다시 선택해 주세요.", 2600);
    });
  }

  function seatStatus(seat) {
    if (seat && seat.leaving) return seat.leavingIntent === "spectate" ? "관전 예약" : "나가기 예약";
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

  function latestSeatActionHistory(seat) {
    if (!seat || !Array.isArray(state.actionHistory) || !state.actionHistory.length) return null;
    var latest = state.actionHistory[state.actionHistory.length - 1];
    if (!latest || latest.seat !== seat.seat) return null;
    if (latest.seq && state.actionSeq && latest.seq !== state.actionSeq) return null;
    return latest;
  }

  function pendingMoveForSeat(seat) {
    if (!seat || !pendingMove || state.phase === "waiting") return null;
    if (pendingMove.version !== state.version || pendingMove.handId !== state.handId) return null;
    return pendingMove.seat === seat.seat ? pendingMove : null;
  }

  function seatDisplayAction(seat) {
    if (!seat) return "";
    var optimistic = pendingMoveForSeat(seat);
    if (optimistic) return optimistic.action;
    return seat.lastAction || (latestSeatActionHistory(seat) || {}).action || "";
  }

  function seatDisplayActionAmount(seat) {
    var optimistic = pendingMoveForSeat(seat);
    if (optimistic) return optimistic.amount > 0 ? formatChips(optimistic.amount) : "";
    var latest = latestSeatActionHistory(seat);
    if (seat && seat.bet > 0) return formatChips(seat.bet);
    return latest && latest.amount > 0 ? formatChips(latest.amount) : "";
  }

  function seatActionLabel(seat) {
    var action = seatDisplayAction(seat);
    if (!seat || !action || state.phase === "waiting") return "";
    var amount = seatDisplayActionAmount(seat);
    var amountSuffix = amount ? " " + amount : "";
    var labels = {
      fold: "폴드",
      check: "체크",
      call: "콜" + amountSuffix,
      bet: "베팅" + amountSuffix,
      raise: "레이즈" + amountSuffix,
      allin: "올인" + amountSuffix,
      small_blind: formatChips(seat.bet || state.smallBlind),
      big_blind: formatChips(seat.bet || state.bigBlind)
    };
    return labels[action] || "";
  }

  function seatActionAmountLabel(seat) {
    var action = seatDisplayAction(seat);
    if (!seat || (action !== "bet" && action !== "raise" && action !== "allin")) return "";
    return seatDisplayActionAmount(seat);
  }

  function seatActionHtml(seat) {
    var label = seatActionLabel(seat);
    var amount = seatActionAmountLabel(seat);
    if (!label) return "";
    if (!amount) return esc(label);
    var suffix = " " + amount;
    var main = label.slice(-suffix.length) === suffix
      ? label.slice(0, -suffix.length)
      : label;
    return '<span class="holdem-seat-action-main">' + esc(main) + '</span>' +
      '<span class="holdem-seat-action-amount">' + esc(amount) + '</span>';
  }

  function seatActionClass(seat) {
    var action = seatDisplayAction(seat);
    var className = action ? "action-" + action.replace(/_/g, "-") : "";
    if (className && pendingMoveForSeat(seat)) className += " is-pending";
    return className;
  }

  function seatActionAnimationKey(seat, absolute) {
    var optimistic = pendingMoveForSeat(seat);
    if (optimistic) return pendingMoveAnimationKey(optimistic);
    var latest = latestSeatActionHistory(seat);
    var action = latest && actionSoundKind(latest.action);
    if (!seat || !latest || !action) return "";
    return [
      state.handId || state.handNumber || "hand",
      latest.seq || action,
      absolute,
      action,
      seatDisplayActionAmount(seat) || 0
    ].join(":");
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
      urgent: remaining <= 5000,
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
      var seconds = info.active ? String(info.seconds) : "";
      timer.textContent = seconds;
      timer.setAttribute("data-seconds", seconds);
      timer.classList.toggle("urgent", info.urgent);
      timer.style.setProperty("--holdem-seat-timer-ratio", String(info.ratio));
    }
  }

  function timerWarningKey(info) {
    if (!info || !info.active || info.seconds < 1 || info.seconds > 5) return "";
    if (!isHandActive(state.phase) || state.heroSeat < 0 || state.actingSeat !== state.heroSeat) return "";
    return [
      state.handId || state.handNumber || "hand",
      state.actionSeq || 0,
      state.actingSeat,
      state.deadlineAt,
      info.seconds
    ].join(":");
  }

  function syncTimerWarning(info) {
    var key = timerWarningKey(info);
    if (!key) {
      if (!info || !info.active || info.seconds > 5 || state.actingSeat !== state.heroSeat) {
        lastTimerWarningKey = "";
      }
      return;
    }
    if (key === lastTimerWarningKey) return;
    lastTimerWarningKey = key;
    playTimerWarningSfx();
  }

  function renderSettings() {
    show("holdem-settings-panel", settingsOpen);
    var settingsButton = $("holdem-settings-btn");
    if (settingsButton) settingsButton.setAttribute("aria-expanded", settingsOpen ? "true" : "false");
    var unitToggle = $("holdem-unit-toggle");
    var isBb = moneyUnitMode === "bb";
    setText("holdem-unit-label", isBb ? "BB \uB2E8\uC704" : "\uC6D0 \uB2E8\uC704");
    if (unitToggle) {
      unitToggle.setAttribute("aria-pressed", isBb ? "true" : "false");
      unitToggle.textContent = isBb ? "\uC6D0" : "BB";
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
    var stage = resultStage();
    var revealWinner = state.phase !== "complete" || stage === "announced";
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
      if (seat && seat.leaving) classes.push("is-leaving");
      if (seat && seat.away) classes.push("is-away");
      if (seat && seat.isBot) classes.push("is-bot");
      var isWinner = !!(seat && (seat.winner || winners[seat.nick]));
      if (isWinner && revealWinner) classes.push("is-winner");

      var name = seat ? (seat.displayName || seat.nick) : "";
      var status = seat ? seatStatus(seat) : "";
      var actionLabel = seatActionLabel(seat);
      var actionHtml = seatActionHtml(seat);
      var actionClass = seatActionClass(seat);
      var actionAnimationKey = seatActionAnimationKey(seat, absolute);
      var actionEnterClass = "";
      if (actionAnimationKey) {
        if (!suppressActionTagAnimations &&
            pendingActionTagAnimationKeys[actionAnimationKey] &&
            !actionTagAnimationKeys[actionAnimationKey]) {
          actionEnterClass = " is-action-enter";
        }
        actionTagAnimationKeys[actionAnimationKey] = true;
        delete pendingActionTagAnimationKeys[actionAnimationKey];
      }
      var personalityLabel = seat && seat.isBot
        ? botPersonalityLabel(seat.botPersonality)
        : "";
      var avatarSrc = seat && seat.isBot
        ? botPersonalityAvatar(seat.botPersonality)
        : seat ? readProfileAvatar(seat.nick) : "";
      var displayStack = seat ? animatedStackAmount(absolute, seat.stack) : 0;
      var label = seat
        ? name + ", 보유액 " + formatChips(displayStack) +
          (seat.isBot ? ", AI, " + personalityLabel : "") +
          (status ? ", " + status : "") + (isActive ? ", 행동 차례" : "")
        : (seatedAloneWithBotsEnabled() ? "빈 좌석, AI 추가" : "빈 좌석, 앉기");
      var badges = "";
      if (absolute === state.dealerSeat) badges += "<span>D</span>";
      var leaveBadge = seat && seat.leaving
        ? '<span class="holdem-seat-leave-badge" aria-hidden="true">' +
          esc(seat.leavingIntent === "spectate" ? "관전 예약" : "나가기 예약") + '</span>'
        : "";

      var holes = "";
      var holesClass = "holdem-hole-cards";
      var currentHand = isMe ? heroCurrentHand() : null;
      var currentHandHtml = currentHand
        ? '<span class="holdem-hero-hand-badge">' + esc(currentHand.name) + '</span>'
        : "";
      var winnerCombo = seat ? resultWinningComboForSeat(absolute) : null;
      if (winnerCombo) holesClass += " is-winning-combo-review";
      if (seat) {
        if (isMe && state.heroCards.length) {
          holesClass += " is-visible-cards";
          holes = state.heroCards.map(function (card, cardIndex) {
            var comboClass = winnerCombo
              ? (winnerCombo.holeCards[cardIndex] ? "is-winning-combo-card" : "is-winning-combo-muted")
              : (currentHand && currentHand.holeCards[cardIndex] ? "is-hero-made-hand-card" : "");
            return cardHtml(card, null, comboClass);
          }).join("");
        } else if (state.revealedCards[absolute] && state.revealedCards[absolute].length) {
          holesClass += " is-visible-cards is-revealed-cards";
          holes = state.revealedCards[absolute].map(function (card, cardIndex) {
            var comboClass = winnerCombo
              ? (winnerCombo.holeCards[cardIndex] ? "is-winning-combo-card" : "is-winning-combo-muted")
              : "";
            return cardHtml(card, null, comboClass);
          }).join("");
        } else {
          var count = seat.cardCount || (isHandActive(state.phase) && seat.inHand && !seat.folded ? 2 : 0);
          for (var cardIndex = 0; cardIndex < count; cardIndex++) holes += cardHtml(null, "back");
        }
      }
      var resultBadge = "";
      if (seat && isWinner && state.phase === "complete" && stage === "announced") {
        var won = animatedWinAmount(absolute);
        var wonText = won > 0 ? "+" + formatChips(won) : "";
        var winGainClass = "holdem-win-gain";
        if (wonText.length >= 12) winGainClass += " is-tiny";
        else if (wonText.length >= 9) winGainClass += " is-compact";
        resultBadge = '<div class="holdem-winner-result" aria-hidden="true">' +
          (won > 0 ? '<span class="' + winGainClass + '">' + esc(wonText) + '</span>' : "") +
          '<strong>WINNER</strong>' +
          '<small>' + esc(resultHandLabel(absolute)) + '</small>' +
        '</div>';
      }

      html.push(
        '<article class="' + classes.join(" ") + '" data-seat="' + absolute +
        '" data-relative-seat="' + relative + '" aria-label="' + esc(label) + '"' +
        (seat || (!seat && !isHandActive(state.phase)) ? ' role="button" tabindex="0"' : "") + '>' +
          '<div class="' + holesClass + '">' + holes + currentHandHtml + '</div>' +
          resultBadge +
          '<div class="holdem-seat-avatar" aria-hidden="true">' +
            (avatarSrc ? '<img src="' + esc(avatarSrc) + '" alt="">' : seat ? avatarNameHtml(name) :
              '<span class="holdem-seat-open-icon"><span></span><i></i></span>') +
          '</div>' +
          '<div class="holdem-seat-badges" aria-hidden="true">' + badges + '</div>' +
          leaveBadge +
          (seat ? '<strong class="holdem-seat-name">' + esc(name) + '</strong>' : "") +
          (seat ? '<span class="holdem-seat-stack">' + formatChips(displayStack) + '</span>' : "") +
          (isActive && state.deadlineAt
            ? '<span class="holdem-seat-turn-timer" data-holdem-seat-timer="' + absolute + '"></span>'
            : "") +
          (actionLabel ? '<span class="holdem-seat-action ' + esc(actionClass + actionEnterClass) + '">' + actionHtml + '</span>' : "") +
        '</article>'
      );
    }
    var nextHtml = html.join("");
    if (lastSeatsHtml !== nextHtml) {
      box.innerHTML = nextHtml;
      lastSeatsHtml = nextHtml;
    }
    lastSeatResultStage = stage;
    suppressActionTagAnimations = false;
  }

  function communityCardHtml(card, index, newRevealIndex, now, currentHand) {
    if (!card) return cardHtml(null);
    var cardClasses = [];
    if (currentHand && currentHand.communityCards[index]) {
      cardClasses.push(currentHand.resultCombo ? "is-winning-combo-card" : "is-hero-made-hand-card");
    } else if (currentHand && currentHand.dimCommunityCards) {
      cardClasses.push("is-winning-combo-muted");
    }
    var highlightClass = cardClasses.join(" ");
    var key = communityCardKey(card);
    if (boardRevealState.cards[index] !== key) {
      boardRevealState.cards[index] = key;
      boardRevealState.delayMs[index] = newRevealIndex * COMMUNITY_CARD_FLIP_STAGGER_MS;
      boardRevealState.revealAt[index] = now + boardRevealState.delayMs[index];
      scheduleCommunityCardOpenSfx(card, index, boardRevealState.delayMs[index]);
    }
    var isRiver = index === 4;
    var revealDuration = isRiver ? COMMUNITY_RIVER_FLIP_MS : COMMUNITY_CARD_FLIP_MS;
    var flipClass = "is-community-flipping" +
      (isRiver ? " is-community-river-flipping" : "");
    var revealEnd = boardRevealState.revealAt[index] + revealDuration;
    if (now <= revealEnd) {
      return cardHtml(
        card,
        null,
        (flipClass + " " + highlightClass).trim(),
        ' style="--holdem-community-flip-delay: ' + boardRevealState.delayMs[index] + 'ms;"'
      );
    }
    return cardHtml(card, null, highlightClass);
  }

  function communityRevealBlocksActions(now) {
    if (!isHandActive(state.phase) || state.board.length < 5 || !state.board[4]) return false;
    var key = communityCardKey(state.board[4]);
    if (boardRevealState.cards[4] !== key) return true;
    var revealAt = boardRevealState.revealAt[4];
    if (!revealAt) return false;
    return (now || Date.now()) <= revealAt + COMMUNITY_RIVER_FLIP_MS;
  }

  function renderBoard() {
    var board = $("holdem-board");
    if (!board) return;
    syncBoardRevealKey();
    var html = "";
    var visibleCount = resultBoardVisibleCount();
    var now = Date.now();
    var newRevealIndex = 0;
    var currentHand = resultWinningBoardCombo() || heroCurrentHand();
    for (var i = 0; i < 5; i++) {
      var card = i < visibleCount ? state.board[i] : null;
      if (card && boardRevealState.cards[i] !== communityCardKey(card)) {
        html += communityCardHtml(card, i, newRevealIndex, now, currentHand);
        newRevealIndex += 1;
      } else {
        html += card ? communityCardHtml(card, i, 0, now, currentHand) : cardHtml(null);
      }
    }
    if (lastBoardHtml !== html) {
      board.innerHTML = html;
      lastBoardHtml = html;
    }
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
      ? (state.practiceMode ? "6-MAX · AI 연습 홀덤" : "6-MAX · 홀덤")
      : "6-MAX · " + (state.tournamentSpeed === "turbo" ? "터보" : "일반") + " 토너먼트";
    var modeDescription = state.practiceMode
      ? "AI와 하는 연습용 임시 원화 자산입니다. 보유 자산·테이블 자산에 반영되지 않아요."
      : state.mode === "ring"
      ? "홀덤 자산에서 " + formatChips(state.startingStack) +
        "을 바이인합니다. 퇴장하면 남은 테이블 금액이 자산으로 돌아오며, 블라인드는 " +
        formatChips(state.smallBlind) + "/" + formatChips(state.bigBlind) + "로 고정됩니다."
      : "전원 " + formatChips(state.startingStack) + "으로 시작하며 " +
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
    var occupied = state.seats.filter(Boolean).length;
    var roster = api && typeof api.roster === "function" ? api.roster() : [];
    setText("holdem-people-count", Math.max(occupied, Array.isArray(roster) ? roster.length : 0));
    if (roomName()) setText("holdem-lobby-title", roomName());
    renderSpectatorChip();
    renderSettings();
  }

  function holdemUnseatedSpectators() {
    var seated = Object.create(null);
    state.seats.forEach(function (seat) {
      var nick = text(seat && seat.nick, 40);
      if (nick) seated[nick] = true;
    });
    var roster = api && typeof api.roster === "function" ? api.roster() : [];
    if (!Array.isArray(roster)) roster = [];
    var seen = Object.create(null);
    var spectators = [];
    roster.forEach(function (person) {
      var nick = text(person && person.nick, 40);
      if (!nick || seated[nick] || seen[nick]) return;
      seen[nick] = true;
      spectators.push(nick);
    });
    return spectators;
  }

  function renderSpectatorChip() {
    var chip = $("holdem-spectator-chip");
    if (!chip) return;
    var spectators = holdemUnseatedSpectators();
    var count = spectators.length;
    chip.classList.toggle("hidden", count <= 0);
    if (count <= 0) {
      chip.textContent = "";
      chip.removeAttribute("title");
      return;
    }
    chip.innerHTML = '<strong>관전자 ' + count + '명</strong>' +
      spectators.map(function (nick) {
        return '<span>' + esc(nick) + '</span>';
      }).join("");
    chip.title = spectators.join(", ");
  }

  function renderConnection() {
    var element = $("holdem-connection");
    if (!element) return;
    element.classList.remove("ready", "error");
    element.classList.add("hidden");
    if (element.textContent) element.textContent = "";

    var status = state.phase === "loading"
      ? "테이블 연결 중"
      : phaseLabel(state.phase) + (pendingAction && pendingAction !== "join" ? " · 처리 중" : "");
    setText("holdem-status", status);
  }

  function tableHint() {
    if (!connected) return "서버 연결을 확인 중이에요";
    if (lastError) return lastError;
    if (demoMode()) return "이 기기에서 홀덤 UI를 연습 중이에요";
    if (state.message) return state.message;
    if (state.phase === "loading" || !hasSnapshot || pendingAction === "join") {
      return "테이블을 불러오는 중이에요";
    }
    if (state.phase === "waiting") {
      if (state.heroSeat < 0) return "빈 좌석을 눌러 착석하세요";
      if (seatedAloneWithBotsEnabled()) return "다른 빈 좌석을 누르면 랜덤 성향 AI가 앉아요.";
      var readyCount = state.seats.filter(function (seat) { return seat && seat.ready; }).length;
      return readyCount + "명 준비 · 두 명 이상 준비하면 시작할 수 있어요";
    }
    if (state.mode === "ring" && state.heroSeat >= 0 &&
        state.seats[state.heroSeat] && state.seats[state.heroSeat].stack <= 0) {
      return state.canRefill
        ? formatChips(state.refillAmount || 20000) + "을 자동으로 충전하고 있어요"
        : "무료 충전을 모두 사용했어요. 보유 자산으로 다시 참가할 수 있어요";
    }
    if (isBetweenHands(state.phase) && state.lastRake > 0) {
      return "이번 핸드 수수료 " + formatChips(state.lastRake) +
        " · 플랍 이후 2%, 최대 1BB";
    }
    return "";
  }

  function announcement() {
    return "";
  }

  function renderTableHint() {
    setText("holdem-table-hint", tableHint());
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
    var heroMaximum = hero
      ? nonnegative(hero.bet, 0) + nonnegative(hero.stack, 0)
      : 0;
    var maximum = state.legal.raise && state.legal.raise.max ||
      state.legal.bet && state.legal.bet.max ||
      state.maxRaise || hero && hero.stack || minimum;
    if (heroMaximum > 0) maximum = Math.min(maximum, heroMaximum);
    minimum = Math.max(1, Math.round(minimum));
    maximum = Math.max(minimum, Math.round(maximum));
    return { min: minimum, max: maximum, step: Math.max(1, state.raiseStep || 1) };
  }

  function snapRaiseValue(value, bounds) {
    var numeric = finite(value, bounds.min);
    var stepped = Math.round(numeric / bounds.step) * bounds.step;
    return clamp(stepped, bounds.min, bounds.max);
  }

  function setRaiseValue(value) {
    var slider = $("holdem-raise-slider");
    if (!slider) return;
    var bounds = raiseBounds();
    raiseValue = snapRaiseValue(value, bounds);
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

  function quickBetRawTarget(kind) {
    var bounds = raiseBounds();
    var target = bounds.min;
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    var raising = !!state.legal.raise;
    var matchedBet = raising ? nonnegative(hero && hero.bet, 0) + state.toCall : 0;
    var potAfterCall = state.pot + (raising ? state.toCall : 0);
    if (kind === "half") target = matchedBet + Math.round(potAfterCall * 0.5);
    else if (kind === "three-quarter") target = matchedBet + Math.round(potAfterCall * 0.75);
    else if (kind === "pot") target = matchedBet + Math.round(potAfterCall);
    else if (kind === "two-pot") target = matchedBet + Math.round(potAfterCall * 2);
    else if (kind === "four-pot") target = matchedBet + Math.round(potAfterCall * 4);
    else if (kind === "eight-pot") target = matchedBet + Math.round(potAfterCall * 8);
    else if (kind === "allin") target = bounds.max;
    return target;
  }

  function quickBetTarget(kind) {
    var bounds = raiseBounds();
    return snapRaiseValue(quickBetRawTarget(kind), bounds);
  }

  function quickBetAvailable(kind) {
    if (kind === "allin") return true;
    var bounds = raiseBounds();
    return quickBetRawTarget(kind) < bounds.max;
  }

  function quickBetLabel(kind) {
    return {
      half: "1/2 팟",
      "three-quarter": "3/4 팟",
      pot: "팟",
      "two-pot": "2 팟",
      "four-pot": "4 팟",
      "eight-pot": "8 팟",
      allin: "올인"
    }[kind] || "레이즈";
  }

  function actionAmountFitClass(value) {
    var compact = String(value || "").replace(/\s+/g, "");
    if (compact.length >= 10) return " is-xl-amount";
    if (compact.length >= 8) return " is-long-amount";
    return "";
  }

  function syncQuickBetButtons() {
    var buttons = root() ? root().querySelectorAll("[data-holdem-bet]") : [];
    for (var i = 0; i < buttons.length; i++) {
      var kind = buttons[i].getAttribute("data-holdem-bet");
      var available = quickBetAvailable(kind);
      buttons[i].classList.toggle("hidden", !available);
      buttons[i].disabled = !available;
      var amount = formatChips(quickBetTarget(kind));
      buttons[i].innerHTML = '<span>' + esc(quickBetLabel(kind)) + '</span>' +
        (amount ? '<strong class="holdem-action-amount-fit' + actionAmountFitClass(amount) + '">' + esc(amount) + '</strong>' : "");
    }
  }

  function renderPracticeJoinControls(busy) {
    var requestButton = $("holdem-join-request-btn");
    var alert = $("holdem-join-request-alert");
    var incoming = incomingJoinRequest();
    var ownRequest = ownJoinRequest();
    var canRequest = canRequestPracticeJoin();
    if (requestButton) {
      var showRequest = canRequest || !!ownRequest;
      requestButton.classList.toggle("hidden", !showRequest);
      requestButton.disabled = !!(busy || ownRequest || requests.join_request || !canRequest);
      requestButton.textContent = ownRequest ? "요청 보냄" : "같이 플레이 요청";
    }
    if (alert) {
      alert.classList.toggle("hidden", !incoming);
      alert.setAttribute("aria-hidden", incoming ? "false" : "true");
    }
    if (incoming) {
      setText("holdem-join-request-text", incoming.nick + "님이 같이 플레이하고 싶어해요");
    } else {
      setText("holdem-join-request-text", "");
    }
    disable("holdem-join-accept-btn", busy || !incoming || requests.resolve_join_request);
    disable("holdem-join-decline-btn", busy || !incoming || requests.resolve_join_request);
  }

  function renderControls() {
    var waiting = state.phase === "waiting";
    var completed = state.phase === "complete";
    var moves = ["fold", "check", "call", "bet", "raise", "allin"];
    var revealBlockingActions = communityRevealBlocksActions();
    communityRevealControlBlocked = revealBlockingActions;
    var hasMove = !revealBlockingActions && moves.some(function (move) { return !!state.legal[move]; });
    var busy = pendingUiCount > 0;
    var isOwner = !!(text(me().nick, 40) && text(me().nick, 40) === state.ownerNick);
    var humanCount = humanSeatCount();
    var canManageBots = isOwner && state.canManageBots && humanCount === 1;
    var occupiedSeats = state.seats.filter(Boolean).length;
    var canSize = !!(state.legal.bet || state.legal.raise);
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    var resultReady = resultTransitionReady();
    var resultSettled = resultSettlementReady();
    var needsRefill = state.mode === "ring" && !!hero && hero.stack <= 0 &&
      !isHandActive(state.phase) && resultReady;
    var menuKey = state.handId + ":" + state.version + ":" + state.actionSeq + ":" +
      state.actingSeat + ":" + (canSize ? sizedMove() : "none");
    if (menuKey !== actionMenuKey) {
      actionMenuKey = menuKey;
      raiseMenuOpen = false;
    }
    if (!hasMove || !canSize) raiseMenuOpen = false;

    show("holdem-lobby", false);
    show("holdem-seat-controls", waiting && state.heroSeat >= 0);
    show("holdem-bot-controls", false);
    show("holdem-bot-note", false);
    setText("holdem-bot-count", "AI " + state.botCount + "명");
    disable("holdem-bot-add-btn", busy || !canManageBots || occupiedSeats >= MAX_SEATS);
    disable("holdem-bot-fill-btn", busy || !canManageBots || state.botCount >= 5 || occupiedSeats >= MAX_SEATS);
    disable("holdem-bot-remove-btn", busy || !canManageBots || state.botCount <= 0);
    var isNewGameStart = state.phase === "complete" && state.newGameBuyInRequired &&
      isOwner && resultReady;
    var tableStartVisible = (waiting && state.canStart) || isNewGameStart;
    show("holdem-ready-btn", false);
    show("holdem-start-btn", false);
    show("holdem-table-start-btn", tableStartVisible);
    var tableStartButton = $("holdem-table-start-btn");
    if (tableStartButton) {
      tableStartButton.textContent = isNewGameStart
        ? "새 게임 시작"
        : "시작하기";
    }
    var readyButton = $("holdem-ready-btn");
    if (readyButton) {
      readyButton.setAttribute("aria-pressed", state.heroReady ? "true" : "false");
      readyButton.textContent = state.heroReady ? "준비 취소" : "준비";
    }
    disable("holdem-ready-btn", busy);
    disable("holdem-start-btn", busy);
    disable("holdem-table-start-btn", busy);
    show("holdem-refill-panel", needsRefill);
    renderPracticeJoinControls(busy);
    var refillButton = $("holdem-refill-btn");
    if (refillButton) {
      var walletCannotRebuy = buyInWallet &&
        buyInWallet.balance < Math.max(100, state.buyInMin || 10000);
      refillButton.textContent = state.canRefill
        ? formatChips(state.refillAmount || 20000) + " 자동 충전"
        : "재참가 금액 선택";
      refillButton.disabled = busy || state.canRefill ||
        (!state.canRefill && walletCannotRebuy);
    }
    if (needsRefill) {
      var refillStatus = state.practiceMode
        ? "연습용 금액을 자동으로 충전하고 있어요"
        : state.refillStatusKnown
        ? (state.refillsRemainingToday > 0
          ? "스택이 0원이 되어 " + formatChips(state.refillAmount || 20000) +
            "을 지급해요 · 오늘 " + state.refillsRemainingToday + "회 남음"
          : "오늘 무료 충전 " + (state.dailyRefillLimit || 3) + "회를 모두 사용했어요")
        : "스택이 0원이 되면 " + formatChips(state.refillAmount || 20000) +
          "을 자동 지급해요";
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
    var callAmount = state.toCall ? formatChips(state.toCall) : "";
    setText("holdem-call-amount", callAmount);
    var callAmountNode = $("holdem-call-amount");
    if (callAmountNode) {
      callAmountNode.className = "holdem-action-call-amount holdem-action-amount-fit" + actionAmountFitClass(callAmount);
    }
    setText("holdem-action-label", state.actingSeat === state.heroSeat ? "내 차례" : "행동 선택");
    setText("holdem-hand-name", state.handName || "패를 확인하세요");

    show("holdem-raise-panel", hasMove && canSize && raiseMenuOpen);
    if (canSize) syncRaiseControls();
    if (canSize) syncQuickBetButtons();
    var slider = $("holdem-raise-slider");
    if (slider) slider.disabled = busy;
    var quick = root() ? root().querySelectorAll("[data-holdem-bet]") : [];
    for (var i = 0; i < quick.length; i++) quick[i].disabled = busy || quick[i].classList.contains("hidden");

    var screen = root();
    if (screen) {
      screen.classList.toggle("is-requesting", busy);
      screen.classList.toggle("is-actioning", hasMove);
      screen.classList.toggle("is-raise-menu-open", hasMove && canSize && raiseMenuOpen);
      screen.classList.toggle("is-seat-selection", waiting && state.heroSeat < 0);
    }
    renderConnection();
  }

  function renderTimer() {
    renderAutoNextCountdown();
    renderSeatTimers();
    renderSettlementAnimation();
    releaseResultTransitions();
    var revealBlockingActions = communityRevealBlocksActions();
    if (revealBlockingActions || communityRevealControlBlocked) {
      communityRevealControlBlocked = revealBlockingActions;
      renderBoard();
      renderControls();
    }
    var timer = $("holdem-timer");
    if (!timer) return;
    if (!state.deadlineAt) {
      timer.textContent = "--";
      timer.classList.remove("urgent");
      lastTimerWarningKey = "";
      return;
    }
    var info = timerSnapshot();
    var remaining = Math.max(0, state.deadlineAt - Date.now());
    timer.textContent = String(info.seconds);
    timer.classList.toggle("urgent", info.urgent);
    syncTimerWarning(info);
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
    if (state.newGameBuyInRequired) {
      countdown.textContent = text(me().nick, 40) === state.ownerNick
        ? "새 게임 참가금액을 선택해주세요."
        : "방장이 새 게임 참가금액을 정하고 있어요.";
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

  function syncResultClasses(stage) {
    var screen = root();
    if (!screen) return;
    stage = stage || resultStage();
    var settling = !!(state.phase === "complete" && resultFlow &&
      Date.now() >= resultFlow.settleStart && Date.now() < resultFlow.settleEnd);
    screen.classList.toggle("is-showdown", isBetweenHands(state.phase) && stage !== "action");
    screen.classList.toggle("is-result-final-action", stage === "action");
    screen.classList.toggle("is-result-cards-first", stage === "cards");
    screen.classList.toggle("is-result-announced", stage === "announced");
    screen.classList.toggle("is-settling-pot", settling);
  }

  function renderSettlementAnimation() {
    if (state.phase !== "complete") return;
    var stage = resultStage();
    syncResultClasses(stage);
    if (stage !== lastSeatResultStage) renderSeats();
    renderBoard();
    setText("holdem-pot-amount", formatChips(animatedPotAmount()));
    setText("holdem-result-pot", formatChips(animatedPotAmount()));
    maybeStartPayoutParticleStream();
    for (var i = 0; i < MAX_SEATS; i++) {
      var seat = state.seats[i];
      if (!seat) continue;
      var node = root() && root().querySelector('.holdem-seat[data-seat="' + i + '"] .holdem-seat-stack');
      if (node) node.textContent = formatChips(animatedStackAmount(i, seat.stack));
    }
    releaseResultSettlement();
    if (stage === "announced") renderHandResult();
  }

  function renderPlayers(box, hint) {
    if (!box) return;
    if (hint) {
      hint.className = "players-hint";
      hint.textContent = "홀덤 좌석과 현재 보유 금액입니다. 한 테이블에는 최대 6명이 참가합니다.";
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
    screen.classList.toggle("is-connected", connected);
    syncResultClasses();
    renderHeader();
    renderBoard();
    renderTableHint();
    renderSeats();
    renderLobbyRoster();
    renderHandResult();
    renderAnnouncer();
    renderControls();
    maybeAutoSeatJoin();
    renderBuyInDialog();
    renderTimer();
    maybeAutoOpenRebuyDialog();
    scheduleBotStep();
    scheduleAutoReadyForNextHand();
    scheduleAutoNextHand();
  }

  function quickBet(kind) {
    if (kind === "allin" && state.legal.allin) {
      performMove("allin");
      return;
    }
    if (!quickBetAvailable(kind)) return;
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

  function setChatOpen(open, focusInput) {
    var screen = root();
    var input = $("holdem-chat-input");
    var button = $("holdem-chat-toggle");
    open = !!open;
    if (screen) {
      screen.classList.toggle("is-chat-open", open);
      if (!open) screen.classList.remove("is-chat-focused");
    }
    if (button) {
      button.setAttribute("aria-expanded", open ? "true" : "false");
      button.setAttribute("aria-label", open ? "채팅 닫기" : "채팅 열기");
    }
    if (open && focusInput && input) {
      setTimeout(function () { input.focus(); }, 0);
    } else if (!open && input && document.activeElement === input) {
      input.blur();
    }
    if (!open) {
      var overlay = $("holdem-chat-overlay");
      if (overlay) {
        overlay.dataset.holdemOverlayMode = "toast";
        overlay.innerHTML = "";
      }
    }
  }

  function toggleChatOpen() {
    var screen = root();
    setChatOpen(!(screen && screen.classList.contains("is-chat-open")), true);
  }

  function onRootClick(event) {
    var screen = root();
    if (!screen || !event.target || !event.target.closest) return;
    unlockHoldemAudio();

    if (event.target.id === "holdem-profile-backdrop") {
      closeProfileDialog();
      return;
    }
    if (event.target.id === "holdem-buyin-backdrop") {
      closeBuyInDialog({ suppressAutoSeat: true });
      return;
    }
    var profileSeat = event.target.closest(".holdem-seat:not(.is-empty)");
    if (profileSeat && screen.contains(profileSeat)) {
      openProfileDialog(profileSeat.getAttribute("data-seat"));
      return;
    }

    var seatElement = event.target.closest(".holdem-seat.is-empty");
    if (seatElement && screen.contains(seatElement)) {
      chooseEmptySeat(seatElement.getAttribute("data-seat"));
      return;
    }

    var button = event.target.closest("button");
    if (!button || !screen.contains(button)) return;
    var id = button.id;
    if (id === "holdem-settings-btn") {
      settingsOpen = !settingsOpen;
      renderSettings();
    } else if (id === "holdem-buyin-close" || id === "holdem-buyin-cancel") {
      closeBuyInDialog({ suppressAutoSeat: true });
    } else if (id === "holdem-buyin-spectate") {
      spectateFromBuyInDialog();
    } else if (id === "holdem-buyin-confirm") {
      confirmBuyInDialog();
    } else if (id === "holdem-profile-close") {
      closeProfileDialog();
    } else if (id === "holdem-profile-asset-record-btn") {
      var recordTarget = profileTarget();
      var recordTotalAssets = profileTargetAsset(recordTarget, true);
      if (window.HoldemAssetRecords && typeof HoldemAssetRecords.open === "function") {
        HoldemAssetRecords.open(text(me().nick, 40), recordTotalAssets);
      }
    } else if (id === "holdem-profile-role-action") {
      toggleProfileRole();
    } else if (id === "holdem-profile-avatar-remove") {
      var profileNick = text(me().nick, 40);
      removeProfileAvatar(profileNick);
      renderProfileDialog();
      renderSeats();
      persistProfileAvatar(profileNick, "").then(function (result) {
        if (result && result.ok) refreshProfileAvatars(state, true);
      }, function () {});
    } else if (id === "holdem-settings-close") {
      settingsOpen = false;
      renderSettings();
    } else if (id === "holdem-unit-toggle") {
      toggleMoneyUnitMode();
    } else if (id === "holdem-people-btn") {
      if (api && typeof api.openPlayers === "function") api.openPlayers();
    } else if (id === "holdem-hands-btn") {
      if (api && typeof api.openHoldemHands === "function") api.openHoldemHands();
      else if (api && typeof api.openRules === "function") api.openRules();
      else if (api && typeof api.openMenu === "function") api.openMenu();
    } else if (id === "holdem-rank-btn") {
      if (api && typeof api.openHoldemRank === "function") api.openHoldemRank();
    } else if (id === "holdem-leave-btn") {
      if (isBusy()) requestLeaveAfterHand();
      else if (api && typeof api.leaveRoom === "function") api.leaveRoom();
    } else if (id === "holdem-chat-toggle") {
      toggleChatOpen();
    } else if (id === "holdem-chat-send") {
      sendChat();
    } else if (id === "holdem-join-request-btn") {
      requestPracticeJoin();
    } else if (id === "holdem-join-accept-btn") {
      resolvePracticeJoin(true);
    } else if (id === "holdem-join-decline-btn") {
      resolvePracticeJoin(false);
    } else if (id === "holdem-ready-btn") {
      setReady();
    } else if (id === "holdem-refill-btn") {
      var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
      if (state.mode === "ring" && hero && hero.stack <= 0 && state.canRefill) {
        refillRingChips();
      } else if (state.mode === "ring" && hero && hero.stack <= 0) {
        openBuyInDialog("rebuy", state.heroSeat);
      }
    } else if (id === "holdem-bot-add-btn") {
      addBot();
    } else if (id === "holdem-bot-fill-btn") {
      addFiveBots();
    } else if (id === "holdem-bot-remove-btn") {
      removeBot();
    } else if (id === "holdem-start-btn" || id === "holdem-table-start-btn") {
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
    } else if (event.target && event.target.id === "holdem-buyin-slider") {
      setBuyInValue(event.target.value);
    }
  }

  function onRootChange(event) {
    if (event.target && event.target.id === "holdem-profile-avatar-input") {
      var file = event.target.files && event.target.files[0];
      if (file) updateProfileAvatarFromFile(file);
      event.target.value = "";
    }
  }

  function onRootKeydown(event) {
    if (event.key === "Escape" && profileDialogOpen) {
      closeProfileDialog();
      return;
    }
    if (event.key === "Escape" && buyInDialogOpen) {
      closeBuyInDialog({ suppressAutoSeat: true });
      return;
    }
    if (event.key === "Escape" && settingsOpen) {
      settingsOpen = false;
      renderSettings();
      return;
    }
    if (event.key === "Escape" && root() && root().classList.contains("is-chat-open")) {
      setChatOpen(false);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && event.target &&
        event.target.closest && event.target.closest(".holdem-seat:not(.is-empty)")) {
      var profileSeat = event.target.closest(".holdem-seat:not(.is-empty)");
      if (profileSeat && root() && root().contains(profileSeat)) {
        event.preventDefault();
        openProfileDialog(profileSeat.getAttribute("data-seat"));
        return;
      }
    }
    if ((event.key === "Enter" || event.key === " ") && event.target &&
        event.target.closest && event.target.closest(".holdem-seat.is-empty")) {
      var seatElement = event.target.closest(".holdem-seat.is-empty");
      if (seatElement && root() && root().contains(seatElement)) {
        event.preventDefault();
        chooseEmptySeat(seatElement.getAttribute("data-seat"));
        return;
      }
    }
    if (event.target && event.target.id === "holdem-chat-input" &&
        event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      sendChat();
    }
  }

  function ensureSeatControls() {
    if (typeof document === "undefined") return;
    var stage = $("holdem-stage");
    if (!stage) return;
    var controls = $("holdem-seat-controls");
    if (!controls) {
      controls = document.createElement("section");
      controls.id = "holdem-seat-controls";
      controls.className = "holdem-seat-controls hidden";
      controls.setAttribute("aria-label", "홀덤 대기 컨트롤");
      stage.appendChild(controls);
    }
    ["holdem-ready-btn", "holdem-start-btn"].forEach(function (id) {
      var button = $(id);
      if (button && button.parentNode !== controls) controls.appendChild(button);
    });
  }

  function bindDom() {
    var screen = root();
    if (!screen) return false;
    ensureSeatControls();
    if (boundRoot === screen) return true;
    if (boundRoot) {
      boundRoot.removeEventListener("click", onRootClick);
      boundRoot.removeEventListener("input", onRootInput);
      boundRoot.removeEventListener("change", onRootChange);
      boundRoot.removeEventListener("keydown", onRootKeydown);
    }
    boundRoot = screen;
    boundRoot.addEventListener("click", onRootClick);
    boundRoot.addEventListener("input", onRootInput);
    boundRoot.addEventListener("change", onRootChange);
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
    clearCommunityCardOpenSoundTimers();
    clearActionSoundTimers();
    stopAllinBgmSfx();
    resultFlow = null;
    boardRevealState = { key: "", cards: [], revealAt: [], delayMs: [], soundKeys: [] };
    actionTagAnimationKeys = Object.create(null);
    pendingActionTagAnimationKeys = Object.create(null);
    suppressActionTagAnimations = false;
    resetPayoutParticleStream();
    lastBoardHtml = "";
    lastSeatsHtml = "";
    lastSeatResultStage = "none";
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
    lastTimerWarningKey = "";
    lastTurnSoundKey = "";
    profileDialogOpen = false;
    profileAssetRequestSeq += 1;
    profileAssetPending = false;
    profileAsset = null;
    profileAssetNick = "";
    profileTargetSeat = -1;
    autoSeatKey = "";
    autoSeatSuppressed = false;
    tickSentKey = "";
    botSentKey = "";
    botRetryAt = 0;
    demoState = null;
    demoVersion = 0;
    resultFlow = null;
    boardRevealState = { key: "", cards: [], revealAt: [], delayMs: [], soundKeys: [] };
    lastActionSoundKey = "";
    lastAllinBgmKey = "";
    lastWinnerSoundKey = "";
    actionTagAnimationKeys = Object.create(null);
    pendingActionTagAnimationKeys = Object.create(null);
    suppressActionTagAnimations = false;
    lastBoardHtml = "";
    lastSeatsHtml = "";
    communityRevealControlBlocked = false;
    leaveAfterHandRequested = false;
    if (!bindDom()) throw new Error("텍사스 홀덤 화면을 찾을 수 없습니다.");
    setChatOpen(false);
    bindHoldemAudioUnlock();
    syncAudio();
    render();
    startTimers();
    refreshSnapshot("enter", true);
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
        expectedVersion: previousVersion,
        leaveIntent: "leave"
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
    pendingMove = null;
    lastTimerWarningKey = "";
    lastTurnSoundKey = "";
    actionTagAnimationKeys = Object.create(null);
    pendingActionTagAnimationKeys = Object.create(null);
    suppressActionTagAnimations = false;
    profileDialogOpen = false;
    profileWalletPending = false;
    profileAssetRequestSeq += 1;
    profileAssetPending = false;
    profileAsset = null;
    profileAssetNick = "";
    profileTargetSeat = -1;
    autoSeatKey = "";
    autoSeatSuppressed = false;
    state = emptyState();
    rawSnapshot = null;
    demoState = null;
    demoVersion = 0;
    botSentKey = "";
    botRetryAt = 0;
    lastActionSoundKey = "";
    lastAllinBgmKey = "";
    lastWinnerSoundKey = "";
    communityRevealControlBlocked = false;
    leaveAfterHandRequested = false;
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
      scheduleRefresh("broadcast", true, 0);
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
      summary: occupied + "/6명 참가 · " + ready + "명 준비" +
        (state.mode === "ring" ? " · 바이인 " + formatChips(state.startingStack) : "")
    };
  }

  function isBusy() {
    var hero = state.heroSeat >= 0 ? state.seats[state.heroSeat] : null;
    return !!(hero && isHandActive(state.phase) && hero.inHand);
  }

  function canChat() {
    return true;
  }

  function rules() {
    return {
      title: "텍사스 홀덤 규칙",
      html: '<div class="cm-rules holdem-rules">' +
        '<p class="rule-intro">Poker TDA 2024와 일반적인 국제 토너먼트 진행 원칙을 바탕으로 한 6인 노리밋 텍사스 홀덤입니다. 각자 받은 <b>홀 카드 2장</b>과 모두가 공유하는 커뮤니티 카드 5장 중 가장 좋은 5장 조합으로 승부하며, 실제 가치가 없는 홀덤 전용 게임 자산만 사용합니다.</p>' +
        '<section class="cm-rule-section"><h3>1. 진행 순서</h3><ul class="cm-rule-list">' +
        '<li>딜러 버튼 왼쪽의 두 사람이 스몰 블라인드(SB)와 빅 블라인드(BB)를 냅니다.</li>' +
        '<li>프리플랍 → 플랍 3장 → 턴 1장 → 리버 1장 순서로 공개되며 각 단계마다 베팅합니다.</li>' +
        '<li>가능한 액션은 폴드, 체크, 콜, 벳, 레이즈, 올인입니다. 서버가 현재 가능한 액션과 최소 금액을 검증합니다.</li>' +
        '</ul></section>' +
        '<section class="cm-rule-section"><h3>2. 패 순위</h3><p>로열 스트레이트 플러시 · 스트레이트 플러시 · 포카드 · 풀하우스 · 플러시 · 스트레이트 · 트리플 · 투 페어 · 원 페어 · 하이 카드 순입니다. 같은 조합이면 구성 카드의 높은 숫자를 차례로 비교합니다.</p></section>' +
        '<section class="cm-rule-section"><h3>3. 올인과 동률</h3><ul class="cm-rule-list">' +
        '<li>보유 금액이 부족한 참가자가 올인하면 참가 자격에 따라 메인 팟과 사이드 팟이 나뉩니다.</li>' +
        '<li>숏 올인은 허용되지만 정상 최소 레이즈에 못 미치면 단독으로 베팅 권리를 다시 열지 않습니다. 여러 숏 올인의 누적액이 정상 레이즈 폭에 이르면 다시 레이즈할 수 있습니다.</li>' +
        '<li>완전히 같은 패는 팟을 나누며, 나눌 수 없는 남는 금액은 규칙상 먼저 받을 위치의 참가자에게 갑니다.</li>' +
        '</ul></section>' +
        '<section class="cm-rule-section"><h3>4. 충전과 수수료</h3><ul class="cm-rule-list">' +
        '<li>핸드 종료 후 스택이 0원이 되면 20,000원을 즉시 지급하며, 계정당 하루 3회까지 받을 수 있습니다.</li>' +
        '<li>실제 자산 테이블은 플랍이 공개된 핸드에만 팟의 2%를 수수료로 차감하며, 최대 금액은 해당 방의 1BB입니다.</li>' +
        '<li>수수료는 100원 단위로 내림 처리하고, AI 연습 테이블에는 적용하지 않습니다.</li>' +
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
    requestLeaveAfterHand: requestLeaveAfterHand,
    isBusy: isBusy,
    canChat: canChat,
    renderPlayers: renderPlayers,
    render: render,
    syncAudio: syncAudio,
    rules: rules,
    handRankings: handRankings,
    get state() { return state; }
  };

  if (window.__HOLDEM_TEST__) {
    controller._test = {
      emptyState: emptyState,
      normalizeSnapshot: normalizeSnapshot,
      normalizeActionHistory: normalizeActionHistory,
      normalizeCard: normalizeCard,
      normalizeLegal: normalizeLegal,
      cardHtml: cardHtml,
      seatActionLabel: seatActionLabel,
      seatActionClass: seatActionClass,
      pendingMoveMatchesActionEntry: pendingMoveMatchesActionEntry,
      handRankings: handRankings,
      resultBoardVisibleCount: resultBoardVisibleCount,
      resultStage: resultStage,
      resultSettlementDelayMs: resultSettlementDelayMs,
      resultSettlementReady: resultSettlementReady,
      resultTransitionDelayMs: resultTransitionDelayMs,
      resultTransitionReady: resultTransitionReady,
      renderSettlementAnimation: renderSettlementAnimation,
      renderControls: renderControls,
      renderTimer: renderTimer,
      renderBoard: renderBoard,
      communityRevealBlocksActions: communityRevealBlocksActions,
      relativeSeat: relativeSeat,
      requestId: requestId,
      joinTable: joinTable,
      openBuyInDialog: openBuyInDialog,
      setBuyInValue: setBuyInValue,
      confirmBuyInDialog: confirmBuyInDialog,
      refillRingChips: refillRingChips,
      rebuyRingChips: rebuyRingChips,
      addBot: addBot,
      chooseEmptySeat: chooseEmptySeat,
      maybeAutoSeatJoin: maybeAutoSeatJoin,
      maybeAutoOpenRebuyDialog: maybeAutoOpenRebuyDialog,
      leaveTableForSpectate: leaveTableForSpectate,
      requestLeaveAfterHand: requestLeaveAfterHand,
      maybeLeaveRoomAfterHand: maybeLeaveRoomAfterHand,
      performMove: performMove,
      applySnapshot: applySnapshot,
      invoke: invoke,
      setApi: function (nextApi) { api = nextApi; },
      setActive: function (value) { active = !!value; },
      setState: function (nextState) { state = nextState; },
      setHasSnapshot: function (value) { hasSnapshot = !!value; },
      getBuyInDialogState: function () {
        return {
          open: buyInDialogOpen,
          mode: buyInMode,
          seat: buyInSeat,
          pending: buyInWalletPending
        };
      },
      getLifecycleGeneration: function () { return lifecycleGeneration; },
      getRawSnapshot: function () { return rawSnapshot; },
      getPendingMove: function () {
        return pendingMove ? Object.assign({}, pendingMove) : null;
      },
      constants: {
        maxSeats: MAX_SEATS,
        pollMs: POLL_MS,
        clockMs: CLOCK_MS,
        resultFinalActionMs: RESULT_FINAL_ACTION_MS,
        resultCardsFirstMs: RESULT_CARDS_FIRST_MS,
        resultBoardRevealStepMs: RESULT_BOARD_REVEAL_STEP_MS,
        communityRiverFlipMs: COMMUNITY_RIVER_FLIP_MS,
        resultSettleMs: RESULT_SETTLE_MS,
        resultReviewMs: RESULT_REVIEW_MS
      }
    };
  }

  return controller;
})();
