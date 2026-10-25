begin;

alter table public.accounts
  add column if not exists registration_completed boolean not null default false;

update public.accounts set registration_completed = true
where not registration_completed and nullif(btrim(pw_hash), '') is not null;

create or replace function public.mark_account_registration_completed()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    new.registration_completed := old.registration_completed
      or new.registration_completed or nullif(btrim(new.pw_hash), '') is not null;
  else
    new.registration_completed := new.registration_completed
      or nullif(btrim(new.pw_hash), '') is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_registration_completed on public.accounts;
create trigger accounts_registration_completed
before insert or update of pw_hash, registration_completed on public.accounts
for each row execute function public.mark_account_registration_completed();

notify pgrst, 'reload schema';

commit;
