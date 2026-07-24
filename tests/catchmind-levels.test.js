"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Levels = require("../catchmind-levels.js");

test("CatchMind uses a steep permanent one-to-one-hundred XP curve", () => {
  assert.equal(Levels.MAX_LEVEL, 100);
  assert.ok(Levels.MAX_TOTAL_XP >= 850000);
  assert.ok(Levels.MAX_TOTAL_XP <= 950000);
  assert.ok(Levels.xpToNext(1) < Levels.xpToNext(25));
  assert.ok(Levels.xpToNext(25) < Levels.xpToNext(50));
  assert.ok(Levels.xpToNext(50) < Levels.xpToNext(90));
  assert.equal(Levels.xpToNext(100), 0);
  assert.equal(Levels.levelForXp(Levels.MAX_TOTAL_XP), 100);
});

test("XP progress crosses levels and stops cleanly at level one hundred", () => {
  const level25 = Levels.totalXpForLevel(25);
  const before = level25 - 20;
  const gain = Levels.progression(before, 80);

  assert.equal(gain.before.level, 24);
  assert.equal(gain.after.level, 25);
  assert.equal(gain.levelsGained, 1);
  assert.ok(gain.after.currentXp > 0);
  assert.deepEqual(gain.rewards.map((reward) => reward.id), ["frame-bamboo-garden"]);
  assert.ok(gain.rewards.every((reward) => reward.kind === Levels.REWARD_KINDS.BOARD_FRAME));

  const maxed = Levels.progression(Levels.MAX_TOTAL_XP - 10, 100);
  assert.equal(maxed.after.level, 100);
  assert.equal(maxed.after.isMax, true);
  assert.equal(maxed.appliedXp, 10);
});

test("answer speed XP decreases across the full ninety-second turn", () => {
  assert.equal(Levels.answerSpeedXp(15000), 12);
  assert.equal(Levels.answerSpeedXp(15001), 9);
  assert.equal(Levels.answerSpeedXp(30000), 9);
  assert.equal(Levels.answerSpeedXp(30001), 6);
  assert.equal(Levels.answerSpeedXp(50001), 4);
  assert.equal(Levels.answerSpeedXp(70001), 2);
  assert.equal(Levels.answerSpeedXp(90001), 0);
  assert.equal(Levels.answerSpeedXp(null), 0);
});

test("match XP contains only completion and per-answer speed XP", () => {
  const result = Levels.matchXp({
    eligibleRounds: 6,
    answerTimesMs: [14000, 27000, 48000]
  }, {
    humanPlayers: 6,
    completed: true
  });

  assert.equal(result.eligible, true);
  assert.equal(result.breakdown.completion, 15);
  assert.equal(result.breakdown.answers, 27);
  assert.equal(result.breakdown.mvp, 0);
  assert.equal(result.metrics.eligibleRounds, 6);
  assert.equal(result.metrics.correctCount, 3);
  assert.deepEqual(result.metrics.answerTimesMs, [14000, 27000, 48000]);
  assert.deepEqual(result.metrics.answerXp, [12, 9, 6]);
  assert.equal(result.metrics.mvp, false);
  assert.equal(result.total, 42);
  assert.equal(result.total, Object.values(result.breakdown).reduce((sum, value) => sum + value, 0));
});

test("answer XP is capped and MVP is a separate fixed bonus", () => {
  const base = Levels.matchXp({
    eligibleRounds: 8,
    answerTimesMs: [5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000]
  }, {
    humanPlayers: 8,
    completed: true
  });
  const winner = Levels.applyMvpBonus(base, true);
  const nonWinner = Levels.applyMvpBonus(base, false);

  assert.equal(base.breakdown.answers, 60);
  assert.equal(base.total, 75);
  assert.equal(winner.breakdown.mvp, 15);
  assert.equal(winner.total, 90);
  assert.equal(nonWinner.breakdown.mvp, 0);
  assert.equal(nonWinner.total, 75);
  assert.equal(Levels.COMPLETION_XP, 15);
  assert.equal(Levels.ANSWER_XP_CAP, 60);
  assert.equal(Levels.MVP_XP, 15);
  assert.equal(Levels.MATCH_XP_CAP, 100);
});

test("legacy score, drawing, and client MVP fields do not change base XP", () => {
  const result = {
    eligibleRounds: 6,
    answerTimesMs: [14000, 27000, 48000]
  };
  const context = { humanPlayers: 6, completed: true };
  const plain = Levels.matchXp(result, context);
  const inflated = Levels.matchXp({
    ...result,
    points: 999999,
    maxPoints: 1,
    correct: 99,
    drawCorrect: 99,
    mvp: true
  }, context);

  assert.equal(plain.total, inflated.total);
  assert.deepEqual(plain.breakdown, inflated.breakdown);
});

test("practice, solo, preview, and inactive matches never award XP", () => {
  const active = { eligibleRounds: 4, answerTimesMs: [12000] };
  assert.equal(Levels.matchXp(active, { humanPlayers: 1 }).total, 0);
  assert.equal(Levels.matchXp(active, { humanPlayers: 2, practice: true }).total, 0);
  assert.equal(Levels.matchXp(active, { humanPlayers: 2, preview: true }).total, 0);
  assert.equal(Levels.matchXp(active, { humanPlayers: 2 }).total, 0);
  assert.equal(Levels.matchXp({ eligibleRounds: 1 }, { humanPlayers: 2, completed: true }).total, 0);
  assert.equal(Levels.matchXp({ eligibleRounds: 0 }, { humanPlayers: 8 }).total, 0);
});

test("every level has a reward slot while undecided rewards remain planned", () => {
  const slots = Levels.rewardSlots();
  assert.equal(slots.length, 99);
  assert.equal(slots[0].level, 2);
  assert.equal(slots.at(-1).level, 100);
  assert.ok(slots.some((slot) => slot.planned));
  assert.deepEqual(Levels.rewardsAtLevel(100).map((reward) => reward.id), ["frame-pastel-carnival"]);
});

test("board frame rewards preserve the preview order and split low from high levels", () => {
  const expected = [
    ["frame-color-pencil", 5, "assets/catchmind/board-frames/frame-color-pencil-v2.png", "low"],
    ["frame-galaxy-stars", 10, "assets/catchmind/board-frames/frame-galaxy-stars.png", "low"],
    ["frame-retro-pixel", 15, "assets/catchmind/board-frames/frame-retro-pixel.png", "low"],
    ["frame-cherry-blossom", 20, "assets/catchmind/board-frames/frame-cherry-blossom.png", "low"],
    ["frame-bamboo-garden", 25, "assets/catchmind/board-frames/frame-bamboo-garden.png", "low"],
    ["frame-dancheong", 30, "assets/catchmind/board-frames/frame-dancheong.png", "low"],
    ["frame-ice-crystal", 35, "assets/catchmind/board-frames/frame-ice-crystal.png", "low"],
    ["frame-cookie-sprinkle", 40, "assets/catchmind/board-frames/frame-cookie-sprinkle.png", "low"],
    ["frame-aurora-ribbon", 50, "assets/catchmind/board-frames/frame-aurora-ribbon.png", "high"],
    ["frame-prism-glass", 55, "assets/catchmind/board-frames/frame-prism-glass.png", "high"],
    ["frame-rainbow-hologram", 60, "assets/catchmind/board-frames/frame-rainbow-hologram.png", "high"],
    ["frame-magic-palette", 65, "assets/catchmind/board-frames/frame-magic-palette.png", "high"],
    ["frame-golden-doodle", 70, "assets/catchmind/board-frames/frame-golden-doodle.png", "high"],
    ["frame-masterpiece", 75, "assets/catchmind/board-frames/frame-masterpiece.png", "high"],
    ["frame-starlight-cloud", 80, "assets/catchmind/board-frames/frame-starlight-cloud.png", "high"],
    ["frame-celebration-ribbon", 85, "assets/catchmind/board-frames/frame-celebration-ribbon.png", "high"],
    ["frame-gem-candy", 90, "assets/catchmind/board-frames/frame-gem-candy.png", "high"],
    ["frame-pastel-carnival", 100, "assets/catchmind/board-frames/frame-pastel-carnival.png", "high"]
  ];
  const frames = Levels.REWARD_CATALOG
    .filter((reward) => reward.kind === Levels.REWARD_KINDS.BOARD_FRAME)
    .sort((a, b) => a.order - b.order);

  assert.deepEqual(Object.keys(Levels.REWARD_KINDS), ["BOARD_FRAME"]);
  assert.equal(Levels.REWARD_CATALOG.length, 18);
  assert.ok(Levels.REWARD_CATALOG.every((reward) => reward.kind === Levels.REWARD_KINDS.BOARD_FRAME));
  assert.equal(frames.length, 18);
  assert.deepEqual(
    frames.map((reward) => [reward.id, reward.level, reward.asset, reward.tier]),
    expected
  );
  assert.deepEqual(frames.map((reward) => reward.order), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.ok(frames.slice(0, 8).every((reward) => reward.tier === "low" && reward.level <= 40));
  assert.ok(frames.slice(8).every((reward) => reward.tier === "high" && reward.level >= 50));
  frames.forEach((reward) => {
    assert.equal(fs.existsSync(path.join(__dirname, "..", reward.asset)), true, reward.asset);
  });
});

test("nameplate tiers cover every level without gaps", () => {
  for (let level = 1; level <= 100; level++) {
    const tier = Levels.tierForLevel(level);
    assert.ok(level >= tier.min && level <= tier.max);
  }
  assert.equal(Levels.tierForLevel(1).id, "sketch");
  assert.equal(Levels.tierForLevel(50).id, "artist");
  assert.equal(Levels.tierForLevel(100).id, "legend");
});
