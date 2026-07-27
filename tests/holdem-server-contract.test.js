"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202607250001_holdem_tables.sql"
  ),
  "utf8"
);
const ringRefillMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202607260001_holdem_ring_refills.sql"
  ),
  "utf8"
);
const walletMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202607270001_holdem_wallets_and_buyins.sql"
  ),
  "utf8"
);
const edge = fs.readFileSync(
  path.join(root, "supabase", "functions", "holdem-table", "index.ts"),
  "utf8"
);
const engine = fs.readFileSync(path.join(root, "holdem-engine.js"), "utf8");

test("secret Hold'em state is isolated from browser database roles", () => {
  assert.match(
    migration,
    /create table if not exists public\.holdem_tables/i
  );
  assert.match(migration, /room_id text primary key/i);
  assert.match(migration, /state jsonb not null/i);
  assert.match(migration, /version bigint not null default 1/i);
  assert.match(migration, /updated_at timestamptz not null default now\(\)/i);
  assert.match(
    migration,
    /alter table public\.holdem_tables enable row level security/i
  );
  assert.match(
    migration,
    /revoke all on table public\.holdem_tables from public, anon, authenticated/i
  );
  assert.match(
    migration,
    /grant all on table public\.holdem_tables to service_role/i
  );
  assert.doesNotMatch(
    migration,
    /grant\s+(?:select|insert|update|delete|all)\s+on\s+(?:table\s+)?public\.holdem_tables\s+to\s+(?:anon|authenticated)/i
  );
});

test("the database owns atomic table creation and versioned compare-and-swap", () => {
  assert.match(
    migration,
    /create or replace function public\.holdem_table_compare_and_swap/i
  );
  assert.match(migration, /p_expected_version bigint/i);
  assert.match(
    migration,
    /if p_expected_version = 0 then[\s\S]*insert into public\.holdem_tables/i
  );
  assert.match(migration, /on conflict \(room_id\) do nothing/i);
  assert.match(
    migration,
    /where table_row\.room_id = p_room_id\s+and table_row\.version = p_expected_version/i
  );
  assert.match(migration, /version = table_row\.version \+ 1/i);
  assert.match(migration, /security definer/i);
  assert.match(
    migration,
    /revoke all on function public\.holdem_table_compare_and_swap\(text,bigint,jsonb,text\)[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    migration,
    /grant execute on function public\.holdem_table_compare_and_swap\(text,bigint,jsonb,text\)[\s\S]*to service_role/i
  );
});

test("abandoned secret tables have a bounded service-only cleanup helper", () => {
  assert.match(
    migration,
    /create or replace function public\.cleanup_expired_holdem_tables/i
  );
  assert.match(migration, /greatest\(\s*300,/i);
  assert.match(migration, /least\(coalesce\(p_limit, 200\), 500\)/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(
    migration,
    /delete from public\.holdem_tables as table_row/i
  );
  assert.match(
    migration,
    /revoke all on function public\.cleanup_expired_holdem_tables\(integer,integer\)[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    migration,
    /grant execute on function public\.cleanup_expired_holdem_tables\(integer,integer\)[\s\S]*to service_role/i
  );
});

test("the edge function authenticates the account and never trusts a payload nickname", () => {
  assert.match(edge, /async function verifyAccount/);
  assert.match(edge, /\.from\("accounts"\)/);
  assert.match(edge, /\.eq\("nickname", nick\)/);
  assert.match(edge, /\.eq\("pw_hash", hash\)/);
  assert.match(edge, /RESERVED_COMMAND_KEYS/);
  assert.match(edge, /command\.nick = nick/);
  assert.match(
    edge,
    /const command = commandPayload\(body, action, account\.nick\)/
  );
});

test("only the bounded Hold'em command surface and identifiers are accepted", () => {
  for (const action of [
    "join",
    "leave",
    "ready",
    "settings",
    "start",
    "act",
    "tick",
    "snapshot",
  ]) {
    assert.match(edge, new RegExp(`"${action}"`));
  }
  assert.match(edge, /ROOM_ID_PATTERN = \/\^\[A-Za-z0-9_-\]\{1,80\}\$\//);
  assert.match(
    edge,
    /REQUEST_ID_PATTERN = \/\^\[A-Za-z0-9\._:-\]\{1,100\}\$\//
  );
  assert.match(edge, /MAX_BODY_BYTES = 16 \* 1024/);
  assert.match(edge, /MAX_CAS_RETRIES = 5/);
  assert.match(
    edge,
    /for \(let attempt = 0; attempt < MAX_CAS_RETRIES; attempt \+= 1\)/
  );
});

test("the endpoint action, poker move, version, and hand identity stay distinct", () => {
  assert.match(edge, /const POKER_ACTIONS = new Set\(\[[\s\S]*"fold"[\s\S]*"allin"/);
  assert.match(edge, /const move = safeText\(explicit\.move, 16\)\.toLowerCase\(\)/);
  assert.match(edge, /POKER_ACTIONS\.has\(move\)\) command\.action = move/);
  assert.doesNotMatch(edge, /command\.action = safeText\(explicit\.action/);
  assert.match(edge, /const VERSIONED_ACTIONS = new Set\(\[[^\]]*"act"/);
  assert.match(edge, /const expectedVersion = parseVersion\(body\.expectedVersion\)/);
  assert.match(
    edge,
    /VERSIONED_ACTIONS\.has\(action\)[\s\S]*expectedVersion !== baseVersion[\s\S]*"stale"/
  );
  assert.match(edge, /const HAND_SCOPED_ACTIONS = new Set\(\["act", "tick"\]\)/);
  assert.match(edge, /const expectedHandId = safeText\(body\.handId, 80\)/);
  assert.match(
    edge,
    /HAND_SCOPED_ACTIONS\.has\(action\)[\s\S]*expectedHandId !== String\(baseState\.handNo \?\? ""\)[\s\S]*"stale"/
  );
});

test("room lease ownership and game mode configure the authoritative table", () => {
  assert.match(edge, /async function activeLease/);
  assert.match(edge, /\.from\("room_leases"\)/);
  assert.match(edge, /\.select\("nickname,game,config"\)/);
  assert.match(edge, /\.eq\("room_id", roomId\)/);
  assert.match(edge, /\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(
    edge,
    /const ownerNick = lease\?\.ownerNick \?\?\s*table\?\.owner_nickname \?\?\s*account\.nick/
  );
  assert.match(
    edge,
    /engine\.createTable\(createTableOptions\([\s\S]*lease\?\.game \?\? "holdem",[\s\S]*lease\?\.buyIn \?\? 0/
  );
  assert.match(edge, /game === "holdem_ring"/);
  assert.match(edge, /game === "holdem_turbo"/);
  assert.match(
    edge,
    /OWNER_ACTIONS\.has\(action\) && account\.nick !== ownerNick/
  );
});

test("the engine gets secure randomness and only changed results reach CAS", () => {
  assert.match(edge, /import "\.\.\/\.\.\/\.\.\/holdem-engine\.js"/);
  assert.match(edge, /\.HoldemEngine/);
  assert.match(edge, /crypto\.getRandomValues\(buffer\)/);
  assert.match(
    edge,
    /const result = engine\.command\(baseState, command, \{[\s\S]*now: requestedAt,[\s\S]*randomInt: secureRandomInt/
  );
  assert.match(edge, /const resultState = result\.state/);
  assert.match(
    edge,
    /if \(!result\.changed\) \{[\s\S]*return publicTableResponse/
  );
  assert.match(
    edge,
    /const nextState = normalizeState\(resultState\);[\s\S]*const cas = action === "refill"/
  );
  assert.match(
    edge,
    /client\.rpc\("holdem_table_compare_and_swap"/
  );
});

test("responses are built from the per-player engine view, never stored state", () => {
  assert.match(edge, /const snapshot = engine\.view\(state, nick\)/);
  assert.match(edge, /const snapshot = sanitizedSnapshot\(engine, state, nick\)/);
  assert.match(edge, /snapshot,\s*\}\);/);
  assert.doesNotMatch(edge, /jsonResponse\(\{[^}]*\bstate\s*:/s);
  assert.doesNotMatch(edge, /jsonResponse\(\{[^}]*\bdeck\s*:/s);
  assert.doesNotMatch(edge, /jsonResponse\(\{[^}]*\bburn\s*:/s);
  assert.doesNotMatch(edge, /console\.(?:log|error)\([^)]*\.state/s);
});

test("AI management and bot turns stay inside the authoritative command surface", () => {
  for (const action of ["add_bot", "remove_bot", "bot_step"]) {
    assert.match(edge, new RegExp(`"${action}"`));
  }
  assert.match(
    edge,
    /const OWNER_ACTIONS = new Set\(\[[^\]]*"add_bot"[^\]]*"remove_bot"/s,
  );
  assert.match(
    edge,
    /const VERSIONED_ACTIONS = new Set\(\[[^\]]*"add_bot"[^\]]*"remove_bot"[^\]]*"bot_step"/s,
  );
  assert.match(edge, /HAND_SCOPED_ACTIONS\.add\("bot_step"\)/);
  assert.match(edge, /const expectedActionSeqValue = Number\(body\.actionSeq\)/);
  assert.match(
    edge,
    /action === "bot_step"[\s\S]*expectedActionSeqValue !== Number\(baseState\.actionSeq\)[\s\S]*"stale"/,
  );
  assert.match(
    edge,
    /const command = action === "bot_step" && ai\s*\?\s*botCommand\(engine, ai, baseState\)/,
  );
  assert.match(edge, /internalBot: action === "bot_step"/);
  assert.match(engine, /function humanPlayers\(state\)/);
  assert.match(engine, /function botPlayers\(state\)/);
  assert.match(engine, /function convertRingTableToPractice\(state\)/);
  assert.match(engine, /practice_refund/);
  assert.match(engine, /practice_ai_only/);
  assert.match(engine, /bots_solo_only/);
  assert.match(engine, /convertRingTableToAssetBacked\(next\)/);
});

test("the AI receives only botView data and client-supplied moves cannot steer it", () => {
  assert.match(edge, /import "\.\.\/\.\.\/\.\.\/holdem-ai\.js"/);
  assert.match(edge, /function sanitizedBotSnapshot/);
  assert.match(edge, /const snapshot = engine\.botView\(state, botId\)/);
  assert.match(
    edge,
    /ai\.decide\(\s*sanitizedBotSnapshot\(engine, state, actor\.botId\)/s,
  );
  assert.doesNotMatch(edge, /difficulty:\s*actor\./);
  assert.doesNotMatch(edge, /personality:\s*actor\./);
  assert.match(
    edge,
    /"difficulty",\s*"botDifficulty",\s*"level",/s,
  );
  assert.match(edge, /"personality",\s*"botPersonality",/s);
  assert.doesNotMatch(edge, /ai\.decide\(\s*state\b/s);
  assert.match(edge, /type: "bot_act"/);
  assert.match(edge, /requestId: `bot:\$\{handNo\}:\$\{actionSeq\}:\$\{actor\.botId\}`/);
  assert.doesNotMatch(
    edge,
    /action === "bot_step"[\s\S]{0,500}(?:explicit|body)\.(?:move|amount)/,
  );
  assert.match(
    edge,
    /publicTableResponse\(\s*client,\s*engine,\s*isRecord\(cas\.current_state\) \? cas\.current_state : nextState,\s*account\.nick/s,
  );
});

test("ring refills are account-wide, Korea-day limited, and atomic with the table update", () => {
  assert.match(
    ringRefillMigration,
    /create table if not exists public\.holdem_ring_refills/i
  );
  assert.match(ringRefillMigration, /primary key \(nickname, refill_date\)/i);
  assert.match(ringRefillMigration, /used_count between 0 and 3/i);
  assert.match(
    ringRefillMigration,
    /alter table public\.holdem_ring_refills enable row level security/i
  );
  assert.match(
    ringRefillMigration,
    /revoke all on table public\.holdem_ring_refills from public, anon, authenticated/i
  );
  assert.match(
    ringRefillMigration,
    /timezone\('Asia\/Seoul', now\(\)\)/i
  );
  assert.match(
    ringRefillMigration,
    /if current_count >= 3[\s\S]*'refill_limit'/i
  );
  assert.match(
    ringRefillMigration,
    /update public\.holdem_ring_refills[\s\S]*update public\.holdem_tables/i
  );
  assert.match(
    ringRefillMigration,
    /grant execute on function public\.holdem_ring_refill_compare_and_swap\(text,bigint,jsonb,text,text\)[\s\S]*to service_role/i
  );
  assert.match(edge, /"refill"/);
  assert.match(edge, /internalRefill: action === "refill"/);
  assert.match(edge, /client\.rpc\(\s*"holdem_ring_refill_compare_and_swap"/s);
  assert.match(edge, /\.from\("holdem_ring_refills"\)/);
  assert.match(edge, /cas\.reason === "refill_limit"/);
});

test("Hold'em wallets use 100-chip accounting and update atomically with ring tables", () => {
  assert.match(
    walletMigration,
    /delete from public\.holdem_tables[\s\S]*economyVersion[\s\S]*distinct from '2'/i
  );
  assert.match(
    walletMigration,
    /constraint holdem_tables_economy_version_check[\s\S]*coalesce\(state ->> 'economyVersion', ''\) = '2'/i
  );
  assert.match(
    walletMigration,
    /create table if not exists public\.holdem_wallets/i
  );
  assert.match(walletMigration, /balance bigint not null default 100000/i);
  assert.match(walletMigration, /balance >= 0 and mod\(balance, 100\) = 0/i);
  assert.match(
    walletMigration,
    /alter table public\.holdem_wallets enable row level security/i
  );
  assert.match(
    walletMigration,
    /revoke all on table public\.holdem_wallets from public, anon, authenticated/i
  );
  assert.match(
    walletMigration,
    /create or replace function public\.holdem_wallet_get_or_create/i
  );
  assert.match(
    walletMigration,
    /table_balance bigint[\s\S]*total_assets bigint[\s\S]*table_holdings[\s\S]*wallet\.balance \+ table_holdings\.amount/i
  );
  assert.match(
    walletMigration,
    /create or replace function public\.holdem_ring_table_compare_and_swap/i
  );
  assert.match(
    walletMigration,
    /wallet\.balance \+ totals\.delta < 0[\s\S]*'wallet_insufficient'/i
  );
  assert.match(
    walletMigration,
    /update public\.holdem_wallets[\s\S]*(?:insert into|update public\.)holdem_tables/i
  );
  assert.match(
    walletMigration,
    /grant execute on function public\.holdem_ring_table_compare_and_swap\([\s\S]*to service_role/i
  );
  assert.match(edge, /const CHIP_UNIT = 100/);
  assert.match(edge, /const INITIAL_WALLET_BALANCE = 100000/);
  assert.doesNotMatch(edge, /RING_BUY_IN_OPTIONS/);
  assert.match(edge, /amount >= RING_MIN_BUY_IN[\s\S]*amount <= RING_MAX_BUY_IN[\s\S]*amount % CHIP_UNIT === 0/);
  assert.match(edge, /function ringBlindForBuyIn\(buyIn: number\)/);
  assert.match(edge, /return \{ smallBlind: 100, bigBlind: 200 \}/);
  assert.match(edge, /smallBlind: 300, bigBlind: 600/);
  assert.match(edge, /smallBlind: blind\.smallBlind/);
  assert.match(edge, /bigBlind: blind\.bigBlind/);
  assert.match(edge, /assetBacked: false/);
  assert.match(edge, /RING_REFILL_AMOUNT = 20000/);
  assert.match(edge, /action === "wallet"/);
  assert.match(edge, /holdem_wallet_get_or_create/);
  assert.match(edge, /availableBalance[\s\S]*tableBalance[\s\S]*totalAssets/);
  assert.match(edge, /function takeWalletAdjustments/);
  assert.match(edge, /delete state\.walletAdjustments/);
  assert.match(edge, /const assetBackedRingTable = ringTable/);
  assert.match(edge, /assetBackedRingTable \|\| walletAdjustments\.length > 0/);
  assert.match(edge, /action === "refill" && assetBackedRingTable/);
  assert.match(edge, /client\.rpc\(\s*"holdem_ring_table_compare_and_swap"/s);
  assert.match(edge, /cas\.reason === "wallet_insufficient"/);
  assert.match(
    walletMigration,
    /create or replace function public\.cleanup_expired_holdem_tables/i
  );
  assert.match(walletMigration, /settings,assetBacked/i);
  assert.match(walletMigration, /jsonb_array_elements/i);
  assert.match(walletMigration, /seat\.value ->> 'totalBet'/i);
  assert.match(
    walletMigration,
    /wallet_updates as[\s\S]*update public\.holdem_wallets[\s\S]*refund_guard as[\s\S]*delete from public\.holdem_tables/i
  );
  assert.match(
    walletMigration,
    /not exists \([\s\S]*public\.room_leases[\s\S]*lease\.expires_at > clock_timestamp\(\)/i
  );
  assert.match(edge, /async function cleanupExpiredTables/);
  assert.match(
    edge,
    /cleanup_expired_holdem_tables[\s\S]*p_ttl_seconds: 300[\s\S]*p_limit: 50/
  );
  assert.match(
    edge,
    /if \(walletAction\) \{[\s\S]*await cleanupExpiredTables\(client\)[\s\S]*walletProfile/
  );
  assert.match(edge, /if \(action === "join"\) await cleanupExpiredTables\(client\)/);
});
