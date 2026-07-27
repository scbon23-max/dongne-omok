(function (root, factory) {
  "use strict";
  var engine = root.HoldemEngine;
  if (!engine && typeof module === "object" && module.exports) {
    engine = require("./holdem-engine.js");
  }
  var api = factory(engine);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoldemAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine) {
  "use strict";

  var PROFILE = {
    samples: 192,
    callMargin: -0.008,
    valueBetFloor: 0.56,
    valueRaiseFloor: 0.6,
    bluffRate: 0.075
  };
  var PERSONALITIES = {
    tight_passive: {
      label: "타이트 패시브",
      rangeBias: 0.025,
      aggressionBias: -0.05,
      bluffMultiplier: 0.78,
      sizeBias: -1
    },
    tight_aggressive: {
      label: "타이트 어그레시브",
      rangeBias: 0.025,
      aggressionBias: 0.05,
      bluffMultiplier: 1.18,
      sizeBias: 1
    },
    loose_passive: {
      label: "루즈 패시브",
      rangeBias: -0.025,
      aggressionBias: -0.05,
      bluffMultiplier: 0.78,
      sizeBias: -1
    },
    loose_aggressive: {
      label: "루즈 어그레시브",
      rangeBias: -0.025,
      aggressionBias: 0.05,
      bluffMultiplier: 1.18,
      sizeBias: 1
    }
  };
  var RANK_VALUE = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
    "9": 9, T: 10, "10": 10, J: 11, Q: 12, K: 13, A: 14
  };
  var SUITS = { c: true, d: true, h: true, s: true };
  var ACTIONS = {
    fold: true,
    check: true,
    call: true,
    bet: true,
    raise: true,
    allin: true
  };

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function integer(value, fallback) {
    var number = finite(value, NaN);
    return isFinite(number) ? Math.floor(number) : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function text(value, max) {
    return String(value == null ? "" : value).trim().slice(0, max || 80);
  }

  function normalizePersonality(value) {
    value = text(value, 32).toLowerCase().replace(/-/g, "_");
    return PERSONALITIES[value] ? value : "tight_aggressive";
  }

  function cardCode(value) {
    var rank = "";
    var suit = "";
    if (typeof value === "string") {
      var match = value.trim().match(/^(10|[2-9TJQKA])([CDHS])$/i);
      if (!match) return "";
      rank = match[1].toUpperCase();
      suit = match[2].toLowerCase();
    } else if (value && typeof value === "object") {
      rank = text(value.rank != null ? value.rank : value.value, 2).toUpperCase();
      suit = text(value.suit, 1).toLowerCase();
    }
    if (rank === "10") rank = "T";
    return RANK_VALUE[rank] && SUITS[suit] ? rank + suit : "";
  }

  function normalizeCards(value, limit) {
    if (!Array.isArray(value)) return [];
    var cards = [];
    var seen = {};
    for (var i = 0; i < value.length && cards.length < limit; i++) {
      var card = cardCode(value[i]);
      if (card && !seen[card]) {
        seen[card] = true;
        cards.push(card);
      }
    }
    return cards;
  }

  function legalFrom(value) {
    value = value && typeof value === "object" ? value : {};
    var actions = Array.isArray(value.actions) ? value.actions : [];
    var allowed = [];
    actions.forEach(function (action) {
      action = text(action, 16).toLowerCase();
      if (ACTIONS[action] && allowed.indexOf(action) < 0) allowed.push(action);
    });
    return {
      actions: allowed,
      callAmount: Math.max(0, integer(value.callAmount, 0)),
      minBet: value.minBet == null ? null : Math.max(0, integer(value.minBet, 0)),
      minRaiseTo: value.minRaiseTo == null ? null : Math.max(0, integer(value.minRaiseTo, 0)),
      maxRaiseTo: value.maxRaiseTo == null ? null : Math.max(0, integer(value.maxRaiseTo, 0)),
      pot: Math.max(0, integer(value.pot, 0)),
      currentBet: Math.max(0, integer(value.currentBet, 0)),
      streetBet: Math.max(0, integer(value.streetBet, 0)),
      stack: Math.max(0, integer(value.stack, 0)),
      step: Math.max(1, integer(value.step, 1))
    };
  }

  /*
   * This is the AI's information firewall. Only these public fields are
   * copied. Extra properties such as deck, burn, or opponent cards are
   * deliberately ignored even if a caller accidentally supplies them.
   */
  function sanitizeObservation(snapshot) {
    snapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
    var viewer = snapshot.viewer && typeof snapshot.viewer === "object"
      ? snapshot.viewer
      : {};
    var heroCards = normalizeCards(
      Array.isArray(viewer.cards) ? viewer.cards : snapshot.heroCards,
      2
    );
    var board = normalizeCards(snapshot.board, 5);
    var used = {};
    heroCards.concat(board).forEach(function (card) { used[card] = true; });
    if (Object.keys(used).length !== heroCards.length + board.length) {
      heroCards = [];
      board = [];
    }

    var seats = [];
    if (Array.isArray(snapshot.seats)) {
      snapshot.seats.slice(0, 6).forEach(function (seat, index) {
        if (!seat || typeof seat !== "object") {
          seats.push(null);
          return;
        }
        seats.push({
          seat: clamp(integer(seat.seat, index), 0, 5),
          nick: text(seat.nick, 40),
          botPersonality: normalizePersonality(seat.botPersonality),
          stack: Math.max(0, integer(seat.stack, 0)),
          inHand: !!seat.inHand,
          folded: !!seat.folded,
          allIn: !!seat.allIn,
          streetBet: Math.max(0, integer(seat.streetBet, 0)),
          totalBet: Math.max(0, integer(seat.totalBet, 0)),
          lastAction: text(seat.lastAction, 16).toLowerCase()
        });
      });
    }
    while (seats.length < 6) seats.push(null);

    var history = [];
    if (Array.isArray(snapshot.actionHistory)) {
      snapshot.actionHistory.slice(-96).forEach(function (entry) {
        if (!entry || typeof entry !== "object") return;
        var action = text(entry.action, 16).toLowerCase();
        if (!ACTIONS[action] && action !== "small_blind" && action !== "big_blind") return;
        history.push({
          seq: Math.max(0, integer(entry.seq, 0)),
          street: text(entry.street != null ? entry.street : entry.phase, 12).toLowerCase(),
          seat: clamp(integer(entry.seat, 0), 0, 5),
          action: action,
          amount: Math.max(0, integer(entry.amount, 0)),
          potBefore: Math.max(0, integer(entry.potBefore, 0)),
          currentBetBefore: Math.max(0, integer(entry.currentBetBefore, 0))
        });
      });
    }

    var legal = legalFrom(
      viewer.legalActions && typeof viewer.legalActions === "object"
        ? viewer.legalActions
        : snapshot.legalActions
    );
    var heroSeat = clamp(integer(viewer.seat, snapshot.actorSeat), 0, 5);
    var hero = seats[heroSeat];
    var personality = normalizePersonality(
      snapshot.botPersonality || (hero && hero.botPersonality)
    );
    var settings = snapshot.settings && typeof snapshot.settings === "object"
      ? snapshot.settings
      : {};
    return {
      phase: text(snapshot.phase, 12).toLowerCase(),
      heroCards: heroCards,
      board: board,
      seats: seats,
      history: history,
      heroSeat: heroSeat,
      personality: personality,
      actorSeat: clamp(integer(snapshot.actorSeat, snapshot.actingSeat), 0, 5),
      buttonSeat: clamp(integer(snapshot.buttonSeat, 0), 0, 5),
      smallBlindSeat: clamp(integer(snapshot.smallBlindSeat, 0), 0, 5),
      bigBlindSeat: clamp(integer(snapshot.bigBlindSeat, 0), 0, 5),
      pot: Math.max(0, integer(snapshot.pot, legal.pot)),
      currentBet: Math.max(0, integer(snapshot.currentBet, legal.currentBet)),
      bigBlind: Math.max(1, integer(settings.bigBlind, 1)),
      smallBlind: Math.max(0, integer(settings.smallBlind, 0)),
      legal: legal
    };
  }

  function randomSource(options) {
    options = options || {};
    if (typeof options.random === "function") {
      return function () {
        return clamp(finite(options.random(), 0), 0, 0.999999999999);
      };
    }
    if (typeof options.randomInt === "function") {
      return function () {
        return clamp(integer(options.randomInt(0x100000000), 0) / 0x100000000, 0, 0.999999999999);
      };
    }
    return Math.random;
  }

  function randomIndex(length, random) {
    return Math.min(length - 1, Math.floor(random() * length));
  }

  function preflopStrength(cards) {
    cards = normalizeCards(cards, 2);
    if (cards.length !== 2) return 0;
    var a = RANK_VALUE[cards[0].charAt(0)];
    var b = RANK_VALUE[cards[1].charAt(0)];
    var hi = Math.max(a, b);
    var lo = Math.min(a, b);
    if (hi === lo) return clamp(0.48 + ((hi - 2) / 12) * 0.47, 0, 1);
    var suited = cards[0].charAt(1) === cards[1].charAt(1);
    var gap = hi - lo - 1;
    var score = 0.06 + ((hi - 2) / 12) * 0.34 + ((lo - 2) / 12) * 0.18;
    if (suited) score += 0.06;
    if (gap <= 0) score += 0.08;
    else if (gap === 1) score += 0.06;
    else if (gap === 2) score += 0.03;
    else if (gap >= 4) score -= 0.04;
    if (hi >= 13 && lo >= 10) score += 0.12;
    if (hi === 14 && lo >= 10) score += 0.08;
    if (hi <= 7 && gap <= 1) score += suited ? 0.035 : 0.01;
    return clamp(score, 0.04, 0.93);
  }

  function liveOpponents(observation) {
    return observation.seats.filter(function (seat) {
      return !!seat && seat.seat !== observation.heroSeat &&
        seat.inHand && !seat.folded;
    });
  }

  function remainingDeck(observation) {
    if (!Engine || typeof Engine.makeDeck !== "function") return [];
    var known = {};
    observation.heroCards.concat(observation.board).forEach(function (card) {
      known[card] = true;
    });
    return Engine.makeDeck().filter(function (card) { return !known[card]; });
  }

  function sampleCount(options) {
    var configured = options && options.simulations;
    return clamp(integer(configured, PROFILE.samples), 8, 512);
  }

  function aggressivePressure(observation) {
    var pressure = 0;
    liveOpponents(observation).forEach(function (seat) {
      if (seat.lastAction === "raise" || seat.lastAction === "allin") pressure += 1;
      else if (seat.lastAction === "bet") pressure += 0.65;
    });
    observation.history.slice(-12).forEach(function (entry) {
      if (entry.seat === observation.heroSeat) return;
      if (entry.action === "raise" || entry.action === "allin") pressure += 0.18;
      else if (entry.action === "bet") pressure += 0.1;
    });
    return Math.min(3, pressure);
  }

  function estimateEquityFromSanitized(observation, options) {
    if (!Engine || typeof Engine.evaluateSeven !== "function" ||
        typeof Engine.compareEvaluations !== "function") {
      return preflopStrength(observation.heroCards);
    }
    if (observation.heroCards.length !== 2) return 0;
    var opponents = liveOpponents(observation);
    if (!opponents.length) return 1;
    var deck = remainingDeck(observation);
    var boardMissing = 5 - observation.board.length;
    var needed = opponents.length * 2 + boardMissing;
    if (needed < 0 || deck.length < needed) return 0;

    var random = randomSource(options);
    var samples = sampleCount(options);
    var share = 0;
    for (var sample = 0; sample < samples; sample++) {
      var pool = deck.slice();
      for (var draw = 0; draw < needed; draw++) {
        var pick = draw + randomIndex(pool.length - draw, random);
        var swap = pool[draw];
        pool[draw] = pool[pick];
        pool[pick] = swap;
      }
      var cursor = 0;
      var opponentCards = [];
      for (var opponentIndex = 0; opponentIndex < opponents.length; opponentIndex++) {
        opponentCards.push([pool[cursor], pool[cursor + 1]]);
        cursor += 2;
      }
      var runout = observation.board.concat(pool.slice(cursor, cursor + boardMissing));
      var heroEvaluation = Engine.evaluateSeven(observation.heroCards.concat(runout));
      var best = heroEvaluation;
      var heroBest = true;
      var tied = 1;
      opponentCards.forEach(function (cards) {
        var evaluation = Engine.evaluateSeven(cards.concat(runout));
        var comparison = Engine.compareEvaluations(evaluation, best);
        if (comparison > 0) {
          best = evaluation;
          heroBest = false;
          tied = 1;
        } else if (comparison === 0) {
          tied += 1;
        }
      });
      if (heroBest && Engine.compareEvaluations(heroEvaluation, best) === 0) {
        share += 1 / tied;
      }
    }
    var equity = share / samples;
    equity -= Math.min(0.07, aggressivePressure(observation) * 0.018);
    return clamp(equity, 0, 1);
  }

  function estimateEquity(snapshot, options) {
    return estimateEquityFromSanitized(sanitizeObservation(snapshot), options || {});
  }

  function relativePosition(observation) {
    var active = observation.seats.filter(function (seat) {
      return !!seat && seat.inHand && !seat.folded;
    }).map(function (seat) { return seat.seat; });
    if (active.length < 2) return 0;
    active.sort(function (a, b) {
      var distanceA = (a - observation.buttonSeat + 6) % 6 || 6;
      var distanceB = (b - observation.buttonSeat + 6) % 6 || 6;
      return distanceA - distanceB;
    });
    return Math.max(0, active.indexOf(observation.heroSeat)) / Math.max(1, active.length - 1);
  }

  function boardTexture(observation) {
    var cards = observation.board;
    if (cards.length < 3) return { wet: 0, paired: false, monotone: false };
    var ranks = {};
    var suits = {};
    cards.forEach(function (card) {
      var rank = RANK_VALUE[card.charAt(0)];
      var suit = card.charAt(1);
      ranks[rank] = (ranks[rank] || 0) + 1;
      suits[suit] = (suits[suit] || 0) + 1;
    });
    var rankValues = Object.keys(ranks).map(Number).sort(function (a, b) { return a - b; });
    var close = 0;
    for (var i = 1; i < rankValues.length; i++) {
      if (rankValues[i] - rankValues[i - 1] <= 2) close += 1;
    }
    var maxSuit = Math.max.apply(null, Object.keys(suits).map(function (suit) { return suits[suit]; }));
    return {
      wet: clamp(close * 0.2 + (maxSuit >= 3 ? 0.45 : maxSuit === 2 ? 0.18 : 0), 0, 1),
      paired: Object.keys(ranks).some(function (rank) { return ranks[rank] >= 2; }),
      monotone: maxSuit >= 3
    };
  }

  function effectiveStack(observation) {
    var hero = observation.seats[observation.heroSeat];
    var heroStack = hero ? hero.stack : observation.legal.stack;
    var opponentStacks = liveOpponents(observation).map(function (seat) { return seat.stack; });
    if (!opponentStacks.length) return heroStack;
    return Math.min(heroStack, Math.max.apply(null, opponentStacks));
  }

  /*
   * A short stack cannot win contributions above its final matched amount.
   * Cap every participant's committed chips at the hero's post-call total so
   * an unrelated side pot never makes a losing call appear cheap.
   */
  function contestablePot(observation) {
    var hero = observation.seats[observation.heroSeat];
    if (!hero) return observation.pot;
    var finalContribution = hero.totalBet + observation.legal.callAmount;
    if (finalContribution <= 0) return observation.pot;
    var capped = observation.seats.reduce(function (sum, seat) {
      if (!seat || !seat.inHand) return sum;
      return sum + Math.min(seat.totalBet, finalContribution);
    }, 0);
    if (capped <= 0) return observation.pot;
    return Math.min(observation.pot, capped);
  }

  function hasAction(legal, action) {
    return legal.actions.indexOf(action) >= 0;
  }

  function safeFallback(legal) {
    if (hasAction(legal, "check")) return { action: "check" };
    if (hasAction(legal, "fold")) return { action: "fold" };
    if (hasAction(legal, "call")) return { action: "call" };
    if (hasAction(legal, "allin")) return { action: "allin" };
    return { action: legal.actions[0] || "fold" };
  }

  function aggressiveAction(observation, personality, equity, random) {
    var legal = observation.legal;
    var action = hasAction(legal, "raise") ? "raise" :
      hasAction(legal, "bet") ? "bet" : "";
    if (!action) {
      if (hasAction(legal, "allin") && equity > 0.82) return { action: "allin" };
      return null;
    }
    var minimum = action === "raise" ? legal.minRaiseTo : legal.minBet;
    var maximum = legal.maxRaiseTo;
    if (minimum == null || maximum == null || maximum < minimum) return null;

    var hero = observation.seats[observation.heroSeat];
    var matched = action === "raise"
      ? Math.max(0, hero ? hero.streetBet : legal.streetBet) + legal.callAmount
      : 0;
    var afterCallPot = Math.max(observation.bigBlind, observation.pot + legal.callAmount);
    var fractions = observation.phase === "flop"
      ? [0.33, 0.67, 1]
      : [0.5, 0.75, 1];

    var fractionIndex;
    if (equity > 0.82) fractionIndex = fractions.length - 1;
    else if (equity > 0.66) fractionIndex = Math.min(fractions.length - 1, 1);
    else fractionIndex = randomIndex(Math.max(1, fractions.length - 1), random);
    if (personality.sizeBias < 0 && fractionIndex > 0 && random() < 0.55) {
      fractionIndex -= 1;
    } else if (personality.sizeBias > 0 &&
        fractionIndex < fractions.length - 1 && random() < 0.55) {
      fractionIndex += 1;
    }
    var target = matched + Math.round(afterCallPot * fractions[fractionIndex]);
    target = Math.round(target / legal.step) * legal.step;
    target = clamp(target, minimum, maximum);
    var stack = hero ? hero.stack : legal.stack;
    var spr = stack / Math.max(1, observation.pot);
    if (hasAction(legal, "allin") &&
        (target >= maximum || (equity > 0.83 && spr <= 1.2))) {
      return { action: "allin" };
    }
    return { action: action, amount: Math.round(target / legal.step) * legal.step };
  }

  function preflopOpenThreshold(observation, personality) {
    var position = relativePosition(observation);
    return 0.59 - position * 0.17 + personality.rangeBias;
  }

  function decide(snapshot, options) {
    options = options || {};
    var profile = PROFILE;
    var observation = sanitizeObservation(snapshot);
    var personality = PERSONALITIES[observation.personality];
    var legal = observation.legal;
    if (!legal.actions.length || observation.heroCards.length !== 2) {
      return safeFallback(legal);
    }
    var random = randomSource(options);
    var opponents = liveOpponents(observation).length;
    var equity = estimateEquityFromSanitized(observation, {
      random: random,
      simulations: options.simulations
    });
    var observedEquity = equity;
    var toCall = legal.callAmount;
    var callablePot = contestablePot(observation);
    var potOdds = toCall > 0 ? toCall / Math.max(1, callablePot + toCall) : 0;
    var position = relativePosition(observation);
    var multiwayPenalty = Math.max(0, opponents - 1) * 0.012;
    var stack = effectiveStack(observation);
    var spr = stack / Math.max(1, observation.pot);
    var texture = boardTexture(observation);
    var edge = observedEquity - potOdds - multiwayPenalty;

    if (observation.phase === "preflop") {
      var openingStrength = preflopStrength(observation.heroCards);
      var openingThreshold = preflopOpenThreshold(observation, personality);
      if (toCall > observation.bigBlind) openingThreshold += 0.09;
      var insideOpeningRange = openingStrength >= openingThreshold;
      if (insideOpeningRange) {
        var preflopAggressionFrequency = clamp(
          0.72 + personality.aggressionBias,
          0.64,
          0.8
        );
        if (openingStrength >= openingThreshold + 0.08 ||
            random() < preflopAggressionFrequency) {
          var preflopAggression = aggressiveAction(
            observation,
            personality,
            observedEquity,
            random
          );
          if (preflopAggression) return preflopAggression;
        }
      }
      if (toCall === 0 && hasAction(legal, "check")) return { action: "check" };
      var preflopCallMargin = profile.callMargin + personality.rangeBias * 0.2 -
        Math.min(0.018, position * 0.014);
      if (hasAction(legal, "call") &&
          (insideOpeningRange ||
           (openingStrength >= openingThreshold - 0.05 && edge >= preflopCallMargin))) {
        return { action: "call" };
      }
      return hasAction(legal, "fold") ? { action: "fold" } : safeFallback(legal);
    }

    var valueThreshold = toCall > 0
      ? profile.valueRaiseFloor
      : profile.valueBetFloor;
    valueThreshold += multiwayPenalty * 1.5;
    valueThreshold -= position * 0.018;
    if (spr < 1.5) valueThreshold -= 0.025;
    if (texture.wet && observation.phase !== "river") valueThreshold -= 0.018;
    valueThreshold = clamp(valueThreshold, 0.5, 0.72);
    if (observedEquity >= valueThreshold) {
      var valueAggressionFrequency = clamp(
        0.83 + personality.aggressionBias,
        0.76,
        0.9
      );
      if (observedEquity >= Math.max(0.88, valueThreshold + 0.18)) {
        valueAggressionFrequency = Math.max(0.9, valueAggressionFrequency);
      }
      if (random() < valueAggressionFrequency) {
        var valueAction = aggressiveAction(observation, personality, observedEquity, random);
        if (valueAction) return valueAction;
      }
    }

    var bluffRate = profile.bluffRate * Math.pow(0.55, Math.max(0, opponents - 1));
    bluffRate *= 0.55 + position * 0.65;
    bluffRate *= personality.bluffMultiplier;
    if (texture.monotone) bluffRate *= 0.7;
    if (toCall === 0 && random() < bluffRate) {
      var bluff = aggressiveAction(observation, personality, observedEquity, random);
      if (bluff) return bluff;
    }

    if (toCall === 0 && hasAction(legal, "check")) {
      return { action: "check" };
    }

    var callMargin = profile.callMargin + personality.rangeBias * 0.2 -
      Math.min(0.025, position * 0.018 + (spr < 2 ? 0.008 : 0));
    if (edge >= callMargin && hasAction(legal, "call")) {
      return { action: "call" };
    }
    return hasAction(legal, "fold") ? { action: "fold" } : safeFallback(legal);
  }

  return {
    PROFILE: PROFILE,
    PERSONALITIES: PERSONALITIES,
    normalizePersonality: normalizePersonality,
    sanitizeObservation: sanitizeObservation,
    preflopStrength: preflopStrength,
    contestablePot: function (snapshot) {
      return contestablePot(sanitizeObservation(snapshot));
    },
    estimateEquity: estimateEquity,
    decide: decide
  };
});
