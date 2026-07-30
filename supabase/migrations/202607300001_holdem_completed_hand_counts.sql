create or replace function public.holdem_completed_hand_counts()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(counted.nickname, counted.hand_count),
    '{}'::jsonb
  )
  from (
    select result.nickname, count(*)::bigint as hand_count
    from public.holdem_hand_results as result
    where result.nickname is not null
    group by result.nickname
  ) as counted;
$$;

revoke all on function public.holdem_completed_hand_counts()
  from public, anon, authenticated;
grant execute on function public.holdem_completed_hand_counts()
  to service_role;
