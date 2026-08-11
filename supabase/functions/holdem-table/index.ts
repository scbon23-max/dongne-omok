import "../../../holdem-engine.js";
import "../../../holdem-ai.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

type JsonRecord = Record<string, unknown>;

type HoldemCommandResult = {
  ok: boolean;
  state: unknown;
  changed: boolean;
  reason?: string;
  event?: unknown;
};

type HoldemEngineApi = {
  createTable(options: {
    roomId: string;
    ownerNick: string;
    mode?: string;
    tournamentSpeed?: string;
    assetBacked?: boolean;
    chipUnit?: number;
    startingStack?: number;
    smallBlind?: number;
    bigBlind?: number;
    actionMs?: number;
    blindLevelMs?: number;
    refillAmount?: number;
    dailyRefillLimit?: number;
  }): unknown;
  command(
    state: unknown,
    command: JsonRecord,
    context: {
      now: number;
      randomInt(max: number): number;
      internalBot?: boolean;
      internalRefill?: boolean;
    },
  ): HoldemCommandResult;
  view(state: unknown, nick: string): unknown;
  botView(state: unknown, botId: string): unknown;
};

type HoldemAIDecision = {
  action: string;
  amount?: number;
};

type HoldemAIApi = {
  decide(
    snapshot: unknown,
    options: {
      randomInt(max: number): number;
    },
  ): HoldemAIDecision;
};

type Account = {
  nick: string;
  isAdmin: boolean;
};

const REFILL_COUNT_BASELINE_ISO = "2026-07-31T15:55:47+09:00";
const REFILL_COUNT_BASELINE_LABEL = "2026.7.31";

type TableRow = {
  room_id: string;
  state: unknown;
  version: number;
  owner_nickname: string;
};

type CasRow = {
  applied: boolean;
  reason?: string;
  current_state: unknown;
  current_version: number | string;
  current_owner_nickname: string | null;
};

type LeaseInfo = {
  ownerNick: string;
  game: string;
  buyIn: number;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTIONS = new Set([
  "wallet",
  "profile_asset",
  "wallet_refill",
  "ranking",
  "ranking_detail",
  "join",
  "leave",
  "ready",
  "settings",
  "start",
  "act",
  "reveal_cards",
  "tick",
  "presence",
  "add_bot",
  "remove_bot",
  "join_request",
  "resolve_join_request",
  "bot_step",
  "snapshot",
  "refill",
  "rebuy",
]);
const OWNER_ACTIONS = new Set(["settings", "add_bot", "remove_bot"]);
const VERSIONED_ACTIONS = new Set([
  "act",
  "add_bot",
  "remove_bot",
  "bot_step",
]);
// Refill and rebuy are target-stack operations. The CAS loop safely reapplies
// them to the newest table state when ordinary game actions advance the version.
const HAND_SCOPED_ACTIONS = new Set(["act", "reveal_cards", "tick"]);
HAND_SCOPED_ACTIONS.add("bot_step");
const POKER_ACTIONS = new Set([
  "fold",
  "check",
  "call",
  "bet",
  "raise",
  "allin",
]);
const ACTIVE_HAND_PHASES = new Set(["preflop", "flop", "turn", "river"]);
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_STATE_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const MAX_CAS_RETRIES = 5;
const CHIP_UNIT = 100;
const INITIAL_WALLET_BALANCE = 100000;
const RANKING_MIN_HANDS = 5;
const RANKING_EXCLUDED_NICKNAMES = new Set(["테스터"]);
const RING_MIN_BUY_IN = 10000;
const RING_MAX_BUY_IN = 100000;
const RING_ROOM_BUY_INS = new Set([15000, 30000, 75000]);
const RING_DEFAULT_BUY_IN = 30000;
const RING_REFILL_AMOUNT = 20000;
const RING_FREE_REFILL_ASSET_LIMIT = RING_REFILL_AMOUNT;
const HOLDEM_ROOM_GAMES = new Set([
  "holdem",
  "holdem_tournament",
  "holdem_turbo",
  "holdem_ring",
]);

const RESERVED_COMMAND_KEYS = new Set([
  "auth",
  "roomId",
  "requestId",
  "type",
  "nick",
  "nickname",
  "actor",
  "actorNick",
  "owner",
  "ownerNick",
  "state",
  "deck",
  "burn",
  "burnCards",
  "holeCards",
  "move",
  "difficulty",
  "botDifficulty",
  "level",
  "personality",
  "botPersonality",
]);

function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

async function readBody(request: Request): Promise<JsonRecord> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_BODY_BYTES
  ) {
    throw new Error("body_too_large");
  }
  if (!request.body) throw new Error("invalid_json");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("invalid_json");
  }
  if (!isRecord(parsed)) throw new Error("invalid_json");
  return parsed;
}

function getEngine(): HoldemEngineApi | null {
  const candidate = (
    globalThis as typeof globalThis & { HoldemEngine?: HoldemEngineApi }
  ).HoldemEngine;
  return candidate &&
      typeof candidate.createTable === "function" &&
      typeof candidate.command === "function" &&
      typeof candidate.view === "function" &&
      typeof candidate.botView === "function"
    ? candidate
    : null;
}

function getAI(): HoldemAIApi | null {
  const candidate = (
    globalThis as typeof globalThis & { HoldemAI?: HoldemAIApi }
  ).HoldemAI;
  return candidate && typeof candidate.decide === "function"
    ? candidate
    : null;
}

function secureRandomInt(max: number) {
  if (!Number.isSafeInteger(max) || max <= 0 || max > 0x1_0000_0000) {
    throw new RangeError("invalid_random_range");
  }
  const range = 0x1_0000_0000;
  const ceiling = range - (range % max);
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= ceiling);
  return buffer[0] % max;
}

function normalizeState(value: unknown): JsonRecord {
  const serialized = JSON.stringify(value);
  if (
    !serialized ||
    byteLength(serialized) > MAX_STATE_BYTES
  ) {
    throw new Error("invalid_state");
  }
  const normalized: unknown = JSON.parse(serialized);
  if (!isRecord(normalized)) throw new Error("invalid_state");
  return normalized;
}

function sanitizedSnapshot(
  engine: HoldemEngineApi,
  state: unknown,
  nick: string,
) {
  const snapshot = engine.view(state, nick);
  const serialized = JSON.stringify(snapshot);
  if (
    serialized === undefined ||
    byteLength(serialized) > MAX_SNAPSHOT_BYTES
  ) {
    throw new Error("invalid_snapshot");
  }
  return JSON.parse(serialized);
}

function sanitizedBotSnapshot(
  engine: HoldemEngineApi,
  state: unknown,
  botId: string,
) {
  // botView is the information boundary: the AI never receives the raw table
  // state, deck, burn cards, or any opponent's hidden cards.
  const snapshot = engine.botView(state, botId);
  const serialized = JSON.stringify(snapshot);
  if (
    serialized === undefined ||
    byteLength(serialized) > MAX_SNAPSHOT_BYTES
  ) {
    throw new Error("invalid_bot_snapshot");
  }
  return JSON.parse(serialized);
}

function actingBot(state: unknown) {
  if (!isRecord(state) || !Array.isArray(state.seats)) return null;
  const actorSeat = Number(state.actorSeat);
  if (
    !Number.isSafeInteger(actorSeat) ||
    actorSeat < 0 ||
    actorSeat >= state.seats.length
  ) {
    return null;
  }
  const actor = state.seats[actorSeat];
  if (!isRecord(actor) || actor.isBot !== true) return null;
  const botId = safeText(actor.botId, 40);
  return botId ? { botId } : null;
}

function botCommand(
  engine: HoldemEngineApi,
  ai: HoldemAIApi,
  state: unknown,
) {
  const actor = actingBot(state);
  if (!actor || !isRecord(state)) return null;

  const decision = ai.decide(
    sanitizedBotSnapshot(engine, state, actor.botId),
    {
      randomInt: secureRandomInt,
    },
  );
  const decidedAction = safeText(decision?.action, 16).toLowerCase();
  if (!decision || !POKER_ACTIONS.has(decidedAction)) {
    throw new Error("invalid_bot_decision");
  }

  const handNo = Number.isSafeInteger(Number(state.handNo))
    ? Math.max(0, Number(state.handNo))
    : 0;
  const actionSeq = Number.isSafeInteger(Number(state.actionSeq))
    ? Math.max(0, Number(state.actionSeq))
    : 0;
  const command: JsonRecord = {
    type: "bot_act",
    botId: actor.botId,
    action: decidedAction,
    requestId: `bot:${handNo}:${actionSeq}:${actor.botId}`,
  };
  if (
    typeof decision.amount === "number" &&
    Number.isSafeInteger(decision.amount) &&
    decision.amount >= 0
  ) {
    command.amount = decision.amount;
  }
  return command;
}

function seoulDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values: Record<string, string> = {};
  for (const part of parts) values[part.type] = part.value;
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizedRingBuyIn(value: unknown) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) &&
      amount % CHIP_UNIT === 0 &&
      RING_ROOM_BUY_INS.has(amount)
    ? amount
    : RING_DEFAULT_BUY_IN;
}

function ringBlindForBuyIn(buyIn: number) {
  if (buyIn >= 75000) return { smallBlind: 500, bigBlind: 1000 };
  if (buyIn >= 30000) return { smallBlind: 200, bigBlind: 400 };
  return { smallBlind: 100, bigBlind: 200 };
}

function ringTableBoundsForBuyIn(buyIn: number) {
  if (buyIn >= 75000) return { minBuyIn: 50000, maxBuyIn: 100000, defaultBuyIn: 75000 };
  if (buyIn >= 30000) return { minBuyIn: 20000, maxBuyIn: 40000, defaultBuyIn: 30000 };
  return { minBuyIn: 10000, maxBuyIn: 20000, defaultBuyIn: 15000 };
}

async function walletProfile(
  client: ReturnType<typeof createClient>,
  nick: string,
) {
  const { data, error } = await client.rpc("holdem_wallet_get_or_create", {
    p_nickname: nick,
  });
  const row = Array.isArray(data) ? data[0] : null;
  const availableBalance = Number(row?.current_balance);
  const tableBalance = Number(row?.table_balance);
  const totalAssets = Number(row?.total_assets);
  if (
    error ||
    !Number.isSafeInteger(availableBalance) ||
    !Number.isSafeInteger(tableBalance) ||
    !Number.isSafeInteger(totalAssets) ||
    availableBalance < 0 ||
    tableBalance < 0 ||
    totalAssets !== availableBalance + tableBalance
  ) {
    throw new Error("wallet_lookup");
  }
  return {
    balance: availableBalance,
    availableBalance,
    tableBalance,
    totalAssets,
    initialBalance: INITIAL_WALLET_BALANCE,
    chipUnit: CHIP_UNIT,
    smallBlind: ringBlindForBuyIn(RING_DEFAULT_BUY_IN).smallBlind,
    bigBlind: ringBlindForBuyIn(RING_DEFAULT_BUY_IN).bigBlind,
    minBuyIn: RING_MIN_BUY_IN,
    maxBuyIn: RING_MAX_BUY_IN,
    defaultBuyIn: RING_DEFAULT_BUY_IN,
    refillAmount: RING_REFILL_AMOUNT,
    dailyRefillLimit: 3,
  };
}

async function walletRefillIfEmpty(
  client: ReturnType<typeof createClient>,
  nick: string,
) {
  const { data, error } = await client.rpc("holdem_wallet_refill_if_empty", {
    p_nickname: nick,
  });
  const row = Array.isArray(data) ? data[0] : null;
  const availableBalance = Number(row?.current_balance);
  const tableBalance = Number(row?.table_balance);
  const totalAssets = Number(row?.total_assets);
  const refillsUsedToday = Math.max(0, Number(row?.refills_used) || 0);
  const refillsRemainingToday = Math.max(0, Number(row?.refills_remaining) || 0);
  if (
    error ||
    !row ||
    !Number.isSafeInteger(availableBalance) ||
    !Number.isSafeInteger(tableBalance) ||
    !Number.isSafeInteger(totalAssets) ||
    availableBalance < 0 ||
    tableBalance < 0 ||
    totalAssets !== availableBalance + tableBalance
  ) {
    throw new Error("wallet_refill");
  }
  return {
    applied: row.applied === true,
    reason: row.reason ? safeText(row.reason, 80) : "",
    refillsUsedToday,
    refillsRemainingToday,
    wallet: {
      balance: availableBalance,
      availableBalance,
      tableBalance,
      totalAssets,
      initialBalance: INITIAL_WALLET_BALANCE,
      chipUnit: CHIP_UNIT,
      smallBlind: ringBlindForBuyIn(RING_DEFAULT_BUY_IN).smallBlind,
      bigBlind: ringBlindForBuyIn(RING_DEFAULT_BUY_IN).bigBlind,
      minBuyIn: RING_MIN_BUY_IN,
      maxBuyIn: RING_MAX_BUY_IN,
      defaultBuyIn: RING_DEFAULT_BUY_IN,
      refillAmount: RING_REFILL_AMOUNT,
      dailyRefillLimit: 3,
      refillsUsedToday,
      refillsRemainingToday,
    },
  };
}

function tableHoldingsByNickname(rows: unknown[]) {
  const holdings = new Map<string, number>();
  const activePhases = new Set(["preflop", "flop", "turn", "river"]);
  for (const row of rows) {
    if (!isRecord(row) || !isRecord(row.state)) continue;
    const state = row.state;
    const settings = isRecord(state.settings) ? state.settings : null;
    if (
      !settings ||
      safeText(settings.mode, 24) !== "ring" ||
      settings.assetBacked !== true ||
      !Array.isArray(state.seats)
    ) {
      continue;
    }
    const includeCommittedBets = activePhases.has(safeText(state.phase, 24));
    for (const rawSeat of state.seats) {
      if (!isRecord(rawSeat) || rawSeat.isBot === true) continue;
      const nickname = safeText(rawSeat.nick, 40);
      const stack = Number(rawSeat.stack);
      const totalBet = includeCommittedBets ? Number(rawSeat.totalBet) : 0;
      if (
        !nickname ||
        !Number.isSafeInteger(stack) ||
        !Number.isSafeInteger(totalBet) ||
        stack < 0 ||
        totalBet < 0 ||
        stack % CHIP_UNIT !== 0 ||
        totalBet % CHIP_UNIT !== 0
      ) {
        continue;
      }
      const next = (holdings.get(nickname) ?? 0) + stack + totalBet;
      if (Number.isSafeInteger(next) && next >= 0) holdings.set(nickname, next);
    }
  }
  return holdings;
}

async function profileAsset(
  client: ReturnType<typeof createClient>,
  targetNick: string,
) {
  targetNick = safeText(targetNick, 40);
  if (!targetNick) return null;

  const [{
    data: accountRow,
    error: accountError,
  }, {
    data: walletRow,
    error: walletError,
  }, {
    data: tableRows,
    error: tableError,
  }] = await Promise.all([
    client
      .from("accounts")
      .select("nickname")
      .eq("nickname", targetNick)
      .maybeSingle(),
    client
      .from("holdem_wallets")
      .select("balance")
      .eq("nickname", targetNick)
      .maybeSingle(),
    client
      .from("holdem_tables")
      .select("state")
      .limit(500),
  ]);
  if (accountError || walletError || tableError) {
    throw new Error("profile_asset_lookup");
  }
  if (!accountRow) return null;

  const balance = walletRow == null
    ? INITIAL_WALLET_BALANCE
    : Number(walletRow.balance);
  if (
    !Number.isSafeInteger(balance) ||
    balance < 0 ||
    balance % CHIP_UNIT !== 0
  ) {
    throw new Error("profile_asset_lookup");
  }
  const holdings = tableHoldingsByNickname(
    Array.isArray(tableRows) ? tableRows : [],
  );
  const totalAssets = balance + (holdings.get(targetNick) ?? 0);
  if (!Number.isSafeInteger(totalAssets) || totalAssets < 0) {
    throw new Error("profile_asset_lookup");
  }
  return {
    nickname: targetNick,
    totalAssets,
  };
}

async function assetRankingRows(client: ReturnType<typeof createClient>) {
  const [{ data: walletRows, error: walletError }, {
    data: tableRows,
    error: tableError,
  }, {
    data: accountRows,
    error: accountError,
  }, {
    data: handCounts,
    error: handError,
  }] = await Promise.all([
    client
      .from("holdem_wallets")
      .select("nickname,balance,updated_at")
      .limit(500),
    client
      .from("holdem_tables")
      .select("state")
      .limit(500),
    client
      .from("accounts")
      .select("nickname,is_admin")
      .eq("is_admin", true)
      .limit(500),
    client.rpc("holdem_completed_hand_counts"),
  ]);
  if (walletError || tableError || accountError || handError) {
    throw new Error("ranking_lookup");
  }

  const adminNicknames = new Set(
    (Array.isArray(accountRows) ? accountRows : [])
      .map((row) => safeText(row?.nickname, 40))
      .filter((nickname) => nickname),
  );
  const holdings = tableHoldingsByNickname(Array.isArray(tableRows) ? tableRows : []);
  const completedHands = new Map<string, number>();
  if (!isRecord(handCounts)) throw new Error("ranking_lookup");
  Object.entries(handCounts).forEach(([rawNickname, rawHandCount]) => {
    const nickname = safeText(rawNickname, 40);
    const handCount = Number(rawHandCount);
    if (
      !nickname ||
      !Number.isSafeInteger(handCount) ||
      handCount < 0
    ) {
      throw new Error("ranking_lookup");
    }
    completedHands.set(nickname, handCount);
  });
  const ranked = (Array.isArray(walletRows) ? walletRows : []).map((row) => {
    const nickname = safeText(row?.nickname, 40);
    if (RANKING_EXCLUDED_NICKNAMES.has(nickname)) return null;
    const isAdmin = adminNicknames.has(nickname);
    const handCount = completedHands.get(nickname) ?? 0;
    if (!isAdmin && handCount < RANKING_MIN_HANDS) return null;
    const balance = Number(row?.balance);
    if (
      !nickname ||
      !Number.isSafeInteger(balance) ||
      balance < 0 ||
      balance % CHIP_UNIT !== 0
    ) {
      return null;
    }
    const totalAssets = balance + (holdings.get(nickname) ?? 0);
    if (!Number.isSafeInteger(totalAssets) || totalAssets < 0) return null;
    return {
      nickname,
      totalAssets,
      handCount,
      updatedAt: safeText(row?.updated_at, 40),
      rank: 0,
    };
  }).filter((row): row is {
    nickname: string;
    totalAssets: number;
    handCount: number;
    updatedAt: string;
    rank: number;
  } => row !== null).sort((left, right) => {
    return right.totalAssets - left.totalAssets ||
      left.updatedAt.localeCompare(right.updatedAt) ||
      left.nickname.localeCompare(right.nickname, "ko");
  });

  let previousAssets: number | null = null;
  let previousRank = 0;
  ranked.forEach((row, index) => {
    if (previousAssets !== row.totalAssets) previousRank = index + 1;
    row.rank = previousRank;
    previousAssets = row.totalAssets;
  });
  return ranked;
}

async function assetRanking(
  client: ReturnType<typeof createClient>,
  viewerNick: string,
) {
  const ranked = await assetRankingRows(client);
  const publicRow = (row: typeof ranked[number]) => ({
    rank: row.rank,
    nickname: row.nickname,
    totalAssets: row.totalAssets,
    handCount: row.handCount,
  });
  const viewer = ranked.find((row) => row.nickname === viewerNick);
  return {
    rows: ranked.slice(0, 100).map(publicRow),
    viewer: viewer ? publicRow(viewer) : null,
    totalPlayers: ranked.length,
    minHands: RANKING_MIN_HANDS,
    initialAssets: INITIAL_WALLET_BALANCE,
    generatedAt: new Date().toISOString(),
  };
}

function tableTierLabel(smallBlind: number, bigBlind: number) {
  if (bigBlind <= 200) return "라이트";
  if (bigBlind <= 500) return "스탠다드";
  return "하이롤러";
}

function publicHandHighlight(
  row: Record<string, unknown> | null,
  direction: "win" | "loss",
) {
  if (!row) return null;
  const amount = rankingChipAmount(row.amount, true);
  const handName = safeText(row.handName, 40);
  if (
    (direction === "win" && amount <= 0) ||
    (direction === "loss" && amount >= 0)
  ) {
    throw new Error("ranking_detail_lookup");
  }
  return {
    amount,
    handName,
  };
}

function rankingChipAmount(value: unknown, allowNegative = false) {
  const amount = Number(value);
  if (
    !Number.isSafeInteger(amount) ||
    (!allowNegative && amount < 0) ||
    Math.abs(amount) % CHIP_UNIT !== 0
  ) {
    throw new Error("ranking_detail_lookup");
  }
  return amount;
}

async function assetRankingDetail(
  client: ReturnType<typeof createClient>,
  viewerNick: string,
  targetNick: string,
) {
  targetNick = safeText(targetNick || viewerNick, 40);
  if (!targetNick) throw new Error("ranking_detail_target");

  const ranked = await assetRankingRows(client);
  const profile = ranked.find((row) => row.nickname === targetNick);
  if (!profile) return null;

  const { data: stats, error: statsError } = await client.rpc(
    "holdem_player_asset_stats",
    { p_nickname: targetNick },
  );
  if (statsError || !isRecord(stats)) throw new Error("ranking_detail_lookup");
  const { count: refillCount, error: refillCountError } = await client
    .from("holdem_economy_events")
    .select("id", { count: "exact", head: true })
    .eq("nickname", targetNick)
    .eq("event_type", "refill")
    .gte("created_at", REFILL_COUNT_BASELINE_ISO);
  if (
    refillCountError ||
    !Number.isSafeInteger(refillCount) ||
    refillCount < 0
  ) {
    throw new Error("ranking_detail_lookup");
  }

  const handCount = Number(stats.handCount);
  if (!Number.isSafeInteger(handCount) || handCount < 0) {
    throw new Error("ranking_detail_lookup");
  }
  const sessions = (Array.isArray(stats.sessions) ? stats.sessions : [])
    .slice(0, 10)
    .map((rawSession) => {
      if (!isRecord(rawSession)) throw new Error("ranking_detail_lookup");
      const smallBlind = rankingChipAmount(rawSession.smallBlind);
      const bigBlind = rankingChipAmount(rawSession.bigBlind);
      const sessionHandCount = Number(rawSession.handCount);
      if (
        smallBlind < CHIP_UNIT ||
        bigBlind < smallBlind * 2 ||
        !Number.isSafeInteger(sessionHandCount) ||
        sessionHandCount < 1
      ) {
        throw new Error("ranking_detail_lookup");
      }
      return {
        date: safeText(rawSession.date, 16),
        label: tableTierLabel(smallBlind, bigBlind),
        smallBlind,
        bigBlind,
        handCount: sessionHandCount,
        netAmount: rankingChipAmount(rawSession.netAmount, true),
        biggestWin: publicHandHighlight(
          isRecord(rawSession.biggestWin) ? rawSession.biggestWin : null,
          "win",
        ),
        biggestLoss: publicHandHighlight(
          isRecord(rawSession.biggestLoss) ? rawSession.biggestLoss : null,
          "loss",
        ),
      };
    });

  return {
    rank: profile.rank,
    nickname: profile.nickname,
    totalAssets: profile.totalAssets,
    handCount,
    minHands: RANKING_MIN_HANDS,
    totalWon: rankingChipAmount(stats.totalWon),
    totalLost: rankingChipAmount(stats.totalLost),
    totalNet: rankingChipAmount(stats.totalNet, true),
    todayNet: rankingChipAmount(stats.todayNet, true),
    sevenDayNet: rankingChipAmount(stats.sevenDayNet, true),
    refillTotal: rankingChipAmount(stats.refillTotal),
    refillCount,
    refillCountBaselineDate: REFILL_COUNT_BASELINE_LABEL,
    refillToday: rankingChipAmount(stats.refillToday),
    refillSevenDays: rankingChipAmount(stats.refillSevenDays),
    initialGrantTotal: rankingChipAmount(stats.initialGrantTotal),
    adjustmentTotal: rankingChipAmount(stats.adjustmentTotal, true),
    recordedSince: safeText(stats.recordedSince, 40),
    sessions,
    generatedAt: new Date().toISOString(),
  };
}

async function cleanupExpiredTables(
  client: ReturnType<typeof createClient>,
) {
  await client.rpc("cleanup_expired_holdem_tables", {
    p_ttl_seconds: 300,
    p_limit: 50,
  });
}

function takeWalletAdjustments(state: JsonRecord) {
  const raw = Array.isArray(state.walletAdjustments)
    ? state.walletAdjustments
    : [];
  const adjustments = raw.map((entry) => {
    if (!isRecord(entry)) throw new Error("invalid_wallet_adjustment");
    const nickname = safeText(entry.nickname, 40);
    const delta = Number(entry.delta);
    if (
      !nickname ||
      !Number.isSafeInteger(delta) ||
      delta === 0 ||
      Math.abs(delta) > 100000000 ||
      delta % CHIP_UNIT !== 0
    ) {
      throw new Error("invalid_wallet_adjustment");
    }
    return { nickname, delta };
  });
  if (adjustments.length > 6) throw new Error("invalid_wallet_adjustment");
  delete state.walletAdjustments;
  return adjustments;
}

function takeEconomyEvents(state: JsonRecord) {
  const raw = Array.isArray(state.economyEvents)
    ? state.economyEvents
    : [];
  const events = raw.map((entry) => {
    if (!isRecord(entry)) throw new Error("invalid_economy_event");
    const eventType = safeText(entry.type, 24);
    const amount = Number(entry.amount);
    const handNo = Number(entry.handNo);
    if (
      eventType !== "rake" ||
      !Number.isSafeInteger(amount) ||
      amount >= 0 ||
      Math.abs(amount) > 100000000 ||
      amount % CHIP_UNIT !== 0 ||
      !Number.isSafeInteger(handNo) ||
      handNo < 1
    ) {
      throw new Error("invalid_economy_event");
    }
    return {
      event_type: eventType,
      amount,
      hand_no: handNo,
    };
  });
  if (events.length > 1) throw new Error("invalid_economy_event");
  delete state.economyEvents;
  return events;
}

function takeHandResults(state: JsonRecord) {
  const raw = Array.isArray(state.handResults)
    ? state.handResults
    : [];
  const results = raw.map((entry) => {
    if (!isRecord(entry)) throw new Error("invalid_hand_result");
    const nickname = safeText(entry.nickname, 40);
    const handNo = Number(entry.handNo);
    const smallBlind = Number(entry.smallBlind);
    const bigBlind = Number(entry.bigBlind);
    const netAmount = Number(entry.netAmount);
    const wonAmount = Number(entry.wonAmount);
    const handName = safeText(entry.handName, 40);
    const handCategory = Number(entry.handCategory);
    if (
      !nickname ||
      !Number.isSafeInteger(handNo) ||
      handNo < 1 ||
      !Number.isSafeInteger(smallBlind) ||
      !Number.isSafeInteger(bigBlind) ||
      smallBlind < CHIP_UNIT ||
      bigBlind < smallBlind * 2 ||
      smallBlind % CHIP_UNIT !== 0 ||
      bigBlind % CHIP_UNIT !== 0 ||
      !Number.isSafeInteger(netAmount) ||
      Math.abs(netAmount) > 100000000 ||
      Math.abs(netAmount) % CHIP_UNIT !== 0 ||
      !Number.isSafeInteger(wonAmount) ||
      wonAmount < 0 ||
      wonAmount > 100000000 ||
      wonAmount % CHIP_UNIT !== 0 ||
      !Number.isSafeInteger(handCategory) ||
      handCategory < -1 ||
      handCategory > 8
    ) {
      throw new Error("invalid_hand_result");
    }
    return {
      nickname,
      hand_no: handNo,
      small_blind: smallBlind,
      big_blind: bigBlind,
      net_amount: netAmount,
      won_amount: wonAmount,
      is_winner: entry.isWinner === true,
      revealed: entry.revealed === true,
      hand_name: entry.revealed === true ? handName : "",
      hand_category: entry.revealed === true ? handCategory : -1,
    };
  });
  if (results.length > 6) throw new Error("invalid_hand_result");
  delete state.handResults;
  return results;
}

function ringSettings(state: unknown) {
  if (!isRecord(state) || !isRecord(state.settings)) return null;
  if (safeText(state.settings.mode, 24) !== "ring") return null;
  return {
    amount: Math.max(0, Number(state.settings.refillAmount) || 0),
    assetBacked: state.settings.assetBacked === true,
    dailyLimit: Math.max(
      1,
      Math.min(3, Number(state.settings.dailyRefillLimit) || 3),
    ),
  };
}

function isAssetBackedRingState(state: unknown) {
  return isRecord(state) &&
    isRecord(state.settings) &&
    safeText(state.settings.mode, 24) === "ring" &&
    state.settings.assetBacked === true;
}

async function ringRefillStatus(
  client: ReturnType<typeof createClient>,
  nick: string,
  dailyLimit: number,
) {
  const { data, error } = await client
    .from("holdem_ring_refills")
    .select("used_count")
    .eq("nickname", nick)
    .eq("refill_date", seoulDateKey())
    .maybeSingle();
  if (error) return null;
  const used = Math.max(
    0,
    Math.min(dailyLimit, Number(data?.used_count) || 0),
  );
  return { used, remaining: Math.max(0, dailyLimit - used) };
}

async function walletProfileWithRefillStatus(
  client: ReturnType<typeof createClient>,
  nick: string,
) {
  const [wallet, status] = await Promise.all([
    walletProfile(client, nick),
    ringRefillStatus(client, nick, 3),
  ]);
  return {
    ...wallet,
    ...(status
      ? {
        refillsUsedToday: status.used,
        refillsRemainingToday: status.remaining,
      }
      : {}),
    refillStatusKnown: status !== null,
    canFreeRefill: wallet.totalAssets < RING_FREE_REFILL_ASSET_LIMIT &&
      status !== null && status.remaining > 0,
  };
}

async function publicTableResponse(
  client: ReturnType<typeof createClient>,
  engine: HoldemEngineApi,
  state: unknown,
  nick: string,
  version: number,
  ok: boolean,
  reason?: string,
) {
  const snapshot = sanitizedSnapshot(engine, state, nick);
  const refill = ringSettings(state);
  if (refill && isRecord(snapshot)) {
    const activeHand = isRecord(state) &&
      ACTIVE_HAND_PHASES.has(safeText(state.phase, 24));
    const engineAllowsRefill = snapshot.canRefill === true;
    const viewer = isRecord(snapshot.viewer) ? snapshot.viewer : null;
    const viewerSeat = viewer?.seat == null ? -1 : Number(viewer.seat);
    const viewerPlayer = Number.isSafeInteger(viewerSeat) &&
        Array.isArray(snapshot.seats)
      ? snapshot.seats[viewerSeat]
      : null;
    const canQueueAfterHand = activeHand && isRecord(viewerPlayer) &&
      viewerPlayer.isBot !== true && Number(viewerPlayer.stack) <= 0 &&
      viewerPlayer.inHand === true;
    const status = engineAllowsRefill || canQueueAfterHand || !activeHand
      ? await ringRefillStatus(client, nick, refill.dailyLimit)
      : null;
    const hasLowAssets = (engineAllowsRefill || canQueueAfterHand) && refill.assetBacked
      ? (await walletProfile(client, nick)).totalAssets < RING_FREE_REFILL_ASSET_LIMIT
      : true;
    const freeRefillEligible = engineAllowsRefill && hasLowAssets;
    snapshot.ringRefill = {
      amount: refill.amount,
      dailyLimit: refill.dailyLimit,
      ...(status
        ? {
          usedToday: status.used,
          remainingToday: status.remaining,
          canRefill: freeRefillEligible && status.remaining > 0,
          canQueue: canQueueAfterHand && hasLowAssets && status.remaining > 0,
        }
        : { canRefill: freeRefillEligible, canQueue: false }),
    };
    snapshot.canRefill = status
      ? freeRefillEligible && status.remaining > 0
      : freeRefillEligible;
  }
  return jsonResponse({
    ok,
    ...(reason ? { reason: safeText(reason, 80) || "rejected" } : {}),
    version,
    snapshot,
  });
}

function parseVersion(value: unknown) {
  const version = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : 0;
}

function commandPayload(body: JsonRecord, action: string, nick: string) {
  const explicit = isRecord(body.command)
    ? body.command
    : isRecord(body.payload)
    ? body.payload
    : body;
  const command: JsonRecord = {};
  for (const [key, value] of Object.entries(explicit)) {
    if (!RESERVED_COMMAND_KEYS.has(key) && key !== "action") {
      command[key] = value;
    }
  }

  // body.action identifies the endpoint ("act"). The player's poker move is
  // deliberately carried in a separate, bounded field so it cannot be
  // overwritten by the database wrapper.
  if (action === "act") {
    const move = safeText(explicit.move, 16).toLowerCase();
    if (POKER_ACTIONS.has(move)) command.action = move;
  }
  command.type = action;
  command.nick = nick;
  return command;
}

function authenticatedCommand(
  body: JsonRecord,
  action: string,
  account: Account,
  requestId: string,
) {
  const command = commandPayload(body, action, account.nick);
  command.requestId = `${account.nick}:${requestId}`;
  return command;
}

async function verifyAccount(
  client: ReturnType<typeof createClient>,
  auth: JsonRecord | undefined,
): Promise<Account | null> {
  const nick = safeText(auth?.nick, 40);
  const hash = safeText(auth?.hash, 64);
  if (!nick || !/^[0-9a-f]{64}$/.test(hash)) return null;

  const { data, error } = await client
    .from("accounts")
    .select("nickname,is_admin")
    .eq("nickname", nick)
    .eq("pw_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  const verifiedNick = safeText(data.nickname, 40);
  return verifiedNick
    ? { nick: verifiedNick, isAdmin: data.is_admin === true }
    : null;
}

async function activeLease(
  client: ReturnType<typeof createClient>,
  roomId: string,
): Promise<LeaseInfo | null> {
  const { data, error } = await client
    .from("room_leases")
    .select("nickname,game,config")
    .eq("room_id", roomId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error("lease_lookup");
  if (!data) return null;
  const ownerNick = safeText(data.nickname, 40);
  const game = safeText(data.game, 30);
  const config = isRecord(data.config) ? data.config : {};
  const buyIn = game === "holdem_ring"
    ? normalizedRingBuyIn(config.holdemBuyIn)
    : 0;
  return ownerNick && game ? { ownerNick, game, buyIn } : null;
}

function createTableOptions(
  roomId: string,
  ownerNick: string,
  game: string,
  buyIn = 0,
) {
  const ring = game === "holdem_ring";
  const turbo = game === "holdem_turbo";
  const selectedBuyIn = ring ? normalizedRingBuyIn(buyIn) : 0;
  const ringBounds = ring ? ringTableBoundsForBuyIn(selectedBuyIn) : null;
  const startingStack = ring
    ? ringBounds?.maxBuyIn ?? RING_DEFAULT_BUY_IN
    : RING_DEFAULT_BUY_IN;
  const blind = ring ? ringBlindForBuyIn(selectedBuyIn) : {
    smallBlind: 100,
    bigBlind: 200,
  };
  return {
    roomId,
    ownerNick,
    mode: ring ? "ring" : "tournament",
    tournamentSpeed: turbo ? "turbo" : "normal",
    assetBacked: false,
    chipUnit: CHIP_UNIT,
    startingStack,
    smallBlind: blind.smallBlind,
    bigBlind: blind.bigBlind,
    actionMs: turbo ? 15000 : 20000,
    blindLevelMs: ring ? 0 : turbo ? 5 * 60 * 1000 : 10 * 60 * 1000,
    refillAmount: ring ? RING_REFILL_AMOUNT : 0,
    dailyRefillLimit: ring ? 3 : 0,
  };
}

async function loadTable(
  client: ReturnType<typeof createClient>,
  roomId: string,
): Promise<TableRow | null> {
  const { data, error } = await client
    .from("holdem_tables")
    .select("room_id,state,version,owner_nickname")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) throw new Error("table_lookup");
  if (!data) return null;
  const version = parseVersion(data.version);
  const ownerNickname = safeText(data.owner_nickname, 40);
  if (!version || !ownerNickname || !isRecord(data.state)) {
    throw new Error("invalid_stored_table");
  }
  return {
    room_id: roomId,
    state: data.state,
    version,
    owner_nickname: ownerNickname,
  };
}

async function compareAndSwap(
  client: ReturnType<typeof createClient>,
  roomId: string,
  expectedVersion: number,
  state: JsonRecord,
  ownerNick: string,
): Promise<CasRow> {
  const { data, error } = await client.rpc("holdem_table_compare_and_swap", {
    p_room_id: roomId,
    p_expected_version: expectedVersion,
    p_state: state,
    p_owner_nickname: ownerNick,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) throw new Error("table_write");
  return row as CasRow;
}

async function compareAndSwapRingRefill(
  client: ReturnType<typeof createClient>,
  roomId: string,
  expectedVersion: number,
  state: JsonRecord,
  ownerNick: string,
  nick: string,
): Promise<CasRow> {
  const { data, error } = await client.rpc(
    "holdem_ring_refill_v3_compare_and_swap",
    {
      p_room_id: roomId,
      p_expected_version: expectedVersion,
      p_state: state,
      p_owner_nickname: ownerNick,
      p_nickname: nick,
    },
  );
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) throw new Error("ring_refill_write");
  return row as CasRow;
}

async function compareAndSwapRingFreeBuyIn(
  client: ReturnType<typeof createClient>,
  roomId: string,
  expectedVersion: number,
  state: JsonRecord,
  ownerNick: string,
  nick: string,
): Promise<CasRow> {
  const { data, error } = await client.rpc(
    "holdem_ring_free_buyin_v1_compare_and_swap",
    {
      p_room_id: roomId,
      p_expected_version: expectedVersion,
      p_state: state,
      p_owner_nickname: ownerNick,
      p_nickname: nick,
    },
  );
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) throw new Error("ring_free_buyin_write");
  return row as CasRow;
}

async function compareAndSwapRingWallet(
  client: ReturnType<typeof createClient>,
  roomId: string,
  expectedVersion: number,
  state: JsonRecord,
  ownerNick: string,
  adjustments: Array<{ nickname: string; delta: number }>,
  economyEvents: Array<{
    event_type: string;
    amount: number;
    hand_no: number;
  }>,
  handResults: Array<{
    nickname: string;
    hand_no: number;
    small_blind: number;
    big_blind: number;
    net_amount: number;
    won_amount: number;
    is_winner: boolean;
    revealed: boolean;
    hand_name: string;
    hand_category: number;
  }>,
): Promise<CasRow> {
  const { data, error } = await client.rpc(
    "holdem_ring_table_v4_compare_and_swap",
    {
      p_room_id: roomId,
      p_expected_version: expectedVersion,
      p_state: state,
      p_owner_nickname: ownerNick,
      p_adjustments: adjustments,
      p_economy_events: economyEvents,
      p_hand_results: handResults,
    },
  );
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) throw new Error("ring_wallet_write");
  return row as CasRow;
}

function rowFromConflict(roomId: string, row: CasRow): TableRow | null {
  const version = parseVersion(row.current_version);
  const ownerNickname = safeText(row.current_owner_nickname, 40);
  if (!version || !ownerNickname || !isRecord(row.current_state)) return null;
  return {
    room_id: roomId,
    state: row.current_state,
    version,
    owner_nickname: ownerNickname,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, reason: "method" }, 405);
  }

  let body: JsonRecord;
  try {
    body = await readBody(request);
  } catch (error) {
    const reason = error instanceof Error && error.message === "body_too_large"
      ? "body_too_large"
      : "invalid_json";
    return jsonResponse({ ok: false, reason }, 400);
  }

  const action = safeText(body.action, 24);
  if (!ACTIONS.has(action)) {
    return jsonResponse({ ok: false, reason: "action" }, 400);
  }
  const walletAction = action === "wallet";
  const profileAssetAction = action === "profile_asset";
  const walletRefillAction = action === "wallet_refill";
  const rankingAction = action === "ranking";
  const rankingDetailAction = action === "ranking_detail";
  const roomlessAction = walletAction || profileAssetAction ||
    walletRefillAction || rankingAction || rankingDetailAction;
  const roomId = roomlessAction ? "" : safeText(body.roomId, 81);
  const requestId = roomlessAction ? "" : safeText(body.requestId, 101);
  if (!roomlessAction) {
    if (!ROOM_ID_PATTERN.test(roomId)) {
      return jsonResponse({ ok: false, reason: "invalid_room" }, 400);
    }
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      return jsonResponse({ ok: false, reason: "invalid_request_id" }, 400);
    }
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const engine = getEngine();
  const ai = action === "bot_step" ? getAI() : null;
  if (
    !url ||
    !serviceKey ||
    (!roomlessAction && !engine) ||
    (action === "bot_step" && !ai)
  ) {
    return jsonResponse({ ok: false, reason: "server_config" }, 500);
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const accountPromise = verifyAccount(
      client,
      isRecord(body.auth) ? body.auth : undefined,
    );
    const tablePromise: Promise<TableRow | null> =
      roomlessAction || action === "join"
      ? Promise.resolve(null)
      : loadTable(client, roomId);
    const [account, initialTable] = await Promise.all([
      accountPromise,
      tablePromise,
    ]);
    if (!account) return jsonResponse({ ok: false, reason: "auth" }, 401);

    if (walletAction) {
      await cleanupExpiredTables(client);
      return jsonResponse({
        ok: true,
        wallet: await walletProfileWithRefillStatus(client, account.nick),
      });
    }
    if (profileAssetAction) {
      await cleanupExpiredTables(client);
      return jsonResponse({
        ok: true,
        asset: await profileAsset(
          client,
          safeText(body.targetNick, 40),
        ),
      });
    }
    if (walletRefillAction) {
      await cleanupExpiredTables(client);
      const refill = await walletRefillIfEmpty(client, account.nick);
      return jsonResponse({
        ok: refill.applied,
        ...(refill.reason ? { reason: refill.reason } : {}),
        wallet: refill.wallet,
        refillsUsedToday: refill.refillsUsedToday,
        refillsRemainingToday: refill.refillsRemainingToday,
      });
    }
    if (rankingAction) {
      await cleanupExpiredTables(client);
      return jsonResponse({
        ok: true,
        ranking: await assetRanking(client, account.nick),
      });
    }
    if (rankingDetailAction) {
      await cleanupExpiredTables(client);
      return jsonResponse({
        ok: true,
        detail: await assetRankingDetail(
          client,
          account.nick,
          safeText(body.targetNick, 40),
        ),
      });
    }
    if (!engine) {
      return jsonResponse({ ok: false, reason: "server_config" }, 500);
    }

    let lease: LeaseInfo | null = null;
    let table = initialTable;
    if (action === "join") {
      await cleanupExpiredTables(client);
      [lease, table] = await Promise.all([
        activeLease(client, roomId),
        loadTable(client, roomId),
      ]);
    }
    const requestedAt = Date.now();
    const expectedVersion = parseVersion(body.expectedVersion);
    const expectedHandId = safeText(body.handId, 80);
    const expectedActionSeqValue = Number(body.actionSeq);
    const hasExpectedActionSeq = Number.isSafeInteger(expectedActionSeqValue) &&
      expectedActionSeqValue >= 0;

    if (action === "snapshot") {
      return table
        ? publicTableResponse(
          client,
          engine,
          table.state,
          account.nick,
          table.version,
          true,
        )
        : jsonResponse({
          ok: false,
          reason: "not_found",
          version: 0,
          snapshot: null,
        }, 404);
    }

    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
      const creating = table === null;
      if (creating && action !== "join") {
        return jsonResponse({
          ok: false,
          reason: "not_found",
          version: 0,
          snapshot: null,
        }, 404);
      }
      if (creating && (!lease || !HOLDEM_ROOM_GAMES.has(lease.game))) {
        return jsonResponse({
          ok: false,
          reason: "invalid_room",
          version: 0,
          snapshot: null,
        }, 400);
      }

      const ownerNick = lease?.ownerNick ??
        table?.owner_nickname ??
        account.nick;
      const baseState = table?.state ??
        engine.createTable(createTableOptions(
          roomId,
          ownerNick,
          lease?.game ?? "holdem",
          lease?.buyIn ?? 0,
        ));
      const baseVersion = table?.version ?? 0;

      if (
        VERSIONED_ACTIONS.has(action) &&
        expectedVersion !== baseVersion
      ) {
        return publicTableResponse(
          client,
          engine,
          baseState,
          account.nick,
          baseVersion,
          false,
          "stale",
        );
      }

      if (
        HAND_SCOPED_ACTIONS.has(action) &&
        (
          !expectedHandId ||
          !isRecord(baseState) ||
          expectedHandId !== String(baseState.handNo ?? "")
        )
      ) {
        return publicTableResponse(
          client,
          engine,
          baseState,
          account.nick,
          baseVersion,
          false,
          "stale",
        );
      }

      if (
        action === "bot_step" &&
        (
          !hasExpectedActionSeq ||
          !isRecord(baseState) ||
          expectedActionSeqValue !== Number(baseState.actionSeq)
        )
      ) {
        return publicTableResponse(
          client,
          engine,
          baseState,
          account.nick,
          baseVersion,
          false,
          "stale",
        );
      }

      if (
        action === "bot_step" &&
        isRecord(baseState) &&
        Number.isFinite(Number(baseState.botDueAt)) &&
        requestedAt < Number(baseState.botDueAt)
      ) {
        return publicTableResponse(
          client,
          engine,
          baseState,
          account.nick,
          baseVersion,
          false,
          "not_due",
        );
      }

      if (OWNER_ACTIONS.has(action) && account.nick !== ownerNick) {
        return publicTableResponse(
          client,
          engine,
          baseState,
          account.nick,
          baseVersion,
          false,
          "owner",
        );
      }

      if (action === "refill" && isAssetBackedRingState(baseState)) {
        const profile = await walletProfile(client, account.nick);
        if (profile.totalAssets >= RING_FREE_REFILL_ASSET_LIMIT) {
          return publicTableResponse(
            client,
            engine,
            baseState,
            account.nick,
            baseVersion,
            false,
            "assets_remaining",
          );
        }
      }

      const command = action === "bot_step" && ai
        ? botCommand(engine, ai, baseState)
        : authenticatedCommand(body, action, account, requestId);
      if (!command) {
        return publicTableResponse(
          client,
          engine,
          baseState,
          account.nick,
          baseVersion,
          false,
          "bot_turn",
        );
      }
      const freeRefillBuyIn = (
        action === "join" || action === "rebuy"
      ) && command.freeRefill === true;
      if (freeRefillBuyIn) {
        const profile = await walletProfile(client, account.nick);
        if (profile.totalAssets >= RING_FREE_REFILL_ASSET_LIMIT) {
          return publicTableResponse(
            client,
            engine,
            baseState,
            account.nick,
            baseVersion,
            false,
            "assets_remaining",
          );
        }
      }
      const result = engine.command(baseState, command, {
        now: requestedAt,
        randomInt: secureRandomInt,
        internalBot: action === "bot_step",
        internalRefill: action === "refill" || freeRefillBuyIn,
      });
      if (
        !result ||
        typeof result.ok !== "boolean" ||
        typeof result.changed !== "boolean"
      ) {
        throw new Error("invalid_engine_result");
      }

      // The engine return value is authoritative even if it cloned or mutated.
      const resultState = result.state;
      if (!result.ok) {
        return publicTableResponse(
          client,
          engine,
          resultState,
          account.nick,
          baseVersion,
          false,
          result.reason ?? "rejected",
        );
      }
      if (!result.changed) {
        return publicTableResponse(
          client,
          engine,
          resultState,
          account.nick,
          baseVersion,
          true,
        );
      }

      const nextState = normalizeState(resultState);
      const ringTable = isRecord(nextState.settings) &&
        safeText(nextState.settings.mode, 24) === "ring";
      const assetBackedRingTable = ringTable &&
        nextState.settings.assetBacked === true;
      const walletAdjustments = ringTable
        ? takeWalletAdjustments(nextState)
        : [];
      const economyEvents = takeEconomyEvents(nextState);
      const handResults = assetBackedRingTable
        ? takeHandResults(nextState)
        : [];
      if (action === "refill" && walletAdjustments.length) {
        throw new Error("unexpected_refill_wallet_adjustment");
      }
      if (economyEvents.length && !assetBackedRingTable) {
        throw new Error("unexpected_economy_event");
      }
      const cas = freeRefillBuyIn && ringTable
        ? await compareAndSwapRingFreeBuyIn(
          client,
          roomId,
          baseVersion,
          nextState,
          ownerNick,
          account.nick,
        )
        : action === "refill" && assetBackedRingTable
        ? await compareAndSwapRingRefill(
          client,
          roomId,
          baseVersion,
          nextState,
          ownerNick,
          account.nick,
        )
        : assetBackedRingTable || walletAdjustments.length > 0
        ? await compareAndSwapRingWallet(
          client,
          roomId,
          baseVersion,
          nextState,
          ownerNick,
          walletAdjustments,
          economyEvents,
          handResults,
        )
        : await compareAndSwap(
          client,
          roomId,
          baseVersion,
          nextState,
          ownerNick,
        );
      if (cas.applied) {
        return publicTableResponse(
          client,
          engine,
          isRecord(cas.current_state) ? cas.current_state : nextState,
          account.nick,
          parseVersion(cas.current_version),
          true,
          result.reason,
        );
      }
      if (cas.reason === "refill_limit") {
        return publicTableResponse(
          client,
          engine,
          cas.current_state,
          account.nick,
          parseVersion(cas.current_version),
          false,
          "refill_limit",
        );
      }
      if (cas.reason === "wallet_insufficient") {
        return publicTableResponse(
          client,
          engine,
          isRecord(cas.current_state) ? cas.current_state : baseState,
          account.nick,
          parseVersion(cas.current_version) || baseVersion,
          false,
          "wallet_insufficient",
        );
      }
      if (cas.reason === "assets_remaining") {
        return publicTableResponse(
          client,
          engine,
          isRecord(cas.current_state) ? cas.current_state : baseState,
          account.nick,
          parseVersion(cas.current_version) || baseVersion,
          false,
          "assets_remaining",
        );
      }

      table = rowFromConflict(roomId, cas);
    }

    const latest = table ?? await loadTable(client, roomId);
    return latest
      ? publicTableResponse(
        client,
        engine,
        latest.state,
        account.nick,
        latest.version,
        false,
        "conflict",
      )
      : jsonResponse({
        ok: false,
        reason: "conflict",
        version: 0,
        snapshot: null,
      }, 409);
  } catch (error) {
    console.error(
      "holdem-table request failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonResponse({ ok: false, reason: "server" }, 500);
  }
});
