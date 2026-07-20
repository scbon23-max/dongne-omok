import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "relay-gallery";
const RECENT_LIMIT = 100;
const MAX_IMAGE_BYTES = 153600;
const MAX_ALBUM_BYTES = 921600;

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

function safeInteger(value: unknown, min: number, max: number) {
  const number = Math.floor(Number(value));
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
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

function hasWebpSignature(bytes: Uint8Array) {
  return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
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

function publicUrl(client: ReturnType<typeof createClient>, path: unknown) {
  const value = String(path ?? "");
  return value ? client.storage.from(BUCKET).getPublicUrl(value).data.publicUrl : "";
}

async function pruneOldAlbums(client: ReturnType<typeof createClient>) {
  const { data: removable } = await client.rpc("relay_gallery_prune_candidates", { max_albums: 20 });
  const ids = (removable ?? []).map((row: { id: number }) => row.id).filter(Boolean);
  if (!ids.length) return;
  const { data: entries } = await client
    .from("relay_album_entries")
    .select("image_path")
    .in("album_id", ids)
    .not("image_path", "is", null);
  const paths = (entries ?? []).map((row) => String(row.image_path ?? "")).filter(Boolean);
  if (paths.length) {
    const { error: storageError } = await client.storage.from(BUCKET).remove(paths);
    if (storageError) return;
  }
  await client.from("relay_albums").delete().in("id", ids);
}

async function saveAlbum(client: ReturnType<typeof createClient>, nick: string, body: Record<string, unknown>) {
  const matchId = safeId(body.matchId);
  const origin = safeText(body.origin, 40);
  const playerCount = safeInteger(body.playerCount, 3, 12);
  const sourceEntries = Array.isArray(body.entries) ? body.entries : [];
  if (!matchId || !origin || !playerCount || sourceEntries.length !== playerCount) {
    return response({ ok: false, reason: "invalid_album" });
  }

  const prepared: Array<Record<string, unknown>> = [];
  let totalBytes = 0;
  for (let index = 0; index < sourceEntries.length; index++) {
    const source = sourceEntries[index] as Record<string, unknown>;
    const stepIndex = safeInteger(source.stepIndex, 0, 11);
    const expectedKind = index === 0 ? "prompt" : (index % 2 ? "drawing" : "caption");
    const kind = source.kind === expectedKind ? expectedKind : "";
    const author = safeText(source.author, 40);
    if (stepIndex !== index || !kind || !author) return response({ ok: false, reason: "invalid_entry" });
    if (kind === "drawing") {
      let bytes: Uint8Array;
      try {
        bytes = bytesFromBase64(source.imageBase64);
      } catch {
        return response({ ok: false, reason: "invalid_image" });
      }
      if (!hasWebpSignature(bytes)) return response({ ok: false, reason: "invalid_image" });
      totalBytes += bytes.length;
      if (totalBytes > MAX_ALBUM_BYTES) return response({ ok: false, reason: "album_too_large" });
      prepared.push({ stepIndex, kind, author, bytes });
    } else {
      const text = safeText(source.text, 40);
      if (!text) return response({ ok: false, reason: "invalid_text" });
      prepared.push({ stepIndex, kind, author, text });
    }
  }

  const startText = String(prepared[0].text ?? "");
  const { data: album, error: albumError } = await client
    .from("relay_albums")
    .upsert({
      match_id: matchId,
      origin,
      start_text: startText,
      player_count: playerCount,
      entry_count: prepared.length,
      saved_by: nick,
    }, { onConflict: "match_id,origin" })
    .select("id")
    .single();
  if (albumError || !album) return response({ ok: false, reason: "metadata", msg: albumError?.message });

  const albumId = Number(album.id);
  let coverPath = "";
  for (const entry of prepared) {
    const stepIndex = Number(entry.stepIndex);
    if (entry.kind === "drawing") {
      const imagePath = `albums/${albumId}/${stepIndex}.webp`;
      const bytes = entry.bytes as Uint8Array;
      const { error: uploadError } = await client.storage.from(BUCKET).upload(imagePath, bytes, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: true,
      });
      if (uploadError) return response({ ok: false, reason: "upload", msg: uploadError.message });
      if (!coverPath) coverPath = imagePath;
      const { error } = await client.from("relay_album_entries").upsert({
        album_id: albumId,
        step_index: stepIndex,
        kind: entry.kind,
        author: entry.author,
        body_text: null,
        image_path: imagePath,
        mime_type: "image/webp",
        byte_size: bytes.length,
      }, { onConflict: "album_id,step_index" });
      if (error) return response({ ok: false, reason: "entry", msg: error.message });
    } else {
      const { error } = await client.from("relay_album_entries").upsert({
        album_id: albumId,
        step_index: stepIndex,
        kind: entry.kind,
        author: entry.author,
        body_text: entry.text,
        image_path: null,
        mime_type: null,
        byte_size: null,
      }, { onConflict: "album_id,step_index" });
      if (error) return response({ ok: false, reason: "entry", msg: error.message });
    }
  }
  await client.from("relay_albums").update({ cover_path: coverPath || null }).eq("id", albumId);
  await pruneOldAlbums(client);
  return response({ ok: true, id: albumId });
}

async function listAlbums(client: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
  const limit = Math.max(1, Math.min(20, Math.floor(Number(body.limit) || 10)));
  const { data, count, error } = await client
    .from("relay_albums")
    .select("id,origin,start_text,player_count,entry_count,cover_path,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, Math.min(RECENT_LIMIT, offset + limit) - 1);
  if (error) return response({ ok: false, reason: "query", msg: error.message });
  const rows = (data ?? []).map((row) => ({
    id: row.id,
    origin: row.origin,
    startText: row.start_text,
    playerCount: row.player_count,
    entryCount: row.entry_count,
    coverUrl: publicUrl(client, row.cover_path),
    createdAt: row.created_at,
  }));
  const total = Math.min(count ?? 0, RECENT_LIMIT);
  return response({ ok: true, rows, hasMore: offset + rows.length < total, total });
}

async function albumDetail(client: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const albumId = safeInteger(body.albumId, 1, 2147483647);
  if (!albumId) return response({ ok: false, reason: "invalid_album" });
  const { data: album, error } = await client
    .from("relay_albums")
    .select("id,origin,start_text,player_count,entry_count,created_at")
    .eq("id", albumId)
    .maybeSingle();
  if (error || !album) return response({ ok: false, reason: "missing" });
  const { data: entries, error: entryError } = await client
    .from("relay_album_entries")
    .select("step_index,kind,author,body_text,image_path")
    .eq("album_id", albumId)
    .order("step_index", { ascending: true });
  if (entryError) return response({ ok: false, reason: "query", msg: entryError.message });
  return response({
    ok: true,
    album: {
      id: album.id,
      origin: album.origin,
      startText: album.start_text,
      playerCount: album.player_count,
      entryCount: album.entry_count,
      createdAt: album.created_at,
      entries: (entries ?? []).map((entry) => ({
        stepIndex: entry.step_index,
        kind: entry.kind,
        author: entry.author,
        text: entry.body_text,
        imageUrl: publicUrl(client, entry.image_path),
      })),
    },
  });
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
  if (body.action === "save") return saveAlbum(client, nick, body);
  if (body.action === "list") return listAlbums(client, body);
  if (body.action === "detail") return albumDetail(client, body);
  return response({ ok: false, reason: "action" });
});
