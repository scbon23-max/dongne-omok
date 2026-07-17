"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");

test("the Pro difficulty routes only its moves through Rapfi", () => {
  assert.match(index, /class="lvbtn pro" data-ai="god">프로<\/button>/);
  assert.match(styles, /\.lvbtn\.pro \{[^}]*grid-column: 1 \/ -1/);
  assert.match(game, /level === "god" \? "rapfi" : "classic"/);
  assert.match(game, /rapfi-worker\.js\?v=rapfi-3aedf3a-pro-v2-20260717/);
  assert.match(game, /if \(omokAI\.level === "god"\) \{[\s\S]*?omokAI\.level = "master";[\s\S]*?G\.aiLevel = "master";/);
  assert.match(game, /finishWithFallback\(\)/);
  assert.doesNotMatch(game, /OmokAI\.bestMove\(G\.board/);
  assert.match(game, /프로 AI 오류로 초고수로 전환했어요/);
  assert.match(game, /history: G\.history \|\| \[\]/);
  assert.match(game, /lv === "god" \? "프로"/);
  assert.match(game, /showProLoadProgress\(0, "download"\);\s*worker\.postMessage\(\{ type: "init" \}\);/);
  assert.match(game, /if \(data\.type === "progress"\) \{\s*showProLoadProgress\(data\.percent, data\.phase\)/);
  assert.match(game, /"ai-cancel"\)\.addEventListener\("click", function \(\) \{ cancelAiSearch\(\)/);
});

test("every Pro game explains the timer-strength relationship in room chat", () => {
  assert.match(game, /if \(level === "god"\) \{[\s\S]*?현재 설정: " \+ timerLabel/);
  assert.match(game, /addChatTo\("omok", "__sys", "프로는 30초→1분→2분 순으로 시간이 길수록 더 깊게 분석해 난이도가 올라갑니다\. 무한은 깊이 12 완주 방식입니다\./);
});

test("the pinned Rapfi artifacts and redistribution notices are present", () => {
  const expected = {
    "rapfi-single-simd128.js": "c91f973304a28aeca7c5487debe468ced0990174d2ef5631f6ed0c349593c8c9",
    "rapfi-single-simd128.wasm": "c70d440224d5c97740ee5bb34baef4bd337aca76d9c6085b1ab8c6bc9e1a7e2a",
    "rapfi-single-simd128.data": "cb62b37736c8aa449fe6990afbb194739c077b260276f0cfb1036551582af1d6"
  };
  for (const [name, digest] of Object.entries(expected)) {
    const content = fs.readFileSync(path.join(root, "assets", "rapfi", name));
    assert.equal(crypto.createHash("sha256").update(content).digest("hex"), digest);
  }
  assert.ok(fs.existsSync(path.join(root, "third_party", "rapfi", "COPYING.txt")));
  assert.ok(fs.existsSync(path.join(root, "third_party", "rapfi", "NETWORKS-LICENSE.txt")));
  const source = fs.readFileSync(path.join(root, "third_party", "rapfi", "SOURCE.md"), "utf8");
  assert.match(source, /3aedf3a2ab0ab710a9f3d00e57d5287ceb864894/);
  assert.match(source, /918b757a129258e9e765f77fe17d507c2bb1a60b/);
});
