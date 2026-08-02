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
  if total_assets > 0 then
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
