import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CURVE_VERSION = 1;
const MAX_LEVEL = 100;
const MAX_TOTAL_XP = 883080;
const MATCH_XP_CAP = 100;
const COMPLETION_XP = 15;
const ANSWER_XP_CAP = 60;
const MVP_XP = 15;
const EQUIP_LIMITS = {
  sticker: 4,
  text_emote: 12,
} as const;

type JsonObject = Record<string, unknown>;
type RewardKind = "board_frame" | "sticker" | "text_emote" | "nameplate" | "bundle";

function response(body: JsonObject) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function safeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function safeId(value: unknown) {
  const text = safeText(value, 80);
  return /^[A-Za-z0-9_-]{1,80}$/.test(text) ? text : "";
}

function safeInteger(value: unknown, min: number, max: number) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function totalXpForLevel(targetLevel: number) {
  let total = 0;
  for (let level = 1; level < Math.max(1, Math.min(MAX_LEVEL, targetLevel)); level++) {
    total += Math.round((60 + 18 * level + 2.4 * level * level) / 5) * 5;
  }
  return total;
}

function levelForXp(totalXp: unknown) {
  const xp = safeInteger(totalXp, 0, MAX_TOTAL_XP);
  let low = 1;
  let high = MAX_LEVEL;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (totalXpForLevel(middle) <= xp) low = middle;
    else high = middle - 1;
  }
  return low;
}

function answerSpeedXp(answerMs: unknown) {
  if (answerMs == null || !Number.isFinite(Number(answerMs))) return 0;
  const milliseconds = Math.max(0, Number(answerMs));
  if (milliseconds <= 15000) return 12;
  if (milliseconds <= 30000) return 9;
  if (milliseconds <= 50000) return 6;
  if (milliseconds <= 70000) return 4;
  if (milliseconds <= 90000) return 2;
  return 0;
}

function answerTimes(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit)
    .map((time) => Number(time))
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= 90000)
    .map((time) => Math.round(time));
}

function calculateMatchXp(resultValue: unknown, contextValue: unknown) {
  const result = object(resultValue);
  const context = object(contextValue);
  const humanPlayers = safeInteger(context.humanPlayers, 0, 8);
  const eligibleRounds = safeInteger(
    result.eligibleRounds ?? context.roundsPlayed,
    0,
    40,
  );
  const eligible = context.completed === true
    && context.practice !== true
    && context.preview !== true
    && humanPlayers >= 2
    && eligibleRounds >= 2;
  if (!eligible) {
    return {
      eligible: false,
      total: 0,
      breakdown: {
        completion: 0,
        answers: 0,
        mvp: 0,
      },
      metrics: {
        eligibleRounds,
        answerTimesMs: [],
        answerXp: [],
        correctCount: 0,
        mvp: false,
      },
    };
  }

  const times = answerTimes(result.answerTimesMs, Math.max(1, eligibleRounds));
  const answerXp = times.map(answerSpeedXp);
  const answerTotal = Math.min(
    ANSWER_XP_CAP,
    answerXp.reduce((sum, xp) => sum + xp, 0),
  );
  const breakdown = {
    completion: COMPLETION_XP,
    answers: answerTotal,
    mvp: 0,
  };
  const raw = breakdown.completion + breakdown.answers;
  return {
    eligible: true,
    total: Math.min(MATCH_XP_CAP, raw),
    raw,
    breakdown,
    metrics: {
      eligibleRounds,
      answerTimesMs: times,
      answerXp,
      correctCount: times.length,
      mvp: false,
    },
  };
}

async function verifyAccount(client: ReturnType<typeof createClient>, authValue: unknown) {
  const auth = object(authValue);
  const nick = safeText(auth.nick, 40);
  const hash = safeText(auth.hash, 128);
  if (!nick || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const { data, error } = await client
    .from("accounts")
    .select("nickname")
    .eq("nickname", nick)
    .eq("pw_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  return nick;
}

async function ensureProfile(client: ReturnType<typeof createClient>, nick: string) {
  await client
    .from("catchmind_profiles")
    .upsert(
      { nickname: nick, curve_version: CURVE_VERSION },
      { onConflict: "nickname", ignoreDuplicates: true },
    );
}

async function profilePayload(client: ReturnType<typeof createClient>, nick: string) {
  await ensureProfile(client, nick);
  const [{ data: profile, error: profileError }, { data: unlocks, error: unlockError }] = await Promise.all([
    client
      .from("catchmind_profiles")
      .select("nickname,total_xp,curve_version,equipped_board_frame,equipped_nameplate,equipped_stickers,equipped_text_emotes,updated_at")
      .eq("nickname", nick)
      .single(),
    client
      .from("catchmind_unlocks")
      .select("reward_id,unlocked_at,catchmind_reward_catalog!inner(unlock_level,kind,name,asset_key,config,active)")
      .eq("nickname", nick)
      .order("unlocked_at", { ascending: true }),
  ]);
  if (profileError || unlockError || !profile) {
    return { ok: false, reason: "profile", msg: profileError?.message ?? unlockError?.message };
  }
  return {
    ok: true,
    profile: {
      nickname: profile.nickname,
      totalXp: profile.total_xp,
      level: levelForXp(profile.total_xp),
      curveVersion: profile.curve_version,
      equipped: {
        boardFrame: profile.equipped_board_frame,
        nameplate: profile.equipped_nameplate,
        stickers: profile.equipped_stickers ?? [],
        textEmotes: profile.equipped_text_emotes ?? [],
      },
      updatedAt: profile.updated_at,
    },
    unlocks: unlocks ?? [],
  };
}

async function awardMatchXp(
  client: ReturnType<typeof createClient>,
  nick: string,
  body: JsonObject,
) {
  const matchId = safeId(body.matchId);
  if (!matchId) return response({ ok: false, reason: "invalid_match" });
  const award = calculateMatchXp(body.result, body.context);
  if (!award.eligible) return response({ ok: false, reason: "ineligible", xp: 0 });

  const context = object(body.context);
  const storedContext = {
    humanPlayers: safeInteger(context.humanPlayers, 0, 8),
    roundsPlayed: safeInteger(context.roundsPlayed, 0, 40),
    durationMs: safeInteger(context.durationMs, 0, 7200000),
  };
  const { data, error } = await client.rpc("award_catchmind_xp", {
    p_match_id: matchId,
    p_nickname: nick,
    p_xp: award.total,
    p_breakdown: { xp: award.breakdown, metrics: award.metrics },
    p_context: storedContext,
    p_curve_version: CURVE_VERSION,
  });
  if (error) return response({ ok: false, reason: "award", msg: error.message });
  return response({
    ok: true,
    award: { ...data, breakdown: award.breakdown, metrics: award.metrics },
  });
}

async function castMvpVote(
  client: ReturnType<typeof createClient>,
  nick: string,
  body: JsonObject,
) {
  const matchId = safeId(body.matchId);
  const nominee = safeText(body.nominee, 40);
  if (!matchId || !nominee || nominee === nick) {
    return response({ ok: false, reason: "invalid_mvp_vote" });
  }
  const { data, error } = await client.rpc("cast_catchmind_mvp_vote", {
    p_match_id: matchId,
    p_voter: nick,
    p_nominee: nominee,
  });
  if (error) return response({ ok: false, reason: "mvp_vote", msg: error.message });
  return response({ ok: true, vote: data, bonusXp: MVP_XP });
}

async function mvpResult(
  client: ReturnType<typeof createClient>,
  nick: string,
  body: JsonObject,
) {
  const matchId = safeId(body.matchId);
  if (!matchId) return response({ ok: false, reason: "invalid_match" });
  const { data, error } = await client.rpc("finalize_catchmind_mvp", {
    p_match_id: matchId,
    p_requester: nick,
  });
  if (error) return response({ ok: false, reason: "mvp_result", msg: error.message });
  return response({ ok: true, result: data, bonusXp: MVP_XP });
}

async function unlockedRewards(
  client: ReturnType<typeof createClient>,
  nick: string,
  rewardIds: string[],
  kind: RewardKind,
) {
  if (!rewardIds.length) return true;
  const { data: unlocks, error: unlockError } = await client
    .from("catchmind_unlocks")
    .select("reward_id")
    .eq("nickname", nick)
    .in("reward_id", rewardIds);
  if (unlockError || (unlocks ?? []).length !== rewardIds.length) return false;
  const { data: rewards, error: rewardError } = await client
    .from("catchmind_reward_catalog")
    .select("reward_id")
    .eq("kind", kind)
    .eq("active", true)
    .in("reward_id", rewardIds);
  return !rewardError && (rewards ?? []).length === rewardIds.length;
}

function uniqueRewardIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.map((item) => safeText(item, 80))
      .filter((item) => /^[a-z0-9-]{1,80}$/.test(item)),
  )];
}

async function equipRewards(
  client: ReturnType<typeof createClient>,
  nick: string,
  body: JsonObject,
) {
  const kind = safeText(body.kind, 20) as RewardKind;
  if (!["board_frame", "sticker", "text_emote", "nameplate"].includes(kind)) {
    return response({ ok: false, reason: "invalid_kind" });
  }

  if (kind === "board_frame" || kind === "nameplate") {
    const rewardId = safeText(body.rewardId, 80);
    if (rewardId && !await unlockedRewards(client, nick, [rewardId], kind)) {
      return response({ ok: false, reason: "locked_reward" });
    }
    const field = kind === "board_frame" ? "equipped_board_frame" : "equipped_nameplate";
    const { error } = await client
      .from("catchmind_profiles")
      .update({ [field]: rewardId || null, updated_at: new Date().toISOString() })
      .eq("nickname", nick);
    if (error) return response({ ok: false, reason: "equip", msg: error.message });
  } else {
    const rewardIds = uniqueRewardIds(body.rewardIds);
    const limit = EQUIP_LIMITS[kind];
    if (rewardIds.length > limit) return response({ ok: false, reason: "equip_limit", limit });
    if (!await unlockedRewards(client, nick, rewardIds, kind)) {
      return response({ ok: false, reason: "locked_reward" });
    }
    const field = kind === "sticker" ? "equipped_stickers" : "equipped_text_emotes";
    const { error } = await client
      .from("catchmind_profiles")
      .update({ [field]: rewardIds, updated_at: new Date().toISOString() })
      .eq("nickname", nick);
    if (error) return response({ ok: false, reason: "equip", msg: error.message });
  }

  const payload = await profilePayload(client, nick);
  return response(payload);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return response({ ok: false, reason: "method" });

  let body: JsonObject;
  try {
    body = await request.json();
  } catch {
    return response({ ok: false, reason: "invalid_json" });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return response({ ok: false, reason: "server_config" });
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const nick = await verifyAccount(client, body.auth);
  if (!nick) return response({ ok: false, reason: "auth" });

  if (body.action === "profile") return response(await profilePayload(client, nick));
  if (body.action === "award") return awardMatchXp(client, nick, body);
  if (body.action === "mvp_vote") return castMvpVote(client, nick, body);
  if (body.action === "mvp_result") return mvpResult(client, nick, body);
  if (body.action === "equip") {
    await ensureProfile(client, nick);
    return equipRewards(client, nick, body);
  }
  return response({ ok: false, reason: "action" });
});
