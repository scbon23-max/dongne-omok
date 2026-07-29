create or replace function public.broadcast_holdem_table_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      't', 'holdem_refresh',
      'by', 'server',
      'version', new.version,
      'handId', coalesce(new.state ->> 'handNo', ''),
      'requestId', 'server:' || new.room_id || ':' || new.version::text,
      'reason', 'commit'
    ),
    'm',
    'room:' || new.room_id,
    false
  );
  return null;
end;
$$;

revoke all on function public.broadcast_holdem_table_refresh()
  from public, anon, authenticated;

drop trigger if exists holdem_table_refresh_broadcast
  on public.holdem_tables;

create trigger holdem_table_refresh_broadcast
after insert or update of state, version
on public.holdem_tables
for each row
execute function public.broadcast_holdem_table_refresh();
