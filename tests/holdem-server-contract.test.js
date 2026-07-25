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
const edge = fs.readFileSync(
  path.join(root, "supabase", "functions", "holdem-table", "index.ts"),
  "utf8"
);

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

test("room lease ownership wins, with the authenticated creator as final fallback", () => {
  assert.match(edge, /async function activeLeaseOwner/);
  assert.match(edge, /\.from\("room_leases"\)/);
  assert.match(edge, /\.eq\("room_id", roomId\)/);
  assert.match(edge, /\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(
    edge,
    /const ownerNick = leaseOwner \?\?\s*table\?\.owner_nickname \?\?\s*account\.nick/
  );
  assert.match(edge, /engine\.createTable\(\{ roomId, ownerNick \}\)/);
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
    /const nextState = normalizeState\(resultState\);[\s\S]*const cas = await compareAndSwap/
  );
  assert.match(
    edge,
    /client\.rpc\("holdem_table_compare_and_swap"/
  );
});

test("responses are built from the per-player engine view, never stored state", () => {
  assert.match(edge, /const snapshot = engine\.view\(state, nick\)/);
  assert.match(edge, /snapshot: sanitizedSnapshot\(engine, state, nick\)/);
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
    /publicTableResponse\(\s*engine,\s*nextState,\s*account\.nick/s,
  );
});
