"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadWordList() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, "catchmind-words.js"), "utf8"),
    context,
    { filename: "catchmind-words.js" }
  );
  return Array.from(context.window.CATCHMIND_WORDS || []);
}

function loadBuilderWords() {
  const builder = fs.readFileSync(
    path.join(root, "tools", "build-catchmind-wordlist.mjs"),
    "utf8"
  );
  const seen = new Set();
  const words = [];

  for (const match of builder.matchAll(/name:\s*"[^"]+",\s*words:\s*`([\s\S]*?)`/g)) {
    for (const word of match[1].trim().split(/\s+/)) {
      if (!seen.has(word)) {
        seen.add(word);
        words.push(word);
      }
    }
  }

  return words;
}

test("curated CatchMind words are unique, valid, and mirrored in the text file", () => {
  const words = loadWordList();
  const textWords = fs.readFileSync(path.join(root, "catchmind-words.txt"), "utf8").trim().split(/\r?\n/);
  const builderWords = loadBuilderWords();

  assert.ok(words.length >= 3000, `expected at least 3000 words, got ${words.length}`);
  assert.equal(new Set(words).size, words.length);
  assert.ok(words.every(word => /^[가-힣]{1,10}$/.test(word)));
  assert.deepEqual(words, textWords);
  assert.deepEqual(words, builderWords);
});

test("the word list does not restore generated compound noise", () => {
  const words = new Set(loadWordList());
  const rejected = [
    "표범쿠키",
    "표범열쇠고리",
    "감자스테이크",
    "교실전화기",
    "고양이스티커",
    "바나나가방",
    "회전놀이기구",
    "일시정지버튼",
    "철제상자",
    "건강검진표"
  ];

  for (const word of rejected) {
    assert.equal(words.has(word), false, `generated compound returned: ${word}`);
  }

  const builder = fs.readFileSync(path.join(root, "tools", "build-catchmind-wordlist.mjs"), "utf8");
  assert.doesNotMatch(builder, /\bcombine\s*\(/);
});

test("the word list retains a broad set of easy drawing prompts", () => {
  const words = new Set(loadWordList());
  const essentials = [
    "강아지", "고양이", "사과", "김밥", "냉장고", "연필",
    "축구공", "자동차", "소방관", "무지개", "생일", "로봇"
  ];

  for (const word of essentials) {
    assert.equal(words.has(word), true, `missing essential word: ${word}`);
  }
});
