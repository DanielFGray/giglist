/*
 * RLS check for app_public.setlist_entries_resolved, run as the authenticator by
 * tests/db/run.sh after setlists-seed.sql. The view must apply the caller's policies
 * on songs, so a song from another band never reaches a reader through it.
 */
\set ON_ERROR_STOP 1

create function pg_temp.as_user(session_name text) returns void language sql as $$
  select set_config('role', 'setlist_visitor', true),
         set_config('my.session_id', session_name::text, true);
$$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', what; end if;
  raise notice 'pass: %', what;
end $$;

begin;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from app_public.setlist_entries_resolved) = 1, 'a bandmate reads the entry for the band''s own song');
select pg_temp.check(not exists (select 1 from app_public.setlist_entries_resolved where title = 'Secret Song'), 'a song of another band does not come through the view');
create temp table mixed_keys (position_key text collate "C");
insert into mixed_keys values ('aB'), ('Ab');
select pg_temp.check((select string_agg(position_key, ',' order by position_key) from mixed_keys) = 'Ab,aB', 'mixed-case position keys use JavaScript string order');
rollback;

begin;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.check((select count(*) from app_public.setlist_entries_resolved) = 0, 'an outsider reads no entries');
rollback;
