begin;

insert into public.catchmind_reward_catalog (
  reward_id,
  unlock_level,
  kind,
  name,
  asset_key,
  config,
  active
)
values
  (
    'frame-color-pencil',
    5,
    'board_frame',
    '색연필',
    'assets/catchmind/board-frames/frame-color-pencil-v2.png',
    '{"order":1,"tier":"low"}'::jsonb,
    true
  ),
  (
    'frame-galaxy-stars',
    10,
    'board_frame',
    '은하수',
    'assets/catchmind/board-frames/frame-galaxy-stars.png',
    '{"order":2,"tier":"low"}'::jsonb,
    true
  ),
  (
    'frame-retro-pixel',
    15,
    'board_frame',
    '레트로 픽셀',
    'assets/catchmind/board-frames/frame-retro-pixel.png',
    '{"order":3,"tier":"low"}'::jsonb,
    true
  ),
  (
    'frame-cherry-blossom',
    20,
    'board_frame',
    '벚꽃',
    'assets/catchmind/board-frames/frame-cherry-blossom.png',
    '{"order":4,"tier":"low"}'::jsonb,
    true
  ),
  (
    'frame-bamboo-garden',
    25,
    'board_frame',
    '대나무',
    'assets/catchmind/board-frames/frame-bamboo-garden.png',
    '{"order":5,"tier":"low"}'::jsonb,
    true
  ),
  (
    'frame-dancheong',
    30,
    'board_frame',
    '단청',
    'assets/catchmind/board-frames/frame-dancheong.png',
    '{"order":6,"tier":"low"}'::jsonb,
    true
  ),
  (
    'frame-ice-crystal',
    35,
    'board_frame',
    '얼음 결정',
    'assets/catchmind/board-frames/frame-ice-crystal.png',
    '{"order":7,"tier":"low"}'::jsonb,
    true
  ),
  (
    'frame-cookie-sprinkle',
    40,
    'board_frame',
    '쿠키 스프링클',
    'assets/catchmind/board-frames/frame-cookie-sprinkle.png',
    '{"order":8,"tier":"low"}'::jsonb,
    true
  ),
  (
    'frame-aurora-ribbon',
    50,
    'board_frame',
    '오로라 리본',
    'assets/catchmind/board-frames/frame-aurora-ribbon.png',
    '{"order":9,"tier":"high"}'::jsonb,
    true
  ),
  (
    'frame-prism-glass',
    55,
    'board_frame',
    '프리즘 글라스',
    'assets/catchmind/board-frames/frame-prism-glass.png',
    '{"order":10,"tier":"high"}'::jsonb,
    true
  ),
  (
    'frame-rainbow-hologram',
    60,
    'board_frame',
    '레인보우 홀로그램',
    'assets/catchmind/board-frames/frame-rainbow-hologram.png',
    '{"order":11,"tier":"high"}'::jsonb,
    true
  ),
  (
    'frame-magic-palette',
    65,
    'board_frame',
    '마법 팔레트',
    'assets/catchmind/board-frames/frame-magic-palette.png',
    '{"order":12,"tier":"high"}'::jsonb,
    true
  ),
  (
    'frame-golden-doodle',
    70,
    'board_frame',
    '골든 두들',
    'assets/catchmind/board-frames/frame-golden-doodle.png',
    '{"order":13,"tier":"high"}'::jsonb,
    true
  ),
  (
    'frame-masterpiece',
    75,
    'board_frame',
    '명작의 순간',
    'assets/catchmind/board-frames/frame-masterpiece.png',
    '{"order":14,"tier":"high"}'::jsonb,
    true
  ),
  (
    'frame-starlight-cloud',
    80,
    'board_frame',
    '별빛 구름',
    'assets/catchmind/board-frames/frame-starlight-cloud.png',
    '{"order":15,"tier":"high"}'::jsonb,
    true
  ),
  (
    'frame-celebration-ribbon',
    85,
    'board_frame',
    '축제 리본',
    'assets/catchmind/board-frames/frame-celebration-ribbon.png',
    '{"order":16,"tier":"high"}'::jsonb,
    true
  ),
  (
    'frame-gem-candy',
    90,
    'board_frame',
    '캔디 보석',
    'assets/catchmind/board-frames/frame-gem-candy.png',
    '{"order":17,"tier":"high"}'::jsonb,
    true
  ),
  (
    'frame-pastel-carnival',
    100,
    'board_frame',
    '파스텔 카니발',
    'assets/catchmind/board-frames/frame-pastel-carnival.png',
    '{"order":18,"tier":"high"}'::jsonb,
    true
  )
on conflict (reward_id) do update set
  unlock_level = excluded.unlock_level,
  kind = excluded.kind,
  name = excluded.name,
  asset_key = excluded.asset_key,
  config = excluded.config,
  active = excluded.active;

insert into public.catchmind_unlocks as current_unlock (
  nickname,
  reward_id,
  unlocked_at
)
select
  legacy_unlock.nickname,
  case legacy_unlock.reward_id
    when 'frame-blue-pencil' then 'frame-color-pencil'
    when 'frame-master' then 'frame-masterpiece'
  end,
  legacy_unlock.unlocked_at
from public.catchmind_unlocks legacy_unlock
where legacy_unlock.reward_id in ('frame-blue-pencil', 'frame-master')
on conflict (nickname, reward_id) do update set
  unlocked_at = least(
    current_unlock.unlocked_at,
    excluded.unlocked_at
  );

update public.catchmind_profiles
set
  equipped_board_frame = case equipped_board_frame
    when 'frame-blue-pencil' then 'frame-color-pencil'
    when 'frame-master' then 'frame-masterpiece'
  end,
  updated_at = now()
where equipped_board_frame in ('frame-blue-pencil', 'frame-master');

delete from public.catchmind_reward_catalog
where reward_id in ('frame-blue-pencil', 'frame-master');

insert into public.catchmind_unlocks (
  nickname,
  reward_id
)
select
  profile.nickname,
  reward.reward_id
from public.catchmind_profiles profile
join public.catchmind_reward_catalog reward
  on reward.kind = 'board_frame'
  and reward.active
  and reward.unlock_level <= public.catchmind_level_for_xp(profile.total_xp)
where reward.reward_id = any (
  array[
    'frame-color-pencil',
    'frame-galaxy-stars',
    'frame-retro-pixel',
    'frame-cherry-blossom',
    'frame-bamboo-garden',
    'frame-dancheong',
    'frame-ice-crystal',
    'frame-cookie-sprinkle',
    'frame-aurora-ribbon',
    'frame-prism-glass',
    'frame-rainbow-hologram',
    'frame-magic-palette',
    'frame-golden-doodle',
    'frame-masterpiece',
    'frame-starlight-cloud',
    'frame-celebration-ribbon',
    'frame-gem-candy',
    'frame-pastel-carnival'
  ]::text[]
)
on conflict (nickname, reward_id) do nothing;

commit;
