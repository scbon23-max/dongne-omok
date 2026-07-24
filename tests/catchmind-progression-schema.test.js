const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "202607240001_catchmind_progression.sql"),
  "utf8"
);
const edge = fs.readFileSync(
  path.join(root, "supabase", "functions", "catchmind-progression", "index.ts"),
  "utf8"
);
const config = fs.readFileSync(path.join(root, "supabase", "config.toml"), "utf8");

test("progression storage separates profiles, events, rewards, and unlocks", () => {
  assert.match(migration, /create table if not exists public\.catchmind_profiles/i);
  assert.match(migration, /create table if not exists public\.catchmind_xp_events/i);
  assert.match(migration, /create table if not exists public\.catchmind_mvp_votes/i);
  assert.match(migration, /create table if not exists public\.catchmind_mvp_results/i);
  assert.match(migration, /create table if not exists public\.catchmind_reward_catalog/i);
  assert.match(migration, /create table if not exists public\.catchmind_unlocks/i);
});

test("one account can receive XP only once for a match", () => {
  assert.match(migration, /unique\s*\(\s*match_id\s*,\s*nickname\s*\)/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /'duplicate'\s*,\s*true/i);
});

test("XP and level bounds are enforced in both database and edge function", () => {
  assert.match(migration, /total_xp between 0 and 883080/i);
  assert.match(migration, /xp between 0 and 100/i);
  assert.match(edge, /const MAX_LEVEL = 100/);
  assert.match(edge, /const MAX_TOTAL_XP = 883080/);
  assert.match(edge, /const MATCH_XP_CAP = 100/);
  assert.match(edge, /const COMPLETION_XP = 15/);
  assert.match(edge, /const ANSWER_XP_CAP = 60/);
  assert.match(edge, /const MVP_XP = 15/);
});

test("browser access stays closed and the edge function verifies the account", () => {
  assert.match(migration, /enable row level security/gi);
  assert.match(migration, /revoke all on public\.catchmind_profiles from anon, authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete|all).*to\s+(anon|authenticated)/i);
  assert.match(edge, /async function verifyAccount/);
  assert.match(edge, /\.eq\("pw_hash", hash\)/);
});

test("the edge function recalculates completion and answer-speed XP before the atomic RPC", () => {
  assert.match(edge, /function calculateMatchXp/);
  assert.match(edge, /function answerSpeedXp/);
  assert.match(edge, /answerTimes\(result\.answerTimesMs/);
  assert.match(edge, /context\.completed === true/);
  assert.match(edge, /humanPlayers >= 2/);
  assert.match(edge, /Math\.min\(\s*ANSWER_XP_CAP/);
  assert.match(edge, /Math\.min\(MATCH_XP_CAP, raw\)/);
  assert.match(edge, /p_breakdown: \{ xp: award\.breakdown, metrics: award\.metrics \}/);
  assert.match(edge, /client\.rpc\("award_catchmind_xp"/);
});

test("MVP voting excludes self, accepts one vote, and grants one fixed server bonus", () => {
  assert.match(migration, /primary key\s*\(\s*match_id\s*,\s*voter_nickname\s*\)/i);
  assert.match(migration, /check\s*\(\s*voter_nickname\s*<>\s*nominee_nickname\s*\)/i);
  assert.match(migration, /create or replace function public\.cast_catchmind_mvp_vote/i);
  assert.match(migration, /create or replace function public\.finalize_catchmind_mvp/i);
  assert.match(migration, /mvp_vote_requires_match_participants/i);
  assert.match(migration, /v_after := least\(883080, v_before \+ 15\)/i);
  assert.match(edge, /body\.action === "mvp_vote"/);
  assert.match(edge, /body\.action === "mvp_result"/);
  assert.match(edge, /nominee === nick/);
});

test("reward equipment has category limits and the function is locally configured", () => {
  assert.match(edge, /sticker: 4/);
  assert.match(edge, /text_emote: 12/);
  assert.match(edge, /body\.action === "equip"/);
  assert.match(config, /\[functions\.catchmind-progression\][\s\S]*verify_jwt = false/);
});
