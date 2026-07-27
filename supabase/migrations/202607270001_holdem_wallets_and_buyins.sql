alter table public.room_leases
  add column if not exists config jsonb not null default '{}'::jsonb;

-- Legacy Hold'em tables used non-persistent play chips and the old 50/100 scale.
delete from public.holdem_tables
where state ->> 'economyVersion' is distinct from '2';

delete from public.room_leases as lease
using public.accounts as account
where lease.nickname = account.nickname
  and lease.game in ('holdem', 'holdem_tournament', 'holdem_turbo')
  and coalesce(account.is_admin, false) = false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'holdem_tables_economy_version_check'
      and conrelid = 'public.holdem_tables'::regclass
  ) then
    alter table public.holdem_tables
      add constraint holdem_tables_economy_version_check
      check (coalesce(state ->> 'economyVersion', '') = '2');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'room_leases_config_check'
      and conrelid = 'public.room_leases'::regclass
  ) then
    alter table public.room_leases
      add constraint room_leases_config_check
      check (
        jsonb_typeof(config) = 'object'
        and pg_column_size(config) <= 2048
      );
  end if;
end;
$$;

drop function if exists public.claim_room_lease(
  text,
  text,
  text,
  text,
  text,
  integer
);

create or replace function public.claim_room_lease(
  p_nickname text,
  p_room_id text,
  p_room_name text,
  p_game text,
  p_lease_token text,
  p_config jsonb default '{}'::jsonb,
  p_ttl_seconds integer default 60
)
returns table (
  acquired boolean,
  active_room_id text,
  active_room_name text,
  active_game text,
  active_config jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_lease public.room_leases%rowtype;
  ttl integer := greatest(30, least(coalesce(p_ttl_seconds, 60), 120));
begin
  if p_config is null
    or jsonb_typeof(p_config) <> 'object'
    or pg_column_size(p_config) > 2048
  then
    raise exception 'invalid room lease config'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_nickname));
  delete from public.room_leases
  where nickname = p_nickname and expires_at <= now();

  select * into current_lease
  from public.room_leases
  where nickname = p_nickname;

  if found then
    if current_lease.room_id = p_room_id
      and current_lease.lease_token = p_lease_token
    then
      update public.room_leases
      set expires_at = now() + make_interval(secs => ttl),
          updated_at = now()
      where nickname = p_nickname
      returning * into current_lease;

      return query select
        true,
        current_lease.room_id,
        current_lease.room_name,
        current_lease.game,
        current_lease.config;
      return;
    end if;

    return query select
      false,
      current_lease.room_id,
      current_lease.room_name,
      current_lease.game,
      current_lease.config;
    return;
  end if;

  insert into public.room_leases (
    nickname,
    room_id,
    room_name,
    game,
    lease_token,
    config,
    expires_at
  )
  values (
    p_nickname,
    p_room_id,
    p_room_name,
    p_game,
    p_lease_token,
    p_config,
    now() + make_interval(secs => ttl)
  )
  returning * into current_lease;

  return query select
    true,
    current_lease.room_id,
    current_lease.room_name,
    current_lease.game,
    current_lease.config;
end;
$$;

revoke all on function public.claim_room_lease(
  text,
  text,
  text,
  text,
  text,
  jsonb,
  integer
) from public, anon, authenticated;
grant execute on function public.claim_room_lease(
  text,
  text,
  text,
  text,
  text,
  jsonb,
  integer
) to service_role;

create table if not exists public.holdem_wallets (
  nickname text primary key
    references public.accounts(nickname) on delete cascade,
  balance bigint not null default 100000
    check (balance >= 0 and mod(balance, 100) = 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.holdem_wallets enable row level security;
revoke all on table public.holdem_wallets from public, anon, authenticated;
grant all on table public.holdem_wallets to service_role;

create or replace function public.holdem_wallet_get_or_create(
  p_nickname text
)
returns table (
  current_balance bigint,
  table_balance bigint,
  total_assets bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_nickname is null
    or char_length(p_nickname) not between 1 and 40
  then
    raise exception 'invalid holdem wallet nickname'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('holdem-wallet:' || p_nickname));

  insert into public.holdem_wallets (nickname)
  values (p_nickname)
  on conflict (nickname) do nothing;

  return query
    with table_holdings as (
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
      ), 0)::bigint as amount
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
        and seat.value ->> 'nick' = p_nickname
    )
    select
      wallet.balance,
      table_holdings.amount,
      wallet.balance + table_holdings.amount
    from public.holdem_wallets as wallet
    cross join table_holdings
    where wallet.nickname = p_nickname;
end;
$$;

revoke all on function public.holdem_wallet_get_or_create(text)
  from public, anon, authenticated;
grant execute on function public.holdem_wallet_get_or_create(text)
  to service_role;

create or replace function public.holdem_ring_table_compare_and_swap(
  p_room_id text,
  p_expected_version bigint,
  p_state jsonb,
  p_owner_nickname text,
  p_adjustments jsonb default '[]'::jsonb
)
returns table (
  applied boolean,
  reason text,
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
  table_exists boolean := false;
  insufficient_nickname text;
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
    or p_adjustments is null
    or jsonb_typeof(p_adjustments) <> 'array'
    or jsonb_array_length(p_adjustments) > 6
  then
    raise exception 'invalid holdem ring compare-and-swap input'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_adjustments)
      as adjustment(nickname text, delta bigint)
    where adjustment.nickname is null
      or char_length(adjustment.nickname) not between 1 and 40
      or adjustment.nickname <> btrim(adjustment.nickname)
      or adjustment.delta is null
      or adjustment.delta = 0
      or abs(adjustment.delta) > 100000000
      or mod(adjustment.delta, 100) <> 0
  ) then
    raise exception 'invalid holdem wallet adjustment'
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
        current_row.updated_at;
    else
      return query select
        false,
        'conflict'::text,
        null::jsonb,
        0::bigint,
        null::text,
        null::timestamptz;
    end if;
    return;
  end if;

  insert into public.holdem_wallets (nickname)
  select distinct adjustment.nickname
  from jsonb_to_recordset(p_adjustments)
    as adjustment(nickname text, delta bigint)
  on conflict (nickname) do nothing;

  perform 1
  from public.holdem_wallets as wallet
  where wallet.nickname in (
    select adjustment.nickname
    from jsonb_to_recordset(p_adjustments)
      as adjustment(nickname text, delta bigint)
  )
  order by wallet.nickname
  for update;

  select totals.nickname
  into insufficient_nickname
  from (
    select adjustment.nickname, sum(adjustment.delta)::bigint as delta
    from jsonb_to_recordset(p_adjustments)
      as adjustment(nickname text, delta bigint)
    group by adjustment.nickname
  ) as totals
  join public.holdem_wallets as wallet
    on wallet.nickname = totals.nickname
  where wallet.balance + totals.delta < 0
  order by totals.nickname
  limit 1;

  if insufficient_nickname is not null then
    return query select
      false,
      'wallet_insufficient'::text,
      case when table_exists then current_row.state else null::jsonb end,
      case when table_exists then current_row.version else 0::bigint end,
      case when table_exists then current_row.owner_nickname else null::text end,
      case when table_exists then current_row.updated_at else null::timestamptz end;
    return;
  end if;

  update public.holdem_wallets as wallet
  set
    balance = wallet.balance + totals.delta,
    updated_at = clock_timestamp()
  from (
    select adjustment.nickname, sum(adjustment.delta)::bigint as delta
    from jsonb_to_recordset(p_adjustments)
      as adjustment(nickname text, delta bigint)
    group by adjustment.nickname
  ) as totals
  where wallet.nickname = totals.nickname;

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
    returning table_row.* into current_row;
  end if;

  return query select
    true,
    null::text,
    current_row.state,
    current_row.version,
    current_row.owner_nickname,
    current_row.updated_at;
end;
$$;

revoke all on function public.holdem_ring_table_compare_and_swap(
  text,
  bigint,
  jsonb,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.holdem_ring_table_compare_and_swap(
  text,
  bigint,
  jsonb,
  text,
  jsonb
) to service_role;

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
  with stale as materialized (
    select table_row.room_id, table_row.state
    from public.holdem_tables as table_row
    where table_row.updated_at
      < clock_timestamp() - make_interval(secs => ttl_seconds)
      and not exists (
        select 1
        from public.room_leases as lease
        where lease.room_id = table_row.room_id
          and lease.expires_at > clock_timestamp()
      )
    order by table_row.updated_at
    limit row_limit
    for update of table_row skip locked
  ),
  seat_refunds as materialized (
    select
      btrim(seat.value ->> 'nick') as nickname,
      (
        case
          when coalesce(seat.value ->> 'stack', '') ~ '^[0-9]{1,9}$'
            then (seat.value ->> 'stack')::bigint
          else 0
        end
        +
        case
          when coalesce(stale.state ->> 'phase', '') in (
            'preflop',
            'flop',
            'turn',
            'river'
          )
          and coalesce(seat.value ->> 'totalBet', '') ~ '^[0-9]{1,9}$'
            then (seat.value ->> 'totalBet')::bigint
          else 0
        end
      )::bigint as amount
    from stale
    cross join lateral jsonb_array_elements(
      case
        when stale.state #>> '{settings,mode}' = 'ring'
          and stale.state #>> '{settings,assetBacked}' = 'true'
          and jsonb_typeof(stale.state -> 'seats') = 'array'
          then stale.state -> 'seats'
        else '[]'::jsonb
      end
    ) as seat(value)
    where jsonb_typeof(seat.value) = 'object'
      and coalesce(seat.value ->> 'isBot', 'false') <> 'true'
      and char_length(btrim(coalesce(seat.value ->> 'nick', '')))
        between 1 and 40
  ),
  refunds as materialized (
    select
      seat_refunds.nickname,
      (
        sum(seat_refunds.amount)::bigint
        - mod(sum(seat_refunds.amount)::bigint, 100)
      )::bigint as amount
    from seat_refunds
    group by seat_refunds.nickname
    having sum(seat_refunds.amount) >= 100
  ),
  locked_wallets as materialized (
    select wallet.nickname
    from public.holdem_wallets as wallet
    join refunds on refunds.nickname = wallet.nickname
    order by wallet.nickname
    for update of wallet
  ),
  wallet_guard as materialized (
    select
      (select count(*) from refunds) =
      (select count(*) from locked_wallets) as ready
  ),
  wallet_updates as (
    update public.holdem_wallets as wallet
    set
      balance = wallet.balance + refunds.amount,
      updated_at = clock_timestamp()
    from refunds
    where wallet.nickname = refunds.nickname
      and (select ready from wallet_guard)
    returning wallet.nickname
  ),
  refund_guard as materialized (
    select
      (select ready from wallet_guard)
      and (select count(*) from wallet_updates) =
        (select count(*) from refunds) as ready
  ),
  removed as (
    delete from public.holdem_tables as table_row
    using stale
    where table_row.room_id = stale.room_id
      and (select ready from refund_guard)
    returning 1
  )
  select count(*)::integer
  into removed_count
  from removed;

  return coalesce(removed_count, 0);
end;
$$;

revoke all on function public.cleanup_expired_holdem_tables(integer,integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_holdem_tables(integer,integer)
  to service_role;
