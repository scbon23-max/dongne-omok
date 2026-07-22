import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "catchmind-gallery";
const RECENT_LIMIT = 1000;
const FAVORITE_LIMIT = 20;
const MAX_IMAGE_BYTES = 307200;

function response(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function safeId(value: unknown) {
  return safeText(value, 80).replace(/[^a-zA-Z0-9_-]/g, "");
}

function bytesFromBase64(value: unknown) {
  const source = String(value ?? "");
  if (!source || source.length > MAX_IMAGE_BYTES * 1.4) throw new Error("invalid_image");
  const binary = atob(source);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("invalid_image");
  return bytes;
}

function hasImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return mimeType === "image/png"
    && bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47;
}

function publicDrawing(client: ReturnType<typeof createClient>, row: Record<string, unknown>, favorite: boolean) {
  const imagePath = String(row.image_path ?? "");
  const publicUrl = client.storage.from(BUCKET).getPublicUrl(imagePath).data.publicUrl;
  return {
    id: row.id,
    drawer: row.drawer,
    word: row.word,
    createdAt: row.created_at,
    imageUrl: publicUrl,
    favorite,
  };
}

async function verifyAccount(client: ReturnType<typeof createClient>, auth: Record<string, unknown> | undefined) {
  const nick = safeText(auth?.nick, 40);
  const hash = safeText(auth?.hash, 128);
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

async function favoriteCount(client: ReturnType<typeof createClient>, nick: string) {
  const { count } = await client
    .from("catchmind_favorites")
    .select("drawing_id", { count: "exact", head: true })
    .eq("nickname", nick);
  return count ?? 0;
}

async function galleryDrawers(client: ReturnType<typeof createClient>) {
  const { data, error } = await client
    .from("catchmind_drawings")
    .select("drawer")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (error) return [];
  const seen = new Set<string>();
  const drawers: string[] = [];
  for (const row of data ?? []) {
    const drawer = safeText(row.drawer, 40);
    if (!drawer || seen.has(drawer)) continue;
    seen.add(drawer);
    drawers.push(drawer);
  }
  return drawers.sort((a, b) => a.localeCompare(b));
}

async function pruneOldDrawings(client: ReturnType<typeof createClient>) {
  const { data: removable } = await client.rpc("catchmind_gallery_prune_candidates", { max_rows: 200 });
  if (!removable?.length) return;
  const paths = removable.map((row: { image_path: string }) => row.image_path);
  const { error: storageError } = await client.storage.from(BUCKET).remove(paths);
  if (storageError) return;
  await client
    .from("catchmind_drawings")
    .delete()
    .in("id", removable.map((row: { id: number }) => row.id));
}

async function saveDrawing(client: ReturnType<typeof createClient>, nick: string, body: Record<string, unknown>) {
  const matchId = safeId(body.matchId);
  const roundIndex = Math.floor(Number(body.roundIndex));
  const drawer = safeText(body.drawer, 40);
  const word = safeText(body.word, 10);
  const mimeType = body.mimeType === "image/png" ? "image/png" : "image/webp";
  if (!matchId || !Number.isInteger(roundIndex) || roundIndex < 0 || roundIndex > 39 || !drawer || !word) {
    return response({ ok: false, reason: "invalid_drawing" });
  }

  let bytes: Uint8Array;
  try {
    bytes = bytesFromBase64(body.imageBase64);
  } catch {
    return response({ ok: false, reason: "invalid_image" });
  }
  if (!hasImageSignature(bytes, mimeType)) return response({ ok: false, reason: "invalid_image" });

  const extension = mimeType === "image/png" ? "png" : "webp";
  const imagePath = `drawings/${matchId}/${roundIndex}.${extension}`;
  const { error: uploadError } = await client.storage.from(BUCKET).upload(imagePath, bytes, {
    contentType: mimeType,
    cacheControl: "31536000",
    upsert: true,
  });
  if (uploadError) return response({ ok: false, reason: "upload", msg: uploadError.message });

  const { data, error } = await client
    .from("catchmind_drawings")
    .upsert({
      match_id: matchId,
      round_index: roundIndex,
      drawer,
      word,
      image_path: imagePath,
      mime_type: mimeType,
      byte_size: bytes.length,
      saved_by: nick,
    }, { onConflict: "match_id,round_index" })
    .select("id")
    .single();
  if (error) {
    return response({ ok: false, reason: "metadata", msg: error.message });
  }

  await pruneOldDrawings(client);
  return response({ ok: true, id: data.id });
}

async function listGallery(client: ReturnType<typeof createClient>, nick: string, body: Record<string, unknown>) {
  const mode = body.mode === "favorites" ? "favorites" : "recent";
  const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
  const limit = Math.max(1, Math.min(40, Math.floor(Number(body.limit) || 20)));
  const drawer = safeText(body.drawer, 40);
  const favoritesTotal = await favoriteCount(client, nick);
  const drawerOptions = body.includeDrawers === true ? await galleryDrawers(client) : null;
  const finish = (payload: Record<string, unknown>) => response(drawerOptions
    ? { ...payload, drawers: drawerOptions }
    : payload);

  if (mode === "favorites") {
    const { data: favoriteRows, error } = await client
      .from("catchmind_favorites")
      .select("drawing_id,created_at")
      .eq("nickname", nick)
      .order("created_at", { ascending: false })
      .limit(FAVORITE_LIMIT);
    if (error) return response({ ok: false, reason: "query", msg: error.message });
    const ids = (favoriteRows ?? []).map((row) => row.drawing_id);
    if (!ids.length) return finish({ ok: true, rows: [], hasMore: false, favoriteCount: favoritesTotal });
    const { data: drawings, error: drawingError } = await client
      .from("catchmind_drawings")
      .select("id,drawer,word,image_path,created_at")
      .in("id", ids);
    if (drawingError) return response({ ok: false, reason: "query", msg: drawingError.message });
    const byId = new Map((drawings ?? []).map((row) => [String(row.id), row]));
    const filtered = [];
    for (const id of ids) {
      const row = byId.get(String(id));
      if (row && (!drawer || row.drawer === drawer)) filtered.push(row);
    }
    const rows = filtered.slice(offset, offset + limit).map((row) => publicDrawing(client, row, true));
    return finish({
      ok: true,
      rows,
      hasMore: offset + rows.length < filtered.length,
      favoriteCount: favoritesTotal,
    });
  }

  let query = client
    .from("catchmind_drawings")
    .select("id,drawer,word,image_path,created_at", { count: "exact" });
  if (drawer) query = query.eq("drawer", drawer);
  const { data: drawings, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, Math.min(RECENT_LIMIT, offset + limit) - 1);
  if (error) return response({ ok: false, reason: "query", msg: error.message });
  const ids = (drawings ?? []).map((row) => row.id);
  let favoriteIds = new Set<string>();
  if (ids.length) {
    const { data: favoriteRows } = await client
      .from("catchmind_favorites")
      .select("drawing_id")
      .eq("nickname", nick)
      .in("drawing_id", ids);
    favoriteIds = new Set((favoriteRows ?? []).map((row) => String(row.drawing_id)));
  }
  const rows = (drawings ?? []).map((row) => publicDrawing(client, row, favoriteIds.has(String(row.id))));
  const recentTotal = Math.min(count ?? 0, RECENT_LIMIT);
  return finish({
    ok: true,
    rows,
    hasMore: offset + rows.length < recentTotal,
    favoriteCount: favoritesTotal,
  });
}

async function changeFavorite(client: ReturnType<typeof createClient>, nick: string, body: Record<string, unknown>) {
  const drawingId = Math.floor(Number(body.drawingId));
  if (!Number.isInteger(drawingId) || drawingId <= 0) return response({ ok: false, reason: "invalid_drawing" });
  if (body.favorite) {
    const { data: existing } = await client
      .from("catchmind_favorites")
      .select("drawing_id")
      .eq("nickname", nick)
      .eq("drawing_id", drawingId)
      .maybeSingle();
    if (existing) return response({ ok: true, favoriteCount: await favoriteCount(client, nick) });
    if (await favoriteCount(client, nick) >= FAVORITE_LIMIT) {
      return response({ ok: false, reason: "favorite_limit" });
    }
    const { error } = await client
      .from("catchmind_favorites")
      .upsert({ nickname: nick, drawing_id: drawingId }, { onConflict: "nickname,drawing_id", ignoreDuplicates: true });
    if (error) {
      const limitError = /catchmind_favorite_limit/i.test(error.message);
      return response({ ok: false, reason: limitError ? "favorite_limit" : "favorite", msg: error.message });
    }
  } else {
    const { error } = await client
      .from("catchmind_favorites")
      .delete()
      .eq("nickname", nick)
      .eq("drawing_id", drawingId);
    if (error) return response({ ok: false, reason: "favorite", msg: error.message });
  }
  return response({ ok: true, favoriteCount: await favoriteCount(client, nick) });
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
  const nick = await verifyAccount(client, body.auth as Record<string, unknown> | undefined);
  if (!nick) return response({ ok: false, reason: "auth" });

  if (body.action === "save") return saveDrawing(client, nick, body);
  if (body.action === "list") return listGallery(client, nick, body);
  if (body.action === "favorite") return changeFavorite(client, nick, body);
  return response({ ok: false, reason: "action" });
});
