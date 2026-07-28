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
  assert.match(index, /현재 테이블에 가져간 칩까지 모두 합친 총자산 기준입니다/);
});

test("Hold'em ranking stays readable and scrollable on narrow mobile screens", () => {
  assert.match(styles, /\.holdem-asset-ranking-dialog\s*\{[\s\S]*max-height:\s*min\(86dvh,\s*680px\)/);
  assert.match(styles, /\.holdem-asset-ranking-list\s*\{[\s\S]*overflow-y:\s*auto/);
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
  assert.match(game, /function openHoldemAssetRanking\(\)/);
  assert.match(game, /Db\.getHoldemAssetRanking\(\{[\s\S]*nick:\s*me\.nick,[\s\S]*hash:\s*sessionAuthHash/);
  assert.match(game, /function normalizeHoldemAssetRankingRow\(value\)/);
  assert.match(game, /function renderHoldemAssetRankingDetail\(detail\)/);
  assert.match(game, /Db\.getHoldemAssetRankingDetail\(\{[\s\S]*hash:\s*sessionAuthHash[\s\S]*\}, targetNick\)/);
  assert.match(game, /data-holdem-rank-nick/);
  assert.match(game, /holdem-asset-ranking-row[\s\S]*holdem-asset-ranking-me-tag/);
  assert.match(game, /holdem-asset-ranking-close[\s\S]*closeHoldemAssetRanking/);
});

test("the browser requests rankings and ranking details without exposing a room identifier", () => {
  assert.match(db, /body\.action !== "wallet" &&[\s\S]*body\.action !== "ranking" &&[\s\S]*body\.action !== "ranking_detail"/);
  assert.match(db, /async function getHoldemAssetRanking\(auth\)[\s\S]*holdemInvoke\(auth, "ranking", \{\}\)/);
  assert.match(db, /async function getHoldemAssetRankingDetail\(auth, targetNick\)[\s\S]*holdemInvoke\(auth, "ranking_detail"/);
  assert.match(db, /getHoldemAssetRanking:\s*getHoldemAssetRanking/);
  assert.match(db, /getHoldemAssetRankingDetail:\s*getHoldemAssetRankingDetail/);
});

test("the authenticated server ranking includes live table chips but exposes only public totals", () => {
  assert.match(edge, /const ACTIONS = new Set\(\[[\s\S]*"wallet",[\s\S]*"ranking"/);
  assert.match(edge, /const rankingAction = action === "ranking"/);
  assert.match(edge, /const roomlessAction = walletAction \|\| rankingAction \|\| rankingDetailAction/);
  assert.match(edge, /const account = await verifyAccount\([\s\S]*if \(!account\) return jsonResponse/);
  assert.match(edge, /if \(rankingAction\) \{[\s\S]*await cleanupExpiredTables\(client\)[\s\S]*assetRanking\(client, account\.nick\)/);
  assert.match(edge, /function tableHoldingsByNickname\(rows: unknown\[\]\)/);
  assert.match(edge, /settings\.assetBacked !== true/);
  assert.match(edge, /new Set\(\["preflop", "flop", "turn", "river"\]\)/);
  assert.match(edge, /includeCommittedBets \? Number\(rawSeat\.totalBet\) : 0/);
  assert.match(edge, /\.from\("holdem_wallets"\)[\s\S]*\.select\("nickname,balance,updated_at"\)/);
  assert.match(edge, /\.from\("holdem_tables"\)[\s\S]*\.select\("state"\)/);
  assert.match(edge, /\.from\("accounts"\)[\s\S]*\.select\("nickname,is_admin"\)[\s\S]*\.eq\("is_admin", true\)/);
  assert.match(edge, /const adminNicknames = new Set\([\s\S]*safeText\(row\?\.nickname, 40\)/);
  assert.match(edge, /if \(adminNicknames\.has\(nickname\)\) return null/);
  assert.match(edge, /right\.totalAssets - left\.totalAssets/);
  assert.match(edge, /rows:\s*ranked\.slice\(0, 100\)\.map\(publicRow\)/);
  assert.match(edge, /const publicRow = \(row:[\s\S]*rank:\s*row\.rank,[\s\S]*nickname:\s*row\.nickname,[\s\S]*totalAssets:\s*row\.totalAssets/);
  assert.doesNotMatch(edge, /const publicRow = \(row:[\s\S]{0,300}\bbalance:\s*row\.balance/);
});

test("Hold'em ranking details expose session summaries without private hand data", () => {
  const migration = read(path.join("supabase", "migrations", "202607280003_holdem_session_history.sql"));
  assert.match(edge, /"ranking_detail"/);
  assert.match(edge, /const rankingDetailAction = action === "ranking_detail"/);
  assert.match(edge, /assetRankingDetail\([\s\S]*safeText\(body\.targetNick, 40\)/);
  assert.match(edge, /\.from\("holdem_hand_results"\)[\s\S]*"session_date,small_blind,big_blind,net_amount,won_amount,revealed,hand_name,hand_category,is_winner,created_at,hand_no"/);
  assert.match(edge, /refillToday:[\s\S]*refillSevenDays:/);
  assert.match(edge, /biggestWin:[\s\S]*publicHandHighlight/);
  assert.doesNotMatch(edge, /\.from\("holdem_hand_results"\)[\s\S]{0,180}\.select\([\s\S]{0,120}"[^"]*(?:cards|opponent|room_id)[^"]*"/);
  assert.match(migration, /create table if not exists public\.holdem_hand_results/);
  assert.match(migration, /nickname text[\s\S]*references public\.accounts/);
  assert.match(migration, /revoke all on table public\.holdem_hand_results[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /create or replace function public\.holdem_ring_table_v4_compare_and_swap/);
  assert.match(migration, /insert into public\.holdem_hand_results/);
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
  assert.match(
    controller,
    /isMine \? "내 총자산" : target && target\.isBot \? "연습칩" : "총자산"/
  );
  assert.match(controller, /function loadProfileAsset\(force\)/);
  assert.match(controller, /Db\.getHoldemAssetRankingDetail\(currentAuth, nick\)/);
  assert.match(controller, /if \(!seat\.isBot\) return null/);
});
