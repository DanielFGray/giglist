/*
 * RLS check for app_public.setlist_entries_resolved, run as the authenticator by
 * tests/db/run.sh after setlists-seed.sql. The view must apply the caller's policies
 * on songs, so a song from another band never reaches a reader through it.
 */
\set ON_ERROR_STOP 1

create function pg_temp.as_user(session_name text) returns void language sql as $$
  select set_config('role', current_setting('test.visitor'), true),
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
select pg_temp.check((select count(*) from app_public.gig_setlists) = 1, 'a bandmate reads which setlists the band''s gig plays');
create temp table mixed_keys (position_key text collate "C");
insert into mixed_keys values ('aB'), ('Ab');
select pg_temp.check((select string_agg(position_key, ',' order by position_key) from mixed_keys) = 'Ab,aB', 'mixed-case position keys use JavaScript string order');
rollback;

begin;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.check((select count(*) from app_public.setlist_entries_resolved) = 0, 'an outsider reads no entries');
rollback;

begin;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.check((select count(*) from app_public.gigs) = 0 and (select count(*) from app_public.gig_setlists) = 0, 'an outsider reads no gigs and no gig setlists');
rollback;

-- A gig plays only its own band's setlists: the composite foreign key refuses another band's.
begin;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$
begin
  insert into app_public.gig_setlists (band_id, gig_id, setlist_id, position_key) values
    ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000052', 'V');
  raise exception 'FAIL: a gig played another band''s setlist';
exception when foreign_key_violation then
  raise notice 'pass: a gig cannot play another band''s setlist';
end $$;
rollback;

-- A gig that swaps in another setlist (its own copy) is held to the same key.
begin;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$
begin
  update app_public.gig_setlists set setlist_id = '00000000-0000-0000-0000-000000000052'
    where gig_id = '00000000-0000-0000-0000-000000000061';
  raise exception 'FAIL: a gig swapped in another band''s setlist';
exception when foreign_key_violation then
  raise notice 'pass: a gig cannot swap in another band''s setlist';
end $$;
rollback;
