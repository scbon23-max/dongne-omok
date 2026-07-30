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
const engine = read("holdem-engine.js");
const config = read(path.join("supabase", "config.toml"));
const profileAvatarMigration = read(path.join("supabase", "migrations", "202607280001_account_profile_avatars.sql"));
const cardBackAssets = [
  "assets/holdem/card-back-lucky-clover.png",
  "assets/holdem/card-back-royal-candy.png",
  "assets/holdem/card-back-moon-chip.png",
  "assets/holdem/card-back-ivory-minimal.png",
  "assets/holdem/card-back-teal-wave.png",
  "assets/holdem/card-back-midnight-gold.png",
];

test("Hold'em is an available six-player controller game", () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(catalogSource, context, { filename: "game-catalog.js" });
  const definition = context.window.GameCatalog.get("holdem");

  assert.equal(definition.family, "holdem");
  assert.equal(definition.maxPlayers, 6);
  assert.equal(definition.maxRoomMembers, 0);
  assert.equal(definition.rankable, false);
  assert.equal(definition.createAdminOnly, false);
  assert.equal(definition.discoverable, true);
  assert.equal(definition.controller, "TexasHoldem");
  assert.equal(definition.screenId, "holdemgame");
  assert.match(game, /GameCatalog\.order\.filter\(function \(id\) \{ return id !== "alk_terr"; \}\)/);
  assert.match(game, /visibleGameIds\(createIds\)\.filter\(canCreateGame\)/);
  assert.match(game, /def && def\.createAdminOnly && !me\.isAdmin/);
  assert.doesNotMatch(game, /createAdminOnly && !isGunaAdmin\(\)/);
  assert.match(game, /id === "holdem" \? "assets\/create-room-icons\/holdem\.webp"/);
  assert.match(game, /var iconClass = "create-game-icon" \+ \(id === "holdem" \? " holdem" : ""\)/);
});

test("Hold'em room creation shows assets, hides tournaments, and selects a ring buy-in", () => {
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
  assert.equal(ring.discoverable, true);
  assert.equal(ring.name, "홀덤");
  const holdemCreateStep = index.slice(
    index.indexOf('id="create-holdem-mode-step"'),
    index.indexOf("<!-- 메뉴 모달 -->")
  );
  assert.match(index, /id="create-holdem-mode-step"/);
  assert.match(index, /id="create-holdem-wallet-balance"/);
  assert.match(index, /내 홀덤 총 자산/);
  assert.match(index, /id="create-holdem-asset-record-btn"[^>]*>자산기록<\/button>/);
  assert.match(index, /id="holdem-asset-record-backdrop"/);
  assert.match(index, /오늘 딴 금액/);
  assert.match(index, /오늘 잃은 금액/);
  assert.doesNotMatch(index, /MY STACK/);
  assert.doesNotMatch(index, /현금과 무관한/);
  assert.doesNotMatch(index, /data-holdem-mode="tournament"/);
  assert.match(index, /id="create-holdem-mode"\s+class="[^"]*\bhidden\b[^"]*"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(index, /data-holdem-mode="ring"/);
  assert.match(index, /data-holdem-speed="normal"/);
  assert.match(index, /data-holdem-speed="turbo"/);
  assert.match(index, /id="create-holdem-speed-group"[^>]*hidden/);
  assert.match(index, /id="create-holdem-buyin-slider"[^>]*type="hidden"[^>]*max="100000"[^>]*step="100"/);
  assert.match(index, /data-holdem-buyin="15000"[\s\S]*data-holdem-buyin="30000"[\s\S]*data-holdem-buyin="75000"/);
  assert.match(index, /참가비용 범위/);
  assert.match(index, /<small>최소<\/small><b>10,000원<\/b>[\s\S]*<small>최대<\/small><b>20,000원<\/b>/);
  assert.match(index, /<small>최소<\/small><b>20,000원<\/b>[\s\S]*<small>최대<\/small><b>40,000원<\/b>/);
  assert.match(index, /<small>최소<\/small><b>50,000원<\/b>[\s\S]*<small>최대<\/small><b>100,000원<\/b>/);
  assert.match(styles, /\.create-holdem-buyin-range\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.create-holdem-buyin-range > span \+ span\s*\{[\s\S]*border-top:\s*1px solid/);
  assert.doesNotMatch(styles, /\.create-holdem-buyin-range > span \+ span\s*\{[\s\S]*border-left:/);
  assert.match(styles, /\.create-holdem-buyin-range b\s*\{[^}]*white-space:\s*nowrap/);
  assert.doesNotMatch(styles, /\.create-holdem-buyin-range b\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(index, /<strong>홀덤<\/strong>/);
  assert.doesNotMatch(index, /id="create-holdem-summary-name"/);
  assert.doesNotMatch(index, /create-holdem-head-title/);
  assert.doesNotMatch(holdemCreateStep, /<span>방 이름<\/span>/);
  assert.match(holdemCreateStep, /create-holdem-wallet create-holdem-wallet-full/);
  assert.doesNotMatch(holdemCreateStep, /create-holdem-buyin-output|create-holdem-buyin-note|create-holdem-rule-summary/);
  assert.doesNotMatch(holdemCreateStep, /SB 100|SB 200|SB 300|BB 200|BB 400|BB 600|李멸? 媛??/);
  assert.match(game, /renderCreateHoldemMode\(initialHoldemSelection\.mode \|\| "ring", createHoldemSpeed\)/);
  assert.match(game, /HOLDEM_INITIAL_ASSETS = 100000/);
  assert.match(game, /HOLDEM_DEFAULT_BUY_IN = 30000/);
  assert.match(game, /HOLDEM_BUY_IN_OPTIONS = \[[\s\S]*amount: 15000[\s\S]*minBuyIn: 10000[\s\S]*maxBuyIn: 20000[\s\S]*amount: 30000[\s\S]*minBuyIn: 20000[\s\S]*maxBuyIn: 40000[\s\S]*amount: 75000[\s\S]*minBuyIn: 50000[\s\S]*maxBuyIn: 100000/);
  assert.match(game, /smallBlind: 100[\s\S]*bigBlind: 200/);
  assert.match(game, /smallBlind: 200[\s\S]*bigBlind: 400/);
  assert.match(game, /smallBlind: 500[\s\S]*bigBlind: 1000/);
  assert.doesNotMatch(game, /smallBlind: 50(?!0)|smallBlind: 250/);
  assert.doesNotMatch(index, /SB 50(?!0)|SB 250|SB 300/);
  assert.match(game, /function holdemBuyInRangeLabel\(amount\)/);
  assert.match(game, /HOLDEM_ASSET_RECORD_STORAGE_KEY = "dongne_holdem_asset_records_v1"/);
  assert.match(game, /function recordHoldemAssetSnapshot\(nick, totalAssets\)/);
  assert.match(game, /recordHoldemAssetSnapshot\(me\.nick, totalAssets\)/);
  assert.match(game, /openHoldemAssetRecordDialog\(me\.nick, totalAssets\)/);
  assert.match(game, /totalAssets[\s\S]*tableBalance[\s\S]*현재 테이블에서 사용 중/);
  assert.match(game, /mode = "ring"/);
  assert.match(game, /modeBox\.hidden = true/);
  assert.match(game, /modeCards\[i\]\.hidden = true/);
  assert.doesNotMatch(game, /토너먼트 방은 관리자만 만들 수 있어요/);
  assert.match(game, /function holdemCreateGameId\(mode, speed\)/);
  assert.match(game, /return "holdem_ring"/);
  assert.doesNotMatch(game, /speed === "turbo" \? "holdem_turbo" : "holdem_tournament"/);
  assert.match(game, /createRoom\([\s\S]*holdemCreateGameId\(createHoldemMode, createHoldemSpeed\)[\s\S]*buyIn: createHoldemBuyIn/);
  assert.match(db, /async function getHoldemWallet\(auth\)/);
  assert.match(styles, /\.room-badge\.holdem_ring/);
  assert.match(styles, /\.room-badge\.holdem_tournament/);
});

test("room visibility follows the catalog and Hold'em rooms are public", () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(catalogSource, context, { filename: "game-catalog.js" });
  for (const id of ["holdem", "holdem_ring"]) {
    assert.equal(context.window.GameCatalog.get(id).discoverable, true);
  }
  for (const id of ["holdem_tournament", "holdem_turbo"]) {
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
    "holdem-table-hint",
    "holdem-board",
    "holdem-table-start-btn",
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
    "holdem-bot-add-btn",
    "holdem-bot-fill-btn",
    "holdem-bot-remove-btn",
    "holdem-action-panel",
    "holdem-solo-bot-fill-panel",
    "holdem-solo-bot-fill-btn",
    "holdem-pre-action-panel",
    "holdem-refill-panel",
    "holdem-refill-btn",
    "holdem-buyin-backdrop",
    "holdem-buyin-slider",
    "holdem-buyin-confirm",
    "holdem-fold-btn",
    "holdem-check-btn",
    "holdem-call-btn",
    "holdem-pre-fold-btn",
    "holdem-pre-check-btn",
    "holdem-pre-call-btn",
    "holdem-pre-call-amount",
    "holdem-bet-btn",
    "holdem-raise-btn",
    "holdem-allin-btn",
    "holdem-raise-slider",
    "holdem-chat-input",
    "holdem-profile-backdrop",
    "holdem-profile-avatar-input",
    "holdem-profile-wallet-balance",
  ].forEach((id) => assert.match(index, new RegExp(`id="${id}"`)));
  assert.match(index, /id="holdem-call-btn"[\s\S]*id="holdem-call-amount" class="holdem-action-call-amount"[\s\S]*class="holdem-action-call-label"/);
  assert.match(index, /id="holdem-connection" class="holdem-connection hidden"[\s\S]*><\/div>/);
  assert.match(index, /id="holdem-announcer" class="holdem-announcer"[\s\S]*><\/div>/);
  assert.doesNotMatch(index, /안전한 테이블에 연결하고 있어요/);
  assert.doesNotMatch(controller, /안전한 서버 테이블에 연결하고 있어요|안전한 테이블에 연결하고 있어요/);

  assert.doesNotMatch(index, /class="holdem-brand"/);
  assert.doesNotMatch(index, /class="holdem-brand-cards"/);
  assert.doesNotMatch(index, /id="holdem-status"/);
  assert.doesNotMatch(index, /id="holdem-people-btn"/);
  assert.doesNotMatch(index, /id="holdem-profile-btn"/);
  assert.match(index, /<nav class="holdem-utility"[\s\S]*class="holdem-exit-stack"[\s\S]*id="holdem-leave-btn"[\s\S]*id="holdem-spectator-chip"[\s\S]*id="holdem-hands-btn"[\s\S]*id="holdem-settings-btn"/);
  assert.match(styles, /\.holdem-topbar\s*\{[\s\S]*background:\s*transparent/);
  assert.match(styles, /\.holdem-exit-stack\s*\{[\s\S]*margin-right:\s*auto/);
  assert.match(styles, /\.holdem-spectator-chip\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(controller, /function renderSpectatorChip\(\)[\s\S]*관전자 /);
  assert.match(controller, /spectators\.map\(function \(nick\)/);
  assert.match(styles, /\.holdem-table\s*\{[\s\S]*aspect-ratio:\s*9\s*\/\s*14/);
  for (let seat = 0; seat < 6; seat += 1) {
    assert.match(
      styles,
      new RegExp(`\\.holdem-seat\\[data-relative-seat="${seat}"\\]`)
    );
  }
  assert.match(styles, /--holdem-seat-avatar-size:\s*clamp\(50px,\s*14\.4vw,\s*72px\)/);
  assert.match(styles, /\.holdem-seat\s*\{[\s\S]*width:\s*clamp\(106px,\s*31vw,\s*158px\)/);
  assert.match(styles, /\.holdem-seat-name\s*\{[\s\S]*font-size:\s*clamp\(11px,\s*3\.2vw,\s*14px\)/);
  assert.match(styles, /\.holdem-seat-stack\s*\{[\s\S]*font-size:\s*clamp\(11px,\s*3\.2vw,\s*14px\)/);
  assert.match(styles, /\.holdem-seat-avatar\s*\{[^}]*border:\s*0/);
  assert.doesNotMatch(styles, /\.holdem-seat-avatar\s*\{[^}]*border:\s*3px solid/);
  assert.match(controller, /function avatarNameHtml\(nick\)[\s\S]*holdem-seat-avatar-name/);
  assert.match(controller, /readProfileAvatar\(seat\.nick\)/);
  assert.match(controller, /event\.target\.closest\("\.holdem-seat:not\(\.is-empty\)"\)/);
  assert.match(styles, /\.holdem-seat-avatar-name\s*\{[\s\S]*-webkit-line-clamp:\s*2/);
  assert.match(styles, /\.holdem-seat\.is-folded\s*\{\s*opacity:\s*1;\s*filter:\s*none;\s*\}/);
  assert.match(styles, /\.holdem-seat\.is-folded \.holdem-seat-avatar,[\s\S]*\.holdem-seat\.is-folded \.holdem-hole-cards \.holdem-card\s*\{[\s\S]*filter:\s*grayscale\(1\)/);
  assert.doesNotMatch(styles, /\.holdem-seat\.is-folded\s*\{[^}]*opacity:\s*\.(?:[0-9]+)/);
  assert.match(styles, /\.create-holdem-wallet small\s*\{[\s\S]*display:\s*none/);
  assert.match(styles, /\.holdem-asset-record-btn\s*\{/);
  assert.match(styles, /\.holdem-asset-record-backdrop\s*\{/);
  assert.match(styles, /\.holdem-asset-record-summary\.is-plus strong/);
  assert.match(index, /class="create-holdem-wallet holdem-profile-wallet"/);
  assert.match(index, /id="holdem-profile-asset-record-btn"[^>]*>자산기록<\/button>/);
  assert.match(controller, /Db\.getHoldemWallet\(currentAuth\)/);
  assert.match(controller, /HoldemAssetRecords\.record\(text\(me\(\)\.nick, 40\), totalAssets\)/);
  assert.match(controller, /id === "holdem-profile-asset-record-btn"[\s\S]*HoldemAssetRecords\.open/);
  assert.match(controller, /Db\.getProfileAvatars\(nicks\)/);
  assert.match(controller, /Db\.saveProfileAvatar\([\s\S]*dataUrl/);
  assert.match(controller, /PROFILE_AVATAR_SIZE = 256/);
  assert.match(controller, /PROFILE_AVATAR_MAX_DATA_URL_LENGTH = 76000/);
  assert.match(controller, /PROFILE_AVATAR_REFRESH_MS = 300000/);
  assert.match(controller, /function resizeAvatarImage\(file\)[\s\S]*formats = \["image\/webp", "image\/jpeg"\]/);
  assert.match(controller, /qualities = \[0\.84, 0\.78, 0\.72, 0\.66, 0\.6\]/);
  assert.match(controller, /candidate\.length <= PROFILE_AVATAR_MAX_DATA_URL_LENGTH/);
  assert.match(db, /async function getProfileAvatars\(nicks\)/);
  assert.match(db, /async function saveProfileAvatar\(auth, dataUrl\)/);
  assert.match(profileAvatarMigration, /alter table public\.accounts[\s\S]*add column if not exists profile_avatar text/i);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\s*\{\s*top:\s*95%;\s*left:\s*50%;\s*\}/);
  assert.match(styles, /\.holdem-card\.back/);
  assert.match(styles, /\.holdem-card\s*\{[\s\S]*--holdem-card-rank-width-auto:[\s\S]*var\(--holdem-card-width/);
  assert.match(styles, /\.holdem-card\s*\{[\s\S]*--holdem-card-rank-top-auto:\s*calc\(var\(--holdem-card-width,\s*clamp\(43px,\s*12vw,\s*74px\)\) \* \.09\)/);
  assert.match(styles, /\.holdem-card-rank svg,[\s\S]*\.holdem-card > \.rank svg\s*\{[\s\S]*fill: currentColor/);
  assert.match(controller, /"10": \{ viewBox: "7\.15 36\.26 115\.14 76\.02"/);
  assert.match(controller, /M62\.8 73\.97 C62\.8 60\.37/);
  assert.match(styles, /\.holdem-board\s*\{[\s\S]*gap:\s*clamp\(3px,\s*\.8vw,\s*5px\)/);
  assert.match(styles, /\.holdem-board\s*\{[\s\S]*perspective:\s*720px/);
  assert.match(styles, /\.holdem-board \.holdem-card\.is-community-flipping\s*\{[\s\S]*holdemCommunityCardFlip 620ms/);
  assert.match(styles, /\.holdem-board \.holdem-card\.is-community-flipping::after\s*\{[\s\S]*background: var\(--holdem-card-back-image, url\("assets\/holdem\/card-back-lucky-clover\.png"\)\) center \/ 100% 100% no-repeat/);
  assert.doesNotMatch(styles, /repeating-linear-gradient\(28deg, transparent 0 5px, #c52835/);
  assert.match(styles, /@keyframes holdemCommunityCardBackFlip/);
  assert.match(styles, /\.is-community-flipping\.is-community-river-flipping\s*\{[\s\S]*animation-name:\s*holdemCommunityRiverFlip[\s\S]*animation-duration:\s*1800ms/);
  assert.match(styles, /\.holdem-result-board \.holdem-card,[\s\S]*\.holdem-result-cards \.holdem-card\s*\{[\s\S]*--holdem-card-rank-top:\s*4px/);
  assert.match(styles, /@keyframes holdemCommunityRiverFlip\s*\{[\s\S]*74%\s*\{[^}]*rotateY\(158deg\)[\s\S]*78%\s*\{[^}]*rotateY\(92deg\)[\s\S]*100%\s*\{[^}]*rotateY\(0\)/);
  assert.match(styles, /@keyframes holdemCommunityRiverBackFlip\s*\{[\s\S]*0%, 76%\s*\{\s*opacity:\s*1[\s\S]*78%, 100%\s*\{\s*opacity:\s*0/);
  assert.match(controller, /COMMUNITY_RIVER_FLIP_MS = 1800/);
  assert.match(controller, /COMMUNITY_RIVER_OPEN_CUE_MS = 1400/);
  assert.match(controller, /var openCueMs = index === 4 \? COMMUNITY_RIVER_OPEN_CUE_MS : 0/);
  assert.match(controller, /var revealDuration = isRiver \? COMMUNITY_RIVER_FLIP_MS : COMMUNITY_CARD_FLIP_MS/);
  assert.match(controller, /is-community-river-flipping/);
  assert.match(controller, /var riverRevealHoldMs = nextBoardCount === 5 && initialBoardCount < 5[\s\S]*COMMUNITY_RIVER_FLIP_MS - RESULT_BOARD_REVEAL_STEP_MS/);
  assert.match(controller, /COMMUNITY_CARD_OPEN_SFX_SRC = "assets\/holdem\/community-card-open\.mp3"/);
  assert.match(controller, /COMMUNITY_CARD_OPEN_SFX_VOLUME = 0\.78/);
  assert.match(controller, /TIMER_WARNING_SFX_SRC = "assets\/warn\.mp3"/);
  assert.match(controller, /TIMER_WARNING_SFX_VOLUME = 1/);
  assert.match(controller, /TURN_START_SFX_SRC = "assets\/holdem\/my-turn\.mp3"/);
  assert.match(controller, /TURN_START_SFX_VOLUME = 0\.92/);
  assert.match(controller, /fold:\s*"assets\/holdem\/fold\.mp3"/);
  assert.match(controller, /check:\s*"assets\/holdem\/check\.mp3"/);
  assert.match(controller, /call:\s*"assets\/holdem\/call\.mp3"/);
  assert.match(controller, /bet:\s*"assets\/holdem\/bet\.mp3"/);
  assert.match(controller, /raise:\s*"assets\/holdem\/raise\.mp3"/);
  assert.match(controller, /allin:\s*"assets\/holdem\/allin\.mp3"/);
  assert.match(controller, /winner:\s*"assets\/holdem\/winner\.mp3"/);
  assert.match(controller, /ALLIN_BGM_SFX_SRC = "assets\/holdem\/allin-bgm\.mp3"/);
  assert.match(controller, /ALLIN_BGM_SFX_VOLUME = 0\.72/);
  assert.match(controller, /function holdemSoundMuted\(\)[\s\S]*localStorage\.getItem\("omok_mute"\) === "1"/);
  assert.match(controller, /HOLDEM_SFX_POOL_SIZE = 2/);
  assert.match(controller, /function ensureHoldemAudioContext\(\)[\s\S]*window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.match(controller, /function preloadHoldemAudioBuffers\(\)[\s\S]*loadHoldemAudioBuffer\("timer-warning", TIMER_WARNING_SFX_SRC\)/);
  assert.match(controller, /function preloadHoldemAudioBuffers\(\)[\s\S]*loadHoldemAudioBuffer\("turn-start", TURN_START_SFX_SRC\)/);
  assert.match(controller, /function playHoldemAudioBuffer\(key, volume\)[\s\S]*context\.createBufferSource\(\)/);
  assert.match(controller, /function ensureHoldemAudioPool\([\s\S]*while \(pool\.length < size\)/);
  assert.match(controller, /function playHoldemAudioPool\([\s\S]*nextHoldemPoolAudio/);
  assert.match(controller, /function playTimerWarningSfx\(\)[\s\S]*playHoldemAudioBuffer\("timer-warning", TIMER_WARNING_SFX_VOLUME\)/);
  assert.match(controller, /function playTurnStartSfx\(\)[\s\S]*playHoldemAudioBuffer\("turn-start", TURN_START_SFX_VOLUME\)/);
  assert.match(controller, /function playHoldemAudioBuffer\(key, volume\)[\s\S]*source\.onended[\s\S]*source\.disconnect\(\)[\s\S]*gain\.disconnect\(\)/);
  assert.match(controller, /function unlockHoldemAudioFallback\(\)[\s\S]*holdemAudioUnlockEl[\s\S]*el\.play\(\)/);
  assert.match(controller, /function unlockHoldemAudio\(\)[\s\S]*holdemAudioUnlocked[\s\S]*preloadHoldemAudioBuffers\(\)[\s\S]*resumeHoldemAudioContext\(\)\.then/);
  assert.match(controller, /function finishHoldemAudioUnlock\(unlocked\)[\s\S]*unbindHoldemAudioUnlock\(\)/);
  assert.match(controller, /function bindHoldemAudioUnlock\(\)[\s\S]*document\.addEventListener\(eventName, unlockHoldemAudio, true\)/);
  assert.match(controller, /function unbindHoldemAudioUnlock\(\)[\s\S]*document\.removeEventListener\(eventName, unlockHoldemAudio, true\)/);
  assert.match(controller, /function enter\(nextApi\)[\s\S]*bindHoldemAudioUnlock\(\);[\s\S]*syncAudio\(\);/);
  assert.match(controller, /function onRootClick\(event\)[\s\S]*unlockHoldemAudio\(\)/);
  assert.match(controller, /function actionSoundEntries\(snapshot\)[\s\S]*snapshot\.actionHistory\.filter/);
  assert.match(controller, /for \(var entryIndex = firstNewIndex;[\s\S]*scheduleActionSfx\(kind, \(entryIndex - firstNewIndex\) \* 90\)/);
  assert.match(controller, /lastActionSoundKey = entryKey/);
  assert.match(controller, /function turnStartSoundKey\(snapshot\)[\s\S]*snapshot\.actingSeat !== snapshot\.heroSeat[\s\S]*snapshot\.deadlineAt/);
  assert.match(controller, /function syncTurnStartSound\(previous, next, hadSnapshot\)[\s\S]*playTurnStartSfx\(\)/);
  assert.match(controller, /syncTurnStartSound\(state, next, hadSnapshot\)/);
  assert.match(controller, /function actionSoundKind\(action\)[\s\S]*action === "check"/);
  assert.match(controller, /if \(kind === "allin"\)[\s\S]*bgmKey !== lastAllinBgmKey[\s\S]*scheduleAllinBgmSfx/);
  assert.match(controller, /function scheduleActionSfx\(kind, delayMs\)[\s\S]*actionSoundTimers\.splice\(index, 1\)/);
  assert.match(controller, /function scheduleCommunityCardOpenSfx\(card, index, delayMs\)[\s\S]*communityCardOpenSoundTimers\.splice\(timerIndex, 1\)/);
  assert.doesNotMatch(controller, /function syncAudio\(\)[\s\S]{0,240}ensureActionSfx\(/);
  assert.match(controller, /allinBgmSfxEl\.loop = false/);
  assert.match(controller, /scheduleActionSfx\("winner", delay\)/);
  assert.match(controller, /function scheduleCommunityCardOpenSfx\(card, index, delayMs\)[\s\S]*setTimeout\(function \(\) \{[\s\S]*playCommunityCardOpenSfx\(\)/);
  assert.match(controller, /scheduleCommunityCardOpenSfx\(card, index, boardRevealState\.delayMs\[index\]\)/);
  assert.match(controller, /syncAudio: syncAudio/);
  assert.match(controller, /ensureTimerWarningSfx\(\)/);
  assert.match(controller, /function timerWarningKey\(info\)[\s\S]*info\.seconds < 1 \|\| info\.seconds > 5[\s\S]*info\.seconds[\s\S]*\.join\(":"\)/);
  assert.match(controller, /COMMUNITY_CARD_FLIP_STAGGER_MS = 120/);
  assert.match(controller, /lastBoardHtml !== html[\s\S]*board\.innerHTML = html/);
  assert.match(controller, /function tableHint\(\)[\s\S]*빈 좌석을 눌러 착석하세요/);
  assert.match(controller, /function renderTableHint\(\)[\s\S]*setText\("holdem-table-hint", tableHint\(\)\)/);
  assert.match(controller, /renderBoard\(\);\s*renderTableHint\(\);/);
  assert.match(styles, /\.holdem-table-hint\s*\{[\s\S]*top:\s*58%/);
  assert.match(styles, /\.holdem-table-hint:empty \{ display: none; \}/);
  assert.match(styles, /\.holdem-board \.holdem-card\s*\{[\s\S]*--holdem-card-width:\s*clamp\(38px,\s*10vw,\s*52px\)/);
  assert.match(styles, /\.holdem-board \.holdem-card\.empty\s*\{[\s\S]*border-style:\s*dashed/);
  assert.match(styles, /\.holdem-board \.holdem-card\.empty\s*\{[\s\S]*border-color:\s*rgba\(213,239,235,\.12\)/);
  assert.match(styles, /\.holdem-board \.holdem-card \+ \.holdem-card\s*\{\s*margin-left:\s*0;\s*\}/);
  assert.match(controller, /function relevantBestCardCodes\(evaluation\)[\s\S]*if \(category === 0\)[\s\S]*groupedRanks = \[evaluation\.tiebreak\[0\]\]/);
  assert.match(controller, /function heroCurrentHand\(\)[\s\S]*if \(code && bestCards\[code\]\) holeCards\[index\] = true[\s\S]*if \(code && bestCards\[code\]\) communityCards\[index\] = true/);
  assert.match(controller, /currentHand && currentHand\.holeCards\[cardIndex\] \? "is-hero-made-hand-card" : ""/);
  assert.match(controller, /class="holdem-hero-hand-badge"/);
  assert.doesNotMatch(controller, /holdem-hero-hand-badge">현재 /);
  assert.match(controller, /is-hero-made-hand-card/);
  assert.match(controller, /class="' \+ holesClass \+ '">' \+ holes \+ currentHandHtml/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\.is-me \.holdem-hole-cards \.holdem-hero-hand-badge\s*\{[\s\S]*bottom:\s*calc\(100% \+ 3px\)[\s\S]*transform:\s*translateX\(-50%\)/);
  assert.doesNotMatch(styles, /\.holdem-seat\[data-relative-seat="0"\]\.is-me \.holdem-hole-cards \.holdem-hero-hand-badge\s*\{[^}]*\b(?:background|border|box-shadow|padding):/);
  const classicCurrentRule = styles.match(/\.holdem-board \.holdem-card\.is-hero-made-hand-card,[\s\S]*?\.holdem-seat\.is-me \.holdem-hole-cards \.holdem-card\.is-hero-made-hand-card\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.match(classicCurrentRule, /border:\s*1px solid rgba\(255,176,0,\.98\)/);
  assert.match(classicCurrentRule, /0 0 4px rgba\(255,122,0,\.86\)[\s\S]*0 0 12px rgba\(255,176,0,\.62\)[\s\S]*0 0 20px rgba\(255,106,0,\.34\)/);
  assert.doesNotMatch(classicCurrentRule, /inset|0 0 0 \d+px/);
  assert.match(styles, /#holdem-call-btn\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(controller, /function actionAmountFitClass\(value\)[\s\S]*is-xl-amount[\s\S]*is-long-amount/);
  assert.match(controller, /class="holdem-action-amount-fit/);
  assert.match(controller, /callAmountNode\.className = "holdem-action-call-amount holdem-action-amount-fit"/);
  assert.match(styles, /\.holdem-action-amount-fit\s*\{[\s\S]*font-size:\s*clamp\(14px,\s*4vw,\s*20px\)/);
  assert.match(styles, /\.holdem-action-amount-fit\.is-long-amount \{ font-size: clamp\(12px,\s*3\.4vw,\s*17px\); \}/);
  assert.match(styles, /\.holdem-action-amount-fit\.is-xl-amount \{ font-size: clamp\(10px,\s*2\.8vw,\s*14px\); \}/);
  assert.match(styles, /#holdem-call-btn \.holdem-action-call-amount\s*\{[\s\S]*font-size:\s*clamp\(14px,\s*4vw,\s*20px\)/);
  assert.match(styles, /#holdem-call-btn \.holdem-action-call-amount\.is-long-amount\s*\{[\s\S]*font-size:\s*clamp\(12px,\s*3\.4vw,\s*17px\)/);
  assert.match(styles, /#holdem-call-btn \.holdem-action-call-amount\.is-xl-amount\s*\{[\s\S]*font-size:\s*clamp\(10px,\s*2\.8vw,\s*14px\)/);
  assert.match(styles, /#holdem-call-btn \.holdem-action-call-label\s*\{[\s\S]*font-size:\s*clamp\(10px,\s*2\.7vw,\s*13px\)/);
  assert.match(styles, /\.holdem-table-start-btn\s*\{[\s\S]*top:\s*66%[\s\S]*시작하기|\.holdem-table-start-btn\s*\{[\s\S]*top:\s*66%/);
  assert.doesNotMatch(controller, /var isNextHandStart = completed && state\.canNext && !state\.newGameBuyInRequired[\s\S]*resultSettled/);
  assert.match(controller, /var tableStartVisible = \(waiting && state\.canStart\) \|\| isNewGameStart/);
  assert.doesNotMatch(controller, /다음 핸드 시작/);
  assert.match(controller, /show\("holdem-table-start-btn", tableStartVisible\)/);
  assert.doesNotMatch(controller, /isNextHandStart \? "다음 핸드" : "시작하기"/);
  assert.doesNotMatch(controller, /id === "holdem-start-btn" \|\| id === "holdem-next-btn" \|\| id === "holdem-table-start-btn"/);
  assert.match(controller, /id === "holdem-start-btn" \|\| id === "holdem-table-start-btn"/);
  cardBackAssets.forEach((asset) => {
    assert.ok(fs.existsSync(path.join(root, asset)), `${asset} should exist`);
    assert.match(styles, new RegExp(asset.replace(/[/.]/g, "\\$&")));
  });
  assert.match(index, /data-card-back-skin="lucky-clover"[\s\S]*data-card-back-skin="royal-candy"[\s\S]*data-card-back-skin="moon-chip"[\s\S]*data-card-back-skin="ivory-minimal"[\s\S]*data-card-back-skin="teal-wave"[\s\S]*data-card-back-skin="midnight-gold"/);
  assert.match(index, /data-card-front-skin="classic"[\s\S]*data-card-front-skin="four-color"/);
  assert.match(index, /data-card-front-skin="classic"[\s\S]*classic spade">♠<\/span>[\s\S]*classic heart">♥<\/span>[\s\S]*classic diamond">♦<\/span>[\s\S]*classic club">♣<\/span>/);
  assert.match(index, /data-card-front-skin="four-color"[\s\S]*mini-card spade">♠<\/span>[\s\S]*mini-card heart">♥<\/span>[\s\S]*mini-card diamond">♦<\/span>[\s\S]*mini-card club">♣<\/span>/);
  assert.doesNotMatch(index, /holdem-card-front-preview[\s\S]*[AKQJ][♠♥♦♣]/);
  assert.match(styles, /\.holdem-screen\[data-card-front-skin="four-color"\] \.holdem-card:not\(\.back\):not\(\.empty\)\s*\{[\s\S]*color:\s*#fff/);
  assert.match(styles, /\.holdem-screen\[data-card-front-skin="four-color"\] \.holdem-card:not\(\.back\):not\(\.empty\)\s*\{[\s\S]*border-color:\s*transparent/);
  assert.match(styles, /\.holdem-card\[data-suit="s"\]\s*\{[\s\S]*--holdem-card-mark-width:\s*84%[\s\S]*--holdem-card-mark-height:\s*60%/);
  assert.match(styles, /\.holdem-screen\[data-card-front-skin="four-color"\] \.holdem-card\[data-suit="s"\]\s*\{\s*background:\s*#323a40/);
  assert.match(styles, /\.holdem-front-mini-card\.classic\s*\{[\s\S]*background:\s*#fff/);
  assert.doesNotMatch(styles, /(?:^|\n)\.holdem-front-mini-card\.spade\s*\{\s*background:\s*#323a40/);
  assert.match(styles, /\.holdem-card-front-preview\.four-color \.holdem-front-mini-card\.spade\s*\{\s*background:\s*#323a40/);
  assert.match(styles, /\.holdem-front-mini-card\s*\{[\s\S]*font-size:\s*15px/);
  assert.match(styles, /\.holdem-card\[data-suit="d"\]\s*\{\s*color:\s*#e3434c/);
  assert.match(styles, /\.holdem-screen\[data-card-front-skin="four-color"\] \.holdem-card\[data-suit="h"\]\s*\{\s*background:\s*#e3434c/);
  assert.match(styles, /\.holdem-screen\[data-card-front-skin="four-color"\] \.holdem-card\[data-suit="d"\]\s*\{\s*background:\s*#2878d9/);
  const fourColorCurrentRule = styles.match(/\.holdem-screen\[data-card-front-skin="four-color"\] \.holdem-card\.is-hero-made-hand-card:not\(\.back\)\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.match(fourColorCurrentRule, /border:\s*1px solid rgba\(255,238,160,\.78\)/);
  assert.match(fourColorCurrentRule, /0 0 3px rgba\(255,218,96,\.38\)[\s\S]*0 0 7px rgba\(255,198,48,\.16\)/);
  assert.doesNotMatch(fourColorCurrentRule, /inset|0 0 0 \d+px/);
  const fourColorWinnerRule = styles.match(/\.holdem-screen\[data-card-front-skin="four-color"\] \.holdem-card\.is-winning-combo-card:not\(\.back\)\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.match(fourColorWinnerRule, /border:\s*1px solid rgba\(255,242,177,\.88\)/);
  assert.match(fourColorWinnerRule, /0 0 4px rgba\(255,220,92,\.48\)[\s\S]*0 0 9px rgba\(255,194,42,\.22\)/);
  assert.doesNotMatch(fourColorWinnerRule, /inset|0 0 0 \d+px/);
  assert.match(styles, /\.holdem-card\.back\s*\{[\s\S]*background: var\(--holdem-card-back-image, url\("assets\/holdem\/card-back-lucky-clover\.png"\)\) center \/ 100% 100% no-repeat/);
  assert.match(controller, /function communityCardHtml\(card, index, newRevealIndex, now, currentHand\) \{\s*if \(!card\) return cardHtml\(null, "back"\)/);
  assert.match(controller, /html \+= card \? communityCardHtml\(card, i, 0, now, currentHand\) : cardHtml\(null, "back"\)/);
  const cardBackRule = styles.match(/\.holdem-card\.back\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.doesNotMatch(cardBackRule, /--holdem-card-back-image:/);
  assert.match(styles, /\.holdem-screen\[data-card-back-skin="royal-candy"\]\s*\{[\s\S]*card-back-royal-candy\.png/);
  assert.match(styles, /\.holdem-screen\[data-card-back-skin="ivory-minimal"\]\s*\{[\s\S]*card-back-ivory-minimal\.png/);
  assert.match(styles, /\.holdem-screen\[data-card-back-skin="teal-wave"\]\s*\{[\s\S]*card-back-teal-wave\.png/);
  assert.match(styles, /\.holdem-screen\[data-card-back-skin="midnight-gold"\]\s*\{[\s\S]*card-back-midnight-gold\.png/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards\s*\{[\s\S]*top: -3px[\s\S]*translate\(-50%, -45%\)/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards\.is-revealed-cards\s*\{[\s\S]*z-index:\s*24[\s\S]*translate\(-50%, -72%\)/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards \.holdem-card\.back\s*\{[\s\S]*--holdem-card-width:\s*clamp\(16px,\s*4\.6vw,\s*24px\)/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards \.holdem-card\.back\s*\{[\s\S]*box-shadow:\s*0 1px 3px rgba\(0,0,0,\.32\)/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards\.is-revealed-cards \.holdem-card:not\(\.back\):not\(\.empty\)\s*\{[\s\S]*--holdem-card-width:\s*clamp\(30px,\s*8vw,\s*42px\)/);
  assert.match(styles, /\.holdem-hole-cards \.holdem-card \+ \.holdem-card \{ margin-left: -5px; \}/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards \.holdem-card\.back \+ \.holdem-card\.back \{ margin-left: -10px; \}/);
  assert.match(styles, /\.holdem-seat:not\(\.is-me\) \.holdem-hole-cards\.is-revealed-cards \.holdem-card:not\(\.back\):not\(\.empty\) \+ \.holdem-card:not\(\.back\):not\(\.empty\) \{ margin-left: -12px; \}/);
  assert.match(styles, /\.holdem-seat\.is-me \.holdem-hole-cards \.holdem-card \+ \.holdem-card \{ margin-left: 6px; \}/);
  assert.match(styles, /\.holdem-hole-cards \.holdem-card:first-of-type\s*\{[\s\S]*rotate\(-7deg\)/);
  assert.match(styles, /\.holdem-hole-cards \.holdem-card:last-of-type\s*\{[\s\S]*rotate\(7deg\)/);
  assert.match(styles, /\.holdem-seat\.is-me \.holdem-hole-cards \.holdem-card:first-of-type,[\s\S]*\.holdem-seat\.is-me \.holdem-hole-cards \.holdem-card:last-of-type\s*\{[\s\S]*transform:\s*none/);
  assert.match(controller, /small_blind:\s*formatChips\(seat\.bet \|\| state\.smallBlind\)/);
  assert.match(controller, /big_blind:\s*formatChips\(seat\.bet \|\| state\.bigBlind\)/);
  assert.doesNotMatch(controller, /badges \+= "<span>SB<\/span>"|badges \+= "<span>BB<\/span>"/);
  assert.match(styles, /\.holdem-seat-action\.action-small-blind,[\s\S]*\.holdem-seat-action\.action-big-blind\s*\{/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\s*\{ top: 95%; left: 50%; \}/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\.is-me\s*\{[\s\S]*--holdem-hero-profile-center-x:\s*calc\(50% - \(var\(--holdem-hero-hand-column\) \+ var\(--holdem-hero-column-gap\)\) \/ 2\)[\s\S]*--holdem-seat-timer-x:\s*var\(--holdem-hero-profile-center-x\)[\s\S]*--holdem-seat-timer-y:\s*calc\(var\(--holdem-seat-avatar-size\) \/ 2\)[\s\S]*grid-template-columns:\s*var\(--holdem-hero-profile-column\) minmax\(var\(--holdem-hero-hand-column\),\s*max-content\)[\s\S]*grid-template-rows:\s*auto auto auto auto[\s\S]*justify-content:\s*center/);
  assert.match(styles, /--holdem-hero-column-gap:\s*clamp\(5px,\s*1\.8vw,\s*10px\)/);
  assert.doesNotMatch(styles, /--holdem-hero-card-zone|padding-right:\s*var\(--holdem-hero-card-zone\)/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\.is-me \.holdem-seat-avatar\s*\{[\s\S]*grid-column:\s*1[\s\S]*grid-row:\s*1/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\.is-me \.holdem-seat-name\s*\{[\s\S]*grid-column:\s*1[\s\S]*grid-row:\s*3[\s\S]*text-align:\s*center/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\.is-me \.holdem-seat-stack\s*\{[\s\S]*grid-column:\s*1[\s\S]*grid-row:\s*4[\s\S]*text-align:\s*center[\s\S]*white-space:\s*nowrap/);
  assert.match(styles, /\.holdem-board\s*\{[\s\S]*top:\s*62%/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\.is-me \.holdem-hole-cards\s*\{[\s\S]*position:\s*relative[\s\S]*grid-column:\s*2[\s\S]*grid-row:\s*1 \/ span 4[\s\S]*justify-self:\s*center[\s\S]*transform:\s*none/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\] \.holdem-seat-action\s*\{[\s\S]*top:\s*var\(--holdem-seat-timer-y\)[\s\S]*left:\s*var\(--holdem-seat-timer-x\)[\s\S]*z-index:\s*18/);
  assert.match(styles, /\.holdem-seat\s*\{[\s\S]*--holdem-seat-timer-x:\s*50%[\s\S]*--holdem-seat-timer-y:\s*calc\(var\(--holdem-seat-avatar-size\) \/ 2\)/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\.is-me\s*\{[\s\S]*--holdem-seat-timer-x:\s*var\(--holdem-hero-profile-center-x\)[\s\S]*--holdem-seat-timer-y:\s*calc\(var\(--holdem-seat-avatar-size\) \/ 2\)/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="1"\] \.holdem-seat-action,[\s\S]*\.holdem-seat\[data-relative-seat="2"\] \.holdem-seat-action\s*\{[\s\S]*left:\s*calc\(50% \+ var\(--holdem-seat-avatar-size\) \/ 2 \+ 24px\)/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="3"\] \.holdem-seat-action\s*\{[\s\S]*top:\s*calc\(var\(--holdem-seat-avatar-size\) \+ 56px\)/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="4"\] \.holdem-seat-action,[\s\S]*\.holdem-seat\[data-relative-seat="5"\] \.holdem-seat-action\s*\{[\s\S]*left:\s*calc\(50% - var\(--holdem-seat-avatar-size\) \/ 2 - 24px\)/);
  assert.match(controller, /is-visible-cards is-revealed-cards/);
  assert.match(controller, /function heroRevealCardClass\(cardIndex\)[\s\S]*heroPublicRevealIndexes\(state\)/);
  assert.match(controller, /function syncHeroRevealThrow\(previous, next, hadSnapshot\)[\s\S]*heroRevealThrowPlayedKey = canAnimate/);
  assert.match(controller, /function heroPublicRevealIndexes\(snapshot\)[\s\S]*snapshot\.phase !== "complete"/);
  assert.match(controller, /function maybeStartHeroRevealThrow\(stage\)[\s\S]*stage === "action"/);
  assert.match(controller, /heroRevealThrowUntil = Date\.now\(\) \+ HERO_REVEAL_THROW_MS/);
  assert.match(controller, /heroRevealCardClass\(cardIndex\)/);
  assert.match(styles, /\.holdem-screen\.is-result-cards-first \.holdem-seat:not\(\.is-me\)/);
  assert.match(styles, /\.holdem-seat\.is-me \.holdem-hole-cards \.holdem-card\.is-hero-reveal-forward\s*\{[\s\S]*transform:\s*translate\(var\(--holdem-reveal-x/);
  assert.match(styles, /\.holdem-seat\.is-me \.holdem-hole-cards \.holdem-card\.is-hero-reveal-throwing\s*\{[\s\S]*animation:\s*holdemHeroRevealThrow/);
  assert.match(styles, /@keyframes holdemHeroRevealThrow[\s\S]*translate\(var\(--holdem-reveal-x/);
  assert.match(styles, /\.holdem-fold-reveal-choice\s*\{[\s\S]*min-height:\s*52px/);
  assert.match(controller, /class="holdem-seat-open-icon"/);
  assert.match(controller, /seat \? readProfileAvatar\(seat\.nick\) : ""/);
  assert.match(controller, /role="button" tabindex="0"/);
  assert.match(styles, /\.holdem-seat-open-icon\s*\{/);
  assert.match(styles, /@media \(min-width: 900px\)[\s\S]*\.holdem-table/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the betting UI keeps raise choices collapsed until requested", () => {
  assert.match(controller, /var raiseMenuOpen = false/);
  assert.match(controller, /var moneyUnitMode = "chips"/);
  assert.match(controller, /var cardFrontSkin = DEFAULT_CARD_FRONT_SKIN/);
  assert.match(controller, /var cardBackSkin = DEFAULT_CARD_BACK_SKIN/);
  assert.match(controller, /HOLDEM_SETTINGS_STORAGE_PREFIX = "dongne_holdem_settings:"/);
  assert.match(controller, /function restoreHoldemSettings\(\)[\s\S]*moneyUnitMode = saved\.moneyUnitMode === "bb" \? "bb" : "chips"[\s\S]*cardFrontSkin = normalizeCardFrontSkin\(saved\.cardFrontSkin\)[\s\S]*cardBackSkin = normalizeCardBackSkin\(saved\.cardBackSkin\)/);
  assert.match(controller, /function enter\(nextApi\)[\s\S]*api = nextApi;[\s\S]*restoreHoldemSettings\(\)/);
  assert.match(controller, /function toggleMoneyUnitMode\(\)[\s\S]*moneyUnitMode === "bb" \? "chips" : "bb"/);
  assert.match(controller, /function setMoneyUnitMode\(mode\)[\s\S]*writeStoredHoldemSettings\(\{ moneyUnitMode: moneyUnitMode \}\)/);
  assert.match(controller, /function setCardFrontSkin\(skin\)[\s\S]*writeStoredHoldemSettings\(\{ cardFrontSkin: cardFrontSkin \}\)/);
  assert.match(controller, /function setCardBackSkin\(skin\)[\s\S]*writeStoredHoldemSettings\(\{ cardBackSkin: cardBackSkin \}\)/);
  assert.match(controller, /var settingsOpen = false/);
  assert.match(controller, /id === "holdem-settings-btn"[\s\S]*settingsOpen = !settingsOpen/);
  assert.match(controller, /hasAttribute\("data-card-front-skin"\)[\s\S]*setCardFrontSkin\(button\.getAttribute\("data-card-front-skin"\)\)/);
  assert.match(controller, /hasAttribute\("data-card-back-skin"\)[\s\S]*setCardBackSkin\(button\.getAttribute\("data-card-back-skin"\)\)/);
  assert.match(controller, /hasAttribute\("data-money-unit-mode"\)[\s\S]*setMoneyUnitMode\(button\.getAttribute\("data-money-unit-mode"\)\)/);
  assert.match(controller, /querySelectorAll\("\.holdem-unit-option"\)[\s\S]*option\.setAttribute\("aria-checked", selected \? "true" : "false"\)/);
  assert.match(index, /class="holdem-unit-option"[\s\S]*data-money-unit-mode="chips"[\s\S]*data-money-unit-mode="bb"/);
  assert.doesNotMatch(index, /id="holdem-unit-toggle"/);
  assert.match(styles, /\.holdem-settings-panel\s*\{[\s\S]*width:\s*min\(304px,\s*calc\(100vw - 16px\)\)[\s\S]*border-radius:\s*8px/);
  assert.match(styles, /\.holdem-unit-options\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(styles, /\.holdem-unit-option\[aria-checked="true"\]\s*\{[\s\S]*background:\s*#176e6b/);
  assert.match(styles, /\.holdem-card-front-options\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(styles, /\.holdem-card-back-name\s*\{/);
  assert.match(controller, /show\("holdem-raise-panel", hasMove && canSize && raiseMenuOpen\)/);
  assert.match(controller, /var queuedAction = null/);
  assert.match(controller, /function queuedActionOptions\(\)[\s\S]*fold_check[\s\S]*maxCallAmount/);
  assert.match(controller, /function renderPreActionPanel\(options, busy, hasMove\)[\s\S]*holdem-pre-action-panel[\s\S]*holdem-pre-call-amount/);
  assert.doesNotMatch(index, /id="holdem-pre-action-title"/);
  assert.doesNotMatch(styles, /\.holdem-pre-action-title\s*\{/);
  assert.match(controller, /function maybePerformQueuedAction\(\)[\s\S]*queuedExecutableMove\(\)[\s\S]*performMove\(move\)/);
  assert.match(controller, /id === "holdem-pre-fold-btn"[\s\S]*queuePreAction\("fold"\)/);
  assert.match(controller, /id === "holdem-fold-btn"[\s\S]*queuePreAction\("fold"\)[\s\S]*performMove\("fold"\)/);
  assert.match(controller, /id === "holdem-raise-btn"[\s\S]*raiseMenuOpen = true[\s\S]*renderControls\(\)/);
  assert.match(controller, /kind === "two-pot"[\s\S]*potAfterCall \* 2/);
  assert.match(controller, /kind === "four-pot"[\s\S]*potAfterCall \* 4/);
  assert.match(controller, /kind === "eight-pot"[\s\S]*potAfterCall \* 8/);
  assert.match(controller, /function quickBetAvailable\(kind\)[\s\S]*quickBetRawTarget\(kind\) < bounds\.max/);
  assert.match(controller, /buttons\[i\]\.classList\.toggle\("hidden", !available\)/);
  assert.match(index, /data-holdem-bet="two-pot" data-holdem-bet-tier="over"/);
  assert.match(index, /data-holdem-bet="four-pot" data-holdem-bet-tier="over"/);
  assert.match(index, /data-holdem-bet="eight-pot" data-holdem-bet-tier="over"/);
  assert.doesNotMatch(index, /data-holdem-bet="one-half-pot"|data-holdem-bet="three-pot"/);
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
  assert.match(controller, /state\.newGameBuyInRequired[\s\S]*openBuyInDialog\("new_game", state\.heroSeat\)/);
  assert.match(controller, /state\.phase !== "complete" \|\| !state\.canStart \|\| state\.newGameBuyInRequired/);
  assert.match(controller, /buyIn:\s*amount[\s\S]*label:\s*"new_game"/);
  assert.match(engine, /function resetPracticeSessionStacks\(state, cmd\)/);
  assert.match(engine, /function transitionPracticeJoinToHumanMatch\([\s\S]*state\.seats = \[null, null, null, null, null, null\][\s\S]*convertRingTableToAssetBacked\(state\)/);
  assert.match(engine, /function repairMixedPracticeTable\([\s\S]*state\.newGameBuyInRequired = true/);
  assert.match(controller, /function openPracticeJoinBuyIn\(\)[\s\S]*openBuyInDialog\("join_request"/);
  assert.match(controller, /function openProfileRebuyIfNeeded\(seat\)[\s\S]*openBuyInDialog\("rebuy", targetSeat\)/);
  assert.match(controller, /openProfileRebuyIfNeeded\(profileSeat\.getAttribute\("data-seat"\)\)[\s\S]*openProfileDialog\(profileSeat\.getAttribute\("data-seat"\)\)/);
  assert.match(controller, /if \(state\.practiceMode\) \{[\s\S]*autoSeatKey = "ai-practice"/);
  assert.match(controller, /!isHandActive\(state\.phase\) && !practiceSpectator/);
  assert.match(engine, /reason:\s*"buy_in_required"/);
  assert.match(controller, /AI와 하는 연습용 임시 원화 자산/);
  assert.match(controller, /연습용 금액을 자동으로 충전/);
  assert.match(styles, /\.holdem-seat-action\s*\{/);
  assert.match(controller, /function actionTagEntryKey\(entry, snapshot\)[\s\S]*entry\.seq \|\| action[\s\S]*amount \|\| 0/);
  assert.match(controller, /pendingActionTagAnimationKeys\[actionTagKey\] = true/);
  assert.match(controller, /function seatActionAnimationKey\(seat, absolute\)[\s\S]*latestSeatActionHistory\(seat\)[\s\S]*latest\.seq \|\| action[\s\S]*seatDisplayActionAmount\(seat\)/);
  assert.match(controller, /actionEnterClass = " is-action-enter"/);
  assert.match(controller, /pendingActionTagAnimationKeys\[actionAnimationKey\][\s\S]*delete pendingActionTagAnimationKeys\[actionAnimationKey\]/);
  assert.match(controller, /suppressActionTagAnimations = !hadSnapshot/);
  assert.match(controller, /leaving:\s*!!firstDefined\(entry\.leaving/);
  assert.match(controller, /classes\.push\("is-leaving"\)/);
  assert.match(controller, /class="holdem-seat-leave-badge"[\s\S]*나가기 예약/);
  assert.match(styles, /\.holdem-seat-leave-badge\s*\{/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="0"\]\.is-me \.holdem-seat-leave-badge\s*\{[\s\S]*grid-row:\s*2/);
  assert.doesNotMatch(styles, /\.holdem-seat-action\s*\{[^}]*animation:/);
  assert.doesNotMatch(styles, /\.holdem-seat-action\s*\{[^}]*will-change:/);
  assert.match(styles, /\.holdem-seat-action\.is-action-enter\s*\{[\s\S]*animation:\s*holdemActionTagPop/);
  assert.match(styles, /\.holdem-seat-action\.is-action-enter\s*\{[\s\S]*will-change:\s*transform, filter, opacity/);
  assert.match(styles, /\.holdem-seat-action\.action-allin\s*\{[\s\S]*animation:\s*holdemActionTagAllinPulse 1\.12s ease-in-out infinite/);
  assert.match(styles, /\.holdem-seat-action\.action-allin\.is-action-enter\s*\{[\s\S]*holdemActionTagPop \.48s[\s\S]*holdemActionTagAllinPulse 1\.12s ease-in-out \.48s infinite/);
  assert.doesNotMatch(styles, /\.holdem-seat-action\.action-allin\.is-action-enter::before\s*\{/);
  assert.match(styles, /@keyframes holdemActionTagAllinPulse[\s\S]*scale\(1\)[\s\S]*scale\(1\.07\)[\s\S]*rgba\(255,87,142,\s*\.2\)/);
  assert.match(controller, /if \(lastSeatsHtml !== nextHtml\)[\s\S]*box\.innerHTML = nextHtml/);
  assert.match(styles, /\.holdem-seat-action\.is-action-enter::before\s*\{[\s\S]*animation:\s*holdemActionTagShine/);
  assert.match(styles, /@keyframes holdemActionTagPop[\s\S]*scale\(1\.18\)[\s\S]*scale\(1\)/);
  assert.match(styles, /\.holdem-seat-turn-timer\s*\{/);
  assert.match(controller, /timer\.setAttribute\("data-seconds", seconds\)/);
  assert.match(styles, /\.holdem-seat-turn-timer\s*\{[\s\S]*top:\s*var\(--holdem-seat-timer-y\)[\s\S]*left:\s*var\(--holdem-seat-timer-x\)[\s\S]*width:\s*var\(--holdem-seat-avatar-size\)[\s\S]*height:\s*var\(--holdem-seat-avatar-size\)/);
  assert.match(styles, /\.holdem-seat-turn-timer::before\s*\{[\s\S]*conic-gradient\(#4df5d9 calc\(var\(--holdem-seat-timer-ratio\) \* 1turn\)/);
  assert.match(styles, /\.holdem-seat-turn-timer::after\s*\{[\s\S]*content:\s*attr\(data-seconds\)[\s\S]*right:\s*-1px[\s\S]*bottom:\s*-2px/);
  assert.match(styles, /\.holdem-seat-turn-timer::after\s*\{[\s\S]*border:\s*0/);
  assert.match(styles, /\.holdem-seat-turn-timer\.urgent\s*\{[\s\S]*width:\s*var\(--holdem-seat-avatar-size\)[\s\S]*height:\s*var\(--holdem-seat-avatar-size\)/);
  assert.match(styles, /\.holdem-seat-turn-timer\.urgent::after\s*\{[\s\S]*inset:\s*0[\s\S]*width:\s*100%[\s\S]*height:\s*100%/);
  assert.match(styles, /\.holdem-seat-turn-timer\.urgent::before\s*\{[\s\S]*#ff433d/);
  assert.match(controller, /urgent:\s*remaining <= 5000/);
  assert.match(controller, /function timerWarningKey\(info\)[\s\S]*info\.seconds > 5[\s\S]*state\.actingSeat !== state\.heroSeat/);
  assert.match(controller, /function syncTimerWarning\(info\)[\s\S]*playTimerWarningSfx\(\)/);
  assert.match(controller, /syncTimerWarning\(info\)/);
  assert.match(styles, /@keyframes holdemSeatTimerUrgent/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-action-summary \{ display: none; \}/);
  assert.match(styles, /\.holdem-action-panel:not\(\.hidden\)\s*\{[\s\S]*bottom:\s*max\(8px,\s*env\(safe-area-inset-bottom\)\)[\s\S]*background:\s*transparent/);
  assert.match(styles, /\.holdem-solo-bot-fill-panel\s*\{[\s\S]*bottom:\s*max\(8px,\s*env\(safe-area-inset-bottom\)\)[\s\S]*max-width:\s*520px/);
  assert.match(styles, /\.holdem-solo-bot-fill-btn\s*\{[\s\S]*min-height:\s*52px[\s\S]*background:\s*linear-gradient/);
  assert.match(styles, /\.holdem-action-panel:not\(\.hidden\) \.holdem-action-summary \{ display: none; \}/);
  assert.match(styles, /\.holdem-action-panel:not\(\.hidden\) \.holdem-action-buttons,[\s\S]*\.holdem-screen\.is-actioning \.holdem-action-buttons\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-raise-panel \{[\s\S]*position: absolute[\s\S]*left: auto[\s\S]*right: 0[\s\S]*bottom: 60px[\s\S]*width: calc\(\(100% - 16px\) \/ 3\)[\s\S]*pointer-events: none/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-quick-bets\s*\{[\s\S]*display: flex[\s\S]*flex-direction: column[\s\S]*justify-content: flex-end[\s\S]*gap: 6px/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-quick-bets button\s*\{[\s\S]*pointer-events: auto/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-action-buttons > \.holdem-action \{ grid-row: 1; \}/);
  assert.match(styles, /\.holdem-screen\.is-actioning #holdem-fold-btn \{ grid-column: 1; \}/);
  assert.match(styles, /\.holdem-screen\.is-actioning #holdem-check-btn,[\s\S]*#holdem-call-btn \{ grid-column: 2; \}/);
  assert.match(styles, /\.holdem-screen\.is-actioning #holdem-bet-btn,[\s\S]*#holdem-raise-btn,[\s\S]*#holdem-allin-btn \{ grid-column: 3; \}/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-quick-bets button\[data-holdem-bet="allin"\] \{ order: 1; \}/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-quick-bets button\[data-holdem-bet="half"\] \{ order: 7; \}/);
  assert.doesNotMatch(styles, /\.holdem-screen\.is-actioning \.holdem-quick-bets button\[data-holdem-bet(?:-tier)?="(?:allin|eight-pot|four-pot|two-pot|pot|three-quarter|half|over)"\][^{]*\{[^}]*grid-(?:row|column):/);
  assert.match(styles, /\.holdem-screen\.is-raise-menu-open #holdem-bet-btn,[\s\S]*#holdem-raise-btn\s*\{[\s\S]*visibility: hidden/);
  assert.match(styles, /\.holdem-screen\.is-actioning:not\(\.is-chat-open\) \.holdem-chat-row \{[\s\S]*opacity: 0/);
  assert.match(styles, /\.holdem-screen\.is-actioning\.is-chat-open \.holdem-chat-row\s*\{[\s\S]*bottom:\s*calc\(max\(8px,\s*env\(safe-area-inset-bottom\)\) \+ 110px \+ var\(--holdem-keyboard-offset,\s*0px\)\)/);
  assert.match(styles, /\.holdem-screen\.is-pre-actioning\.is-chat-open \.holdem-chat-row\s*\{[\s\S]*bottom:\s*calc\(max\(8px,\s*env\(safe-area-inset-bottom\)\) \+ 112px \+ var\(--holdem-keyboard-offset,\s*0px\)\)/);
  assert.match(styles, /\.holdem-screen\.is-fold-revealing\.is-chat-open \.holdem-chat-row\s*\{[\s\S]*bottom:\s*calc\(max\(8px,\s*env\(safe-area-inset-bottom\)\) \+ 110px \+ var\(--holdem-keyboard-offset,\s*0px\)\)/);
  assert.match(styles, /\.holdem-screen\.is-keyboard-open\.is-actioning\.is-chat-open \.holdem-chat-row,[\s\S]*\.holdem-screen\.is-keyboard-open\.is-fold-revealing\.is-chat-open \.holdem-chat-row\s*\{[\s\S]*bottom:\s*calc\(max\(6px,\s*env\(safe-area-inset-bottom\)\) \+ var\(--holdem-keyboard-offset,\s*0px\)\)/);
  assert.match(styles, /\.holdem-pre-action-panel\s*\{[\s\S]*bottom:\s*max\(8px,\s*env\(safe-area-inset-bottom\)\)/);
  assert.match(styles, /\.holdem-fold-reveal-panel\s*\{[\s\S]*bottom:\s*max\(8px,\s*env\(safe-area-inset-bottom\)\)/);
  assert.match(styles, /\.holdem-chat-toggle\s*\{[\s\S]*left:\s*12px[\s\S]*bottom:\s*max\(66px,\s*calc\(env\(safe-area-inset-bottom\) \+ 62px\)\)/);
  assert.match(styles, /\.holdem-screen\.is-actioning \.holdem-chat-toggle\s*\{[\s\S]*bottom:\s*calc\(max\(8px,\s*env\(safe-area-inset-bottom\)\) \+ 68px\)/);
  assert.match(styles, /\.holdem-screen\.is-pre-actioning \.holdem-chat-toggle\s*\{[\s\S]*bottom:\s*calc\(max\(8px,\s*env\(safe-area-inset-bottom\)\) \+ 70px\)/);
  assert.match(styles, /\.holdem-screen\.is-fold-revealing \.holdem-chat-toggle\s*\{[\s\S]*bottom:\s*calc\(max\(8px,\s*env\(safe-area-inset-bottom\)\) \+ 68px\)/);
  assert.doesNotMatch(styles, /\.holdem-screen\.is-actioning \.holdem-chat-toggle\s*\{[^}]*left:/);
  assert.doesNotMatch(styles, /\.holdem-screen\.is-pre-actioning \.holdem-chat-toggle\s*\{[^}]*left:/);
  assert.doesNotMatch(styles, /\.holdem-screen\.is-fold-revealing \.holdem-chat-toggle\s*\{[^}]*left:/);
  assert.doesNotMatch(styles, /\.holdem-screen\.is-actioning \.holdem-chat-toggle \{ left: calc\(50% - 261px\)/);
  const desktopHoldemStart = styles.indexOf("@media (min-width: 900px)");
  const desktopHoldemEnd = styles.indexOf("@media (prefers-reduced-motion: reduce)", desktopHoldemStart);
  const desktopHoldemStyles = styles.slice(desktopHoldemStart, desktopHoldemEnd);
  const desktopChatRule = desktopHoldemStyles.match(/\.holdem-chat-row\s*\{([^}]*)\}/)?.[1] || "";
  assert.ok(desktopHoldemStart >= 0 && desktopHoldemEnd > desktopHoldemStart);
  assert.match(desktopChatRule, /right:\s*0/);
  assert.match(desktopChatRule, /left:\s*0/);
  assert.match(desktopChatRule, /width:\s*720px/);
  assert.doesNotMatch(desktopChatRule, /transform:/);
  assert.doesNotMatch(desktopHoldemStyles, /\.holdem-action-panel\s*,\s*\.holdem-chat-row/);
  assert.match(controller, /viewportScale[\s\S]*Math\.abs\(viewportScale - 1\) > 0\.01[\s\S]*min-width: 900px[\s\S]*pointer: fine/);
  assert.match(styles, /\.holdem-pre-action\.is-queued\s*\{[\s\S]*border-color:\s*rgba\(117, 238, 255, \.76\)/);
  assert.match(styles, /\.holdem-pre-action\.is-queued::after\s*\{[\s\S]*content:\s*"예약"/);
  assert.doesNotMatch(styles, /is-unreservable/);
  assert.doesNotMatch(controller, /unreservableMove/);
});

test("hand results stay on the table without a popup and advance automatically", () => {
  assert.match(controller, /var AUTO_NEXT_HAND_MS = 5000/);
  assert.match(controller, /var RESULT_REVIEW_MS = 4000/);
  assert.match(controller, /function renderHandResult\(\)[\s\S]*panel\.classList\.add\("hidden"\)/);
  assert.doesNotMatch(controller, /panel\.classList\.toggle\("hidden", !announced\)/);
  assert.match(controller, /show\("holdem-lobby", false\)/);
  assert.match(controller, /refreshSnapshot\("enter", true\)/);
  assert.doesNotMatch(controller, /startTimers\(\);\s*joinTable\(\);/);
  assert.match(controller, /function chooseEmptySeat\(seatIndex\)[\s\S]*addBot\(\{ seat: targetSeat \}\)[\s\S]*requestHumanSeatJoin\(targetSeat\)/);
  assert.match(controller, /function maybeAutoSeatJoin\(\)[\s\S]*firstEmptySeat\(\)[\s\S]*requestHumanSeatJoin\(targetSeat\)/);
  assert.match(index, /id="holdem-buyin-spectate"[^>]*>관전하기</);
  assert.match(index, /<dt>내 총자산<\/dt>[\s\S]*id="holdem-buyin-balance"/);
  assert.match(controller, /function displayedBuyInBalance\(bounds\)[\s\S]*var spent = buyInMode === "rebuy"[\s\S]*walletBalance - spent/);
  assert.match(index, /id="holdem-profile-role-action"[^>]*>관전하기</);
  assert.match(engine, /ready:\s*stack > 0/);
  assert.match(engine, /leavingIntent:\s*""/);
  assert.match(engine, /function normalizeLeavingIntent\(value\)/);
  assert.match(engine, /var leaveIntent = normalizeLeavingIntent\(cmd\.leaveIntent/);
  assert.match(engine, /cmd\.cancelLeave === true/);
  assert.match(engine, /player\.leaving = false[\s\S]*player\.leavingIntent = ""/);
  assert.match(engine, /type: cancelledIntent === "spectate" \? "spectate_cancelled" : "leave_cancelled"/);
  assert.match(engine, /player\.leavingIntent = leaveIntent/);
  assert.match(engine, /leavingIntent: player\.leaving \? normalizeLeavingIntent\(player\.leavingIntent\) \|\| "leave" : ""/);
  assert.match(controller, /leaving:\s*!!firstDefined\(entry\.leaving/);
  assert.match(controller, /leavingIntent:\s*text\(firstDefined\(entry\.leavingIntent/);
  assert.match(controller, /seat\.leavingIntent === "spectate" \? "관전 예약" : "나가기 예약"/);
  assert.match(controller, /leaveIntent:\s*"spectate"/);
  assert.match(controller, /leaveIntent:\s*"leave"/);
  assert.match(controller, /cancelLeave:\s*true/);
  assert.match(controller, /leaveAfterHandRequested = false[\s\S]*leave_after_hand_cancel/);
  assert.match(engine, /function startHand\(state, now, context\)[\s\S]*!player\.leaving && player\.stack > 0/);
  assert.match(controller, /function ensureSeatControls\(\)[\s\S]*appendChild\(button\)/);
  assert.match(styles, /\.holdem-seat-controls\s*\{/);
  assert.match(controller, /show\("holdem-ready-btn", false\)/);
  assert.match(engine, /canReady: false/);
  assert.match(controller, /scheduleAutoReadyForNextHand\(\)[\s\S]*scheduleAutoNextHand\(\)/);
  assert.match(controller, /function scheduleAutoNextHand\(\)[\s\S]*state\.phase !== "complete"[\s\S]*hasBustedHumanSeat\(\)[\s\S]*Math\.max\(AUTO_NEXT_HAND_MS, resultTransitionDelayMs\(\)\)[\s\S]*setTimeout\(function \(\) \{ autoStartHand\(key\); \}, delay\)/);
  assert.match(controller, /reviewUntil: settleEnd \+ RESULT_REVIEW_MS/);
  assert.match(controller, /function openBuyInDialog\(mode, seat\)[\s\S]*state\.phase === "complete" && !resultTransitionReady\(\)/);
  assert.match(controller, /function maybeAutoOpenRebuyDialog\(\)[\s\S]*if \(!resultTransitionReady\(\)\) return/);
  assert.match(controller, /function releaseResultTransitions\(\)[\s\S]*maybeAutoOpenRebuyDialog\(\)[\s\S]*scheduleAutoNextHand\(\)/);
  assert.match(styles, /\.holdem-result-panel\s*\{[\s\S]*display: none !important/);
  assert.match(controller, /function resultWinningComboForSeat\(seatIndex\)[\s\S]*resultWinnerEvaluationForSeat\(seatIndex\)[\s\S]*winnerCombo\.holeCards\[cardIndex\] \? "is-winning-combo-card" : "is-winning-combo-muted"/);
  assert.match(controller, /function resultWinningBoardCombo\(\)[\s\S]*dimCommunityCards:\s*true[\s\S]*resultCombo:\s*true/);
  assert.match(controller, /function communityHighlightsReady\(now\)[\s\S]*boardRevealState\.cards\[index\] !== key[\s\S]*communityCardRevealDuration\(index\)/);
  assert.match(controller, /var currentHand = communityHighlightsReady\(now\) \? \(resultWinningBoardCombo\(\) \|\| heroCurrentHand\(\)\) : null/);
  assert.match(controller, /var currentHand = isMe && canShowCommunityHighlights \? heroCurrentHand\(\) : null/);
  assert.match(controller, /RESULT_CARD_HIGHLIGHT_HOLD_MS/);
  assert.match(controller, /function visibleHeroComboBoard\(\)[\s\S]*resultStage\(\) === "cards"[\s\S]*state\.board\.slice\(0, resultBoardVisibleCount\(\)\)/);
  assert.match(controller, /var evaluatedWinnerCount = 0[\s\S]*evaluatedWinnerCount \+= 1[\s\S]*return evaluatedWinnerCount \?/);
  assert.match(controller, /category === 4 \|\| category === 5 \|\| category === 8/);
  const classicWinnerRule = styles.match(/\.holdem-card\.is-winning-combo-card\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.match(classicWinnerRule, /border:\s*1px solid #FFB000/);
  assert.match(classicWinnerRule, /0 0 6px rgba\(255,122,0,\.98\)[\s\S]*0 0 18px rgba\(255,176,0,\.74\)[\s\S]*0 0 26px rgba\(255,106,0,\.42\)/);
  assert.doesNotMatch(classicWinnerRule, /inset|0 0 0 \d+px/);
  assert.match(styles, /\.holdem-screen\[data-card-front-skin="four-color"\] \.holdem-card\.is-winning-combo-card:not\(\.back\)\s*\{[\s\S]*border:\s*1px solid[\s\S]*0 0 9px rgba\(255,194,42,\.22\)/);
  assert.match(styles, /\.holdem-seat\.is-me \.holdem-hole-cards\.is-winning-combo-review \.holdem-card\.is-winning-combo-card:first-of-type,[\s\S]*transform:\s*translateY\(-2px\) scale\(1\.035\)/);
  assert.match(styles, /\.holdem-seat\.is-me \.holdem-hole-cards\.is-winning-combo-review \.holdem-card\.is-winning-combo-muted\.is-hero-reveal-forward\s*\{[\s\S]*filter:\s*grayscale\(\.85\) saturate\(\.42\) brightness\(\.72\)/);
  assert.match(styles, /\.holdem-screen\[data-card-front-skin="four-color"\] \.holdem-seat\.is-me \.holdem-hole-cards\.is-winning-combo-review \.holdem-card\.is-winning-combo-card\.is-hero-reveal-forward:not\(\.back\)\s*\{[\s\S]*filter:\s*saturate\(1\.04\) brightness\(1\.04\)/);
  assert.match(styles, /\.holdem-card\.is-winning-combo-muted\s*\{[\s\S]*opacity:\s*\.28[\s\S]*grayscale/);
  assert.match(styles, /\.holdem-winner-result\s*\{/);
  assert.match(styles, /\.holdem-winner-result\s*\{[\s\S]*top:\s*calc\(var\(--holdem-seat-avatar-size\) \* -0\.56\)/);
  assert.match(styles, /\.holdem-winner-result\s*\{[\s\S]*min-width:\s*108px/);
  assert.match(styles, /\.holdem-winner-result\s*\{[\s\S]*max-width:\s*min\(154px,\s*calc\(100vw - 18px\)\)/);
  assert.match(styles, /\.holdem-winner-result strong\s*\{[\s\S]*padding:\s*4px 14px 5px[\s\S]*font-size:\s*clamp\(12px,\s*3\.35vw,\s*16px\)/);
  assert.match(styles, /\.holdem-winner-result small\s*\{[\s\S]*max-width:\s*min\(142px,\s*calc\(100vw - 24px\)\)[\s\S]*padding:\s*3px 7px/);
  assert.match(styles, /\.holdem-win-gain\s*\{[\s\S]*max-width:\s*min\(148px,\s*calc\(100vw - 28px\)\)[\s\S]*padding:\s*2px 7px 3px[\s\S]*font-size:\s*clamp\(15px,\s*4\.4vw,\s*21px\)[\s\S]*font-weight:\s*1000[\s\S]*white-space:\s*nowrap/);
  assert.match(styles, /\.holdem-win-gain\.is-compact\s*\{[\s\S]*font-size:\s*clamp\(13px,\s*3\.65vw,\s*17px\)/);
  assert.match(styles, /\.holdem-win-gain\.is-tiny\s*\{[\s\S]*font-size:\s*clamp\(11px,\s*3\.05vw,\s*14px\)/);
  assert.match(controller, /if \(wonText\.length >= 12\) winGainClass \+= " is-tiny";[\s\S]*else if \(wonText\.length >= 9\) winGainClass \+= " is-compact"/);
  assert.match(styles, /\.holdem-payout-particles\s*\{[\s\S]*z-index:\s*29[\s\S]*pointer-events:\s*none/);
  assert.match(styles, /\.holdem-payout-particle\s*\{[\s\S]*radial-gradient[\s\S]*animation:\s*holdemPayoutParticleFlow/);
  assert.doesNotMatch(styles, /\.holdem-payout-particle::after\s*\{/);
  assert.match(styles, /@keyframes holdemPayoutParticleFlow\s*\{[\s\S]*var\(--payout-start-x\)[\s\S]*var\(--payout-mid-x\)[\s\S]*var\(--payout-end-x\)/);
  assert.match(styles, /\.holdem-seat\.is-payout-receiving \.holdem-seat-avatar\s*\{[\s\S]*holdemWinnerReceivePulse/);
  assert.match(styles, /\.holdem-seat\.is-payout-receiving \.holdem-winner-result strong\s*\{[\s\S]*holdemWinnerBadgeReceive/);
  assert.match(controller, /var payoutParticleStreamKey = ""/);
  assert.match(controller, /function startPayoutParticleStream\(key\)[\s\S]*particlesPerWinner = targets\.length > 1 \? 9 : 14[\s\S]*holdem-payout-particle[\s\S]*var sizeSteps = \[4\.5, 5\.8, 7\.2, 9\.4, 12\.2\]/);
  assert.match(controller, /function maybeStartPayoutParticleStream\(\)[\s\S]*resultFlow\.settleStart[\s\S]*startPayoutParticleStream\(key\)/);
  assert.match(controller, /function renderSettlementAnimation\(\)[\s\S]*maybeStartPayoutParticleStream\(\)/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="3"\] \.holdem-winner-result\s*\{[\s\S]*top:\s*calc\(var\(--holdem-seat-avatar-size\) \* -0\.56\)/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="1"\] \.holdem-winner-result,[\s\S]*\.holdem-seat\[data-relative-seat="2"\] \.holdem-winner-result\s*\{[\s\S]*left:\s*calc\(50% \+ var\(--holdem-winner-edge-nudge\)\)/);
  assert.match(styles, /\.holdem-seat\[data-relative-seat="4"\] \.holdem-winner-result,[\s\S]*\.holdem-seat\[data-relative-seat="5"\] \.holdem-winner-result\s*\{[\s\S]*left:\s*calc\(50% - var\(--holdem-winner-edge-nudge\)\)/);
  assert.match(styles, /\.holdem-screen\.is-settling-pot \.holdem-seat\.is-winner:not\(\.is-payout-receiving\) \.holdem-seat-avatar/);
  assert.match(controller, /var RESULT_CARDS_FIRST_MS = 900/);
  assert.match(controller, /var RESULT_FINAL_ACTION_MS = 2000/);
  assert.match(controller, /function resultStage\(\)[\s\S]*resultFlow\.actionUntil[\s\S]*return "action"/);
  assert.match(controller, /screen\.classList\.toggle\("is-showdown", isBetweenHands\(state\.phase\) && stage !== "action"\)/);
  assert.match(controller, /var stage = resultStage\(\);[\s\S]*var revealWinner = state\.phase !== "complete" \|\| stage === "announced"/);
  assert.match(controller, /if \(isWinner && revealWinner\) classes\.push\("is-winner"\)/);
  assert.match(controller, /state\.phase === "complete" && stage === "announced"/);
  assert.match(controller, /function renderSettlementAnimation\(\)[\s\S]*maybeStartHeroRevealThrow\(stage\)[\s\S]*stage !== lastSeatResultStage \|\|[\s\S]*comboBoardCount !== lastSeatComboBoardCount \|\|[\s\S]*revealThrowStarted/);
  assert.match(controller, /function releaseResultSettlement\(\)[\s\S]*resultSettlementReady\(\)[\s\S]*renderControls\(\)/);
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
  assert.match(controller, /pendingMove = \{[\s\S]*requestId: moveRequestId[\s\S]*action: move[\s\S]*amount: pendingMoveAmount/);
  assert.match(controller, /renderSeats\(\);[\s\S]*invoke\("act", payload/);
  assert.match(controller, /function pendingMoveMatchesActionEntry\(move, entry, snapshot\)[\s\S]*confirmedSeq !== expectedSeq/);
  assert.match(controller, /pendingMoveMatchesActionEntry\(confirmedPendingMove, entry, next\)[\s\S]*actionTagAnimationKeys\[actionTagKey\] = true/);
  assert.match(controller, /scheduleRefresh\("broadcast", true, 0\)/);
  assert.match(controller, /var pendingUiCount = 0/);
  assert.match(controller, /var busy = pendingUiCount > 0/);
  assert.doesNotMatch(controller, /api\.send\(\{[^}]*\b(?:deck|burn|holeCards|cards)\b/s);
  assert.match(config, /\[functions\.holdem-table\]\s*verify_jwt = false/);
  assert.match(controller, /invoke\("refill"/);
});

test("Hold'em chat keeps transient toasts separate from the recent typing history", () => {
  assert.match(index, /id="holdem-chat-overlay"/);
  assert.match(index, /id="holdem-chat-history"[^>]*role="log"/);
  assert.match(index, /id="holdem-chat-input"/);
  assert.match(index, /id="holdem-emoji-toggle"/);
  assert.match(index, /id="holdem-emoji-panel"/);
  assert.match(index, /data-holdem-emoji="😀"[\s\S]*data-holdem-emoji="☺️"[\s\S]*data-holdem-emoji="😅"/);
  assert.match(index, /data-holdem-emoji="😅"/);
  assert.match(index, /data-holdem-emoji="🤫"[\s\S]*data-holdem-emoji="😨"[\s\S]*data-holdem-emoji="😤"[\s\S]*data-holdem-emoji="👋"/);
  assert.match(index, /data-holdem-emoji="🫢"[\s\S]*data-holdem-emoji="🫣"[\s\S]*data-holdem-emoji="🫩"[\s\S]*data-holdem-emoji="😵‍💫"/);
  assert.match(index, /data-holdem-emoji="🙏"[\s\S]*data-holdem-emoji="👏"[\s\S]*data-holdem-emoji="👌"[\s\S]*data-holdem-emoji="👊"[\s\S]*data-holdem-emoji="🎉"/);
  assert.match(index, /data-holdem-emoji="‼️"/);
  assert.match(styles, /\.holdem-card\.back\s*\{[\s\S]*border-radius:\s*var\(--holdem-card-back-radius/);
  assert.match(styles, /\.holdem-board \.holdem-card\s*\{[\s\S]*--holdem-card-back-radius:\s*clamp\(7px/);
  assert.match(styles, /\.holdem-board \.holdem-card\.is-community-flipping::after\s*\{[\s\S]*border-radius:\s*var\(--holdem-card-back-radius,\s*inherit\)/);
  assert.match(styles, /\.holdem-board \.holdem-card\.back:first-child,[\s\S]*border-top-left-radius:\s*var\(--holdem-card-back-radius/);
  assert.match(styles, /\.holdem-board \.holdem-card\.back:last-child,[\s\S]*border-top-right-radius:\s*var\(--holdem-card-back-radius/);
  assert.match(styles, /\.holdem-seat-avatar\s*\{[\s\S]*overflow:\s*visible/);
  assert.match(styles, /\.holdem-seat-avatar img\s*\{[\s\S]*border-radius:\s*inherit/);
  assert.match(game, /function renderHoldemChatHistory\(\)/);
  assert.match(game, /Db\.getChatHistory\(requestedRoom, 200\)/);
  assert.match(game, /requestedGeneration !== chatLoadGeneration/);
  assert.match(game, /requestedRoom !== chatRoomOf\(curGame\)/);
  assert.match(game, /!panel && g === "holdem"/);
  assert.match(game, /var holdemHistCount = \{\}/);
  assert.match(game, /var holdemMerged = \[\]/);
  assert.match(game, /sessionChat = sessionChat\.filter\(function \(sc\) \{ return sc\.game !== "holdem"; \}\)/);
  assert.match(game, /holdemMerged\.push\(\{ game: "holdem", who: m\.nick, text: m\.text \}\)/);
  assert.match(game, /holdemMerged\.forEach\(function \(sc\) \{ sessionChat\.push\(sc\); \}\)/);
  assert.match(game, /renderHoldemChatHistory\(\);\s*return;/);
  assert.match(game, /var recent = \[\]/);
  assert.match(game, /recent\.length < 5/);
  assert.match(game, /row\.game !== "holdem"/);
  assert.match(game, /historySurface\.scrollTop = historySurface\.scrollHeight/);
  assert.match(game, /line\.classList\.add\("show"\)/);
  assert.match(game, /holdem-chat-input"\)\.addEventListener\("focus"/);
  assert.match(game, /holdem-chat-input"\)\.addEventListener\("blur"[\s\S]*setHoldemChatFocusState\(false\)/);
  assert.doesNotMatch(game, /holdem-chat-input"\)\.addEventListener\("blur"[\s\S]{0,140}setTimeout/);
  assert.match(game, /toastSurface\.innerHTML = ""/);
  assert.match(game, /holdem-chat-history"\)\.innerHTML = ""/);
  assert.doesNotMatch(game + controller, /holdemOverlayMode|holdemToastUntil/);
  assert.match(controller, /api\.sendChat\(value, \{ suppressOverlay: true \}\)/);
  assert.match(controller, /api\.showChatToast\(text\(me\(\)\.nick, 40\), value, "", "holdem"\)/);
  assert.match(controller, /function sendHoldemEmoji\(value\)/);
  assert.match(controller, /t: "holdem_emoji"/);
  assert.match(controller, /showSeatEmoji\(message\.nick, message\.emoji, message\.id\)/);
  assert.match(controller, /seatEmojiHtml\(seat\)/);
  assert.match(game, /var showImmediately = !\(options && options\.suppressOverlay\)/);
  assert.match(controller, /function clearHoldemChatKeyboardSyncTimers\(\)/);
  assert.match(controller, /function cancelHoldemChatKeyboardHide\(\)/);
  assert.match(controller, /chatKeyboardHideTimer = setTimeout\(function \(\)[\s\S]*setChatOpen\(false\);[\s\S]*\}, 220\)/);
  assert.match(styles, /\.holdem-chat-history\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(styles, /\.holdem-emoji-toggle,\s*[\s\S]*\.holdem-chat-toggle\s*\{/);
  assert.match(styles, /\.holdem-emoji-panel\s*\{[\s\S]*grid-template-columns:\s*repeat\(7/);
  assert.match(styles, /\.holdem-seat-emoji-pop\s*\{[\s\S]*font-size:\s*clamp\(43px,\s*calc\(var\(--holdem-seat-avatar-size\) \* \.922\),\s*70px\)/);
  assert.match(styles, /\.holdem-seat-emoji-pop\s*\{[\s\S]*top:\s*var\(--holdem-seat-timer-y\)/);
  assert.match(styles, /\.holdem-seat-emoji-pop\s*\{[\s\S]*left:\s*var\(--holdem-seat-timer-x\)/);
  assert.match(styles, /\.holdem-seat-emoji-pop\s*\{[\s\S]*animation:\s*holdemSeatEmojiPop/);
  assert.match(styles, /transform:\s*translate\(-50%,\s*-50%\)\s*scale/);
  assert.match(styles, /\.holdem-chat-history\s*\{[\s\S]*-webkit-overflow-scrolling:\s*touch/);
  assert.match(styles, /\.holdem-screen\.is-chat-focused \.holdem-chat-history\s*\{[\s\S]*display:\s*flex/);
  assert.match(styles, /\.holdem-screen\.is-pre-actioning\.is-chat-focused \.holdem-chat-history\s*\{[\s\S]*\+ 166px/);
  assert.match(styles, /\.holdem-screen\.is-fold-revealing\.is-chat-focused \.holdem-chat-history\s*\{[\s\S]*\+ 164px/);
  assert.match(styles, /\.holdem-screen\.is-keyboard-open\.is-actioning\.is-chat-focused \.holdem-chat-history,[\s\S]*\.holdem-screen\.is-keyboard-open\.is-fold-revealing\.is-chat-focused \.holdem-chat-history\s*\{[\s\S]*\+ 54px \+ var\(--holdem-keyboard-offset,\s*0px\)/);
  assert.match(styles, /\.holdem-screen\.is-actioning\.is-raise-menu-open\.is-chat-focused \.holdem-chat-history\s*\{[\s\S]*right:\s*calc\(33\.333% \+ 12px\)/);
});

test("the rules and UI clearly identify KRW-unit assets and standard no-limit play", () => {
  assert.match(index, /6-MAX · NO LIMIT/);
  assert.match(index, /실제 현금 가치가 없는 원화 단위 게임 자산/);
  assert.match(index, /data-rules="holdem">텍사스 홀덤 규칙/);
  assert.match(controller, /Poker TDA|TDA/);
  assert.match(controller, /사이드\s*팟|사이드팟/);
  assert.match(controller, /숏\s*올인|최소\s*레이즈/);
});
