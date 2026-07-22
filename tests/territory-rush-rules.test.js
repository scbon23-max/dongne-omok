"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "territory-rush.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function sectionById(id) {
  const match = index.match(new RegExp('<section\\b[^>]*id="' + id + '"[\\s\\S]*?<\\/section>'));
  assert.ok(match, id + " section should exist");
  return match[0];
}

function openingTagById(markup, id) {
  const match = markup.match(new RegExp('<[^>]+id="' + id + '"[^>]*>'));
  assert.ok(match, id + " should exist");
  return match[0];
}

function textFromHtml(html) {
  return String(html || "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&(?:l|g)t;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadController() {
  const windowObject = { __TERRITORY_RUSH_TEST__: true };
  vm.runInNewContext(source, {
    window: windowObject,
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout
  }, { filename: "territory-rush.js" });
  return windowObject.TerritoryRush;
}

test("waiting and result screens both expose an accessible rules button", () => {
  const cases = [
    ["territory-lobby", "territory-lobby-rules-btn"],
    ["territory-finished", "territory-finished-rules-btn"]
  ];

  for (const [sectionId, buttonId] of cases) {
    const button = openingTagById(sectionById(sectionId), buttonId);
    assert.match(button, /\btype="button"/);
    assert.match(button, /\baria-label="[^"]*규칙[^"]*"/);
  }
});

test("both screen-level rules buttons open the shared controller rules", () => {
  const bindSource = source.match(/function bindDom\(\) \{([\s\S]*?)\n  \}\n\n  function startLoops/);
  assert.ok(bindSource, "bindDom should remain inspectable");
  assert.match(bindSource[1], /territory-lobby-rules-btn/);
  assert.match(bindSource[1], /territory-finished-rules-btn/);
  assert.match(bindSource[1], /api\s*&&\s*api\.openRules|api\.openRules\s*&&\s*api\.openRules\(\)|api\.openRules\(\)/);
});

test("rules teach the goal, capture loop, and movement-line danger in plain language", () => {
  const content = loadController().rules();
  const text = textFromHtml(content.html);

  assert.equal(content.title, "땅따먹기 규칙");
  assert.match(content.html, /class="territory-rules"/);
  assert.ok((content.html.match(/class="territory-rule-card\b/g) || []).length >= 3);

  assert.match(text, /내 땅 밖/);
  assert.match(text, /(?:다시 )?내 땅(?:으로 돌아오|에 닿으)면/);
  assert.match(text, /영역/);
  assert.match(text, /이동선/);
  assert.match(text, /캐릭터 뒤에 (?:생기는|이어지는) (?:색 )?선/);
  assert.match(text, /(?:이동선|색 선)[^.。]*상대가[^.。]*(?:닿|건드|밟)/);
  assert.match(text, /90초/);
  assert.match(text, /(?:땅|영역)[^.。]*(?:가장|제일)[^.。]*(?:넓|높)[^.。]*(?:이깁|승리)/);

  // The arena edge is now a solid wall, so the old explanation that leaving it
  // causes a death/respawn would teach a behavior that no longer exists.
  assert.doesNotMatch(text, /경기장 밖[^.。]*(?:다시 출발|죽|탈락)/);
});

test("each illustrated rule is decorative to assistive technology", () => {
  const html = loadController().rules().html;
  const svgs = Array.from(html.matchAll(/<svg\b[^>]*>/g), (match) => match[0]);

  assert.ok(svgs.length >= 3, "each core rule step should have an illustration");
  for (const svg of svgs) {
    assert.match(svg, /\baria-hidden="true"/);
    assert.match(svg, /\bfocusable="false"/);
  }
});

test("the shared rules modal is labelled, dismissible, and scrollable on mobile", () => {
  const modal = index.match(/<div\b[^>]*id="rules-modal"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(modal, "rules modal should exist");
  const dialog = modal[0].match(/<[^>]+\brole="dialog"[^>]*>/);
  assert.ok(dialog, "rules modal needs dialog semantics");
  assert.match(dialog[0], /\baria-modal="true"/);
  assert.match(dialog[0], /\baria-labelledby="rules-title"/);

  const close = modal[0].match(/<button\b[^>]*class="[^"]*modal-close[^"]*"[^>]*>/);
  assert.ok(close, "rules modal needs a close control");
  assert.match(close[0], /\btype="button"/);
  assert.match(close[0], /\baria-label="[^"]+"/);

  assert.match(styles, /\.modal\s*\{[^}]*max-height:\s*86dvh;[^}]*overflow-y:\s*auto;/);
});
