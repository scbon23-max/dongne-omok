begin;

-- 최다 득표자가 여러 명이면 서버가 그 동점자 중 한 명을 무작위로 선정한다.
-- 경기별 advisory lock과 catchmind_mvp_results 저장은 기존대로 유지해
-- 최초 확정 뒤에는 재조회하거나 동시에 요청해도 당선자가 바뀌지 않는다.
create or replace function public.finalize_catchmind_mvp(
  p_match_id text,
  p_requester text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participants integer;
  v_expected integer;
  v_vote_count integer;
  v_started_at timestamptz;
  v_deadline timestamptz;
  v_winner text;
  v_winner_votes integer;
  v_before bigint;
  v_after bigint;
  v_applied integer;
  v_existing_bonus integer;
  v_existing_applied integer;
begin
  if p_match_id is null
    or p_match_id !~ '^[A-Za-z0-9_-]{1,80}$'
    or p_requester is null
    or char_length(p_requester) not between 1 and 40
  then
    raise exception using errcode = '22023', message = 'invalid_catchmind_mvp_result';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('catchmind-mvp:' || p_match_id, 0));

  if not exists (
    select 1
    from public.catchmind_xp_events
    where match_id = p_match_id and nickname = p_requester
  ) then
    raise exception using errcode = '22023', message = 'mvp_result_requires_match_participant';
  end if;

  select winner_nickname, vote_count, bonus_xp, applied_xp
  into v_winner, v_winner_votes, v_existing_bonus, v_existing_applied
  from public.catchmind_mvp_results
  where match_id = p_match_id;

  if found then
    return jsonb_build_object(
      'ok', true,
      'status', 'finalized',
      'winner', v_winner,
      'votes', v_winner_votes,
      'bonusXp', v_existing_bonus,
      'appliedXp', v_existing_applied
    );
  end if;

  select
    count(*)::integer,
    min(created_at),
    least(
      8,
      greatest(
        count(*)::integer,
        coalesce(max(
          case
            when context->>'humanPlayers' ~ '^[0-9]+$'
              then (context->>'humanPlayers')::integer
            else null
          end
        ), count(*)::integer)
      )
    )
  into v_participants, v_started_at, v_expected
  from public.catchmind_xp_events
  where match_id = p_match_id;

  if v_participants < 2 or v_started_at is null then
    raise exception using errcode = '22023', message = 'mvp_result_requires_two_participants';
  end if;

  v_deadline := v_started_at + interval '15 seconds';

  select count(*)::integer
  into v_vote_count
  from public.catchmind_mvp_votes
  where match_id = p_match_id;

  if v_vote_count < v_expected and clock_timestamp() < v_deadline then
    return jsonb_build_object(
      'ok', true,
      'status', 'pending',
      'votes', v_vote_count,
      'expected', v_expected,
      'remainingMs', greatest(
        0,
        floor(extract(epoch from (v_deadline - clock_timestamp())) * 1000)::integer
      )
    );
  end if;

  if v_vote_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'status', 'no_votes',
      'bonusXp', 0,
      'appliedXp', 0
    );
  end if;

  with vote_totals as (
    select nominee_nickname, count(*)::integer as vote_count
    from public.catchmind_mvp_votes
    where match_id = p_match_id
    group by nominee_nickname
  ),
  leaders as (
    select nominee_nickname, vote_count
    from vote_totals
    where vote_count = (select max(vote_count) from vote_totals)
  )
  select nominee_nickname, vote_count
  into v_winner, v_winner_votes
  from leaders
  order by random()
  limit 1;

  select total_xp
  into v_before
  from public.catchmind_profiles
  where nickname = v_winner
  for update;

  v_after := least(883080, v_before + 15);
  v_applied := (v_after - v_before)::integer;

  update public.catchmind_profiles
  set total_xp = v_after,
      updated_at = now()
  where nickname = v_winner;

  update public.catchmind_xp_events
  set xp = xp + 15,
      applied_xp = applied_xp + v_applied,
      breakdown = jsonb_set(
        coalesce(breakdown, '{}'::jsonb),
        '{xp,mvp}',
        to_jsonb(15),
        true
      )
  where match_id = p_match_id and nickname = v_winner;

  insert into public.catchmind_mvp_results (
    match_id,
    winner_nickname,
    vote_count,
    bonus_xp,
    applied_xp
  )
  values (p_match_id, v_winner, v_winner_votes, 15, v_applied);

  insert into public.catchmind_unlocks (nickname, reward_id)
  select v_winner, reward.reward_id
  from public.catchmind_reward_catalog reward
  where reward.active
    and reward.unlock_level <= public.catchmind_level_for_xp(v_after)
  on conflict (nickname, reward_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'status', 'finalized',
    'winner', v_winner,
    'votes', v_winner_votes,
    'bonusXp', 15,
    'appliedXp', v_applied
  );
end;
$$;

commit;
