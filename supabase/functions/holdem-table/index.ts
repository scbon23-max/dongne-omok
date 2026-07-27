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
  "join",
  "leave",
  "ready",
  "settings",
  "start",
  "act",
  "tick",
  "add_bot",
  "remove_bot",
  "bot_step",
  "snapshot",
  "refill",
]);
const OWNER_ACTIONS = new Set(["settings", "add_bot", "remove_bot"]);
const VERSIONED_ACTIONS = new Set([
  "act",
  "add_bot",
  "remove_bot",
  "bot_step",
  "refill",
]);
const HAND_SCOPED_ACTIONS = new Set(["act", "tick"]);
HAND_SCOPED_ACTIONS.add("bot_step");
const POKER_ACTIONS = new Set([
  "fold",
  "check",
  "call",
  "bet",
  "raise",
  "allin",
]);
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_STATE_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const MAX_CAS_RETRIES = 5;
const CHIP_UNIT = 100;
const INITIAL_WALLET_BALANCE = 100000;
const RING_MIN_BUY_IN = 10000;
const RING_MAX_BUY_IN = 100000;
const RING_DEFAULT_BUY_IN = 50000;
const RING_BUY_IN_OPTIONS = new Set([10000, 50000, 100000]);
const RING_REFILL_AMOUNT = 20000;
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
      amount >= RING_MIN_BUY_IN &&
      amount <= RING_MAX_BUY_IN &&
      RING_BUY_IN_OPTIONS.has(amount) &&
      amount % CHIP_UNIT === 0
    ? amount
    : RING_DEFAULT_BUY_IN;
}

function ringBlindForBuyIn(buyIn: number) {
  if (buyIn >= 100000) return { smallBlind: 500, bigBlind: 1000 };
  if (buyIn >= 50000) return { smallBlind: 300, bigBlind: 600 };
  return { smallBlind: 100, bigBlind: 200 };
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

function ringSettings(state: unknown) {
  if (!isRecord(state) || !isRecord(state.settings)) return null;
  if (safeText(state.settings.mode, 24) !== "ring") return null;
  return {
    amount: Math.max(0, Number(state.settings.refillAmount) || 0),
    dailyLimit: Math.max(
      1,
      Math.min(3, Number(state.settings.dailyRefillLimit) || 3),
    ),
  };
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
    const status = await ringRefillStatus(client, nick, refill.dailyLimit);
    const engineAllowsRefill = snapshot.canRefill === true;
    snapshot.ringRefill = {
      amount: refill.amount,
      dailyLimit: refill.dailyLimit,
      ...(status
        ? {
          usedToday: status.used,
          remainingToday: status.remaining,
          canRefill: engineAllowsRefill && status.remaining > 0,
        }
        : { canRefill: engineAllowsRefill }),
    };
    if (status) snapshot.canRefill = engineAllowsRefill && status.remaining > 0;
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
  const startingStack = ring
    ? normalizedRingBuyIn(buyIn)
    : RING_DEFAULT_BUY_IN;
  const blind = ring ? ringBlindForBuyIn(startingStack) : {
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
    "holdem_ring_refill_compare_and_swap",
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

async function compareAndSwapRingWallet(
  client: ReturnType<typeof createClient>,
  roomId: string,
  expectedVersion: number,
  state: JsonRecord,
  ownerNick: string,
  adjustments: Array<{ nickname: string; delta: number }>,
): Promise<CasRow> {
  const { data, error } = await client.rpc(
    "holdem_ring_table_compare_and_swap",
    {
      p_room_id: roomId,
      p_expected_version: expectedVersion,
      p_state: state,
      p_owner_nickname: ownerNick,
      p_adjustments: adjustments,
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

  const action = safeText(body.action, 17);
  if (!ACTIONS.has(action)) {
    return jsonResponse({ ok: false, reason: "action" }, 400);
  }
  const walletAction = action === "wallet";
  const roomId = walletAction ? "" : safeText(body.roomId, 81);
  const requestId = walletAction ? "" : safeText(body.requestId, 101);
  if (!walletAction) {
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
    (!walletAction && !engine) ||
    (action === "bot_step" && !ai)
  ) {
    return jsonResponse({ ok: false, reason: "server_config" }, 500);
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const account = await verifyAccount(
    client,
    isRecord(body.auth) ? body.auth : undefined,
  );
  if (!account) return jsonResponse({ ok: false, reason: "auth" }, 401);

  try {
    if (walletAction) {
      await cleanupExpiredTables(client);
      return jsonResponse({
        ok: true,
        wallet: await walletProfile(client, account.nick),
      });
    }
    if (!engine) {
      return jsonResponse({ ok: false, reason: "server_config" }, 500);
    }

    if (action === "join") await cleanupExpiredTables(client);
    const lease = await activeLease(client, roomId);
    let table = await loadTable(client, roomId);
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
      const result = engine.command(baseState, command, {
        now: requestedAt,
        randomInt: secureRandomInt,
        internalBot: action === "bot_step",
        internalRefill: action === "refill",
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
      if (action === "refill" && walletAdjustments.length) {
        throw new Error("unexpected_refill_wallet_adjustment");
      }
      const cas = action === "refill" && assetBackedRingTable
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
