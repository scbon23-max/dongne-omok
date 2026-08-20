set local lock_timeout = '15s';

do $$
declare
  current_balance bigint;
  next_balance bigint;
begin
  -- Keep table chips and the wallet at one boundary while the balance is removed.
  lock table public.holdem_tables in share row exclusive mode;
  lock table public.holdem_wallets in share row exclusive mode;

  if not exists (
    select 1
    from public.accounts
    where nickname = '구나'
  ) then
    raise exception 'cannot zero unknown account: 구나';
  end if;

  if exists (
    select 1
    from public.holdem_tables as table_row
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(table_row.state -> 'seats') = 'array'
          then table_row.state -> 'seats'
        else '[]'::jsonb
      end
    ) as seat(value)
    where seat.value ->> 'nick' = '구나'
  ) then
    raise exception 'cannot zero assets while 구나 is seated at a Holdem table';
  end if;

  select balance
  into current_balance
  from public.holdem_wallets
  where nickname = '구나'
  for update;

  if current_balance is null then
    raise exception 'cannot zero missing Holdem wallet: 구나';
  end if;

  if current_balance > 0 then
    select public.holdem_adjust_wallet_balance(
      '구나',
      -current_balance,
      'User-requested Holdem asset deletion on 2026-08-20'
    ) into next_balance;
  else
    next_balance := current_balance;
  end if;

  if next_balance <> 0 then
    raise exception 'failed to zero Holdem wallet: 구나';
  end if;

  raise notice 'Zeroed 구나 Holdem wallet: % -> 0', current_balance;
end;
$$;
