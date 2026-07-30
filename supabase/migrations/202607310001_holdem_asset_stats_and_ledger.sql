create table if not exists public.holdem_asset_adjustments (
  id bigint generated always as identity primary key,
  nickname text not null
    check (char_length(nickname) between 1 and 40),
  event_type text not null
    check (
      event_type in (
        'initial_grant',
        'opening_adjustment',
        'manual_adjustment'
      )
    ),
  amount bigint not null
    check (amount <> 0 and mod(amount, 100) = 0),
  source_key text not null default gen_random_uuid()::text
    check (char_length(source_key) between 1 and 160),
  note text not null default ''
    check (char_length(note) <= 240),
  created_at timestamptz not null default clock_timestamp(),
  constraint holdem_asset_adjustments_source_key_unique
    unique (source_key)
);

create index if not exists holdem_asset_adjustments_nickname_created_idx
  on public.holdem_asset_adjustments (nickname, created_at desc);

create index if not exists holdem_economy_events_nickname_type_created_idx
  on public.holdem_economy_events (
    nickname,
    event_type,
    created_at desc
  )
  where nickname is not null;

alter table public.holdem_asset_adjustments enable row level security;
revoke all on table public.holdem_asset_adjustments
  from public, anon, authenticated;
grant all on table public.holdem_asset_adjustments to service_role;

create or replace function public.holdem_record_initial_wallet_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.balance <> 0 then
    insert into public.holdem_asset_adjustments (
      nickname,
      event_type,
      amount,
      source_key,
      note,
      created_at
    )
    values (
      new.nickname,
      'initial_grant',
      new.balance,
      'wallet:' || new.nickname || ':initial',
      'Initial Holdem asset grant',
      new.created_at
    )
    on conflict (source_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.holdem_record_initial_wallet_grant()
  from public, anon, authenticated;

drop trigger if exists holdem_wallet_initial_grant_ledger
  on public.holdem_wallets;
create trigger holdem_wallet_initial_grant_ledger
after insert on public.holdem_wallets
for each row execute function public.holdem_record_initial_wallet_grant();

set local lock_timeout = '15s';

-- Match the live save path's lock order so the one-time reconciliation
-- observes wallet, table, hand, and refill values from the same boundary.
lock table public.holdem_tables in share row exclusive mode;
lock table public.holdem_wallets in share row exclusive mode;
lock table public.holdem_economy_events in share row exclusive mode;
lock table public.holdem_hand_results in share row exclusive mode;

insert into public.holdem_asset_adjustments (
  nickname,
  event_type,
  amount,
  source_key,
  note,
  created_at
)
select
  wallet.nickname,
  'initial_grant',
  100000,
  'wallet:' || wallet.nickname || ':initial',
  'Initial Holdem asset grant',
  wallet.created_at
from public.holdem_wallets as wallet
on conflict (source_key) do nothing;

with table_assets as (
  select
    btrim(seat.value ->> 'nick') as nickname,
    sum(
      case
        when coalesce(seat.value ->> 'stack', '') ~ '^[0-9]{1,15}$'
        then (seat.value ->> 'stack')::bigint
        else 0
      end
      + case
          when table_row.state ->> 'phase' in (
            'preflop',
            'flop',
            'turn',
            'river'
          )
            and coalesce(seat.value ->> 'totalBet', '')
              ~ '^[0-9]{1,15}$'
          then (seat.value ->> 'totalBet')::bigint
          else 0
        end
    )::bigint as amount
  from public.holdem_tables as table_row
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(table_row.state -> 'seats') = 'array'
      then table_row.state -> 'seats'
      else '[]'::jsonb
    end
  ) as seat(value)
  where table_row.state #>> '{settings,mode}' = 'ring'
    and table_row.state #>> '{settings,assetBacked}' = 'true'
    and jsonb_typeof(seat.value) = 'object'
    and coalesce(seat.value ->> 'isBot', 'false') <> 'true'
    and char_length(btrim(coalesce(seat.value ->> 'nick', '')))
      between 1 and 40
  group by btrim(seat.value ->> 'nick')
),
hand_net as (
  select
    result.nickname,
    sum(result.net_amount)::bigint as amount
  from public.holdem_hand_results as result
  where result.nickname is not null
  group by result.nickname
),
refill_total as (
  select
    event.nickname,
    sum(event.amount)::bigint as amount
  from public.holdem_economy_events as event
  where event.event_type = 'refill'
    and event.nickname is not null
  group by event.nickname
),
opening_balance as (
  select
    wallet.nickname,
    (
      wallet.balance
      + coalesce(table_assets.amount, 0)
      - 100000
      - coalesce(hand_net.amount, 0)
      - coalesce(refill_total.amount, 0)
    )::bigint as amount
  from public.holdem_wallets as wallet
  left join table_assets on table_assets.nickname = wallet.nickname
  left join hand_net on hand_net.nickname = wallet.nickname
  left join refill_total on refill_total.nickname = wallet.nickname
)
insert into public.holdem_asset_adjustments (
  nickname,
  event_type,
  amount,
  source_key,
  note
)
select
  opening_balance.nickname,
  'opening_adjustment',
  opening_balance.amount,
  'opening:' || opening_balance.nickname || ':202607310001',
  'Pre-ledger play and manual adjustment reconciliation'
from opening_balance
where opening_balance.amount <> 0
on conflict (source_key) do nothing;

create or replace function public.holdem_adjust_wallet_balance(
  p_nickname text,
  p_delta bigint,
  p_note text default ''
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  target_nickname text := btrim(coalesce(p_nickname, ''));
  adjustment_note text := btrim(coalesce(p_note, ''));
  current_balance bigint;
  next_balance bigint;
begin
  if char_length(target_nickname) not between 1 and 40
    or p_delta is null
    or p_delta = 0
    or p_delta < -100000000
    or p_delta > 100000000
    or mod(p_delta, 100) <> 0
    or char_length(adjustment_note) > 240
  then
    raise exception 'invalid holdem wallet adjustment'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.accounts as account
    where account.nickname = target_nickname
  ) then
    raise exception 'unknown holdem wallet account'
      using errcode = '22023';
  end if;

  insert into public.holdem_wallets (nickname)
  values (target_nickname)
  on conflict (nickname) do nothing;

  select wallet.balance
  into current_balance
  from public.holdem_wallets as wallet
  where wallet.nickname = target_nickname
  for update;

  next_balance := current_balance + p_delta;
  if next_balance < 0 then
    raise exception 'insufficient holdem wallet balance'
      using errcode = '22003';
  end if;

  update public.holdem_wallets
  set
    balance = next_balance,
    updated_at = clock_timestamp()
  where nickname = target_nickname;

  insert into public.holdem_asset_adjustments (
    nickname,
    event_type,
    amount,
    note
  )
  values (
    target_nickname,
    'manual_adjustment',
    p_delta,
    adjustment_note
  );

  return next_balance;
end;
$$;

revoke all on function public.holdem_adjust_wallet_balance(text,bigint,text)
  from public, anon, authenticated;
grant execute on function public.holdem_adjust_wallet_balance(text,bigint,text)
  to service_role;

create or replace view public.holdem_asset_ledger
with (security_invoker = true)
as
select
  'adjustment:' || adjustment.id::text as source_key,
  adjustment.event_type,
  adjustment.nickname,
  adjustment.amount,
  true as affects_player_assets,
  null::text as room_id,
  0::bigint as hand_no,
  0::bigint as table_version,
  adjustment.note,
  adjustment.created_at
from public.holdem_asset_adjustments as adjustment
union all
select
  'hand_result:' || result.id::text,
  'hand_result'::text,
  result.nickname,
  result.net_amount,
  true,
  result.room_id,
  result.hand_no,
  result.table_version,
  case when result.revealed then result.hand_name else '' end,
  result.created_at
from public.holdem_hand_results as result
where result.nickname is not null
union all
select
  'economy_event:' || event.id::text,
  event.event_type,
  event.nickname,
  event.amount,
  event.event_type = 'refill',
  event.room_id,
  event.hand_no,
  event.table_version,
  '',
  event.created_at
from public.holdem_economy_events as event;

revoke all on table public.holdem_asset_ledger
  from public, anon, authenticated;
grant select on table public.holdem_asset_ledger to service_role;

create or replace function public.holdem_player_asset_stats(
  p_nickname text
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with hand_stats as (
    select
      count(*)::bigint as hand_count,
      coalesce(
        sum(greatest(result.net_amount, 0)),
        0
      )::bigint as total_won,
      coalesce(
        sum(greatest(-result.net_amount, 0)),
        0
      )::bigint as total_lost,
      coalesce(sum(result.net_amount), 0)::bigint as total_net,
      coalesce(
        sum(result.net_amount) filter (
          where (result.created_at at time zone 'Asia/Seoul')::date
            = (now() at time zone 'Asia/Seoul')::date
        ),
        0
      )::bigint as today_net,
      coalesce(
        sum(result.net_amount) filter (
          where result.created_at >= now() - interval '7 days'
        ),
        0
      )::bigint as seven_day_net,
      min(result.created_at) as recorded_since
    from public.holdem_hand_results as result
    where result.nickname = btrim(p_nickname)
  ),
  refill_stats as (
    select
      coalesce(sum(event.amount), 0)::bigint as refill_total,
      coalesce(
        sum(event.amount) filter (
          where (event.created_at at time zone 'Asia/Seoul')::date
            = (now() at time zone 'Asia/Seoul')::date
        ),
        0
      )::bigint as refill_today,
      coalesce(
        sum(event.amount) filter (
          where event.created_at >= now() - interval '7 days'
        ),
        0
      )::bigint as refill_seven_days
    from public.holdem_economy_events as event
    where event.nickname = btrim(p_nickname)
      and event.event_type = 'refill'
  ),
  adjustment_stats as (
    select
      coalesce(
        sum(adjustment.amount) filter (
          where adjustment.event_type = 'initial_grant'
        ),
        0
      )::bigint as initial_grant_total,
      coalesce(
        sum(adjustment.amount) filter (
          where adjustment.event_type <> 'initial_grant'
        ),
        0
      )::bigint as adjustment_total
    from public.holdem_asset_adjustments as adjustment
    where adjustment.nickname = btrim(p_nickname)
  ),
  recent_groups as (
    select
      result.session_date,
      result.small_blind,
      result.big_blind,
      count(*)::bigint as hand_count,
      sum(result.net_amount)::bigint as net_amount,
      min(result.created_at) as started_at,
      max(result.created_at) as ended_at
    from public.holdem_hand_results as result
    where result.nickname = btrim(p_nickname)
    group by
      result.session_date,
      result.small_blind,
      result.big_blind
    order by ended_at desc
    limit 10
  ),
  recent_sessions as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', recent.session_date,
          'smallBlind', recent.small_blind,
          'bigBlind', recent.big_blind,
          'handCount', recent.hand_count,
          'netAmount', recent.net_amount,
          'startedAt', recent.started_at,
          'endedAt', recent.ended_at,
          'biggestWin', biggest_win.payload,
          'biggestLoss', biggest_loss.payload
        )
        order by recent.ended_at desc
      ),
      '[]'::jsonb
    ) as sessions
    from recent_groups as recent
    left join lateral (
      select jsonb_build_object(
        'amount',
        result.net_amount,
        'handName',
        case when result.revealed then result.hand_name else '' end
      ) as payload
      from public.holdem_hand_results as result
      where result.nickname = btrim(p_nickname)
        and result.session_date = recent.session_date
        and result.small_blind = recent.small_blind
        and result.big_blind = recent.big_blind
        and result.net_amount > 0
      order by result.net_amount desc, result.created_at desc, result.id desc
      limit 1
    ) as biggest_win on true
    left join lateral (
      select jsonb_build_object(
        'amount',
        result.net_amount,
        'handName',
        case when result.revealed then result.hand_name else '' end
      ) as payload
      from public.holdem_hand_results as result
      where result.nickname = btrim(p_nickname)
        and result.session_date = recent.session_date
        and result.small_blind = recent.small_blind
        and result.big_blind = recent.big_blind
        and result.net_amount < 0
      order by result.net_amount asc, result.created_at desc, result.id desc
      limit 1
    ) as biggest_loss on true
  )
  select jsonb_build_object(
    'handCount', hand_stats.hand_count,
    'totalWon', hand_stats.total_won,
    'totalLost', hand_stats.total_lost,
    'totalNet', hand_stats.total_net,
    'todayNet', hand_stats.today_net,
    'sevenDayNet', hand_stats.seven_day_net,
    'recordedSince', hand_stats.recorded_since,
    'refillTotal', refill_stats.refill_total,
    'refillToday', refill_stats.refill_today,
    'refillSevenDays', refill_stats.refill_seven_days,
    'initialGrantTotal', adjustment_stats.initial_grant_total,
    'adjustmentTotal', adjustment_stats.adjustment_total,
    'sessions', recent_sessions.sessions
  )
  from hand_stats, refill_stats, adjustment_stats, recent_sessions;
$$;

revoke all on function public.holdem_player_asset_stats(text)
  from public, anon, authenticated;
grant execute on function public.holdem_player_asset_stats(text)
  to service_role;
