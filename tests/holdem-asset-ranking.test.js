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
  assert.match(index, /현재 테이블에 가져간 칩까지 모두 합친 총자산 기준입니다/);
});

test("Hold'em ranking stays readable and scrollable on narrow mobile screens", () => {
  assert.match(styles, /\.holdem-asset-ranking-dialog\s*\{[\s\S]*max-height:\s*min\(86dvh,\s*680px\)/);
  assert.match(styles, /\.holdem-asset-ranking-list\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(styles, /\.holdem-asset-ranking-row\s*\{[\s\S]*grid-template-columns:/);
  assert.match(styles, /\.holdem-asset-ranking-player strong\s*\{[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(styles, /\.holdem-asset-ranking-assets\s*\{[\s\S]*font-variant-numeric:\s*tabular-nums/);
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
  assert.match(game, /holdem-asset-ranking-row[\s\S]*holdem-asset-ranking-me-tag/);
  assert.match(game, /holdem-asset-ranking-close[\s\S]*closeHoldemAssetRanking/);
});

test("the browser requests rankings without exposing a room identifier", () => {
  assert.match(db, /body\.action !== "wallet" && body\.action !== "ranking"/);
  assert.match(db, /async function getHoldemAssetRanking\(auth\)[\s\S]*holdemInvoke\(auth, "ranking", \{\}\)/);
  assert.match(db, /getHoldemAssetRanking:\s*getHoldemAssetRanking/);
});

test("the authenticated server ranking includes live table chips but exposes only public totals", () => {
  assert.match(edge, /const ACTIONS = new Set\(\[[\s\S]*"wallet",[\s\S]*"ranking"/);
  assert.match(edge, /const rankingAction = action === "ranking"/);
  assert.match(edge, /const roomlessAction = walletAction \|\| rankingAction/);
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

test("other players' table chips are no longer mislabeled as their total assets", () => {
  assert.match(
    controller,
    /isMine \? "내 총자산" : target && target\.isBot \? "연습칩" : "테이블 보유칩"/
  );
});
