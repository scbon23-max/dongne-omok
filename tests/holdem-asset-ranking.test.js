"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const index = read("index.html");
const styles = read("styles.css");
const game = read("game.js");
const db = read("db.js");
const controller = read("holdem.js");
const engine = read("holdem-engine.js");
const edge = read(path.join("supabase", "functions", "holdem-table", "index.ts"));
const handCountsMigration = read(
  path.join(
    "supabase",
    "migrations",
    "202607300001_holdem_completed_hand_counts.sql"
  )
);
const assetStatsMigration = read(
  path.join(
    "supabase",
    "migrations",
    "202607310001_holdem_asset_stats_and_ledger.sql"
  )
);

test("Hold'em places a dedicated asset ranking beside the hand guide", () => {
  const utility = index.slice(
    index.indexOf('<nav class="holdem-utility"'),
    index.indexOf("</nav>", index.indexOf('<nav class="holdem-utility"'))
  );
  assert.ok(utility.indexOf('id="holdem-hands-btn"') >= 0);
  assert.ok(
    utility.indexOf('id="holdem-hands-btn"') <
      utility.indexOf('id="holdem-rank-btn"')
  );
  assert.ok(
    utility.indexOf('id="holdem-rank-btn"') <
      utility.indexOf('id="holdem-settings-btn"')
  );
  assert.match(index, /id="holdem-asset-ranking-backdrop"/);
  assert.match(index, /id="holdem-asset-ranking-mine"/);
  assert.match(index, /id="holdem-asset-ranking-list"/);
  assert.match(index, /id="holdem-asset-ranking-detail"/);
  assert.match(index, /5핸드 이상 진행해야 순위권에 반영됩니다/);
  assert.match(index, /현재 테이블에 가져간 칩까지 모두 합친 총자산 기준입니다/);
});

test("Hold'em ranking stays readable and scrollable on narrow mobile screens", () => {
  assert.match(styles, /\.holdem-asset-ranking-dialog\s*\{[\s\S]*max-height:\s*min\(86dvh,\s*680px\)/);
  assert.match(styles, /\.holdem-asset-ranking-list\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(styles, /\.holdem-asset-ranking-dialog\.is-detail\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.holdem-asset-ranking-dialog\.is-detail \.holdem-asset-ranking-list,[\s\S]*display:\s*none/);
  assert.match(styles, /\.holdem-asset-ranking-dialog\.is-detail \.holdem-asset-ranking-detail\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(styles, /\.holdem-asset-ranking-detail-nav\s*\{[\s\S]*position:\s*sticky/);
  assert.match(styles, /\.holdem-asset-ranking-row\s*\{[\s\S]*grid-template-columns:/);
  assert.match(styles, /\.holdem-asset-ranking-player strong\s*\{[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(styles, /\.holdem-asset-ranking-assets\s*\{[\s\S]*font-variant-numeric:\s*tabular-nums/);
  assert.match(styles, /\.holdem-asset-ranking-detail\s*\{/);
  assert.match(styles, /\.holdem-asset-ranking-session summary\s*\{[\s\S]*grid-template-columns:/);
  assert.match(styles, /@media \(max-width:\s*370px\)[\s\S]*\.holdem-asset-ranking-row/);
  assert.match(styles, /\.holdem-utility button,[\s\S]*flex-shrink:\s*0/);
  assert.match(styles, /\.holdem-utility button,[\s\S]*white-space:\s*nowrap/);
});

test("the Hold'em controller opens its own asset ranking flow", () => {
  assert.match(controller, /id === "holdem-rank-btn"[\s\S]*api\.openHoldemRank\(\)/);
  assert.match(game, /openHoldemRank:\s*function \(\) \{ openHoldemAssetRanking\(\); \}/);
  assert.match(game, /function openHoldemAssetRanking\(targetNick\)/);
  assert.match(game, /Db\.getHoldemAssetRanking\(\{[\s\S]*nick:\s*me\.nick,[\s\S]*hash:\s*sessionAuthHash/);
  assert.match(game, /function normalizeHoldemAssetRankingRow\(value\)/);
  assert.match(game, /function renderHoldemAssetRankingDetail\(detail\)/);
  assert.match(game, /function setHoldemAssetRankingView\(view\)/);
  assert.match(game, /function backToHoldemAssetRankingList\(\)/);
  assert.match(game, /data-holdem-ranking-back/);
  assert.match(game, /holdem-asset-ranking-detail-hero/);
  assert.match(game, /Db\.getHoldemAssetRankingDetail\(\{[\s\S]*hash:\s*sessionAuthHash[\s\S]*\}, targetNick\)/);
  assert.match(game, /data-holdem-rank-nick/);
  assert.match(game, /holdem-asset-ranking-row[\s\S]*holdem-asset-ranking-me-tag/);
  assert.match(game, /holdem-asset-ranking-close[\s\S]*closeHoldemAssetRanking/);
  assert.match(game, /holdem-asset-ranking-detail"\)\.addEventListener\("click"[\s\S]*backToHoldemAssetRankingList/);
});

test("the lobby overall ranking places Hold'em first and uses asset totals", () => {
  assert.match(index, /id="rank-tabs"[\s\S]*data-g="holdem"[\s\S]*data-g="omok"[\s\S]*data-g="alk"/);
  assert.match(game, /function lobbyRankGames\(\) \{[\s\S]*return \["holdem"\]\.concat\(rankableGames\(\)/);
  assert.match(game, /rankTab = tabs\[0\] \|\| "holdem"/);
  assert.match(game, /tabs\.innerHTML = lobbyRankGames\(\)\.map/);
  assert.match(game, /if \(rankTab === "holdem"\) \{[\s\S]*rank-season"\)\.style\.display = "none"[\s\S]*loadLobbyHoldemRanking\(\)/);
  assert.match(game, /function loadLobbyHoldemRanking\(\)[\s\S]*Db\.getHoldemAssetRanking\(\{[\s\S]*nick: me\.nick,[\s\S]*hash: sessionAuthHash/);
  assert.match(game, /function renderLobbyHoldemRanking\(ranking\)[\s\S]*data-lobby-holdem-rank-nick/);
  assert.match(game, /openHoldemAssetRanking\(targetNick\)/);
  assert.match(styles, /\.rank-lobby-holdem \.holdem-asset-ranking-list\s*\{[\s\S]*max-height:/);
});

test("the browser requests profile assets and rankings without exposing a room identifier", () => {
  assert.match(db, /body\.action !== "wallet" &&[\s\S]*body\.action !== "profile_asset" &&[\s\S]*body\.action !== "ranking" &&[\s\S]*body\.action !== "ranking_detail"/);
  assert.match(db, /async function getHoldemProfileAsset\(auth, targetNick\)[\s\S]*holdemInvoke\(auth, "profile_asset"/);
  assert.match(db, /async function getHoldemAssetRanking\(auth\)[\s\S]*holdemInvoke\(auth, "ranking", \{\}\)/);
  assert.match(db, /async function getHoldemAssetRankingDetail\(auth, targetNick\)[\s\S]*holdemInvoke\(auth, "ranking_detail"/);
  assert.match(db, /getHoldemProfileAsset:\s*getHoldemProfileAsset/);
  assert.match(db, /getHoldemAssetRanking:\s*getHoldemAssetRanking/);
  assert.match(db, /getHoldemAssetRankingDetail:\s*getHoldemAssetRankingDetail/);
});

test("authenticated profile asset lookup is independent from ranking eligibility", () => {
  const profileAssetStart = edge.indexOf("async function profileAsset");
  const profileAssetEnd = edge.indexOf("async function assetRankingRows");
  const profileAssetSource = edge.slice(profileAssetStart, profileAssetEnd);

  assert.ok(profileAssetStart >= 0);
  assert.ok(profileAssetEnd > profileAssetStart);
  assert.match(edge, /"profile_asset"/);
  assert.match(edge, /const profileAssetAction = action === "profile_asset"/);
  assert.match(edge, /const roomlessAction = walletAction \|\| profileAssetAction/);
  assert.match(profileAssetSource, /\.from\("accounts"\)[\s\S]*\.select\("nickname"\)[\s\S]*\.eq\("nickname", targetNick\)/);
  assert.match(profileAssetSource, /\.from\("holdem_wallets"\)[\s\S]*\.select\("balance"\)[\s\S]*\.eq\("nickname", targetNick\)/);
  assert.match(profileAssetSource, /walletRow == null[\s\S]*INITIAL_WALLET_BALANCE/);
  assert.match(profileAssetSource, /tableHoldingsByNickname/);
  assert.doesNotMatch(profileAssetSource, /RANKING_MIN_HANDS|holdem_hand_results/);
  assert.match(edge, /if \(profileAssetAction\)[\s\S]*asset:\s*await profileAsset/);
});

test("the authenticated server ranking includes live table chips but exposes only public totals", () => {
  assert.match(edge, /const ACTIONS = new Set\(\[[\s\S]*"wallet",[\s\S]*"ranking"/);
  assert.match(edge, /const rankingAction = action === "ranking"/);
  assert.match(edge, /const roomlessAction = walletAction \|\| profileAssetAction \|\|[\s\S]*rankingAction \|\| rankingDetailAction/);
  assert.match(edge, /const accountPromise = verifyAccount\([\s\S]*const \[account, initialTable\] = await Promise\.all\([\s\S]*if \(!account\) return jsonResponse/);
  assert.match(edge, /if \(rankingAction\) \{[\s\S]*await cleanupExpiredTables\(client\)[\s\S]*assetRanking\(client, account\.nick\)/);
  assert.match(edge, /function tableHoldingsByNickname\(rows: unknown\[\]\)/);
  assert.match(edge, /settings\.assetBacked !== true/);
  assert.match(edge, /new Set\(\["preflop", "flop", "turn", "river"\]\)/);
  assert.match(edge, /includeCommittedBets \? Number\(rawSeat\.totalBet\) : 0/);
  assert.match(edge, /\.from\("holdem_wallets"\)[\s\S]*\.select\("nickname,balance,updated_at"\)/);
  assert.match(edge, /\.from\("holdem_tables"\)[\s\S]*\.select\("state"\)/);
  assert.match(edge, /\.from\("accounts"\)[\s\S]*\.select\("nickname,is_admin"\)[\s\S]*\.eq\("is_admin", true\)/);
  assert.match(edge, /const RANKING_MIN_HANDS = 5/);
  assert.match(edge, /\.rpc\("holdem_completed_hand_counts"\)/);
  assert.doesNotMatch(edge, /\.select\("nickname"\)[\s\S]*\.limit\(10000\)/);
  assert.match(edge, /Object\.entries\(handCounts\)/);
  assert.match(
    handCountsMigration,
    /select result\.nickname, count\(\*\)::bigint as hand_count[\s\S]*group by result\.nickname/
  );
  assert.match(
    handCountsMigration,
    /returns jsonb[\s\S]*jsonb_object_agg\(counted\.nickname, counted\.hand_count\)/
  );
  assert.match(
    handCountsMigration,
    /revoke all on function public\.holdem_completed_hand_counts\(\)[\s\S]*from public, anon, authenticated/
  );
  assert.match(edge, /const adminNicknames = new Set\([\s\S]*safeText\(row\?\.nickname, 40\)/);
  assert.doesNotMatch(edge, /if \(adminNicknames\.has\(nickname\)\) return null/);
  assert.match(edge, /const completedHands = new Map<string, number>\(\)/);
  assert.match(edge, /const isAdmin = adminNicknames\.has\(nickname\)/);
  assert.match(edge, /const handCount = completedHands\.get\(nickname\) \?\? 0/);
  assert.match(edge, /if \(!isAdmin && handCount < RANKING_MIN_HANDS\) return null/);
  assert.match(edge, /right\.totalAssets - left\.totalAssets/);
  assert.match(edge, /rows:\s*ranked\.slice\(0, 100\)\.map\(publicRow\)/);
  assert.match(edge, /const publicRow = \(row:[\s\S]*rank:\s*row\.rank,[\s\S]*nickname:\s*row\.nickname,[\s\S]*totalAssets:\s*row\.totalAssets,[\s\S]*handCount:\s*row\.handCount/);
  assert.match(edge, /minHands:\s*RANKING_MIN_HANDS/);
  assert.doesNotMatch(edge, /const publicRow = \(row:[\s\S]{0,300}\bbalance:\s*row\.balance/);
});

test("Hold'em ranking details expose session summaries without private hand data", () => {
  const migration = read(path.join("supabase", "migrations", "202607280003_holdem_session_history.sql"));
  assert.match(edge, /"ranking_detail"/);
  assert.match(edge, /const rankingDetailAction = action === "ranking_detail"/);
  assert.match(edge, /assetRankingDetail\([\s\S]*safeText\(body\.targetNick, 40\)/);
  assert.match(edge, /\.rpc\([\s\S]*"holdem_player_asset_stats"[\s\S]*p_nickname:\s*targetNick/);
  assert.doesNotMatch(edge, /\.from\("holdem_hand_results"\)[\s\S]*\.limit\(500\)/);
  assert.match(edge, /totalWon:\s*rankingChipAmount\(stats\.totalWon\)/);
  assert.match(edge, /totalLost:\s*rankingChipAmount\(stats\.totalLost\)/);
  assert.match(edge, /totalNet:\s*rankingChipAmount\(stats\.totalNet, true\)/);
  assert.match(edge, /initialGrantTotal:\s*rankingChipAmount\(stats\.initialGrantTotal\)/);
  assert.match(edge, /refillToday:[\s\S]*refillSevenDays:/);
  assert.match(edge, /handCount,\s*[\s\S]*minHands:\s*RANKING_MIN_HANDS/);
  assert.match(edge, /minHands:\s*RANKING_MIN_HANDS/);
  assert.match(edge, /biggestWin:\s*publicHandHighlight/);
  assert.doesNotMatch(assetStatsMigration, /\b(?:cards|hole_cards|opponent)\b/i);
  assert.match(migration, /create table if not exists public\.holdem_hand_results/);
  assert.match(migration, /nickname text[\s\S]*references public\.accounts/);
  assert.match(migration, /revoke all on table public\.holdem_hand_results[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /create or replace function public\.holdem_ring_table_v4_compare_and_swap/);
  assert.match(migration, /insert into public\.holdem_hand_results/);
});

test("Hold'em detail totals are aggregated over every stored hand in SQL", () => {
  const handStatsSql = assetStatsMigration.match(
    /with hand_stats as \(([\s\S]*?)\),\s*refill_stats as/
  );

  assert.ok(handStatsSql);
  assert.doesNotMatch(handStatsSql[1], /\blimit\b|\boffset\b/i);
  assert.match(
    assetStatsMigration,
    /create or replace function public\.holdem_player_asset_stats\([\s\S]*returns jsonb[\s\S]*language sql[\s\S]*stable/
  );
  assert.match(
    assetStatsMigration,
    /sum\(greatest\(result\.net_amount, 0\)\)[\s\S]*as total_won/
  );
  assert.match(
    assetStatsMigration,
    /sum\(greatest\(-result\.net_amount, 0\)\)[\s\S]*as total_lost/
  );
  assert.match(
    assetStatsMigration,
    /sum\(result\.net_amount\)[\s\S]*as total_net/
  );
  assert.match(
    assetStatsMigration,
    /result\.created_at >= now\(\) - interval '7 days'/
  );
  assert.match(
    assetStatsMigration,
    /group by[\s\S]*result\.session_date,[\s\S]*result\.small_blind,[\s\S]*result\.big_blind[\s\S]*limit 10/
  );
  assert.doesNotMatch(assetStatsMigration, /limit 500|limit 1000/);
  assert.match(
    assetStatsMigration,
    /revoke all on function public\.holdem_player_asset_stats\(text\)[\s\S]*to service_role/
  );
  assert.match(
    assetStatsMigration,
    /'initialGrantTotal', adjustment_stats\.initial_grant_total/
  );
  assert.match(game, /누적 딴 금액/);
  assert.match(game, /누적 잃은 금액/);
  assert.match(game, /누적 순손익/);
  assert.match(game, /게임 손익 집계 시작/);
  assert.match(game, /시작 지급/);
  assert.match(game, /보충칩과 자산 조정은 게임 손익에서 제외됩니다/);
  assert.match(game, /최근 10개 경기 구간/);
});

test("Hold'em keeps an auditable asset ledger without duplicating private hands", () => {
  const adjustmentTableSql = assetStatsMigration.match(
    /create table if not exists public\.holdem_asset_adjustments \(([\s\S]*?)\n\);/
  );
  const tableLock = assetStatsMigration.indexOf(
    "lock table public.holdem_tables"
  );
  const walletLock = assetStatsMigration.indexOf(
    "lock table public.holdem_wallets"
  );
  const economyLock = assetStatsMigration.indexOf(
    "lock table public.holdem_economy_events"
  );
  const handLock = assetStatsMigration.indexOf(
    "lock table public.holdem_hand_results"
  );

  assert.ok(adjustmentTableSql);
  assert.match(adjustmentTableSql[1], /nickname text not null/);
  assert.doesNotMatch(adjustmentTableSql[1], /references public\.accounts/);
  assert.ok(
    tableLock >= 0 &&
      tableLock < walletLock &&
      walletLock < economyLock &&
      economyLock < handLock
  );
  assert.match(
    assetStatsMigration,
    /create table if not exists public\.holdem_asset_adjustments/
  );
  assert.match(
    assetStatsMigration,
    /'initial_grant',[\s\S]*'opening_adjustment',[\s\S]*'manual_adjustment'/
  );
  assert.match(
    assetStatsMigration,
    /create trigger holdem_wallet_initial_grant_ledger[\s\S]*after insert on public\.holdem_wallets/
  );
  assert.match(
    assetStatsMigration,
    /create index if not exists holdem_economy_events_nickname_type_created_idx/
  );
  assert.match(
    assetStatsMigration,
    /wallet\.balance[\s\S]*coalesce\(table_assets\.amount, 0\)[\s\S]*- 100000[\s\S]*coalesce\(hand_net\.amount, 0\)[\s\S]*coalesce\(refill_total\.amount, 0\)/
  );
  assert.match(
    assetStatsMigration,
    /create or replace function public\.holdem_adjust_wallet_balance\([\s\S]*'manual_adjustment'/
  );
  assert.match(
    assetStatsMigration,
    /create or replace view public\.holdem_asset_ledger[\s\S]*'hand_result'::text[\s\S]*event\.event_type/
  );
  assert.match(
    assetStatsMigration,
    /revoke all on table public\.holdem_asset_ledger[\s\S]*grant select on table public\.holdem_asset_ledger to service_role/
  );
  assert.doesNotMatch(assetStatsMigration, /\b(?:cards|hole_cards|opponent)\b/i);
});

test("the engine records only public hand-result summaries for asset-backed ring hands", () => {
  assert.match(engine, /handStartStack = player\.inHand \? player\.stack : null/);
  assert.match(engine, /function addHandResults\(state, now\)/);
  assert.match(engine, /state\.settings\.assetBacked !== true/);
  assert.match(engine, /nickname: player\.nick/);
  assert.match(engine, /netAmount: netAmount/);
  assert.match(engine, /handName: revealed \? text\(player\.evaluation\.name, 40\) : ""/);
  assert.doesNotMatch(engine, /handResults[\s\S]{0,500}cards:/);
});

test("other human profiles show total assets instead of table chips", () => {
  const loaderStart = controller.indexOf("function loadProfileAsset");
  const loaderEnd = controller.indexOf("function loadProfileWallet");
  const loaderSource = controller.slice(loaderStart, loaderEnd);

  assert.match(
    controller,
    /isMine \? "내 총자산" : target && target\.isBot \? "연습칩" : "총자산"/
  );
  assert.ok(loaderStart >= 0);
  assert.ok(loaderEnd > loaderStart);
  assert.match(loaderSource, /Db\.getHoldemProfileAsset\(currentAuth, nick\)/);
  assert.doesNotMatch(loaderSource, /getHoldemAssetRankingDetail/);
  assert.match(controller, /if \(!seat\.isBot\) return null/);
});
