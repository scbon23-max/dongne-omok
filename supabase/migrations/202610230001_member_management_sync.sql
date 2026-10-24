begin;

alter table public.accounts add column if not exists member_departed boolean not null default false;

create table if not exists public.member_management_bindings (
  source text not null,
  member_id text not null,
  nickname text not null,
  status text not null check (status in ('active', 'departed')),
  updated_at timestamptz not null default now(),
  primary key (source, member_id),
  unique (source, nickname)
);
create table if not exists public.member_management_sync_state (
  source text primary key,
  revision bigint not null,
  payload jsonb not null,
  receipt jsonb not null
);
alter table public.member_management_bindings enable row level security;
alter table public.member_management_sync_state enable row level security;
revoke all on public.member_management_bindings, public.member_management_sync_state from public, anon, authenticated;

create or replace function public.sync_member_management(p_source text, p_revision bigint, p_members jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  entry jsonb;
  bound public.member_management_bindings%rowtype;
  prior public.member_management_sync_state%rowtype;
  account_admin boolean;
  affected integer;
  created integer := 0;
  activated integer := 0;
  departed integer := 0;
  protected integer := 0;
  receipt jsonb;
begin
  if p_source is distinct from '13LPdYRKTdwX0sxRAHCJh6Y3Gc7slG2DKi6SHuz6sxlc'
    or p_revision is null or p_revision < (extract(epoch from clock_timestamp())*1000)::bigint-900000
    or p_revision > (extract(epoch from clock_timestamp())*1000)::bigint+60000 then
    raise exception 'invalid_source_or_revision';
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' then raise exception 'invalid_roster'; end if;
  if jsonb_array_length(p_members) not between 1 and 2000 then raise exception 'invalid_roster_size'; end if;
  if exists (select 1 from jsonb_array_elements(p_members) e where
    jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'member_id') is distinct from 'string'
    or jsonb_typeof(e->'nickname') is distinct from 'string' or jsonb_typeof(e->'status') is distinct from 'string'
    or length(btrim(e->>'member_id')) not between 1 and 100
    or length(btrim(e->>'nickname')) not between 1 and 40
    or e->>'nickname' <> btrim(e->>'nickname') or e->>'nickname' ~ '[[:cntrl:]/]'
    or e->>'nickname' = '동운이' or e->>'status' not in ('active','departed','review')) then
    raise exception 'invalid_member';
  end if;
  if (select count(distinct e->>'member_id') <> count(*) or count(distinct lower(regexp_replace(e->>'nickname','\s','','g'))) <> count(*) from jsonb_array_elements(p_members) e) then
    raise exception 'duplicate_member';
  end if;
  -- One transaction serializes checkpoints and all account/allowlist changes.
  perform pg_advisory_xact_lock(hashtextextended(p_source, 0));
  select * into prior from public.member_management_sync_state where source=p_source;
  if found then
    if prior.revision>p_revision then raise exception 'stale_revision'; end if;
    if prior.revision=p_revision then
      if prior.payload is distinct from p_members then raise exception 'revision_conflict'; end if;
      return prior.receipt;
    end if;
  end if;
  for entry in select value from jsonb_array_elements(p_members) loop
    if entry->>'status'='review' then continue; end if;
    select * into bound from public.member_management_bindings where source=p_source and member_id=entry->>'member_id';
    if found and bound.nickname<>entry->>'nickname' then raise exception 'nickname_change_requires_review'; end if;
    if exists(select 1 from public.member_management_bindings where source=p_source and nickname=entry->>'nickname' and member_id<>entry->>'member_id') then
      raise exception 'nickname_identity_conflict';
    end if;
    select is_admin into account_admin from public.accounts where nickname=entry->>'nickname' for update;
    if entry->>'nickname'='구나' or coalesce(account_admin,false) then
      protected:=protected+1;
      continue;
    end if;
    if entry->>'status'='active' then
      insert into public.accounts(nickname,pw_hash,is_admin) values(entry->>'nickname',null,false) on conflict(nickname) do nothing;
      get diagnostics affected = row_count;
      created:=created+affected;
      update public.accounts set member_departed=false where nickname=entry->>'nickname' and member_departed=true and not coalesce(is_admin,false);
      get diagnostics affected = row_count;
      activated:=activated+affected;
      insert into public.allowlist(nickname) values(entry->>'nickname') on conflict(nickname) do nothing;
    else
      delete from public.allowlist where nickname=entry->>'nickname';
      update public.accounts set member_departed=true where nickname=entry->>'nickname' and member_departed=false and not coalesce(is_admin,false);
      get diagnostics affected = row_count;
      departed:=departed+affected;
    end if;
    insert into public.member_management_bindings(source,member_id,nickname,status)
      values(p_source,entry->>'member_id',entry->>'nickname',entry->>'status')
      on conflict(source,member_id) do update set status=excluded.status,updated_at=now()
      where member_management_bindings.status is distinct from excluded.status;
  end loop;
  receipt:=jsonb_build_object('ok',true,'version',1,'source',p_source,'revision',p_revision,
    'processed',jsonb_array_length(p_members),'created',created,'activated',activated,'departed',departed,'protected',protected);
  insert into public.member_management_sync_state(source,revision,payload,receipt) values(p_source,p_revision,p_members,receipt)
    on conflict(source) do update set revision=excluded.revision,payload=excluded.payload,receipt=excluded.receipt;
  return receipt;
end;
$$;
revoke all on function public.sync_member_management(text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.sync_member_management(text,bigint,jsonb) to service_role;

commit;
