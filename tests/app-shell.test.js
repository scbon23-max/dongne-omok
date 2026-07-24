"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");
const net = fs.readFileSync(path.join(root, "net.js"), "utf8");
const alkkagi = fs.readFileSync(path.join(root, "alkkagi.js"), "utf8");
const catchmind = fs.readFileSync(path.join(root, "catchmind.js"), "utf8");
const catchmindLevelMockup = fs.readFileSync(path.join(root, "catchmind-level-system-mockup.html"), "utf8");
const relayDrawing = fs.readFileSync(path.join(root, "relay-drawing.js"), "utf8");
const territoryRush = fs.readFileSync(path.join(root, "territory-rush.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const inlineScripts = Array.from(index.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1]);
const shellSource = inlineScripts.find((source) => source.includes("window.AppShell ="));
const loaderSource = inlineScripts.find((source) => source.includes("var files = ["));

test("the app shell versions every local runtime asset from one build", () => {
  assert.match(index, /<meta name="app-build" content="[^"]+">/);
  assert.match(index, /Date\.parse\(document\.lastModified\)/);
  assert.match(index, /window\.AppShell = \{ build: build, assetUrl: assetUrl, refresh: refresh \}/);
  assert.match(index, /style\.href = assetUrl\("styles\.css"\)/);

  const files = [
    "config.js",
    "sb.js",
    "db.js",
    "renju.js",
    "pro-hint-explain.js",
    "omok-ai.js",
    "omok-ai-v2.js",
    "net.js",
    "alkkagi-maps.js",
    "alkkagi.js",
    "game-catalog.js",
    "catchmind-words.js",
    "catchmind-levels.js",
    "catchmind.js",
    "relay-drawing.js",
    "territory-rush.js",
    "game.js"
  ];
  for (const file of files) assert.match(index, new RegExp('\\{ src: "' + file.replace(".", "\\.") + '" \\}'));

  assert.match(index, /script\.src = file\.external \? file\.src : shell\.assetUrl\(file\.src\)/);
  assert.doesNotMatch(index, /<script src="(?!https:\/\/)[^"]+\.js/);
  assert.ok(index.indexOf('{ src: "catchmind-levels.js" }') < index.indexOf('{ src: "catchmind.js" }'));
});

test("the app shell loads local scripts sequentially with the same revision", () => {
  const styles = [];
  const scripts = [];
  const values = new Map();
  const lastModified = "07/16/2026 21:50:58";
  const document = {
    lastModified,
    querySelector() { return { content: "test-build" }; },
    createElement(tagName) { return { tagName }; },
    head: { appendChild(node) { styles.push(node); } },
    body: { appendChild(node) { scripts.push(node); } }
  };
  const window = {
    location: {
      href: "https://example.test/",
      replace(value) { this.replaced = value; },
      reload() { this.reloaded = true; }
    }
  };
  const context = {
    window,
    document,
    sessionStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); }
    },
    URL,
    console,
    encodeURIComponent
  };

  vm.runInNewContext(shellSource, context);
  vm.runInNewContext(loaderSource, context);

  const version = "test-build-" + Date.parse(lastModified);
  assert.equal(styles[0].href, "styles.css?v=" + encodeURIComponent(version));
  assert.equal(scripts[0].src, "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");

  while (scripts.length < 18) scripts[scripts.length - 1].onload();
  assert.equal(scripts[1].src, "config.js?v=" + encodeURIComponent(version));
  assert.equal(scripts[5].src, "pro-hint-explain.js?v=" + encodeURIComponent(version));
  assert.equal(scripts[13].src, "catchmind-levels.js?v=" + encodeURIComponent(version));
  assert.equal(scripts[15].src, "relay-drawing.js?v=" + encodeURIComponent(version));
  assert.equal(scripts[16].src, "territory-rush.js?v=" + encodeURIComponent(version));
  assert.equal(scripts[17].src, "game.js?v=" + encodeURIComponent(version));
});

test("room entry is not blocked by an HTML and JavaScript build label mismatch", () => {
  assert.doesNotMatch(game, /shell\.content\s*!==/);
  assert.doesNotMatch(game, /var APP_BUILD\s*=/);
  assert.match(game, /url\.searchParams\.set\("app_refresh", String\(now\)\)/);
});

test("late-loaded game code still binds the interface", () => {
  assert.match(game, /if \(document\.readyState === "loading"\) document\.addEventListener\("DOMContentLoaded", bind\);\s*else bind\(\);/);
});

test("CatchMind keeps its level flow while the retired ranking UI stays removed", () => {
  assert.doesNotMatch(index, /id="catch-rank-btn"/);
  assert.doesNotMatch(index, /id="catch-result-backdrop"/);
  assert.doesNotMatch(index, /id="catch-result-open-btn"/);
  assert.match(index, /id="catch-ready-btn"/);
  assert.match(index, /id="catch-stage-marks"/);
  assert.match(index, /id="catch-lobby-roles"/);
  assert.match(index, /id="catch-round-highlights"/);
  assert.match(index, /id="catch-highlight-fast-value"/);
  assert.match(index, /id="catch-level-mvp-backdrop"/);
  assert.match(index, /id="catch-level-xp-backdrop"/);
  assert.match(index, /\{ src: "catchmind-levels\.js" \}/);
  assert.doesNotMatch(catchmind, /api\.recordMatch|api\.resultSummary|syncResultPopup/);
  assert.match(catchmind, /<h3>3\. 경험치와 레벨<\/h3>/);
  assert.doesNotMatch(catchmind, /<h3>3\. 시즌 랭킹 점수<\/h3>/);
});

test("CatchMind ships the balanced looping match audio asset", () => {
  const asset = path.join(root, "assets", "catchmind-start.mp3");
  assert.equal(fs.existsSync(asset), true);
  assert.ok(fs.statSync(asset).size > 100000);
  assert.match(catchmind, /START_SFX_SRC = "assets\/catchmind-start\.mp3"/);
  assert.match(catchmind, /START_SFX_VOLUME = 1/);
  assert.match(catchmind, /startSfxEl\.loop = true/);
  assert.match(catchmind, /if \(!isMatchPlaying\(\)\) { stopStartSfx\(true\); return; }/);
});

test("CatchMind ships the per-second countdown sound asset", () => {
  const asset = path.join(root, "assets", "catchmind-countdown.wav");
  assert.equal(fs.existsSync(asset), true);
  assert.ok(fs.statSync(asset).size > 50000);
  assert.match(catchmind, /COUNTDOWN_SFX_SRC = "assets\/catchmind-countdown\.wav"/);
  assert.match(catchmind, /ROUND_COUNTDOWN_MS = 5000/);
  assert.match(catchmind, /var count = clamp\(Math\.ceil\(\(state\.deadline - Date\.now\(\)\) \/ 1000\), 1, Math\.ceil\(ROUND_COUNTDOWN_MS \/ 1000\)\)/);
});

test("CatchMind uses only the requested six reactions in one row", () => {
  const row = index.match(/<div id="catch-emoji-row"[\s\S]*?<\/div>/);
  assert.ok(row);
  const emojis = Array.from(row[0].matchAll(/data-catch-emoji="([^"]+)"/g), (match) => match[1]);

  assert.deepEqual(emojis, ["❓", "‼️", "🤣", "👍🏻", "⌛", "❤️"]);
  assert.match(catchmind, /var REACTION_EMOJIS = \["❓", "‼️", "🤣", "👍🏻", "⌛", "❤️"\];/);
  assert.match(styles, /\.catch-emoji-row \{[\s\S]*?grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
});

test("CatchMind countdown ships its simple bright progress treatment", () => {
  assert.match(index, /id="catch-countdown-copy"/);
  assert.match(index, /id="catch-countdown-steps"/);
  assert.doesNotMatch(index, /id="catch-round-label"|class="catch-statusbar"/);
  assert.doesNotMatch(styles, /\.catch-round-label|\.catch-statusbar/);
  assert.match(styles, /\.action-row\.slim\.catch-action-row\s*\{[^}]*order:\s*0/);
  assert.match(catchmind, /kicker\.textContent = \(state\.roundIndex \+ 1\) \+ "\/" \+ state\.queue\.length/);
  assert.match(styles, /\.catch-stage\.countdown\s*\{[^}]*background:\s*#fff/);
  assert.match(styles, /\.catch-countdown-steps span\.active\s*\{[^}]*background:\s*var\(--orange\)/);
  assert.doesNotMatch(styles, /\.catch-stage\.countdown::before/);
});

test("CatchMind prevents iPad drawing gestures from selecting the page", () => {
  assert.match(styles, /\.game-screen\.catch-screen,\s*\.game-screen\.catch-screen \*\s*\{[^}]*-webkit-user-select:\s*none;[^}]*user-select:\s*none;[^}]*-webkit-touch-callout:\s*none;/);
  assert.match(styles, /\.game-screen\.catch-screen input,\s*\.game-screen\.catch-screen textarea\s*\{[^}]*-webkit-user-select:\s*text;[^}]*user-select:\s*text;/);
  assert.match(styles, /#catch-board\s*\{[^}]*touch-action:\s*none;[^}]*-webkit-user-drag:\s*none;/);
});

test("CatchMind exposes every live UI state only through the authenticated admin preview", () => {
  for (const phase of [
    "waiting", "countdown", "drawing", "guessing", "solved", "paused",
    "reveal-success", "reveal-timeout", "finished", "level-plates",
    "mvp-vote", "xp-result", "xp-mvp", "xp-levelup"
  ]) {
    assert.match(index, new RegExp('<option value="' + phase + '">'));
  }
  assert.match(index, /id="catch-preview-toolbar"/);
  assert.match(index, /id="catch-preview-menu-btn" class="menu-item admin-only"/);
  assert.match(index, /data-catch-preview-viewport="desktop"/);
  assert.match(index, /data-catch-preview-viewport="mobile"/);
  assert.match(index, /id="catch-preview-skins"[^>]*>배경 18종<\/button>/);
  assert.match(game, /var catchPreviewPhases = \[[\s\S]*"reveal-success"[\s\S]*"level-plates"/);
  assert.doesNotMatch(game.match(/var catchPreviewPhases = \[[\s\S]*?\];/)[0], /"result"/);
  assert.match(game, /params\.has\("catch-preview"\)/);
  assert.match(game, /if \(!phase \|\| !isGunaAdmin\(\) \|\| !window\.CatchMind \|\| !CatchMind\.enterPreview/);
  assert.match(game, /if \(startCatchmindUiPreview\(\) \|\| startRelayUiPreview\(\)\)/);
  assert.match(game, /CatchMind\.enterPreview\(previewApi, phase\)/);
  assert.match(game, /\$\("catch-preview-skins"\)\.addEventListener\("click", openCatchBoardFramePicker\)/);
  const previewBlock = game.slice(
    game.indexOf("function startCatchmindUiPreview"),
    game.indexOf("var relayPreviewPhases")
  );
  assert.doesNotMatch(previewBlock, /Db\.saveCatchmindDrawing|Db\.toggleCatchmindFavorite/);
  assert.doesNotMatch(previewBlock, /recordMatch|resultSummary|scoresChanged/);
  assert.match(catchmind, /enterPreview:\s*enterPreview/);
  assert.match(catchmind, /setPreviewPhase:\s*setPreviewPhase/);
  assert.match(styles, /body\.catch-preview-mobile #catchgame/);
  assert.match(index, /id="catch-level-mvp-backdrop"/);
  assert.match(index, /id="catch-level-xp-backdrop"/);
  assert.match(catchmind, /function syncLevelPreview/);
  assert.match(styles, /\.catch-score-strip\.level-preview/);
  assert.match(catchmind, /class="cm-level-line"><strong><small>LV<\/small>/);
  assert.doesNotMatch(catchmind, /class="cm-level-line"[\s\S]{0,120}tier\.label/);
  assert.match(styles, /@keyframes cm-level-rail-glint/);
});

test("CatchMind A+ nameplates add one visible milestone effect every ten levels", () => {
  assert.match(catchmindLevelMockup, /A\+ · 1~100 성장안/);
  assert.match(catchmindLevelMockup, /var growthLevels = \[1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100\]/);
  const starterColor = styles.match(/milestone-start \{ --level-tier: (#[0-9a-f]{6})/i);
  assert.ok(starterColor, "missing level 1~9 nameplate color");
  const milestoneColors = [starterColor[1].toLowerCase()];
  for (let level = 10; level <= 100; level += 10) {
    const match = styles.match(new RegExp(`milestone-${level} \\{ --level-tier: (#[0-9a-f]{6})`, "i"));
    assert.ok(match, `missing level ${level} nameplate color`);
    milestoneColors.push(match[1].toLowerCase());
  }
  assert.equal(new Set(milestoneColors).size, 11);
  assert.match(styles, /\.cm-level-correct \{[^}]*width: 13px;[^}]*border-radius: 50%;[^}]*background: #178c73;[^}]*box-shadow: none;/);
  assert.match(styles, /\.cm-level-correct::before \{[^}]*content: "\\2714\\FE0E";[^}]*color: #fff;[^}]*-webkit-text-fill-color: #fff;[^}]*font-weight: 900;/);
  assert.match(styles, /span\.drawer \.cm-level-name-row,\s*\.catch-score-strip\.level-preview > span\.drawer \.cm-level-line \{ background-color: var\(--level-tier\); color: #fff; \}/);
  assert.match(styles, /span\.drawer \.cm-level-line \{ border-top: 1px solid rgba\(0,0,0,.12\); box-shadow: none; \}/);
  assert.match(styles, /span\.drawer\.effect-color \.cm-level-name-row,\s*\.catch-score-strip\.level-preview > span\.drawer\.effect-color \.cm-level-line \{ animation: none; background-color: var\(--level-tier\); \}/);
  assert.match(catchmindLevelMockup, /\.nameplate\.style-a\.drawer \.plate-name,\s*\.nameplate\.style-a\.drawer \.plate-level \{ background-color: var\(--tier\); color: #fff; \}/);
  for (const state of ["방장", "정답", "그리는 중", "관전"]) {
    assert.match(catchmindLevelMockup, new RegExp("<span>" + state + "<\\/span>"));
  }
  for (const effect of ["depth", "rain", "corners", "color", "aura", "double", "pulse", "gem", "legend"]) {
    assert.match(catchmindLevelMockup, new RegExp('classes\\.push\\("effect-' + effect + '"\\)'));
    assert.match(catchmind, new RegExp('classes\\.push\\("effect-' + effect + '"\\)'));
  }
  assert.match(catchmindLevelMockup, /plate-level-num/);
  assert.match(catchmindLevelMockup, /justify-content: center/);
  assert.match(catchmindLevelMockup, /@keyframes level-rail-glint/);
  assert.match(catchmindLevelMockup, /prefers-reduced-motion: reduce/);
});

test("CatchMind level results stay readable and scroll on short mobile screens", () => {
  assert.match(index, /class="cm-xp-scroll"/);
  assert.match(styles, /\.cm-xp-dialog \{[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.cm-xp-scroll \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/);
  assert.match(styles, /\.cm-xp-head h2 \{[^}]*font-size: 23px;/);
  assert.match(styles, /\.cm-xp-reason strong \{[^}]*font-size: 13px;/);
  assert.match(styles, /\.cm-xp-reason small \{[^}]*font-size: 11px;[^}]*white-space: normal;/);
  assert.match(styles, /\.cm-mvp-candidates \{[^}]*overflow-y: auto;/);
  assert.match(styles, /\.cm-mvp-plate-wrap > span \{[^}]*width: 100%;[^}]*max-width: none;/);
  assert.match(catchmind, /catch-score-strip level-preview cm-mvp-plate-wrap/);
  assert.match(catchmind, /function levelPreviewClasses\(level\)/);
  assert.match(catchmindLevelMockup, /plateHtml\(\{ nick: person\.nick, level: person\.level, skin: person\.skin \}, "a"\)/);
  assert.match(styles, /\.catch-score-strip\.level-preview > span \{[^}]*min-height: 52px;[^}]*grid-template-rows: 33px 17px;/);
  assert.match(styles, /\.cm-level-name-row b \{[^}]*padding-top: 1px;[^}]*line-height: 1.3;/);
});

test("room host election skips members who switched to spectating", () => {
  assert.match(game, /function memberCanHost\(member\)[\s\S]*member\.hostEligible === false[\s\S]*ctrl\.canHost\(member\.nick\)/);
  assert.match(game, /var eligible = list\.filter\(memberCanHost\)/);
  assert.match(game, /setHostEligible: function \(eligible\)[\s\S]{0,500}Net\.track\(myMetaObj\(null\)\)/);
  assert.match(game, /hostEligible: roomHostEligible/);
});

test("the Omok board uses a HiDPI backing store with logical input coordinates", () => {
  assert.match(game, /var BOARD_SIZE = 450/);
  assert.match(game, /Math\.min\(3, Number\(window\.devicePixelRatio\) \|\| 1\)/);
  assert.match(game, /canvas\.width = backingSize/);
  assert.match(game, /ctx\.setTransform\(renderScale, 0, 0, renderScale, 0, 0\)/);
  assert.match(game, /ctx\.imageSmoothingQuality = "high"/);
  assert.match(game, /var W = BOARD_SIZE/);
  assert.match(game, /var scale = BOARD_SIZE \/ rect\.width/);
  assert.match(game, /var canvas, ctx, MARGIN = 28, GAP, RADIUS/);
  assert.match(game, /ctx\.shadowBlur = RADIUS \* 0\.28 \* boardPixelRatio/);
  assert.match(game, /ctx\.shadowOffsetX = RADIUS \* 0\.1 \* boardPixelRatio/);
  assert.match(game, /ctx\.shadowOffsetY = RADIUS \* 0\.18 \* boardPixelRatio/);
  assert.match(game, /var STONE_SOURCE_INSET = 0\.09/);
  assert.match(game, /RADIUS = GAP \* 0\.5/);
  assert.match(game, /ctx\.drawImage\(img, sourceX, sourceY, sourceWidth, sourceHeight, x - size \/ 2/);
  assert.match(game, /if \(position\.lastMove\) drawLastMoveMarker\(position\.lastMove, board\)/);
  assert.match(game, /strokeBoundaryCircle\(ctx, px\(move\.c\), px\(move\.r\), RADIUS, "#D94A2F", 2\)/);
  assert.doesNotMatch(game, /#FFB347/);
  assert.match(game, /function strokeBoundaryCircle[\s\S]*target\.arc\(x, y, radius, 0, Math\.PI \* 2\)/);
  assert.match(game, /strokeBoundaryCircle\(ctx, px\(move\.c\), px\(move\.r\), RADIUS,[^;]*, 2\)/);
  assert.doesNotMatch(game, /strokeInsideCircle/);
  assert.match(game, /drawStoneShadow\(px\(sc\), px\(sr\), board\[sr\]\[sc\]\)[\s\S]*drawStone\(px\(c\), px\(r\), board\[r\]\[c\]\)/);
  assert.doesNotMatch(game, /ctx\.arc\([^;]*RADIUS \+/);
});

test("Alkkagi reuses the Omok stone skins and redraws each entered room mode", () => {
  assert.match(alkkagi, /load\("black", "assets\/stone-black\.png"\)/);
  assert.match(alkkagi, /load\("white", "assets\/stone-white\.png"\)/);
  assert.match(alkkagi, /var STONE_SOURCE_INSET = 0\.09/);
  assert.match(alkkagi, /ctx\.drawImage\(img, sourceX, sourceY, sourceWidth, sourceHeight,/);
  assert.match(alkkagi, /if \(shadowStone\.alive\) drawStoneShadow\(shadowStone\)/);
  assert.match(alkkagi, /ctx\.imageSmoothingQuality = "high"/);
  assert.match(game, /if \(!alkStarted\) alkStarted = true;\s*alkStartView\(\);/);
  assert.match(game, /if \(game === "alk_terr" && window\.Alkkagi\) \{ A\.mode = "territory"; Alkkagi\.setMode\("territory"\); Alkkagi\.setStones\(\[\]\); \}/);
});

test("Alkkagi has a synchronized five-choice turn timer with short-game warnings", () => {
  assert.match(index, /id="alk-timer-box">∞<\/div>/);
  assert.match(index, /id="alk-timer-options"[\s\S]*data-sec="5"[\s\S]*data-sec="10"[\s\S]*data-sec="20"[\s\S]*data-sec="30"[\s\S]*data-sec="0"/);
  assert.match(game, /timerSec: 5, moveDeadline: null, pausedRemainMs: null/);
  assert.match(index, /id="alk-timer-options"[\s\S]*class="radio-chip active" data-sec="5"/);
  assert.match(game, /moveRemainMs: A\.moveDeadline \? Math\.max\(0, A\.moveDeadline - Date\.now\(\)\) : null/);
  assert.match(game, /case "alk_set_timer"/);
  assert.match(game, /case "alk_timer"/);
  assert.match(game, /function applyAlkTimerMessage\(msg\)/);
  assert.match(game, /function hostAlkTimeout\(\)/);
  assert.match(game, /var warningAt = A\.timerSec <= 10 \? 2 : 5/);
  assert.match(game, /if \(remain !== lastAlkWarnSec\) \{ playSample\(warnBuffer\)/);
  assert.match(game, /A\.started && window\.Alkkagi && Alkkagi\.isMoving\(\) \? "…" : "∞"/);
});

test("room creation hides disabled modes and allows public Territory Rush rooms", () => {
  const catalog = fs.readFileSync(path.join(root, "game-catalog.js"), "utf8");

  assert.match(index, /id="create-game-step"/);
  assert.match(index, /id="create-alk-mode-step"/);
  assert.match(index, /id="create-step-back"/);
  assert.match(index, /id="create-mode-confirm"/);
  assert.match(index, /data-game="alk"[\s\S]*data-game="alk_terr"/);
  assert.match(game, /visibleGameIds\(\["omok", "alk", "catchmind", "relay", "territory"\]\)/);
  assert.match(game, /var ENABLE_ALK_TERRITORY = false/);
  assert.match(game, /var ENABLE_RELAY = false/);
  assert.match(game, /var ENABLE_CATCHMIND_ROOMS = false/);
  assert.match(game, /if \(id === "alk_terr" && !ENABLE_ALK_TERRITORY\) return false/);
  assert.match(game, /if \(id === "relay" && !ENABLE_RELAY\) return false/);
  assert.match(game, /function canEnterGame\(id\)[\s\S]*id !== "catchmind" \|\| ENABLE_CATCHMIND_ROOMS/);
  assert.doesNotMatch(game, /if \(id === "territory"[^\n]+return false/);
  assert.match(game, /function canCreateGame\(id\)[\s\S]*if \(!canEnterGame\(id\)\) return false[\s\S]*def\.createAdminOnly && !isGunaAdmin\(\)/);
  assert.match(game, /visibleGameIds\(\["omok", "alk", "catchmind", "relay", "territory"\]\)\.filter\(canCreateGame\)/);
  assert.match(catalog, /territory:\s*\{[\s\S]*createAdminOnly:\s*false/);
  assert.match(game, /if \(!canEnterGame\(game\)\) \{[\s\S]*game === "catchmind" \? "캐치마인드는 점검 중이라 이용할 수 없어요"/);
  assert.match(game, /filter\(function \(r\) \{ return canEnterGame\(r\.game\)/);
  assert.match(game, /if \(step === "alk-mode" && !ENABLE_ALK_TERRITORY\) step = "game"/);
  assert.match(game, /if \(createGame === "alk" && ENABLE_ALK_TERRITORY\)[\s\S]*showCreateRoomStep\("alk-mode"\)/);
  assert.match(game, /createRoom\(createGame === "alk" \? "alk" : createGame, nm\)/);
  assert.match(game, /createRoom\(createAlkMode, nm\)/);
  assert.match(styles, /\.create-room-dialog\s*\{[^}]*background:\s*var\(--navy-2\)/);
  assert.match(styles, /\.create-game-option\.active\s*\{[^}]*background:\s*rgba\(243,97,42,\.2\)/);
  assert.match(styles, /\.create-game-option\s*\{[^}]*border:\s*0/);
  assert.match(styles, /\.create-mode-card\s*\{[^}]*border:\s*0/);
  assert.match(styles, /\.create-name-input\s*\{[^}]*border:\s*0/);
  assert.doesNotMatch(styles, /\.create-room-dialog\s*\{[^}]*border:/);
  assert.doesNotMatch(index, /알까기-일반|알까기-점령전/);

  [
    "assets/game-icon-alkkagi.svg",
    "assets/game-icon-catchmind.svg",
    "assets/game-icon-relay.svg",
    "assets/game-icon-territory.svg",
    "assets/alkkagi-mode-normal.svg",
    "assets/alkkagi-mode-territory.svg"
  ].forEach((asset) => assert.equal(fs.existsSync(path.join(root, asset)), true));
});

test("Territory Rush is wired as a public non-ranked controller game", () => {
  const catalog = fs.readFileSync(path.join(root, "game-catalog.js"), "utf8");

  assert.match(catalog, /territory:\s*\{[\s\S]*family:\s*"territory"[\s\S]*rankable:\s*false[\s\S]*createAdminOnly:\s*false[\s\S]*maxRoomMembers:\s*10[\s\S]*maxPlayers:\s*8[\s\S]*controller:\s*"TerritoryRush"/);
  assert.match(catalog, /territory:\s*\{[\s\S]*name:\s*"땅따먹기"[\s\S]*rankName:\s*"땅따먹기"/);
  assert.match(index, /id="territorygame"/);
  assert.match(index, /id="territory-board"/);
  assert.match(index, /id="territory-minimap"/);
  assert.match(index, /id="territory-lobby"/);
  assert.match(index, /id="territory-finished"/);
  assert.match(index, /id="territory-chat-overlay"/);
  assert.match(index, /id="territory-chat-row"[\s\S]*id="territory-chat-input"/);
  assert.match(catalog, /territory:\s*\{[\s\S]*chatInputId:\s*"territory-chat-input"[\s\S]*chatOverlayId:\s*"territory-chat-overlay"/);
  assert.match(index, /\{ src: "territory-rush\.js" \}/);
  assert.match(territoryRush, /window\.TerritoryRush\s*=/);
  assert.match(game, /function roomHasSpace\(roomId, game, notify\)[\s\S]*Number\(room\.count\)[\s\S]*방이 가득 찼어요/);
  assert.match(game, /if \(!roomHasSpace\(roomId, game, true\)\) return false/);
  assert.match(game, /roomCount \+ "\/" \+ roomLimit \+ "명"/);
  assert.equal(fs.existsSync(path.join(root, "assets", "territory-rush-bgm.mp3")), true);
  assert.ok(fs.statSync(path.join(root, "assets", "territory-rush-bgm.mp3")).size > 1000000);
  assert.match(territoryRush, /GAME_BGM_SRC = "assets\/territory-rush-bgm\.mp3"/);
  assert.match(territoryRush, /DEATH_SFX_SRC = "assets\/catchmind-countdown\.wav"/);
  assert.match(territoryRush, /function syncRemoteDeathCues\(previous, next\)/);
  assert.match(game, /function expireAway\(nick\)[\s\S]*ctrl\.onPresence\(displayRoster\.slice\(\), \{ expiredNick: nick \}\)/);
  assert.match(styles, /\.game-screen\.territory-screen/);
  assert.match(styles, /#territory-board/);
  assert.match(styles, /\.territory-panel\s*\{[\s\S]*inset:\s*0;[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*border-radius:\s*0;/);
  assert.match(styles, /\.territory-panel-content\s*\{[^}]*flex:\s*0 0 auto;[^}]*margin:\s*auto 0;/);
  assert.doesNotMatch(index, /territory-lobby-art|territory-kicker|영역 넓히기/);
  assert.doesNotMatch(index, /id="territory-(?:event|risk)"/);
  assert.doesNotMatch(territoryRush, /function announce\(|territory-event|territory-risk/);
  assert.match(styles, /\.territory-time\s*\{[^}]*right:\s*max\(8px, env\(safe-area-inset-right\)\);[^}]*height:\s*34px;[^}]*border:\s*1px solid var\(--territory-ui-line\);[^}]*border-radius:\s*8px;[^}]*background:\s*var\(--territory-ui-bg\);[^}]*box-shadow:\s*0 4px 14px rgba\(0,0,0,\.2\);/);
  assert.match(styles, /\.territory-minimap-shell\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/);
  assert.match(styles, /#territory-minimap\s*\{[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*opacity:\s*\.68;/);
  assert.match(styles, /\.territory-utility\s*\{[^}]*grid-template-columns:\s*repeat\(3, auto\)/);
  assert.match(styles, /\.territory-scoreboard\s*\{[^}]*background:\s*rgba\(14,42,58,\.36\);[^}]*font-size:\s*15px;/);
  assert.match(styles, /\.territory-scoreboard\s*\{[^}]*width:\s*min\(147px, calc\(100% - 128px\)\);/);
  assert.match(styles, /\.territory-rank-number\s*\{[^}]*font-size:\s*15px;[^}]*font-weight:\s*1000;/);
  assert.match(styles, /\.territory-chat-row\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*max\(8px, env\(safe-area-inset-bottom\)\);/);
  assert.match(territoryRush, /function canChat\(nick\)[\s\S]*state\.phase !== "playing"[\s\S]*has\(state\.spectators, nick\) \|\| !playerByNick\(nick\)/);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*\.territory-scoreboard\s*\{[^}]*width:\s*min\(143px, calc\(100% - 116px\)\);[^}]*font-size:\s*14px;/);
  const scoreboardSource = territoryRush.match(/function renderScoreboard\(\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  function renderFinished/)[1];
  assert.match(scoreboardSource, /territory-rank-number/);
  assert.doesNotMatch(scoreboardSource, /territory-dot|MASCOTS/);
  assert.doesNotMatch(styles, /\.territory-(?:event|risk)\b/);
});

test("Relay Drawing is registered as a separate non-ranked party game", () => {
  const catalog = fs.readFileSync(path.join(root, "game-catalog.js"), "utf8");

  assert.match(catalog, /relay:\s*\{[\s\S]*family:\s*"relay"[\s\S]*rankable:\s*false[\s\S]*controller:\s*"RelayDrawing"/);
  assert.match(index, /id="relaygame"/);
  assert.match(index, /id="relay-board"/);
  assert.match(index, /id="relay-text-panel"/);
  assert.match(index, /id="relay-result-panel"/);
  assert.match(index, /\{ src: "relay-drawing\.js" \}/);
  assert.match(relayDrawing, /window\.RelayDrawing\s*=/);
  assert.match(styles, /\.game-screen\.relay-screen/);
});

test("Relay Drawing waiting screen mirrors the simple CatchMind participant footer", () => {
  assert.match(index, /class="relay-wait-mark"[\s\S]*class="relay-wait-route"[\s\S]*class="relay-wait-paper one"[\s\S]*class="relay-wait-paper two"[\s\S]*class="relay-wait-paper three"[\s\S]*class="relay-wait-arrow"/);
  assert.match(styles, /\.relay-wait-route\s*\{[\s\S]*border-top:\s*3px dashed #f6a27f/);
  assert.match(styles, /\.relay-wait-paper\.two::before\s*\{[^}]*background:\s*var\(--teal\)/);
  assert.match(index, /id="relay-lobby-roles" class="catch-lobby-roles relay-lobby-roles"/);
  assert.match(index, /id="relay-lobby-participant-row" class="catch-lobby-role-row"/);
  assert.match(index, /id="relay-lobby-spectator-row" class="catch-lobby-role-row"/);
  assert.match(index, /id="relay-idle-actions" class="relay-idle-actions hidden"/);
  assert.match(relayDrawing, /var cls = "catch-lobby-name"/);
  assert.match(relayDrawing, /<span class="catch-lobby-ready"/);
  assert.doesNotMatch(index, /id="relay-summary"/);
  assert.doesNotMatch(index, /id="relay-ready-list"/);
  assert.doesNotMatch(relayDrawing, /진행 단계|예상 시간|문장 시간|그림 시간/);
  assert.doesNotMatch(styles, /\.relay-summary|\.relay-ready-row/);
});

test("Relay Drawing prompt screen keeps only the story form and two actions", () => {
  const promptPanel = index.match(/<section id="relay-text-panel"[\s\S]*?<\/section>/)[0];
  assert.match(index, /id="relay-text-title">스토리 시작<\/h2>/);
  assert.match(index, /id="relay-text-hint">나만의 간단한 이야기를 만들어요!<\/p>/);
  assert.match(index, /class="relay-prompt-mark"/);
  assert.match(index, /class="relay-prompt-card relay-prompt-copy-card"/);
  assert.match(index, /class="relay-prompt-card relay-prompt-picture-card"/);
  assert.match(index, /id="relay-text-input" type="text"/);
  assert.match(index, /id="relay-prompt-actions" class="relay-text-actions relay-prompt-actions hidden"/);
  assert.match(index, /id="relay-suggest-btn"[^>]*>자동 생성<\/button>/);
  assert.match(index, /id="relay-text-submit"[^>]*>제출하기<\/button>/);
  assert.doesNotMatch(promptPanel, /relay-text-actions|relay-suggest-btn|relay-text-submit/);
  assert.doesNotMatch(index, /relay-text-kicker|relay-text-example|relay-text-count|relay-submit-status/);
  assert.match(relayDrawing, /\$\("relay-text-title"\)\.textContent = "스토리 시작"/);
  assert.match(relayDrawing, /\$\("relay-text-hint"\)\.textContent = "나만의 간단한 이야기를 만들어요!"/);
  assert.match(relayDrawing, /label\.textContent = "";\s*text\.textContent = "누군가가 그릴 문장 만들기"/);
  assert.match(relayDrawing, /toggleHidden\(\$\("relay-prompt-actions"\), state\.phase !== "prompt"\)/);
  assert.match(styles, /\.relay-text-panel\.prompt #relay-text-input/);
  assert.match(styles, /\.relay-text-panel\.prompt\s*\{[\s\S]*justify-content:\s*center[\s\S]*padding:\s*24px 22px 30px/);
  assert.match(styles, /\.relay-prompt-actions\s*\{[\s\S]*order:\s*5[\s\S]*max-width:\s*420px/);
  assert.doesNotMatch(styles, /\.relay-text-kicker|\.relay-text-example/);
});

test("Relay Drawing uses the CatchMind tool row and unobstructed caption form", () => {
  assert.match(index, /id="relay-tools" class="catch-tools relay-tools hidden"/);
  assert.match(index, /data-relay-tool="pen"[^>]*>✏️<\/button>/);
  assert.match(index, /data-relay-tool="eraser"[^>]*>🧽<\/button>/);
  assert.match(index, /id="relay-bg-btn"/);
  assert.match(index, /id="relay-palette" class="catch-palette relay-palette hidden"/);
  assert.match(index, /id="relay-caption-row" class="relay-caption-row hidden"[\s\S]*id="relay-caption-input"[\s\S]*id="relay-caption-submit"/);
  assert.match(relayDrawing, /toggleHidden\(\$\("relay-text-panel"\), state\.phase !== "prompt"\)/);
  assert.match(relayDrawing, /toggleHidden\(\$\("relay-caption-row"\), state\.phase !== "caption"\)/);
  assert.match(styles, /\.relay-caption-row\s*\{[\s\S]*order:\s*5/);
  assert.doesNotMatch(styles, /\.relay-text-panel\.caption/);
});

test("Relay Drawing results grow with history and keep the album navigator and ready action visible", () => {
  assert.doesNotMatch(index, /relay-result-head|relay-album-kicker|relay-album-title|relay-album-meta/);
  assert.match(index, /id="relay-result-panel"[\s\S]*id="relay-chain"/);
  assert.match(index, /id="relay-result-dock"[\s\S]*class="relay-album-nav"[\s\S]*id="relay-album-prev"[\s\S]*id="relay-album-position"[\s\S]*id="relay-album-next"[\s\S]*id="relay-again-btn"[\s\S]*id="relay-result-chat-input"/);
  assert.match(relayDrawing, /relay-chain-meta"><b>' \+ esc\(entry\.author\) \+ '<\/b>/);
  assert.doesNotMatch(relayDrawing, /var label = entry\.kind|authorLabel|<b><small>/);
  assert.match(styles, /\.relay-board-wrap\.result-mode #relay-board/);
  assert.match(styles, /\.relay-chain\s*\{[\s\S]*overflow:\s*visible/);
  assert.match(styles, /\.relay-result-panel\s*\{[\s\S]*background:\s*transparent/);
  assert.match(styles, /\.relay-chain-copy > strong\s*\{[\s\S]*font-size:\s*16px/);
  assert.match(relayDrawing, /class="relay-chain-copy relay-chain-text"/);
  assert.match(styles, /\.relay-chain-text\s*\{[\s\S]*display:\s*flex[\s\S]*align-items:\s*center/);
  assert.match(styles, /\.relay-chain-text > strong\s*\{[\s\S]*margin-top:\s*0[\s\S]*text-overflow:\s*ellipsis[\s\S]*white-space:\s*nowrap/);
  assert.doesNotMatch(styles, /\.relay-chain-item::before|\.relay-chain-item:not\(:last-child\)::after|\.relay-chain-meta span|\.relay-chain-meta b small/);
  assert.match(styles, /\.relay-result-dock\s*\{[\s\S]*position:\s*fixed/);
  assert.match(styles, /\.relay-result-dock\s*\{[\s\S]*background:\s*rgba\(18,52,69,\.78\)[\s\S]*backdrop-filter:\s*blur\(12px\)/);
  assert.match(styles, /\.relay-result-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 2fr\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.relay-album-nav\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(relayDrawing, /relay-album-position"\)\.textContent = \(albumIndex \+ 1\) \+ " \/ " \+ state\.players\.length/);
  assert.match(relayDrawing, /function scrollAlbumToTop\(\)[\s\S]*window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
  assert.match(relayDrawing, /relay-album-prev[\s\S]*renderResults\(\);\s*scrollAlbumToTop\(\)/);
  assert.match(relayDrawing, /relay-album-next[\s\S]*renderResults\(\);\s*scrollAlbumToTop\(\)/);
});

test("Relay Drawing warns at five seconds and auto-submits the current draft", () => {
  assert.match(game, /playWarning:\s*function \(\) \{\s*initAudio\(\);\s*playSample\(warnBuffer\)/);
  assert.match(relayDrawing, /seconds > 0 && seconds <= 5 && warningScope !== taskKey\(\)/);
  assert.match(relayDrawing, /api\.playWarning\(\)/);
  assert.match(relayDrawing, /function autoSubmitCurrentState\(\)/);
  assert.match(relayDrawing, /bg:\s*canvasBg,\s*strokes:\s*sanitizeStrokes\(localStrokes\),\s*auto:\s*true/);
  assert.match(relayDrawing, /text:\s*safeText\(input && input\.value, MAX_TEXT\) \|\| "시간 안에 작성하지 못했어요"/);
  assert.match(relayDrawing, /now >= state\.deadline \+ AUTO_SUBMIT_GRACE_MS/);
});

test("Relay Drawing is paused publicly while its UI preview remains restricted to the authenticated owner admin", () => {
  for (const phase of ["waiting", "prompt", "drawing", "caption", "result"]) {
    assert.match(index, new RegExp('<option value="' + phase + '">'));
  }
  assert.match(index, /id="relay-preview-toolbar"/);
  assert.match(index, /id="relay-preview-menu-btn" class="menu-item admin-only"/);
  assert.match(index, /class="menu-item hidden" data-rules="relay"/);
  assert.match(index, /id="lobby-relay-gallery-btn" class="hdr-btn hidden"/);
  assert.match(index, /data-relay-preview-viewport="desktop"/);
  assert.match(index, /data-relay-preview-viewport="mobile"/);
  assert.match(game, /var relayPreviewPhases = \["waiting", "prompt", "drawing", "caption", "result"\]/);
  assert.match(game, /params\.has\("relay-preview"\)/);
  assert.match(game, /if \(!phase \|\| !isGunaAdmin\(\) \|\| !window\.RelayDrawing/);
  assert.match(game, /function isGunaAdmin\(\)\s*\{\s*return me\.isAdmin === true && me\.nick === ADMIN;/);
  assert.match(game, /if \(startCatchmindUiPreview\(\) \|\| startRelayUiPreview\(\)\) \{\s*logLoginOnce\(\);\s*return;/);
  assert.match(game, /id === "relay" && !ENABLE_RELAY/);
  assert.match(game, /RelayDrawing\.enterPreview\(previewApi, phase\)/);
  assert.match(game, /if \(!startLocalAlkMapPreview\(\)\) tryAutoLogin\(\)/);
  assert.match(relayDrawing, /enterPreview:\s*enterPreview/);
  assert.match(relayDrawing, /setPreviewPhase:\s*setPreviewPhase/);
  assert.match(styles, /body\.relay-preview-mobile #relaygame/);
  assert.equal(fs.existsSync(path.join(root, "relay-drawing-mockups.html")), false);
});

test("room presence heals duplicate connections and active ghost speakers", () => {
  assert.match(net, /presenceCount: row\.count/);
  assert.match(net, /startRoomPresenceHeartbeat\(\)/);
  assert.match(net, /channel\.track\(myMeta\)/);
  assert.match(net, /roomPresenceT = setInterval[\s\S]*15000/);
  assert.match(game, /Number\(stillConnected\.presenceCount\) > 1/);
  assert.match(game, /function noteActiveRoomSpeaker\(nick\)/);
  assert.match(game, /noteActiveRoomSpeaker\(msg\.nick\);\s*addChatTo/);
  assert.match(game, /inferredFromActivity: true/);
});

test("CatchMind exposes a self-only reward menu and board-frame picker", () => {
  for (const id of [
    "menu-catch-rewards-btn",
    "menu-catch-rewards",
    "catch-personal-reward-list",
    "catch-frame-picker-open",
    "catch-frame-picker-modal",
    "catch-frame-picker-grid"
  ]) {
    assert.match(index, new RegExp('id="' + id + '"'));
  }

  assert.match(index, /이 화면은 내 메뉴에서만 보여요/);
  assert.match(index, /흰 그림 영역은 그대로 두고 테두리만 바뀌어요/);
  assert.match(catchmind, /nick === me\(\)\.nick/);
  assert.match(catchmind, /data-catch-personal-card="true"/);
  assert.match(catchmind, /api && api\.openBoardFramePicker/);
  assert.match(game, /openBoardFramePicker:\s*openCatchBoardFramePicker/);
  assert.match(game, /function openCatchPersonalRewards\(\)/);
  assert.match(game, /function openCatchBoardFramePicker\(\)/);
  assert.match(game, /function catchPersonalLevel\(\)\s*\{\s*if \(isCatchCosmeticsPreview\(\)\) return 100;/);
  assert.match(game, /CATCH_BOARD_FRAME_STORAGE_PREFIX = "catchmind_board_frame_v1:"/);
  assert.match(game, /Db\.equipCatchmindReward/);
  assert.match(styles, /\.catch-frame-picker-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3/);
  assert.match(styles, /\.catch-score-strip > span\.catch-personal-card/);

  const selectFrame = game.slice(
    game.indexOf("function selectCatchBoardFrame"),
    game.indexOf("function openCatchBoardFramePicker")
  );
  const publishFrame = game.slice(
    game.indexOf("function publishCatchBoardFrameSelection"),
    game.indexOf("function prepareCatchPersonalState")
  );
  const showFrame = game.slice(
    game.indexOf("function showCatchBoardFrame"),
    game.indexOf("function applyCatchBoardFrame")
  );

  assert.match(game, /catchBoardFrameId:\s*catchSelectedBoardFrameId/);
  assert.match(game, /getBoardFrameId:\s*function \(\) \{ return catchSelectedBoardFrameId; \}/);
  assert.match(game, /showBoardFrame:\s*showCatchBoardFrame/);
  assert.match(game, /function showLobby\(\)[\s\S]*loadCatchPersonalProfile\(false\)/);
  assert.match(selectFrame, /publishCatchBoardFrameSelection\(\)/);
  assert.match(publishFrame, /Net\.track\(myMetaObj\(null\)\)/);
  assert.doesNotMatch(showFrame, /catchSelectedBoardFrameId\s*=/);
});
