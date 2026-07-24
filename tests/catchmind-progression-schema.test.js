const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "202607240001_catchmind_progression.sql"),
  "utf8"
);
const boardFrameMigration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "202607240002_catchmind_board_frames.sql"),
  "utf8"
);
const boardFrameOnlyMigration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "202607240003_catchmind_board_frame_rewards_only.sql"),
  "utf8"
);
const randomMvpTieMigration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "202607240004_randomize_catchmind_mvp_ties.sql"),
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

test("MVP vote ties select one random winner and persist the finalized result", () => {
  assert.match(
    randomMvpTieMigration,
    /create or replace function public\.finalize_catchmind_mvp/i
  );
  assert.match(
    randomMvpTieMigration,
    /with vote_totals as\s*\([\s\S]*group by nominee_nickname[\s\S]*leaders as\s*\([\s\S]*where vote_count = \(select max\(vote_count\) from vote_totals\)[\s\S]*from leaders\s+order by random\(\)\s+limit 1/i
  );
  assert.doesNotMatch(randomMvpTieMigration, /md5\s*\(/i);
  assert.match(randomMvpTieMigration, /pg_advisory_xact_lock/i);
  assert.match(
    randomMvpTieMigration,
    /from public\.catchmind_mvp_results\s+where match_id = p_match_id[\s\S]*if found then/i
  );
  assert.match(
    randomMvpTieMigration,
    /insert into public\.catchmind_mvp_results\s*\([\s\S]*winner_nickname[\s\S]*\)\s*values\s*\(\s*p_match_id,\s*v_winner/i
  );
});

test("reward equipment has category limits and the function is locally configured", () => {
  assert.match(edge, /sticker: 4/);
  assert.match(edge, /text_emote: 12/);
  assert.match(edge, /body\.action === "equip"/);
  assert.match(config, /\[functions\.catchmind-progression\][\s\S]*verify_jwt = false/);
});

test("the additive board-frame catalog has eighteen ordered rewards at the agreed levels", () => {
  const expected = [
    ["frame-color-pencil", 5, "assets/catchmind/board-frames/frame-color-pencil-v2.png", 1, "low"],
    ["frame-galaxy-stars", 10, "assets/catchmind/board-frames/frame-galaxy-stars.png", 2, "low"],
    ["frame-retro-pixel", 15, "assets/catchmind/board-frames/frame-retro-pixel.png", 3, "low"],
    ["frame-cherry-blossom", 20, "assets/catchmind/board-frames/frame-cherry-blossom.png", 4, "low"],
    ["frame-bamboo-garden", 25, "assets/catchmind/board-frames/frame-bamboo-garden.png", 5, "low"],
    ["frame-dancheong", 30, "assets/catchmind/board-frames/frame-dancheong.png", 6, "low"],
    ["frame-ice-crystal", 35, "assets/catchmind/board-frames/frame-ice-crystal.png", 7, "low"],
    ["frame-cookie-sprinkle", 40, "assets/catchmind/board-frames/frame-cookie-sprinkle.png", 8, "low"],
    ["frame-aurora-ribbon", 50, "assets/catchmind/board-frames/frame-aurora-ribbon.png", 9, "high"],
    ["frame-prism-glass", 55, "assets/catchmind/board-frames/frame-prism-glass.png", 10, "high"],
    ["frame-rainbow-hologram", 60, "assets/catchmind/board-frames/frame-rainbow-hologram.png", 11, "high"],
    ["frame-magic-palette", 65, "assets/catchmind/board-frames/frame-magic-palette.png", 12, "high"],
    ["frame-golden-doodle", 70, "assets/catchmind/board-frames/frame-golden-doodle.png", 13, "high"],
    ["frame-masterpiece", 75, "assets/catchmind/board-frames/frame-masterpiece.png", 14, "high"],
    ["frame-starlight-cloud", 80, "assets/catchmind/board-frames/frame-starlight-cloud.png", 15, "high"],
    ["frame-celebration-ribbon", 85, "assets/catchmind/board-frames/frame-celebration-ribbon.png", 16, "high"],
    ["frame-gem-candy", 90, "assets/catchmind/board-frames/frame-gem-candy.png", 17, "high"],
    ["frame-pastel-carnival", 100, "assets/catchmind/board-frames/frame-pastel-carnival.png", 18, "high"]
  ];
  const actual = Array.from(
    boardFrameMigration.matchAll(
      /\(\s*'(frame-[^']+)',\s*(\d+),\s*'board_frame',\s*'[^']+',\s*'([^']+)',\s*'\{"order":(\d+),"tier":"(low|high)"\}'::jsonb,\s*true\s*\)/g
    ),
    (match) => [match[1], Number(match[2]), match[3], Number(match[4]), match[5]]
  );

  assert.deepEqual(actual, expected);
  for (const [, , asset] of expected) {
    assert.equal(fs.existsSync(path.join(root, asset)), true, `missing board-frame asset: ${asset}`);
  }
  assert.match(boardFrameMigration, /on conflict \(reward_id\) do update set/i);
  assert.match(boardFrameMigration, /config\s*=\s*excluded\.config/i);
});

test("the board-frame migration preserves legacy ownership and backfills by current level", () => {
  assert.match(
    boardFrameMigration,
    /when 'frame-blue-pencil' then 'frame-color-pencil'/i
  );
  assert.match(
    boardFrameMigration,
    /when 'frame-master' then 'frame-masterpiece'/i
  );
  assert.match(
    boardFrameMigration,
    /update public\.catchmind_profiles[\s\S]*equipped_board_frame[\s\S]*where equipped_board_frame in \('frame-blue-pencil', 'frame-master'\)/i
  );
  assert.match(
    boardFrameMigration,
    /delete from public\.catchmind_reward_catalog\s+where reward_id in \('frame-blue-pencil', 'frame-master'\)/i
  );
  assert.match(
    boardFrameMigration,
    /reward\.unlock_level <= public\.catchmind_level_for_xp\(profile\.total_xp\)/i
  );
  assert.match(
    boardFrameMigration,
    /insert into public\.catchmind_unlocks[\s\S]*on conflict \(nickname, reward_id\) do nothing/i
  );
});

test("the reward cleanup keeps only board frames and clears obsolete equipment", () => {
  assert.match(
    boardFrameOnlyMigration,
    /delete from public\.catchmind_reward_catalog\s+where kind <> 'board_frame'/i
  );
  assert.match(boardFrameOnlyMigration, /equipped_nameplate\s*=\s*null/i);
  assert.match(boardFrameOnlyMigration, /equipped_stickers\s*=\s*'\{\}'::text\[\]/i);
  assert.match(boardFrameOnlyMigration, /equipped_text_emotes\s*=\s*'\{\}'::text\[\]/i);
  assert.match(migration, /reward_id text not null references public\.catchmind_reward_catalog\(reward_id\)[\s\S]*on update cascade on delete cascade/i);
});
