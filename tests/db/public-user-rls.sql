/*
 * RLS check for public user profiles, run as the authenticator by
 * tests/db/run.sh after public-user-seed.sql. A signed-out visitor reads a
 * profile only through the public_user* functions, and those return only
 * what the user turned on.
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
select pg_temp.check((select bio from app_public.public_user('test_rls_ana')) = '**Drums** in the band.', 'a signed-out visitor reads the bio through public_user');
select pg_temp.check(not exists (select 1 from app_public.public_user('test_rls_ben')), 'a profile that is off gives no row');
select pg_temp.check(not exists (select 1 from app_public.public_user('no-such-user')), 'an unknown username gives no row');
select pg_temp.check((select array_agg(slug::text) from app_public.public_user_bands('test_rls_ana')) = array['test-rls-band'], 'bands list only bands whose page is on');
select pg_temp.check(not exists (select 1 from app_public.public_user_bands('test_rls_ben')), 'a profile that is off lists no bands');
rollback;

begin;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
with changed as (
  update app_public.users set is_public = true where username = 'test_rls_ben' returning 1
)
select pg_temp.check((select count(*) from changed) = 0, 'a signed-in user cannot publish someone else''s profile');
update app_public.users
  set page_theme = '<h1>{DisplayName}</h1>', page_options = '{"color:Accent": "#ff0000"}'
  where username = 'test_rls_ana';
select pg_temp.check(
  (select page_theme = '<h1>{DisplayName}</h1>' and page_options ->> 'color:Accent' = '#ff0000'
   from app_public.public_user('test_rls_ana')),
  'public_user returns the theme and its options');
select pg_temp.check(pg_temp.rejects($$update app_public.users set page_options = '["#ff0000"]' where username = 'test_rls_ana'$$), 'options must be an object');
select pg_temp.check(pg_temp.rejects($$update app_public.users set page_theme = repeat('x', 200001) where username = 'test_rls_ana'$$), 'a theme has a size limit');
select pg_temp.check(pg_temp.rejects($$update app_public.users set bio = repeat('x', 10001) where username = 'test_rls_ana'$$), 'a bio has a size limit');
update app_public.users set is_public = false where username = 'test_rls_ana';
select pg_temp.check(not exists (select 1 from app_public.public_user('test_rls_ana')), 'the user can turn their own profile off');
rollback;
