import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TERRITORY_ADMIN = "구나";

function response(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

async function verifyAccount(client: ReturnType<typeof createClient>, auth: Record<string, unknown> | undefined) {
  const nick = safeText(auth?.nick, 40);
  const hash = safeText(auth?.hash, 128);
  if (!nick || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const { data, error } = await client
    .from("accounts")
    .select("nickname,is_admin")
    .eq("nickname", nick)
    .eq("pw_hash", hash)
    .maybeSingle();
  return error || !data ? null : {
    nick: safeText(data.nickname, 40),
    isAdmin: data.is_admin === true,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return response({ ok: false, reason: "method" });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return response({ ok: false, reason: "invalid_json" });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return response({ ok: false, reason: "server_config" });
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const account = await verifyAccount(client, body.auth as Record<string, unknown> | undefined);
  if (!account) return response({ ok: false, reason: "auth" });
  const nick = account.nick;

  const roomId = safeText(body.roomId, 80);
  const token = safeText(body.token, 100);
  if (!roomId || !/^[a-zA-Z0-9_-]{16,100}$/.test(token)) {
    return response({ ok: false, reason: "invalid_lease" });
  }

  if (body.action === "claim") {
    const roomName = safeText(body.roomName, 80);
    const game = safeText(body.game, 30);
    if (!roomName || !game) return response({ ok: false, reason: "invalid_room" });
    if (game === "territory" && (!account.isAdmin || nick !== TERRITORY_ADMIN)) {
      return response({ ok: false, reason: "forbidden" });
    }
    const { data, error } = await client.rpc("claim_room_lease", {
      p_nickname: nick,
      p_room_id: roomId,
      p_room_name: roomName,
      p_game: game,
      p_lease_token: token,
      p_ttl_seconds: 60,
    });
    if (error || !data?.length) return response({ ok: false, reason: "server", msg: error?.message });
    const row = data[0];
    return response({
      ok: !!row.acquired,
      reason: row.acquired ? undefined : "already_owned",
      roomId: row.active_room_id,
      roomName: row.active_room_name,
      game: row.active_game,
    });
  }

  if (body.action === "renew") {
    const { data, error } = await client.rpc("renew_room_lease", {
      p_nickname: nick,
      p_room_id: roomId,
      p_lease_token: token,
      p_ttl_seconds: 60,
    });
    return error ? response({ ok: false, reason: "server", msg: error.message })
      : response({ ok: !!data, reason: data ? undefined : "lost" });
  }

  if (body.action === "release") {
    const { data, error } = await client.rpc("release_room_lease", {
      p_nickname: nick,
      p_room_id: roomId,
      p_lease_token: token,
    });
    return error ? response({ ok: false, reason: "server", msg: error.message })
      : response({ ok: !!data });
  }

  return response({ ok: false, reason: "action" });
});
