create table if not exists public.holdem_economy_events (
  id bigint generated always as identity primary key,
  event_type text not null
    check (event_type in ('rake', 'refill')),
  nickname text
    references public.accounts(nickname) on delete set null,
  amount bigint not null
    check (amount <> 0 and mod(abs(amount), 100) = 0),
  room_id text not null
    check (
      char_length(room_id) between 1 and 80
      and room_id ~ '^[A-Za-z0-9_-]+$'
    ),
  hand_no bigint not null default 0 check (hand_no >= 0),
  table_version bigint not null check (table_version >= 1),
  created_at timestamptz not null default clock_timestamp(),
  constraint holdem_economy_events_shape_check check (
    (
      event_type = 'rake'
      and amount < 0
      and nickname is null
      and hand_no >= 1
    )
    or (
      event_type = 'refill'
      and amount > 0
    )
  )
);

create unique index if not exists holdem_economy_events_once_per_version
  on public.holdem_economy_events (
    room_id,
    table_version,
    event_type,
    coalesce(nickname, '')
  );

create index if not exists holdem_economy_events_created_at_idx
  on public.holdem_economy_events (created_at desc);

alter table public.holdem_economy_events enable row level security;
revoke all on table public.holdem_economy_events
  from public, anon, authenticated;
grant all on table public.holdem_economy_events to service_role;

-- Version 2 tables used the previous room tiers. Cash every asset-backed
-- seat out before closing those tables so the economy change never drops funds.
alter table public.holdem_tables
  drop constraint if exists holdem_tables_economy_version_check;

create temporary table holdem_v2_refunds
on commit drop
as
select
  btrim(seat.value ->> 'nick') as nickname,
  (
    sum(
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
    )::bigint
    - mod(
      sum(
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
      )::bigint,
      100
    )
  )::bigint as amount
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
where table_row.state ->> 'economyVersion' is distinct from '3'
  and jsonb_typeof(seat.value) = 'object'
  and coalesce(seat.value ->> 'isBot', 'false') <> 'true'
  and char_length(btrim(coalesce(seat.value ->> 'nick', '')))
    between 1 and 40
group by btrim(seat.value ->> 'nick')
having sum(
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
) >= 100;

do $$
begin
  if exists (
    select 1
    from holdem_v2_refunds as refund
    left join public.holdem_wallets as wallet
      on wallet.nickname = refund.nickname
    where wallet.nickname is null
  ) then
    raise exception 'cannot migrate holdem table without wallet';
  end if;
end;
$$;

update public.holdem_wallets as wallet
set
  balance = wallet.balance + refund.amount,
  updated_at = clock_timestamp()
from holdem_v2_refunds as refund
where wallet.nickname = refund.nickname;

delete from public.holdem_tables
where state ->> 'economyVersion' is distinct from '3';

delete from public.room_leases
where game in (
  'holdem',
  'holdem_tournament',
  'holdem_turbo',
  'holdem_ring'
);

alter table public.holdem_tables
  add constraint holdem_tables_economy_version_check
  check (coalesce(state ->> 'economyVersion', '') = '3');

create or replace function public.holdem_ring_table_v3_compare_and_swap(
  p_room_id text,
  p_expected_version bigint,
  p_state jsonb,
  p_owner_nickname text,
  p_adjustments jsonb,
  p_economy_events jsonb
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
  result_row record;
begin
  if p_economy_events is null
    or jsonb_typeof(p_economy_events) <> 'array'
    or jsonb_array_length(p_economy_events) > 1
    or exists (
      select 1
      from jsonb_to_recordset(p_economy_events)
        as event(event_type text, amount bigint, hand_no bigint)
      where event.event_type <> 'rake'
        or event.amount is null
        or event.amount >= 0
        or abs(event.amount) > 100000000
        or mod(event.amount, 100) <> 0
        or event.hand_no is null
        or event.hand_no < 1
    )
  then
    raise exception 'invalid holdem economy event'
      using errcode = '22023';
  end if;

  select *
  into result_row
  from public.holdem_ring_table_compare_and_swap(
    p_room_id,
    p_expected_version,
    p_state,
    p_owner_nickname,
    p_adjustments
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
    select
      event.event_type,
      null,
      event.amount,
      p_room_id,
      event.hand_no,
      result_row.current_version
    from jsonb_to_recordset(p_economy_events)
      as event(event_type text, amount bigint, hand_no bigint)
    on conflict do nothing;
  end if;

  return query select
    result_row.applied::boolean,
    result_row.reason::text,
    result_row.current_state::jsonb,
    result_row.current_version::bigint,
    result_row.current_owner_nickname::text,
    result_row.current_updated_at::timestamptz;
end;
$$;

revoke all on function public.holdem_ring_table_v3_compare_and_swap(
  text,
  bigint,
  jsonb,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.holdem_ring_table_v3_compare_and_swap(
  text,
  bigint,
  jsonb,
  text,
  jsonb,
  jsonb
) to service_role;

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
  result_row record;
  refill_amount bigint;
begin
  refill_amount := nullif(p_state #>> '{settings,refillAmount}', '')::bigint;
  if refill_amount is distinct from 20000 then
    raise exception 'invalid holdem refill amount'
      using errcode = '22023';
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
