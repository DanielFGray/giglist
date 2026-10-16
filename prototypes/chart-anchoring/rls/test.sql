/*
 * PROTOTYPE RLS check for rls/charts.sql, run as the authenticator by
 * rls/run.sh after seed.sql. Users: ana and ben are in the band; cy is not.
 * Every assertion raises on failure; psql stops at the first one.
 */
\set ON_ERROR_STOP 1

create temporary table ids (name text primary key, id uuid);
grant select on ids to public;
insert into ids values
  ('ana', '00000000-0000-0000-0000-0000000000a1'), ('ana_session', '00000000-0000-0000-0000-0000000000a2'),
  ('ben', '00000000-0000-0000-0000-0000000000b1'), ('ben_session', '00000000-0000-0000-0000-0000000000b2'),
  ('cy', '00000000-0000-0000-0000-0000000000c1'), ('cy_session', '00000000-0000-0000-0000-0000000000c2'),
  ('revision', '00000000-0000-0000-0000-0000000000f2');

create function pg_temp.as_user(session_name text) returns void language sql as $$
  select set_config('role', 'setlist_visitor', true),
         set_config('my.session_id', (select id::text from ids where name = session_name), true);
$$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', what; end if;
  raise notice 'pass: %', what;
end $$;

-- ben (bandmate) sees the chart and its revision, ana's shared mark, not her private one.
begin;
select pg_temp.as_user('ben_session');
select pg_temp.check((select count(*) from app_public.charts) = 1, 'bandmate sees the band''s chart');
select pg_temp.check((select count(*) from app_public.chart_revisions) = 1, 'bandmate sees its revision');
select pg_temp.check((select count(*) from app_public.marks) = 1, 'bandmate sees only the shared mark');
select pg_temp.check((select visibility from app_public.marks) = 'band', 'the visible mark is the shared one');
select pg_temp.check((select count(*) from app_public.stamps) = 0, 'bandmate sees none of ana''s stamps');
with changed as (update app_public.marks set dx = 99 returning 1)
select pg_temp.check((select count(*) from changed) = 0, 'bandmate cannot move ana''s shared mark');
with gone as (delete from app_public.marks returning 1)
select pg_temp.check((select count(*) from gone) = 0, 'bandmate cannot delete ana''s marks');
rollback;

-- A mark ben creates is ben's: user_id is not grantable, so its default applies.
begin;
select pg_temp.as_user('ben_session');
with made as (
  insert into app_public.marks (revision_id, scope, range_start, range_end, side, dx, dy, scale, body)
  values ((select id from ids where name = 'revision'), '{"kind":"chart"}', 0, 3, 'inline', 0, 0, 1, '{"kind":"text","text":"x"}')
  returning user_id
)
select pg_temp.check((select user_id from made) = (select id from ids where name = 'ben'), 'a new mark is owned by its author');
rollback;

begin;
select pg_temp.as_user('ben_session');
do $$
begin
  begin
    update app_public.marks set user_id = user_id;
    raise exception 'FAIL: user_id was updatable';
  exception when insufficient_privilege then
    perform pg_temp.check(true, 'mark owner cannot be changed');
  end;
end $$;
rollback;

-- Revisions are immutable for everyone.
begin;
select pg_temp.as_user('ana_session');
do $$
begin
  begin
    update app_public.chart_revisions set source = 'rewritten';
    raise exception 'FAIL: revision was updatable';
  exception when insufficient_privilege then
    perform pg_temp.check(true, 'revisions cannot be updated');
  end;
end $$;
rollback;

-- ana sees both her marks and her stamp, and can move her own mark.
begin;
select pg_temp.as_user('ana_session');
select pg_temp.check((select count(*) from app_public.marks) = 2, 'author sees her private and shared marks');
select pg_temp.check((select count(*) from app_public.stamps) = 1, 'author sees her stamp');
with changed as (update app_public.marks set dx = 2 where visibility = 'private' returning 1)
select pg_temp.check((select count(*) from changed) = 1, 'author can move her mark');
rollback;

-- cy (not in the band) sees nothing, and cannot mark the band's chart.
begin;
select pg_temp.as_user('cy_session');
select pg_temp.check((select count(*) from app_public.charts) = 0, 'outsider sees no charts');
select pg_temp.check((select count(*) from app_public.chart_revisions) = 0, 'outsider sees no revisions');
select pg_temp.check((select count(*) from app_public.marks) = 0, 'outsider sees no marks, shared or not');
do $$
begin
  begin
    insert into app_public.marks (revision_id, scope, range_start, range_end, side, dx, dy, scale, body)
    values ((select id from ids where name = 'revision'), '{"kind":"chart"}', 0, 3, 'inline', 0, 0, 1, '{"kind":"text","text":"x"}');
    raise exception 'FAIL: outsider marked the band''s chart';
  exception when insufficient_privilege then
    perform pg_temp.check(true, 'outsider cannot mark the band''s chart');
  end;
end $$;
rollback;
