/*
 * RLS check for band public pages, run as the authenticator by tests/db/run.sh
 * after public-band-seed.sql. The bands table stays member-scoped; outsiders and
 * signed-out visitors read a band only through the public_band* functions, and
 * those return only what the owner turned on.
 */
\set ON_ERROR_STOP 1

create function pg_temp.as_user(session_name text) returns void language sql as $$
  select set_config('role', 'giglist_visitor', true),
         set_config('my.session_id', session_name::text, true);
$$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', what; end if;
  raise notice 'pass: %', what;
end $$;

create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin
  execute statement;
  return false;
exception when others then
  return true;
end $$;

begin;
select pg_temp.as_user('');
select pg_temp.check(not exists (select 1 from app_public.bands), 'a signed-out visitor reads no band rows');
select pg_temp.check((select name from app_public.public_band('test-rls-band')) = 'Test RLS Band', 'a signed-out visitor reads the band through public_band');
select pg_temp.check(not exists (select 1 from app_public.public_band('no-such-band')), 'an unknown slug gives no row');
select pg_temp.check(not exists (select 1 from app_public.public_band_members('test-rls-band')), 'hidden members stay hidden');
select pg_temp.check((select array_agg(title) from app_public.public_band_songs('test-rls-band')) = array['Amazing Grace'], 'shown songs list titles');
select pg_temp.check((select array_agg(venue) from app_public.public_band_gig_dates('test-rls-band')) = array['Next Week'], 'gig dates list only upcoming gigs');
rollback;

begin;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.check(not exists (select 1 from app_public.bands where slug = 'test-rls-band'), 'an outsider does not read another band''s row');
with changed as (
  update app_public.bands set page_theme = '<h1>{BandName}</h1>' where slug = 'test-rls-band' returning 1
)
select pg_temp.check((select count(*) from changed) = 0, 'an outsider cannot restyle another band''s page');
rollback;

begin;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.check(exists (select 1 from app_public.bands where slug = 'test-rls-band'), 'a member reads the band row');
with changed as (
  update app_public.bands
  set page_theme = '<h1>{BandName}</h1>', page_options = '{"color:Accent": "#ff0000"}'
  where slug = 'test-rls-band' returning 1
)
select pg_temp.check((select count(*) from changed) = 1, 'the owner restyles the page');
select pg_temp.check(
  (select page_theme = '<h1>{BandName}</h1>' and page_options ->> 'color:Accent' = '#ff0000'
   from app_public.public_band('test-rls-band')),
  'public_band returns the theme and its options');
select pg_temp.check(pg_temp.rejects($$update app_public.bands set page_options = '["#ff0000"]' where slug = 'test-rls-band'$$), 'options must be an object');
select pg_temp.check(pg_temp.rejects($$update app_public.bands set page_theme = repeat('x', 200001) where slug = 'test-rls-band'$$), 'a theme has a size limit');
update app_public.bands set is_public = false where slug = 'test-rls-band';
select pg_temp.check(not exists (select 1 from app_public.public_band('test-rls-band')), 'a band with its page off has no public page');
select pg_temp.check(not exists (select 1 from app_public.public_band_songs('test-rls-band')), 'a band with its page off shows no lists, whatever their own switches say');
rollback;
