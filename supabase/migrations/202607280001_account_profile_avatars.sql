alter table public.accounts
  add column if not exists profile_avatar text;

comment on column public.accounts.profile_avatar is
  'Small resized profile avatar data URL shared across devices for the same account.';
