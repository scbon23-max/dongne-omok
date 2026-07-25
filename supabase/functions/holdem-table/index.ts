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
  createTable(options: { roomId: string; ownerNick: string }): unknown;
  command(
    state: unknown,
    command: JsonRecord,
    context: {
      now: number;
      randomInt(max: number): number;
      internalBot?: boolean;
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
};

type TableRow = {
  room_id: string;
  state: unknown;
  version: number;
  owner_nickname: string;
};

type CasRow = {
  applied: boolean;
  current_state: unknown;
  current_version: number | string;
  current_owner_nickname: string | null;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTIONS = new Set([
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
]);
const OWNER_ACTIONS = new Set(["settings", "add_bot", "remove_bot"]);
const VERSIONED_ACTIONS = new Set([
  "act",
  "add_bot",
  "remove_bot",
  "bot_step",
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

function publicTableResponse(
  engine: HoldemEngineApi,
  state: unknown,
  nick: string,
  version: number,
  ok: boolean,
  reason?: string,
) {
  return jsonResponse({
    ok,
    ...(reason ? { reason: safeText(reason, 80) || "rejected" } : {}),
    version,
    snapshot: sanitizedSnapshot(engine, state, nick),
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
    .select("nickname")
    .eq("nickname", nick)
    .eq("pw_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  const verifiedNick = safeText(data.nickname, 40);
  return verifiedNick ? { nick: verifiedNick } : null;
}

async function activeLeaseOwner(
  client: ReturnType<typeof createClient>,
  roomId: string,
) {
  const { data, error } = await client
    .from("room_leases")
    .select("nickname")
    .eq("room_id", roomId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error("lease_lookup");
  return data ? safeText(data.nickname, 40) || null : null;
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

  const roomId = safeText(body.roomId, 81);
  const action = safeText(body.action, 17);
  const requestId = safeText(body.requestId, 101);
  if (!ROOM_ID_PATTERN.test(roomId)) {
    return jsonResponse({ ok: false, reason: "invalid_room" }, 400);
  }
  if (!ACTIONS.has(action)) {
    return jsonResponse({ ok: false, reason: "action" }, 400);
  }
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    return jsonResponse({ ok: false, reason: "invalid_request_id" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const engine = getEngine();
  const ai = action === "bot_step" ? getAI() : null;
  if (!url || !serviceKey || !engine || (action === "bot_step" && !ai)) {
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
    const leaseOwner = await activeLeaseOwner(client, roomId);
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

      const ownerNick = leaseOwner ??
        table?.owner_nickname ??
        account.nick;
      const baseState = table?.state ??
        engine.createTable({ roomId, ownerNick });
      const baseVersion = table?.version ?? 0;

      if (
        VERSIONED_ACTIONS.has(action) &&
        expectedVersion !== baseVersion
      ) {
        return publicTableResponse(
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
          engine,
          resultState,
          account.nick,
          baseVersion,
          true,
        );
      }

      const nextState = normalizeState(resultState);
      const cas = await compareAndSwap(
        client,
        roomId,
        baseVersion,
        nextState,
        ownerNick,
      );
      if (cas.applied) {
        return publicTableResponse(
          engine,
          nextState,
          account.nick,
          parseVersion(cas.current_version),
          true,
          result.reason,
        );
      }

      table = rowFromConflict(roomId, cas);
    }

    const latest = table ?? await loadTable(client, roomId);
    return latest
      ? publicTableResponse(
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
