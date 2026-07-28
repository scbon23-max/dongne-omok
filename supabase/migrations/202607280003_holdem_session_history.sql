create table if not exists public.holdem_hand_results (
  id bigint generated always as identity primary key,
  room_id text not null
    check (
      char_length(room_id) between 1 and 80
      and room_id ~ '^[A-Za-z0-9_-]+$'
    ),
  hand_no bigint not null check (hand_no >= 1),
  nickname text
    references public.accounts(nickname) on delete set null,
  session_date date not null default ((now() at time zone 'Asia/Seoul')::date),
  small_blind bigint not null
    check (small_blind >= 100 and mod(small_blind, 100) = 0),
  big_blind bigint not null
    check (big_blind >= small_blind * 2 and mod(big_blind, 100) = 0),
  net_amount bigint not null
    check (mod(abs(net_amount), 100) = 0),
  won_amount bigint not null default 0
    check (won_amount >= 0 and mod(won_amount, 100) = 0),
  is_winner boolean not null default false,
  revealed boolean not null default false,
  hand_name text not null default ''
    check (char_length(hand_name) <= 40),
  hand_category integer not null default -1
    check (hand_category between -1 and 8),
  table_version bigint not null check (table_version >= 1),
  created_at timestamptz not null default clock_timestamp(),
  constraint holdem_hand_results_reveal_check check (
    (revealed and hand_category >= 0 and hand_name <> '')
    or (not revealed and hand_category = -1 and hand_name = '')
  )
);

create unique index if not exists holdem_hand_results_once_per_player
  on public.holdem_hand_results (room_id, hand_no, nickname)
  where nickname is not null;

create index if not exists holdem_hand_results_nickname_created_idx
  on public.holdem_hand_results (nickname, created_at desc)
  where nickname is not null;

create index if not exists holdem_hand_results_session_idx
  on public.holdem_hand_results (
    nickname,
    session_date desc,
    small_blind,
    big_blind
  )
  where nickname is not null;

alter table public.holdem_hand_results enable row level security;
revoke all on table public.holdem_hand_results
  from public, anon, authenticated;
grant all on table public.holdem_hand_results to service_role;

create or replace function public.holdem_ring_table_v4_compare_and_swap(
  p_room_id text,
  p_expected_version bigint,
  p_state jsonb,
  p_owner_nickname text,
  p_adjustments jsonb default '[]'::jsonb,
  p_economy_events jsonb default '[]'::jsonb,
  p_hand_results jsonb default '[]'::jsonb
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
  if p_hand_results is null
    or jsonb_typeof(p_hand_results) <> 'array'
    or jsonb_array_length(p_hand_results) > 6
    or exists (
      select 1
      from jsonb_to_recordset(p_hand_results)
        as hand(
          nickname text,
          hand_no bigint,
          small_blind bigint,
          big_blind bigint,
          net_amount bigint,
          won_amount bigint,
          is_winner boolean,
          revealed boolean,
          hand_name text,
          hand_category integer
        )
      where hand.nickname is null
        or char_length(hand.nickname) not between 1 and 40
        or hand.hand_no is null
        or hand.hand_no < 1
        or hand.small_blind is null
        or hand.small_blind < 100
        or mod(hand.small_blind, 100) <> 0
        or hand.big_blind is null
        or hand.big_blind < hand.small_blind * 2
        or mod(hand.big_blind, 100) <> 0
        or hand.net_amount is null
        or abs(hand.net_amount) > 100000000
        or mod(abs(hand.net_amount), 100) <> 0
        or hand.won_amount is null
        or hand.won_amount < 0
        or hand.won_amount > 100000000
        or mod(hand.won_amount, 100) <> 0
        or hand.hand_category is null
        or hand.hand_category not between -1 and 8
        or coalesce(char_length(hand.hand_name), 0) > 40
        or (
          coalesce(hand.revealed, false)
          and (hand.hand_category < 0 or coalesce(hand.hand_name, '') = '')
        )
        or (
          not coalesce(hand.revealed, false)
          and (hand.hand_category <> -1 or coalesce(hand.hand_name, '') <> '')
        )
    )
  then
    raise exception 'invalid holdem hand result'
      using errcode = '22023';
  end if;

  select *
  into result_row
  from public.holdem_ring_table_v3_compare_and_swap(
    p_room_id,
    p_expected_version,
    p_state,
    p_owner_nickname,
    p_adjustments,
    p_economy_events
  );

  if coalesce(result_row.applied, false) then
    insert into public.holdem_hand_results (
      room_id,
      hand_no,
      nickname,
      session_date,
      small_blind,
      big_blind,
      net_amount,
      won_amount,
      is_winner,
      revealed,
      hand_name,
      hand_category,
      table_version
    )
    select
      p_room_id,
      hand.hand_no,
      hand.nickname,
      (clock_timestamp() at time zone 'Asia/Seoul')::date,
      hand.small_blind,
      hand.big_blind,
      hand.net_amount,
      hand.won_amount,
      coalesce(hand.is_winner, false),
      coalesce(hand.revealed, false),
      case when coalesce(hand.revealed, false) then hand.hand_name else '' end,
      case when coalesce(hand.revealed, false) then hand.hand_category else -1 end,
      result_row.current_version
    from jsonb_to_recordset(p_hand_results)
      as hand(
        nickname text,
        hand_no bigint,
        small_blind bigint,
        big_blind bigint,
        net_amount bigint,
        won_amount bigint,
        is_winner boolean,
        revealed boolean,
        hand_name text,
        hand_category integer
      )
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

revoke all on function public.holdem_ring_table_v4_compare_and_swap(
  text,
  bigint,
  jsonb,
  text,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.holdem_ring_table_v4_compare_and_swap(
  text,
  bigint,
  jsonb,
  text,
  jsonb,
  jsonb,
  jsonb
) to service_role;
