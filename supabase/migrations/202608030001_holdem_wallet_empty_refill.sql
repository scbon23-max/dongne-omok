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
  if total_assets_value > 0 then
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
