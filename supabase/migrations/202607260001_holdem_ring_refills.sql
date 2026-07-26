create table if not exists public.holdem_ring_refills (
  nickname text not null references public.accounts(nickname) on delete cascade,
  refill_date date not null,
  used_count integer not null default 0 check (used_count between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (nickname, refill_date)
);

alter table public.holdem_ring_refills enable row level security;
revoke all on table public.holdem_ring_refills from public, anon, authenticated;
grant all on table public.holdem_ring_refills to service_role;

create or replace function public.holdem_ring_refill_compare_and_swap(
  p_room_id text,
  p_expected_version bigint,
  p_state jsonb,
  p_owner_nickname text,
  p_nickname text
)
returns table (
  applied boolean,
  reason text,
  current_state jsonb,
  current_version bigint,
  current_owner_nickname text,
  refills_used integer,
  refills_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_table public.holdem_tables%rowtype;
  current_count integer := 0;
  today_in_seoul date := (timezone('Asia/Seoul', now()))::date;
begin
  if p_room_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_state is null
    or jsonb_typeof(p_state) <> 'object'
    or coalesce(p_state #>> '{settings,mode}', '') <> 'ring'
    or nullif(btrim(p_owner_nickname), '') is null
    or nullif(btrim(p_nickname), '') is null then
    raise exception 'invalid holdem ring refill input'
      using errcode = '22023';
  end if;

  select *
  into current_table
  from public.holdem_tables
  where room_id = p_room_id
  for update;

  if not found then
    return query select false, 'not_found'::text, null::jsonb, 0::bigint,
      null::text, 0, 3;
    return;
  end if;

  if current_table.version <> p_expected_version then
    return query select false, 'conflict'::text, current_table.state,
      current_table.version, current_table.owner_nickname, 0, 0;
    return;
  end if;

  insert into public.holdem_ring_refills (
    nickname,
    refill_date,
    used_count,
    updated_at
  )
  values (p_nickname, today_in_seoul, 0, now())
  on conflict (nickname, refill_date) do nothing;

  select used_count
  into current_count
  from public.holdem_ring_refills
  where nickname = p_nickname
    and refill_date = today_in_seoul
  for update;

  if current_count >= 3 then
    return query select false, 'refill_limit'::text, current_table.state,
      current_table.version, current_table.owner_nickname,
      current_count, greatest(0, 3 - current_count);
    return;
  end if;

  update public.holdem_ring_refills
  set used_count = used_count + 1,
      updated_at = now()
  where nickname = p_nickname
    and refill_date = today_in_seoul
  returning used_count into current_count;

  update public.holdem_tables as table_row
  set state = p_state,
      version = table_row.version + 1,
      owner_nickname = p_owner_nickname,
      updated_at = now()
  where table_row.room_id = p_room_id
    and table_row.version = p_expected_version
  returning table_row.* into current_table;

  if not found then
    raise exception 'holdem ring refill table update conflict'
      using errcode = '40001';
  end if;

  return query select true, null::text, current_table.state,
    current_table.version, current_table.owner_nickname,
    current_count, greatest(0, 3 - current_count);
end;
$$;

revoke all on function public.holdem_ring_refill_compare_and_swap(text,bigint,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.holdem_ring_refill_compare_and_swap(text,bigint,jsonb,text,text)
  to service_role;
