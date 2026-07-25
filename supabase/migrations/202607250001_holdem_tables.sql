create table if not exists public.holdem_tables (
  room_id text primary key
    check (
      char_length(room_id) between 1 and 80
      and room_id ~ '^[A-Za-z0-9_-]+$'
    ),
  owner_nickname text not null
    references public.accounts(nickname) on delete cascade,
  state jsonb not null
    check (
      jsonb_typeof(state) = 'object'
      and pg_column_size(state) <= 262144
    ),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists holdem_tables_updated_at_idx
  on public.holdem_tables (updated_at);

alter table public.holdem_tables enable row level security;
revoke all on table public.holdem_tables from public, anon, authenticated;
grant all on table public.holdem_tables to service_role;

create or replace function public.holdem_table_compare_and_swap(
  p_room_id text,
  p_expected_version bigint,
  p_state jsonb,
  p_owner_nickname text
)
returns table (
  applied boolean,
  current_state jsonb,
  current_version bigint,
  current_owner_nickname text,
  current_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.holdem_tables%rowtype;
begin
  if p_room_id is null
    or char_length(p_room_id) not between 1 and 80
    or p_room_id !~ '^[A-Za-z0-9_-]+$'
    or p_expected_version is null
    or p_expected_version < 0
    or p_state is null
    or jsonb_typeof(p_state) <> 'object'
    or pg_column_size(p_state) > 262144
    or p_owner_nickname is null
    or char_length(p_owner_nickname) not between 1 and 40
  then
    raise exception 'invalid holdem table compare-and-swap input'
      using errcode = '22023';
  end if;

  if p_expected_version = 0 then
    insert into public.holdem_tables (
      room_id,
      owner_nickname,
      state,
      version,
      created_at,
      updated_at
    )
    values (
      p_room_id,
      p_owner_nickname,
      p_state,
      1,
      clock_timestamp(),
      clock_timestamp()
    )
    on conflict (room_id) do nothing
    returning * into current_row;
  else
    update public.holdem_tables as table_row
    set
      owner_nickname = p_owner_nickname,
      state = p_state,
      version = table_row.version + 1,
      updated_at = clock_timestamp()
    where table_row.room_id = p_room_id
      and table_row.version = p_expected_version
    returning table_row.* into current_row;
  end if;

  if found then
    return query
      select
        true,
        current_row.state,
        current_row.version,
        current_row.owner_nickname,
        current_row.updated_at;
    return;
  end if;

  select table_row.*
  into current_row
  from public.holdem_tables as table_row
  where table_row.room_id = p_room_id;

  if found then
    return query
      select
        false,
        current_row.state,
        current_row.version,
        current_row.owner_nickname,
        current_row.updated_at;
  else
    return query
      select
        false,
        null::jsonb,
        0::bigint,
        null::text,
        null::timestamptz;
  end if;
end;
$$;

create or replace function public.cleanup_expired_holdem_tables(
  p_ttl_seconds integer default 86400,
  p_limit integer default 200
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ttl_seconds integer := greatest(
    300,
    least(coalesce(p_ttl_seconds, 86400), 604800)
  );
  row_limit integer := greatest(1, least(coalesce(p_limit, 200), 500));
  removed_count integer;
begin
  with stale as (
    select table_row.room_id
    from public.holdem_tables as table_row
    where table_row.updated_at
      < clock_timestamp() - make_interval(secs => ttl_seconds)
    order by table_row.updated_at
    for update skip locked
    limit row_limit
  ),
  removed as (
    delete from public.holdem_tables as table_row
    using stale
    where table_row.room_id = stale.room_id
    returning 1
  )
  select count(*)::integer
  into removed_count
  from removed;

  return coalesce(removed_count, 0);
end;
$$;

revoke all on function public.holdem_table_compare_and_swap(text,bigint,jsonb,text)
  from public, anon, authenticated;
revoke all on function public.cleanup_expired_holdem_tables(integer,integer)
  from public, anon, authenticated;
grant execute on function public.holdem_table_compare_and_swap(text,bigint,jsonb,text)
  to service_role;
grant execute on function public.cleanup_expired_holdem_tables(integer,integer)
  to service_role;
