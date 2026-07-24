begin;

-- 그림판 배경 외 꾸미기는 현재 레벨 보상에서 완전히 제외한다.
-- 컬럼은 이전 클라이언트 호환을 위해 유지하되 장착값만 비운다.
update public.catchmind_profiles
set
  equipped_nameplate = null,
  equipped_stickers = '{}'::text[],
  equipped_text_emotes = '{}'::text[],
  updated_at = now()
where equipped_nameplate is not null
  or cardinality(equipped_stickers) > 0
  or cardinality(equipped_text_emotes) > 0;

-- catchmind_unlocks는 reward_id FK의 on delete cascade로 함께 정리된다.
delete from public.catchmind_reward_catalog
where kind <> 'board_frame';

commit;
