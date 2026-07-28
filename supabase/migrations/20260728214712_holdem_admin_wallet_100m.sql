-- Administrator accounts are excluded from the public asset ranking. Set the
-- primary administrator's combined wallet and live-table assets to 100,000,000.
do $$
declare
  target_nickname constant text := '구나';
  target_assets constant bigint := 100000000;
  active_table_assets bigint := 0;
begin
  if not exists (
    select 1
    from public.accounts as account
    where account.nickname = target_nickname
      and coalesce(account.is_admin, false) = true
  ) then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('holdem-wallet:' || target_nickname)
  );

  insert into public.holdem_wallets (nickname, balance)
  values (target_nickname, target_assets)
  on conflict (nickname) do nothing;

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
  into active_table_assets
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
    and seat.value ->> 'nick' = target_nickname;

  if active_table_assets < 0
    or active_table_assets > target_assets
    or mod(active_table_assets, 100) <> 0
  then
    raise exception 'invalid administrator table assets'
      using errcode = '22023';
  end if;

  update public.holdem_wallets
  set
    balance = target_assets - active_table_assets,
    updated_at = clock_timestamp()
  where nickname = target_nickname;

  if not exists (
    select 1
    from public.holdem_wallets
    where nickname = target_nickname
      and balance + active_table_assets = target_assets
  ) then
    raise exception 'administrator wallet update failed';
  end if;
end;
$$;
