begin;
set local lock_timeout = '5s';

-- Preserve the deployed transaction bodies; align their input bounds with
-- the eight-seat engine. The guard makes unexpected definitions fail safely.
do $$
declare
  definition text;
  signature text;
  old_check text;
  new_check text;
begin
  for signature, old_check, new_check in
    select * from (values
      ('public.holdem_ring_table_compare_and_swap(text,bigint,jsonb,text,jsonb)',
       'jsonb_array_length(p_adjustments) > 6', 'jsonb_array_length(p_adjustments) > 8'),
      ('public.holdem_ring_table_v4_compare_and_swap(text,bigint,jsonb,text,jsonb,jsonb,jsonb)',
       'jsonb_array_length(p_hand_results) > 6', 'jsonb_array_length(p_hand_results) > 8')
    ) as changes(signature, old_check, new_check)
  loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(old_check in definition) > 0 then
      execute replace(definition, old_check, new_check);
    elsif position(new_check in definition) = 0 then
      raise exception 'Unexpected Holdem function definition: %', signature;
    end if;
  end loop;
end;
$$;

create or replace function public.holdem_today_net_by_nickname(
  p_nicknames text[],
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(totals.nickname, totals.net_amount), '{}'::jsonb)
  from (
    select result.nickname, sum(result.net_amount)::bigint as net_amount
    from public.holdem_hand_results as result
    where result.nickname = any(p_nicknames)
      and result.created_at >= p_start
      and result.created_at < p_end
    group by result.nickname
  ) as totals;
$$;

revoke all on function public.holdem_today_net_by_nickname(text[],timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.holdem_today_net_by_nickname(text[],timestamptz,timestamptz)
  to service_role;

-- One SQL snapshot includes both the wallet and every table holding. Profile
-- viewing does not create wallets and is unaffected by API row limits.
create or replace function public.holdem_profile_asset(p_nickname text)
returns jsonb
language sql
stable
set search_path = public
as $$
  with table_holdings as (
    select coalesce(sum(
      (seat.value ->> 'stack')::bigint +
      case when table_row.state ->> 'phase' in ('preflop','flop','turn','river')
        then (seat.value ->> 'totalBet')::bigint else 0 end
    ), 0)::bigint as amount
    from public.holdem_tables as table_row
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(table_row.state -> 'seats') = 'array'
        then table_row.state -> 'seats' else '[]'::jsonb end
    ) as seat(value)
    where table_row.state #>> '{settings,mode}' = 'ring'
      and table_row.state #>> '{settings,assetBacked}' = 'true'
      and seat.value ->> 'nick' = p_nickname
      and coalesce(seat.value ->> 'isBot', 'false') <> 'true'
  )
  select jsonb_build_object(
    'nickname', account.nickname,
    'totalAssets', coalesce(wallet.balance, 100000) + table_holdings.amount
  )
  from public.accounts as account
  left join public.holdem_wallets as wallet on wallet.nickname = account.nickname
  cross join table_holdings
  where account.nickname = p_nickname;
$$;

revoke all on function public.holdem_profile_asset(text)
  from public, anon, authenticated;
grant execute on function public.holdem_profile_asset(text)
  to service_role;

commit;
