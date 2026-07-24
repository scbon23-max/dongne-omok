(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CatchMindLevels = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var MAX_LEVEL = 100;
  var CURVE_VERSION = 1;
  var MATCH_XP_CAP = 100;
  var COMPLETION_XP = 15;
  var ANSWER_XP_CAP = 60;
  var MVP_XP = 15;

  var TIERS = [
    { id: "sketch", label: "스케치", min: 1, max: 9 },
    { id: "sprout", label: "새싹", min: 10, max: 24 },
    { id: "color", label: "컬러", min: 25, max: 49 },
    { id: "artist", label: "작가", min: 50, max: 74 },
    { id: "master", label: "명장", min: 75, max: 89 },
    { id: "grand", label: "거장", min: 90, max: 99 },
    { id: "legend", label: "레전드", min: 100, max: 100 }
  ];

  var REWARD_KINDS = {
    BOARD_FRAME: "board_frame",
    STICKER: "sticker",
    TEXT_EMOTE: "text_emote",
    NAMEPLATE: "nameplate",
    BUNDLE: "bundle"
  };

  // The catalog is intentionally sparse while art direction is undecided.
  // Every level has a slot in the database; these milestones are starter content.
  var REWARD_CATALOG = [
    { id: "sticker-pencil", level: 2, kind: REWARD_KINDS.STICKER, name: "연필 반짝 스티커" },
    { id: "emote-nice-drawing", level: 5, kind: REWARD_KINDS.TEXT_EMOTE, name: "그림 좋다! 이모티콘" },
    { id: "nameplate-sprout", level: 10, kind: REWARD_KINDS.NAMEPLATE, name: "새싹 닉네임 박스" },
    { id: "sticker-paint-drop", level: 15, kind: REWARD_KINDS.STICKER, name: "물감 방울 스티커" },
    { id: "frame-blue-pencil", level: 20, kind: REWARD_KINDS.BOARD_FRAME, name: "파란 연필 그림판 테두리" },
    { id: "nameplate-color", level: 25, kind: REWARD_KINDS.NAMEPLATE, name: "컬러 닉네임 박스" },
    { id: "emote-got-it", level: 30, kind: REWARD_KINDS.TEXT_EMOTE, name: "알겠다! 이모티콘" },
    { id: "frame-color-pencil", level: 40, kind: REWARD_KINDS.BOARD_FRAME, name: "색연필 그림판 테두리" },
    { id: "nameplate-artist", level: 50, kind: REWARD_KINDS.NAMEPLATE, name: "작가 닉네임 박스" },
    { id: "sticker-crown-brush", level: 60, kind: REWARD_KINDS.STICKER, name: "왕관 붓 스티커" },
    { id: "nameplate-master", level: 75, kind: REWARD_KINDS.NAMEPLATE, name: "명장 닉네임 박스" },
    { id: "frame-master", level: 80, kind: REWARD_KINDS.BOARD_FRAME, name: "명장 그림판 테두리" },
    { id: "nameplate-grand", level: 90, kind: REWARD_KINDS.NAMEPLATE, name: "거장 닉네임 박스" },
    { id: "sticker-firework", level: 95, kind: REWARD_KINDS.STICKER, name: "불꽃 스티커" },
    { id: "legend-bundle", level: 100, kind: REWARD_KINDS.BUNDLE, name: "레전드 전용 꾸미기 세트" }
  ];

  function clamp(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
  }

  function integer(value, min, max) {
    return Math.floor(clamp(value, min, max));
  }

  function xpToNext(level) {
    level = integer(level, 1, MAX_LEVEL);
    if (level >= MAX_LEVEL) return 0;
    var raw = 60 + 18 * level + 2.4 * level * level;
    return Math.round(raw / 5) * 5;
  }

  var LEVEL_START_XP = [0, 0];
  for (var level = 1; level < MAX_LEVEL; level++) {
    LEVEL_START_XP[level + 1] = LEVEL_START_XP[level] + xpToNext(level);
  }
  var MAX_TOTAL_XP = LEVEL_START_XP[MAX_LEVEL];

  function totalXpForLevel(level) {
    return LEVEL_START_XP[integer(level, 1, MAX_LEVEL)];
  }

  function levelForXp(totalXp) {
    totalXp = integer(totalXp, 0, MAX_TOTAL_XP);
    var low = 1;
    var high = MAX_LEVEL;
    while (low < high) {
      var mid = Math.ceil((low + high) / 2);
      if (LEVEL_START_XP[mid] <= totalXp) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  function progressForXp(totalXp) {
    totalXp = integer(totalXp, 0, MAX_TOTAL_XP);
    var level = levelForXp(totalXp);
    var startXp = LEVEL_START_XP[level];
    var isMax = level >= MAX_LEVEL;
    var needed = isMax ? 0 : xpToNext(level);
    var current = isMax ? 0 : totalXp - startXp;
    return {
      level: level,
      totalXp: totalXp,
      currentXp: current,
      neededXp: needed,
      ratio: isMax ? 1 : clamp(current / needed, 0, 1),
      isMax: isMax,
      tier: tierForLevel(level)
    };
  }

  function tierForLevel(level) {
    level = integer(level, 1, MAX_LEVEL);
    for (var i = 0; i < TIERS.length; i++) {
      if (level >= TIERS[i].min && level <= TIERS[i].max) return Object.assign({}, TIERS[i]);
    }
    return Object.assign({}, TIERS[0]);
  }

  function rewardsAtLevel(level) {
    level = integer(level, 1, MAX_LEVEL);
    return REWARD_CATALOG.filter(function (reward) {
      return reward.level === level;
    }).map(function (reward) {
      return Object.assign({}, reward);
    });
  }

  function unlockedRewards(level) {
    level = integer(level, 1, MAX_LEVEL);
    return REWARD_CATALOG.filter(function (reward) {
      return reward.level <= level;
    }).map(function (reward) {
      return Object.assign({}, reward);
    });
  }

  function rewardSlots() {
    var byLevel = Object.create(null);
    REWARD_CATALOG.forEach(function (reward) {
      if (!byLevel[reward.level]) byLevel[reward.level] = [];
      byLevel[reward.level].push(Object.assign({}, reward));
    });
    var slots = [];
    for (var level = 2; level <= MAX_LEVEL; level++) {
      slots.push({
        level: level,
        rewards: byLevel[level] || [],
        planned: !byLevel[level]
      });
    }
    return slots;
  }

  function answerSpeedXp(answerMs) {
    if (answerMs == null || !isFinite(Number(answerMs))) return 0;
    answerMs = Math.max(0, Number(answerMs));
    if (answerMs <= 15000) return 12;
    if (answerMs <= 30000) return 9;
    if (answerMs <= 50000) return 6;
    if (answerMs <= 70000) return 4;
    if (answerMs <= 90000) return 2;
    return 0;
  }

  function answerTimes(value, limit) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, limit).map(function (time) {
      return Number(time);
    }).filter(function (time) {
      return isFinite(time) && time >= 0 && time <= 90000;
    }).map(function (time) {
      return Math.round(time);
    });
  }

  function matchXp(result, context) {
    result = result && typeof result === "object" ? result : {};
    context = context && typeof context === "object" ? context : {};
    var humanPlayers = integer(context.humanPlayers, 0, 8);
    var eligibleRounds = integer(
      result.eligibleRounds == null ? context.roundsPlayed : result.eligibleRounds,
      0,
      40
    );
    var eligible = context.completed === true
      && context.practice !== true
      && context.preview !== true
      && humanPlayers >= 2
      && eligibleRounds >= 2;
    if (!eligible) {
      return {
        eligible: false,
        total: 0,
        cap: MATCH_XP_CAP,
        breakdown: {
          completion: 0,
          answers: 0,
          mvp: 0
        },
        metrics: {
          eligibleRounds: eligibleRounds,
          answerTimesMs: [],
          answerXp: [],
          correctCount: 0,
          mvp: false
        }
      };
    }

    var times = answerTimes(result.answerTimesMs, Math.max(1, eligibleRounds));
    var answerXp = times.map(answerSpeedXp);
    var answerTotal = Math.min(ANSWER_XP_CAP, answerXp.reduce(function (sum, xp) {
      return sum + xp;
    }, 0));
    var breakdown = {
      completion: COMPLETION_XP,
      answers: answerTotal,
      mvp: 0
    };
    var raw = breakdown.completion + breakdown.answers;
    return {
      eligible: true,
      total: Math.min(MATCH_XP_CAP, raw),
      raw: raw,
      cap: MATCH_XP_CAP,
      breakdown: breakdown,
      metrics: {
        eligibleRounds: eligibleRounds,
        answerTimesMs: times,
        answerXp: answerXp,
        correctCount: times.length,
        mvp: false
      }
    };
  }

  function applyMvpBonus(award, wonMvp) {
    award = award && typeof award === "object" ? award : {};
    var breakdown = Object.assign({ completion: 0, answers: 0, mvp: 0 }, award.breakdown);
    breakdown.mvp = wonMvp === true ? MVP_XP : 0;
    var total = Math.min(MATCH_XP_CAP, breakdown.completion + breakdown.answers + breakdown.mvp);
    return Object.assign({}, award, {
      total: total,
      raw: breakdown.completion + breakdown.answers + breakdown.mvp,
      breakdown: breakdown,
      metrics: Object.assign({}, award.metrics, { mvp: wonMvp === true })
    });
  }

  function progression(beforeXp, earnedXp) {
    beforeXp = integer(beforeXp, 0, MAX_TOTAL_XP);
    earnedXp = integer(earnedXp, 0, MATCH_XP_CAP);
    var afterXp = Math.min(MAX_TOTAL_XP, beforeXp + earnedXp);
    var before = progressForXp(beforeXp);
    var after = progressForXp(afterXp);
    var rewards = [];
    for (var level = before.level + 1; level <= after.level; level++) {
      rewards = rewards.concat(rewardsAtLevel(level));
    }
    return {
      before: before,
      after: after,
      requestedXp: earnedXp,
      appliedXp: afterXp - beforeXp,
      levelsGained: after.level - before.level,
      rewards: rewards
    };
  }

  function formatXp(value) {
    return Math.max(0, Math.round(Number(value) || 0)).toLocaleString("ko-KR");
  }

  return {
    MAX_LEVEL: MAX_LEVEL,
    MAX_TOTAL_XP: MAX_TOTAL_XP,
    MATCH_XP_CAP: MATCH_XP_CAP,
    COMPLETION_XP: COMPLETION_XP,
    ANSWER_XP_CAP: ANSWER_XP_CAP,
    MVP_XP: MVP_XP,
    CURVE_VERSION: CURVE_VERSION,
    TIERS: TIERS.map(function (tier) { return Object.assign({}, tier); }),
    REWARD_KINDS: Object.assign({}, REWARD_KINDS),
    REWARD_CATALOG: REWARD_CATALOG.map(function (reward) { return Object.assign({}, reward); }),
    xpToNext: xpToNext,
    totalXpForLevel: totalXpForLevel,
    levelForXp: levelForXp,
    progressForXp: progressForXp,
    tierForLevel: tierForLevel,
    rewardsAtLevel: rewardsAtLevel,
    unlockedRewards: unlockedRewards,
    rewardSlots: rewardSlots,
    answerSpeedXp: answerSpeedXp,
    matchXp: matchXp,
    applyMvpBonus: applyMvpBonus,
    progression: progression,
    formatXp: formatXp
  };
});
