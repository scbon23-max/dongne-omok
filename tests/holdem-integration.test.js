"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const index = read("index.html");
const styles = read("styles.css");
const catalogSource = read("game-catalog.js");
const game = read("game.js");
const db = read("db.js");
const controller = read("holdem.js");
const config = read(path.join("supabase", "config.toml"));

test("Hold'em is an available six-player controller game", () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(catalogSource, context, { filename: "game-catalog.js" });
  const definition = context.window.GameCatalog.get("holdem");

  assert.equal(definition.family, "holdem");
  assert.equal(definition.maxPlayers, 6);
  assert.equal(definition.maxRoomMembers, 6);
  assert.equal(definition.rankable, false);
  assert.equal(definition.createAdminOnly, true);
  assert.equal(definition.discoverable, false);
  assert.equal(definition.controller, "TexasHoldem");
  assert.equal(definition.screenId, "holdemgame");
  assert.match(game, /GameCatalog\.order\.filter\(function \(id\) \{ return id !== "alk_terr"; \}\)/);
  assert.match(game, /visibleGameIds\(createIds\)\.filter\(canCreateGame\)/);
  assert.match(game, /def && def\.createAdminOnly && !me\.isAdmin/);
  assert.doesNotMatch(game, /createAdminOnly && !isGunaAdmin\(\)/);
  assert.match(game, /id === "holdem" \? "홀덤 · 링게임"/);
});

test("Hold'em room creation shows assets, locks tournaments to admins, and selects a ring buy-in", () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(catalogSource, context, { filename: "game-catalog.js" });

  for (const id of ["holdem_tournament", "holdem_turbo"]) {
    const definition = context.window.GameCatalog.get(id);
    assert.equal(definition.family, "holdem");
    assert.equal(definition.createAdminOnly, true);
    assert.equal(definition.discoverable, false);
  }
  const ring = context.window.GameCatalog.get("holdem_ring");
  assert.equal(ring.family, "holdem");
  assert.equal(ring.createAdminOnly, false);
  assert.equal(ring.discoverable, false);
  assert.equal(ring.name, "홀덤");
  const holdemCreateStep = index.slice(
    index.indexOf('id="create-holdem-mode-step"'),
    index.indexOf("<!-- 메뉴 모달 -->")
  );
  assert.match(index, /id="create-holdem-mode-step"/);
  assert.match(index, /id="create-holdem-wallet-balance"/);
  assert.match(index, /내 홀덤 총 자산/);
  assert.doesNotMatch(index, /현금과 무관한/);
  assert.ok(
    index.indexOf('data-holdem-mode="ring"') <
      index.indexOf('data-holdem-mode="tournament"')
  );
  assert.match(index, /data-holdem-mode="tournament"[^>]*hidden/);
  assert.match(index, /id="create-holdem-mode"[^>]*hidden/);
  assert.match(index, /data-holdem-mode="ring"/);
  assert.match(index, /data-holdem-speed="normal"/);
  assert.match(index, /data-holdem-speed="turbo"/);
  assert.match(index, /id="create-holdem-speed-group"[^>]*hidden/);
  assert.match(index, /id="create-holdem-buyin-slider"[^>]*type="hidden"[^>]*max="100000"[^>]*step="100"/);
  assert.match(index, /data-holdem-buyin="10000"[\s\S]*data-holdem-buyin="50000"[\s\S]*data-holdem-buyin="100000"/);
  assert.match(index, /참가비용 범위/);
  assert.match(index, /10,000원~20,000원[\s\S]*30,000원~50,000원[\s\S]*50,000원~100,000원/);
  assert.match(index, /<strong>홀덤<\/strong>/);
  assert.doesNotMatch(index, /id="create-holdem-summary-name"/);
  assert.doesNotMatch(index, /create-holdem-head-title/);
  assert.doesNotMatch(holdemCreateStep, /<span>방 이름<\/span>/);
  assert.match(holdemCreateStep, /create-holdem-wallet create-holdem-wallet-full/);
  assert.match(game, /renderCreateHoldemMode\("ring", "normal"\)/);
  assert.match(game, /HOLDEM_INITIAL_ASSETS = 100000/);
  assert.match(game, /HOLDEM_DEFAULT_BUY_IN = 50000/);
  assert.match(game, /HOLDEM_BUY_IN_OPTIONS = \[[\s\S]*minBuyIn: 10000[\s\S]*maxBuyIn: 20000[\s\S]*minBuyIn: 30000[\s\S]*maxBuyIn: 50000[\s\S]*minBuyIn: 50000[\s\S]*maxBuyIn: 100000/);
  assert.match(game, /smallBlind: 100[\s\S]*bigBlind: 200/);
  assert.match(game, /smallBlind: 300[\s\S]*bigBlind: 600/);
  assert.doesNotMatch(game, /smallBlind: 50(?!0)|smallBlind: 250/);
  assert.doesNotMatch(index, /SB 50(?!0)|SB 250/);
  assert.match(game, /function holdemBuyInRangeLabel\(amount\)/);
  assert.match(game, /totalAssets[\s\S]*tableBalance[\s\S]*현재 테이블에서 사용 중/);
  assert.match(game, /mode = "ring"/);
  assert.match(game, /modeBox\.hidden = true/);
  assert.match(game, /modeCards\[i\]\.hidden = isTournamentCard/);
  assert.match(game, /토너먼트 방은 관리자만 만들 수 있어요/);
  assert.match(game, /function holdemCreateGameId\(mode, speed\)/);
  assert.match(game, /return "holdem_ring"/);
  assert.match(game, /speed === "turbo" \? "holdem_turbo" : "holdem_tournament"/);
  assert.match(game, /createRoom\([\s\S]*holdemCreateGameId\(createHoldemMode, createHoldemSpeed\)[\s\S]*buyIn: createHoldemBuyIn/);
  assert.match(db, /async function getHoldemWallet\(auth\)/);
  assert.match(styles, /\.room-badge\.holdem_ring/);
  assert.match(styles, /\.room-badge\.holdem_tournament/);
});

test("room visibility follows the catalog and Hold'em rooms stay off the public list", () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(catalogSource, context, { filename: "game-catalog.js" });
  for (const id of ["holdem", "holdem_tournament", "holdem_turbo", "holdem_ring"]) {
    assert.equal(context.window.GameCatalog.get(id).discoverable, false);
  }
  assert.match(
    game,
    /function roomIsDiscoverable\(id\)[\s\S]*def\.discoverable === false/
  );
  assert.match(
    game,
    /function broadcastRoomOpen\(\)[\s\S]*roomIsDiscoverable\(curRoomGame\)[\s\S]*Net\.sendLobby\(\{ t: "room_open"/
  );
  assert.match(
    game,
    /msg\.t === "room_open"[\s\S]*!roomIsDiscoverable\(msg\.room\.game\)[\s\S]*delete rooms\[msg\.room\.id\]/
  );
  assert.match(
    game,
    /function renderRoomList\(\)[\s\S]*roomIsDiscoverable\(r\.game\) && canEnterGame\(r\.game\)/
  );
  assert.match(
    game,
    /function broadcastRoomClose\(roomId, game\)[\s\S]*roomIsDiscoverable\(game\)/
  );
  assert.match(
    game,
    /function lobbyViewingValue\(roomId, game\)[\s\S]*\? "private" : roomId/
  );
  assert.match(
    game,
    /Net\.trackLobby\(myMetaObj\(lobbyViewingValue\(roomId, game\)\)\)/
  );
  assert.doesNotMatch(game, /Net\.trackLobby\(myMetaObj\(roomId\)\)/);
});

test("the app shell loads the engine and controller before the shared game shell", () => {
  const engineAt = index.indexOf('{ src: "holdem-engine.js" }');
  const controllerAt = index.indexOf('{ src: "holdem.js" }');
  const gameAt = index.indexOf('{ src: "game.js" }');

  assert.ok(engineAt > 0);
  assert.ok(controllerAt > engineAt);
  assert.ok(gameAt > controllerAt);
  assert.match(controller, /window\.TexasHoldem\s*=/);
  assert.match(game, /roomId: function \(\) \{ return curRoomId \|\| ""; \}/);
});

test("the six-seat table exposes every required game control", () => {
  [
    "holdemgame",
    "holdem-stage",
    "holdem-table",
    "holdem-board",
    "holdem-seats",
    "holdem-pot",
    "holdem-lobby",
    "holdem-result",
    "holdem-result-title",
    "holdem-result-pot",
    "holdem-result-board",
    "holdem-result-showdown",
    "holdem-result-countdown",
    "holdem-ready-btn",
    "holdem-start-btn",
    "holdem-next-btn",
    "holdem-bot-add-btn",
    "holdem-bot-fill-btn",
    "holdem-bot-remove-btn",
    "holdem-action-panel",
    "holdem-refill-panel",
    "holdem-refill-btn",
    "holdem-fold-btn",
    "holdem-check-btn",
    "holdem-call-btn",
    "holdem-bet-btn",
    "holdem-raise-btn",
    "holdem-allin-btn",
    "holdem-raise-slider",
    "holdem-chat-input",
  ].forEach((id) => assert.match(index, new RegExp(`id="${id}"`)));

  assert.doesNotMatch(index, /class="holdem-brand"/);
  assert.doesNotMatch(index, /class="holdem-brand-cards"/);
  assert.doesNotMatch(index, /id="holdem-status"/);
  assert.doesNotMatch(index, /id="holdem-people-btn"/);
  assert.match(index, /<nav class="holdem-utility"[\s\S]*id="holdem-leave-btn"[\s\S]*id="holdem-hands-btn"[\s\S]*id="holdem-settings-btn"/);
  assert.match(styles, /\.holdem-topbar\s*\{[\s\S]*background:\s*transparent/);
  assert.match(styles, /\.holdem-utility #holdem-leave-btn \{ margin-right: auto; \}/);
  assert.match(styles, /\.holdem-table\s*\{[\s\S]*aspect-ratio:\s*9\s*\/\s*14/);
  for (let seat = 0; seat < 6; seat += 1) {
    assert.match(
      styles,
      new RegExp(`\\.holdem-seat\\[data-relative-seat="${seat}"\\]`)
    );
  }
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\s*\{\s*top:\s*98%;\s*left:\s*50%;\s*\}/);
  assert.match(styles, /\.holdem-card\.back/);
  assert.match(styles, /\.holdem-card\s*\{[\s\S]*--holdem-card-rank-width-auto:[\s\S]*var\(--holdem-card-width/);
  assert.match(styles, /\.holdem-card-rank svg,[\s\S]*\.holdem-card > \.rank svg\s*\{[\s\S]*fill: currentColor/);
  assert.match(styles, /\.holdem-board\s*\{[\s\S]*gap:\s*clamp\(3px,\s*\.8vw,\s*5px\)/);
  assert.match(styles, /\.holdem-board \.holdem-card\s*\{[\s\S]*--holdem-card-width:\s*clamp\(38px,\s*10vw,\s*52px\)/);
  assert.match(styles, /\.holdem-board \.holdem-card\.empty\s*\{[\s\S]*border-color:\s*rgba\(213,239,235,\.035\)/);
  assert.match(styles, /\.holdem-board \.holdem-card \+ \.holdem-card\s*\{\s*margin-left:\s*0;\s*\}/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards\s*\{[\s\S]*top: 1px[\s\S]*translate\(-50%, -45%\)/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards\.is-revealed-cards\s*\{[\s\S]*z-index:\s*24[\s\S]*translate\(-50%, -72%\)/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards \.holdem-card\.back\s*\{[\s\S]*--holdem-card-width:\s*clamp\(16px,\s*4\.6vw,\s*24px\)/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards \.holdem-card\.back\s*\{[\s\S]*box-shadow:\s*inset 0 0 0 1px #ecede8/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards\.is-revealed-cards \.holdem-card:not\(\.back\):not\(\.empty\)\s*\{[\s\S]*--holdem-card-width:\s*clamp\(30px,\s*8vw,\s*42px\)/);
  assert.match(styles, /\.holdem-hole-cards \.holdem-card \+ \.holdem-card \{ margin-left: -5px; \}/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards \.holdem-card\.back \+ \.holdem-card\.back \{ margin-left: -10px; \}/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards\.is-revealed-cards \.holdem-card:not\(\.back\):not\(\.empty\) \+ \.holdem-card:not\(\.back\):not\(\.empty\) \{ margin-left: -12px; \}/);
  assert.match(styles, /\.holdem-seat\.is-me \.holdem-hole-cards \.holdem-card \+ \.holdem-card \{ margin-left: -14px; \}/);
  assert.match(styles, /\.holdem-hole-cards \.holdem-card:first-child\s*\{[\s\S]*rotate\(-7deg\)/);
  assert.match(styles, /\.holdem-hole-cards \.holdem-card:last-child\s*\{[\s\S]*rotate\(7deg\)/);
  assert.match(controller, /is-visible-cards is-revealed-cards/);
  assert.match(controller, /class="holdem-seat-open-icon"/);
  assert.match(controller, /role="button" tabindex="0"/);
  assert.match(styles, /\.holdem-seat-open-icon\s*\{/);
  assert.match(styles, /@media \(min-width: 900px\)[\s\S]*\.holdem-table/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the betting UI keeps raise choices collapsed until requested", () => {
  assert.match(controller, /var raiseMenuOpen = false/);
  assert.match(controller, /var moneyUnitMode = "chips"/);
  assert.match(controller, /function toggleMoneyUnitMode\(\)[\s\S]*moneyUnitMode === "bb" \? "chips" : "bb"/);
  assert.match(controller, /var settingsOpen = false/);
  assert.match(controller, /id === "holdem-settings-btn"[\s\S]*settingsOpen = !settingsOpen/);
  assert.match(controller, /id === "holdem-unit-toggle"[\s\S]*toggleMoneyUnitMode\(\)/);
  assert.match(controller, /show\("holdem-raise-panel", hasMove && canSize && raiseMenuOpen\)/);
  assert.match(controller, /id === "holdem-raise-btn"[\s\S]*raiseMenuOpen = true[\s\S]*renderControls\(\)/);
  assert.match(controller, /function quickBet\(kind\)[\s\S]*performSizedMove\(raiseValue\)/);
  assert.match(controller, /function seatActionLabel\(seat\)[\s\S]*레이즈/);
  assert.match(controller, /class="holdem-seat-action /);
  assert.match(controller, /class="holdem-seat-turn-timer"/);
  assert.match(index, /AI 연습은 방에 혼자 있을 때만 사용할 수 있고/);
  assert.match(index, /연습용 임시 원화 자산으로 진행됩니다/);
  assert.match(controller, /practiceMode: mode === "ring" && botCount > 0 && !assetBacked/);
  assert.match(controller, /function humanSeatCount\(\)[\s\S]*state\.seats\.filter/);
  assert.match(controller, /var humanCount = humanSeatCount\(\)/);
  assert.match(controller, /state\.canManageBots && humanCount === 1/);
  assert.match(controller, /AI와 하는 연습용 임시 원화 자산/);
  assert.match(controller, /연습용 임시 원화 자산 충전/);
  assert.match(styles, /\.holdem-seat-action\s*\{/);
  assert.match(styles, /\.holdem-seat-turn-timer\s*\{/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-action-summary \{ display: none; \}/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-raise-panel \{[\s\S]*position: absolute[\s\S]*bottom: calc\(100% \+ 9px\)/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-chat-row \{[\s\S]*opacity: 0/);
});

test("hand results stay on the table without a popup and advance automatically", () => {
  assert.match(controller, /var AUTO_NEXT_HAND_MS = 5000/);
  assert.match(controller, /function renderHandResult\(\)[\s\S]*panel\.classList\.add\("hidden"\)/);
  assert.doesNotMatch(controller, /panel\.classList\.toggle\("hidden", !announced\)/);
  assert.match(controller, /show\("holdem-lobby", false\)/);
  assert.match(controller, /refreshSnapshot\("enter", true\)/);
  assert.doesNotMatch(controller, /startTimers\(\);\s*joinTable\(\);/);
  assert.match(controller, /function chooseEmptySeat\(seatIndex\)[\s\S]*addBot\(\{ seat: targetSeat \}\)[\s\S]*joinTable\(targetSeat\)/);
  assert.match(controller, /function autoReadyAfterSeatJoin\(\)[\s\S]*invoke\("ready"/);
  assert.match(controller, /function ensureSeatControls\(\)[\s\S]*appendChild\(button\)/);
  assert.match(styles, /\.holdem-seat-controls\s*\{/);
  assert.match(controller, /show\("holdem-ready-btn", waiting && state\.heroSeat >= 0 && state\.canReady\)/);
  assert.match(controller, /function scheduleAutoReadyForNextHand\(\)[\s\S]*state\.phase !== "complete"[\s\S]*invoke\("ready"/);
  assert.match(controller, /scheduleAutoReadyForNextHand\(\)[\s\S]*scheduleAutoNextHand\(\)/);
  assert.match(controller, /function scheduleAutoNextHand\(\)[\s\S]*state\.phase !== "complete"[\s\S]*setTimeout\(function \(\) \{ autoStartHand\(key\); \}, AUTO_NEXT_HAND_MS\)/);
  assert.match(styles, /\.holdem-result-panel\s*\{[\s\S]*display: none !important/);
  assert.match(styles, /\.holdem-winner-result\s*\{/);
  assert.match(styles, /\.holdem-screen\.is-settling-pot \.holdem-seat\.is-winner \.holdem-seat-avatar/);
  assert.match(controller, /var RESULT_CARDS_FIRST_MS = 900/);
  assert.match(controller, /var RESULT_FINAL_ACTION_MS = 1000/);
  assert.match(controller, /function resultStage\(\)[\s\S]*resultFlow\.actionUntil[\s\S]*return "action"/);
  assert.match(controller, /isBetweenHands\(state\.phase\) && resultStage\(\) !== "action"/);
  assert.match(controller, /var RESULT_BOARD_REVEAL_STEP_MS = 900/);
  assert.match(controller, /function resultBoardVisibleCount\(\)[\s\S]*resultFlow\.initialBoardCount/);
  assert.match(controller, /function animatedPotAmount\(\)/);
  assert.match(styles, /\.holdem-screen\.is-showdown \.holdem-table-info/);
  assert.doesNotMatch(styles, /\.holdem-result-panel\s*\{[\s\S]*background: rgba\(5,24,30,\.95\)/);
  assert.match(index, /id="holdem-result"/);
});

test("the browser sends only server commands and public refresh hints", () => {
  assert.match(db, /async function holdemInvoke\(auth, action, payload\)/);
  assert.match(db, /sb\.functions\.invoke\("holdem-table"/);
  assert.match(controller, /Db\.holdemInvoke/);
  assert.match(controller, /holdem_refresh/);
  assert.match(controller, /var pendingUiCount = 0/);
  assert.match(controller, /var busy = pendingUiCount > 0/);
  assert.doesNotMatch(controller, /api\.send\(\{[^}]*\b(?:deck|burn|holeCards|cards)\b/s);
  assert.match(config, /\[functions\.holdem-table\]\s*verify_jwt = false/);
  assert.match(controller, /invoke\("refill"/);
});

test("the rules and UI clearly identify KRW-unit assets and standard no-limit play", () => {
  assert.match(index, /6-MAX · NO LIMIT/);
  assert.match(index, /실제 현금 가치가 없는 원화 단위 게임 자산/);
  assert.match(index, /data-rules="holdem">텍사스 홀덤 규칙/);
  assert.match(controller, /Poker TDA|TDA/);
  assert.match(controller, /사이드\s*팟|사이드팟/);
  assert.match(controller, /숏\s*올인|최소\s*레이즈/);
});
