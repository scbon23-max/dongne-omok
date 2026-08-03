create or replace function public.holdem_wallet_refill_if_empty(
  p_nickname text
)
returns table (
  applied boolean,
  reason text,
  current_balance bigint,
  table_balance bigint,
  total_assets bigint,
  refills_used integer,
  refills_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  refill_amount bigint := 20000;
  minimum_playable_assets bigint := 10000;
  daily_limit integer := 3;
  current_count integer := 0;
  today_in_seoul date := (timezone('Asia/Seoul', now()))::date;
  wallet_balance bigint := 0;
  table_assets bigint := 0;
  total_assets_value bigint := 0;
  refill_room_id text := 'wallet_refill_' || to_char((timezone('Asia/Seoul', now()))::date, 'YYYYMMDD');
begin
  if p_nickname is null
    or char_length(p_nickname) not between 1 and 40
  then
    raise exception 'invalid holdem wallet refill nickname'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('holdem-wallet:' || p_nickname));

  insert into public.holdem_wallets (nickname)
  values (p_nickname)
  on conflict (nickname) do nothing;

  select wallet.balance
  into wallet_balance
  from public.holdem_wallets as wallet
  where wallet.nickname = p_nickname
  for update;

  select coalesce(sum(
    case
      when coalesce(seat.value ->> 'stack', '') ~ '^[0-9]{1,9}$'
        then (seat.value ->> 'stack')::bigint
      else 0
    end
    +
    case
      when coalesce(table_row.state ->> 'phase', '') in (
        'preflop',
        'flop',
        'turn',
        'river'
      )
      and coalesce(seat.value ->> 'totalBet', '') ~ '^[0-9]{1,9}$'
        then (seat.value ->> 'totalBet')::bigint
      else 0
    end
  ), 0)::bigint
  into table_assets
  from public.holdem_tables as table_row
  cross join lateral jsonb_array_elements(
    case
      when table_row.state #>> '{settings,mode}' = 'ring'
        and table_row.state #>> '{settings,assetBacked}' = 'true'
        and jsonb_typeof(table_row.state -> 'seats') = 'array'
        then table_row.state -> 'seats'
      else '[]'::jsonb
    end
  ) as seat(value)
  where jsonb_typeof(seat.value) = 'object'
    and coalesce(seat.value ->> 'isBot', 'false') <> 'true'
    and seat.value ->> 'nick' = p_nickname;

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

  total_assets_value := coalesce(wallet_balance, 0) + coalesce(table_assets, 0);
  if total_assets_value >= minimum_playable_assets then
    return query select false, 'assets_remaining'::text,
      coalesce(wallet_balance, 0), coalesce(table_assets, 0), total_assets_value,
      current_count, greatest(0, daily_limit - current_count);
    return;
  end if;

  if current_count >= daily_limit then
    return query select false, 'refill_limit'::text,
      coalesce(wallet_balance, 0), coalesce(table_assets, 0), total_assets_value,
      current_count, 0;
    return;
  end if;

  update public.holdem_ring_refills
  set used_count = used_count + 1,
      updated_at = now()
  where nickname = p_nickname
    and refill_date = today_in_seoul
  returning used_count into current_count;

  update public.holdem_wallets as wallet
  set balance = wallet.balance + refill_amount,
      updated_at = clock_timestamp()
  where wallet.nickname = p_nickname
  returning wallet.balance into wallet_balance;

  insert into public.holdem_economy_events (
    event_type,
    nickname,
    amount,
    room_id,
    hand_no,
    table_version
  )
  values (
    'refill',
    p_nickname,
    refill_amount,
    refill_room_id,
    0,
    current_count
  )
  on conflict do nothing;

  total_assets_value := coalesce(wallet_balance, 0) + coalesce(table_assets, 0);
  return query select true, null::text,
    coalesce(wallet_balance, 0), coalesce(table_assets, 0), total_assets_value,
    current_count, greatest(0, daily_limit - current_count);
end;
$$;

revoke all on function public.holdem_wallet_refill_if_empty(text)
  from public, anon, authenticated;
grant execute on function public.holdem_wallet_refill_if_empty(text)
  to service_role;

create or replace function public.holdem_ring_refill_v3_compare_and_swap(
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
  result_row record;
  refill_amount bigint;
  minimum_playable_assets bigint := 10000;
  wallet_balance bigint;
  table_assets bigint;
  total_assets bigint;
begin
  refill_amount := nullif(p_state #>> '{settings,refillAmount}', '')::bigint;
  if refill_amount is distinct from 20000 then
    raise exception 'invalid holdem refill amount'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('holdem-table:' || p_room_id));

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

  perform pg_advisory_xact_lock(hashtext('holdem-wallet:' || p_nickname));

  insert into public.holdem_wallets (nickname)
  values (p_nickname)
  on conflict (nickname) do nothing;

  select wallet.balance
  into wallet_balance
  from public.holdem_wallets as wallet
  where wallet.nickname = p_nickname
  for update;

  select coalesce(sum(
    case
      when coalesce(seat.value ->> 'stack', '') ~ '^[0-9]{1,9}$'
        then (seat.value ->> 'stack')::bigint
      else 0
    end
    +
    case
      when coalesce(table_row.state ->> 'phase', '') in (
        'preflop',
        'flop',
        'turn',
        'river'
      )
      and coalesce(seat.value ->> 'totalBet', '') ~ '^[0-9]{1,9}$'
        then (seat.value ->> 'totalBet')::bigint
      else 0
    end
  ), 0)::bigint
  into table_assets
  from public.holdem_tables as table_row
  cross join lateral jsonb_array_elements(
    case
      when table_row.state #>> '{settings,mode}' = 'ring'
        and table_row.state #>> '{settings,assetBacked}' = 'true'
        and jsonb_typeof(table_row.state -> 'seats') = 'array'
        then table_row.state -> 'seats'
      else '[]'::jsonb
    end
  ) as seat(value)
  where jsonb_typeof(seat.value) = 'object'
    and coalesce(seat.value ->> 'isBot', 'false') <> 'true'
    and seat.value ->> 'nick' = p_nickname;

  total_assets := coalesce(wallet_balance, 0) + coalesce(table_assets, 0);
  if total_assets >= minimum_playable_assets then
    return query select false, 'assets_remaining'::text, current_table.state,
      current_table.version, current_table.owner_nickname, 0, 0;
    return;
  end if;

  select *
  into result_row
  from public.holdem_ring_refill_compare_and_swap(
    p_room_id,
    p_expected_version,
    p_state,
    p_owner_nickname,
    p_nickname
  );

  if coalesce(result_row.applied, false) then
    insert into public.holdem_economy_events (
      event_type,
      nickname,
      amount,
      room_id,
      hand_no,
      table_version
    )
    values (
      'refill',
      p_nickname,
      refill_amount,
      p_room_id,
      greatest(0, coalesce(nullif(p_state ->> 'handNo', '')::bigint, 0)),
      result_row.current_version
    )
    on conflict do nothing;
  end if;

  return query select
    result_row.applied::boolean,
    result_row.reason::text,
    result_row.current_state::jsonb,
    result_row.current_version::bigint,
    result_row.current_owner_nickname::text,
    result_row.refills_used::integer,
    result_row.refills_remaining::integer;
end;
$$;

revoke all on function public.holdem_ring_refill_v3_compare_and_swap(
  text,
  bigint,
  jsonb,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.holdem_ring_refill_v3_compare_and_swap(
  text,
  bigint,
  jsonb,
  text,
  text
) to service_role;

create or replace function public.holdem_ring_free_buyin_v1_compare_and_swap(
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
  current_updated_at timestamptz,
  refills_used integer,
  refills_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.holdem_tables%rowtype;
  table_exists boolean := false;
  current_count integer := 0;
  daily_limit integer := 3;
  minimum_playable_assets bigint := 10000;
  today_in_seoul date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  refill_amount bigint;
  wallet_balance bigint := 0;
  table_assets bigint := 0;
  total_assets_value bigint := 0;
begin
  refill_amount := nullif(p_state #>> '{settings,refillAmount}', '')::bigint;
  if p_room_id is null
    or char_length(p_room_id) not between 1 and 80
    or p_room_id !~ '^[A-Za-z0-9_-]+$'
    or p_expected_version is null
    or p_expected_version < 0
    or p_state is null
    or jsonb_typeof(p_state) <> 'object'
    or pg_column_size(p_state) > 262144
    or coalesce(p_state #>> '{settings,mode}', '') <> 'ring'
    or coalesce(p_state #>> '{settings,assetBacked}', '') <> 'true'
    or jsonb_typeof(p_state -> 'seats') <> 'array'
    or refill_amount is distinct from 20000
    or nullif(btrim(p_owner_nickname), '') is null
    or char_length(p_owner_nickname) not between 1 and 40
    or nullif(btrim(p_nickname), '') is null
    or char_length(p_nickname) not between 1 and 40
    or not exists (
      select 1
      from jsonb_array_elements(p_state -> 'seats') as seat(value)
      where jsonb_typeof(seat.value) = 'object'
        and coalesce(seat.value ->> 'isBot', 'false') <> 'true'
        and seat.value ->> 'nick' = p_nickname
        and coalesce(seat.value ->> 'stack', '') ~ '^[0-9]{1,9}$'
        and (seat.value ->> 'stack')::bigint = refill_amount
    )
  then
    raise exception 'invalid holdem free refill buy-in input'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('holdem-table:' || p_room_id));

  select table_row.*
  into current_row
  from public.holdem_tables as table_row
  where table_row.room_id = p_room_id
  for update;
  table_exists := found;

  if (
    p_expected_version = 0 and table_exists
  ) or (
    p_expected_version > 0 and (
      not table_exists or current_row.version <> p_expected_version
    )
  ) then
    if table_exists then
      return query select
        false,
        'conflict'::text,
        current_row.state,
        current_row.version,
        current_row.owner_nickname,
        current_row.updated_at,
        0,
        0;
    else
      return query select
        false,
        'conflict'::text,
        null::jsonb,
        0::bigint,
        null::text,
        null::timestamptz,
        0,
        0;
    end if;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('holdem-wallet:' || p_nickname));

  insert into public.holdem_wallets (nickname)
  values (p_nickname)
  on conflict (nickname) do nothing;

  select wallet.balance
  into wallet_balance
  from public.holdem_wallets as wallet
  where wallet.nickname = p_nickname
  for update;

  select coalesce(sum(
    case
      when coalesce(seat.value ->> 'stack', '') ~ '^[0-9]{1,9}$'
        then (seat.value ->> 'stack')::bigint
      else 0
    end
    +
    case
      when coalesce(table_row.state ->> 'phase', '') in (
        'preflop',
        'flop',
        'turn',
        'river'
      )
      and coalesce(seat.value ->> 'totalBet', '') ~ '^[0-9]{1,9}$'
        then (seat.value ->> 'totalBet')::bigint
      else 0
    end
  ), 0)::bigint
  into table_assets
  from public.holdem_tables as table_row
  cross join lateral jsonb_array_elements(
    case
      when table_row.state #>> '{settings,mode}' = 'ring'
        and table_row.state #>> '{settings,assetBacked}' = 'true'
        and jsonb_typeof(table_row.state -> 'seats') = 'array'
        then table_row.state -> 'seats'
      else '[]'::jsonb
    end
  ) as seat(value)
  where jsonb_typeof(seat.value) = 'object'
    and coalesce(seat.value ->> 'isBot', 'false') <> 'true'
    and seat.value ->> 'nick' = p_nickname;

  insert into public.holdem_ring_refills (
    nickname,
    refill_date,
    used_count,
    updated_at
  )
  values (p_nickname, today_in_seoul, 0, clock_timestamp())
  on conflict (nickname, refill_date) do nothing;

  select used_count
  into current_count
  from public.holdem_ring_refills
  where nickname = p_nickname
    and refill_date = today_in_seoul
  for update;

  total_assets_value := coalesce(wallet_balance, 0) + coalesce(table_assets, 0);
  if total_assets_value >= minimum_playable_assets then
    return query select
      false,
      'assets_remaining'::text,
      case when table_exists then current_row.state else null::jsonb end,
      case when table_exists then current_row.version else 0::bigint end,
      case when table_exists then current_row.owner_nickname else null::text end,
      case when table_exists then current_row.updated_at else null::timestamptz end,
      current_count,
      greatest(0, daily_limit - current_count);
    return;
  end if;

  if current_count >= daily_limit then
    return query select
      false,
      'refill_limit'::text,
      case when table_exists then current_row.state else null::jsonb end,
      case when table_exists then current_row.version else 0::bigint end,
      case when table_exists then current_row.owner_nickname else null::text end,
      case when table_exists then current_row.updated_at else null::timestamptz end,
      current_count,
      greatest(0, daily_limit - current_count);
    return;
  end if;

  update public.holdem_ring_refills
  set
    used_count = used_count + 1,
    updated_at = clock_timestamp()
  where nickname = p_nickname
    and refill_date = today_in_seoul
  returning used_count into current_count;

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

  insert into public.holdem_economy_events (
    event_type,
    nickname,
    amount,
    room_id,
    hand_no,
    table_version
  )
  values (
    'refill',
    p_nickname,
    refill_amount,
    p_room_id,
    greatest(0, coalesce(nullif(p_state ->> 'handNo', '')::bigint, 0)),
    current_row.version
  )
  on conflict do nothing;

  return query select
    true,
    null::text,
    current_row.state,
    current_row.version,
    current_row.owner_nickname,
    current_row.updated_at,
    current_count,
    greatest(0, daily_limit - current_count);
end;
$$;

revoke all on function public.holdem_ring_free_buyin_v1_compare_and_swap(
  text,
  bigint,
  jsonb,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.holdem_ring_free_buyin_v1_compare_and_swap(
  text,
  bigint,
  jsonb,
  text,
  text
) to service_role;
