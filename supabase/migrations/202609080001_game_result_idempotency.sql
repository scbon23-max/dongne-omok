alter table public.games add column if not exists result_id text;

create unique index if not exists games_result_id_unique
  on public.games (result_id);
