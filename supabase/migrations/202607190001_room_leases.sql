create table if not exists public.room_leases (
  nickname text primary key references public.accounts(nickname) on delete cascade,
  room_id text not null unique check (char_length(room_id) between 1 and 80),
  room_name text not null check (char_length(room_name) between 1 and 80),
  game text not null check (char_length(game) between 1 and 30),
  lease_token text not null check (char_length(lease_token) between 16 and 100),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.room_leases enable row level security;
revoke all on public.room_leases from public, anon, authenticated;
grant all on public.room_leases to service_role;

create or replace function public.claim_room_lease(
  p_nickname text,
  p_room_id text,
  p_room_name text,
  p_game text,
  p_lease_token text,
  p_ttl_seconds integer default 60
)
returns table (acquired boolean, active_room_id text, active_room_name text, active_game text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_lease public.room_leases%rowtype;
  ttl integer := greatest(30, least(coalesce(p_ttl_seconds, 60), 120));
begin
  perform pg_advisory_xact_lock(hashtext(p_nickname));
  delete from public.room_leases
  where nickname = p_nickname and expires_at <= now();

  select * into current_lease
  from public.room_leases
  where nickname = p_nickname;

  if found then
    if current_lease.room_id = p_room_id and current_lease.lease_token = p_lease_token then
      update public.room_leases
      set expires_at = now() + make_interval(secs => ttl), updated_at = now()
      where nickname = p_nickname;
      return query select true, p_room_id, p_room_name, p_game;
    end if;
    return query select false, current_lease.room_id, current_lease.room_name, current_lease.game;
    return;
  end if;

  insert into public.room_leases (nickname, room_id, room_name, game, lease_token, expires_at)
  values (p_nickname, p_room_id, p_room_name, p_game, p_lease_token, now() + make_interval(secs => ttl));
  return query select true, p_room_id, p_room_name, p_game;
end;
$$;

create or replace function public.renew_room_lease(
  p_nickname text,
  p_room_id text,
  p_lease_token text,
  p_ttl_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ttl integer := greatest(30, least(coalesce(p_ttl_seconds, 60), 120));
begin
  update public.room_leases
  set expires_at = now() + make_interval(secs => ttl), updated_at = now()
  where nickname = p_nickname
    and room_id = p_room_id
    and lease_token = p_lease_token
    and expires_at > now();
  return found;
end;
$$;

create or replace function public.release_room_lease(
  p_nickname text,
  p_room_id text,
  p_lease_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.room_leases
  where nickname = p_nickname
    and room_id = p_room_id
    and lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.claim_room_lease(text,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.renew_room_lease(text,text,text,integer) from public, anon, authenticated;
revoke all on function public.release_room_lease(text,text,text) from public, anon, authenticated;
grant execute on function public.claim_room_lease(text,text,text,text,text,integer) to service_role;
grant execute on function public.renew_room_lease(text,text,text,integer) to service_role;
grant execute on function public.release_room_lease(text,text,text) to service_role;
