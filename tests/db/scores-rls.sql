/*
 * RLS and integrity checks for migrations/current/0240-scores.sql, run as the
 * authenticator by tests/db/run.sh after scores-seed.sql. sam is in the band;
 * oz is not. Every assertion raises on failure; psql stops at the first one.
 */
\set ON_ERROR_STOP 1

create temporary table ids (name text primary key, id uuid);
grant select on ids to public;
insert into ids values
  ('sam_session', '00000000-0000-0000-0000-000000000521'),
  ('oz_session', '00000000-0000-0000-0000-000000000522'),
  ('song', '00000000-0000-0000-0000-000000000541'),
  ('lyrics_revision', '00000000-0000-0000-0000-000000000504'),
  ('score_chart', '00000000-0000-0000-0000-000000000501'),
  ('score_revision', '00000000-0000-0000-0000-000000000502');

create function pg_temp.as_user(session_name text) returns void language sql as $$
  select set_config('role', current_setting('test.visitor'), true),
         set_config('my.session_id', (select id::text from ids where name = session_name), true);
$$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', what; end if;
  raise notice 'pass: %', what;
end $$;

-- A band member reads the score's file, byte for byte.
begin;
select pg_temp.as_user('sam_session');
select pg_temp.check((select count(*) from app_public.score_files) = 1, 'a band member sees the score''s file');
select pg_temp.check((select bytes from app_public.score_files) = 'abc'::bytea, 'the file is stored unchanged');
rollback;

-- An outsider sees neither the file nor the score, and cannot attach a file to the band's revision.
begin;
select pg_temp.as_user('oz_session');
select pg_temp.check((select count(*) from app_public.score_files) = 0, 'outsider sees no score files');
select pg_temp.check((select count(*) from app_public.charts where kind = 'score') = 0, 'outsider sees no score charts');
do $$
begin
  begin
    insert into app_public.score_files (revision_id, bytes)
    values ((select id from ids where name = 'score_revision'), 'abc'::bytea);
    raise exception 'FAIL: outsider inserted a file';
  exception when insufficient_privilege or check_violation then
    perform pg_temp.check(true, 'outsider cannot insert a file for the band''s revision');
  end;
end $$;
rollback;

-- Stored files are immutable for everyone.
begin;
select pg_temp.as_user('sam_session');
do $$
begin
  begin
    update app_public.score_files set bytes = 'xyz'::bytea;
    raise exception 'FAIL: a file was updatable';
  exception when insufficient_privilege then
    perform pg_temp.check(true, 'score files cannot be updated');
  end;
  begin
    delete from app_public.score_files;
    raise exception 'FAIL: a file was deletable';
  exception when insufficient_privilege then
    perform pg_temp.check(true, 'score files cannot be deleted directly');
  end;
end $$;
rollback;

-- Deleting the chart removes its revisions and their files.
begin;
select pg_temp.as_user('sam_session');
delete from app_public.charts where id = (select id from ids where name = 'score_chart');
select pg_temp.check((select count(*) from app_public.score_files) = 0, 'deleting a score chart deletes its file');
rollback;

-- A band member uploads a score: chart, revision and file in one transaction.
begin;
select pg_temp.as_user('sam_session');
do $$
declare
  chart uuid;
  revision uuid;
begin
  insert into app_public.charts (song_id, kind, name) values ((select id from ids where name = 'song'), 'score', 'Bass')
  returning id into chart;
  insert into app_public.chart_revisions (chart_id, file_key, file_sha256) values (chart, 'bass.gp5', sha256('bytes'::bytea))
  returning id into revision;
  insert into app_public.score_files (revision_id, bytes) values (revision, 'bytes'::bytea);
  set constraints all immediate;
  perform pg_temp.check(true, 'a band member can add a score with its file');
end $$;
rollback;

-- The bytes must hash to the revision's sha256.
begin;
select pg_temp.as_user('sam_session');
do $$
declare
  chart uuid;
  revision uuid;
begin
  insert into app_public.charts (song_id, kind, name) values ((select id from ids where name = 'song'), 'score', 'Bass')
  returning id into chart;
  insert into app_public.chart_revisions (chart_id, file_key, file_sha256) values (chart, 'bass.gp5', sha256('bytes'::bytea))
  returning id into revision;
  begin
    insert into app_public.score_files (revision_id, bytes) values (revision, 'other bytes'::bytea);
    raise exception 'FAIL: a file with the wrong hash was stored';
  exception when check_violation then
    perform pg_temp.check(true, 'a file must match the revision''s sha256');
  end;
end $$;
rollback;

-- A file revision needs its bytes before the transaction commits.
begin;
select pg_temp.as_user('sam_session');
do $$
declare
  chart uuid;
begin
  insert into app_public.charts (song_id, kind, name) values ((select id from ids where name = 'song'), 'score', 'Bass')
  returning id into chart;
  insert into app_public.chart_revisions (chart_id, file_key, file_sha256) values (chart, 'bass.gp5', sha256('bytes'::bytea));
  begin
    set constraints all immediate;
    raise exception 'FAIL: a file revision committed without bytes';
  exception when check_violation then
    perform pg_temp.check(true, 'a file revision needs its bytes');
  end;
end $$;
rollback;

-- A revision cannot take a file twice, and a lyrics revision has no file to attach.
begin;
select pg_temp.as_user('sam_session');
do $$
begin
  begin
    insert into app_public.score_files (revision_id, bytes)
    values ((select id from ids where name = 'score_revision'), 'abc'::bytea);
    raise exception 'FAIL: a revision took a second file';
  exception when unique_violation then
    perform pg_temp.check(true, 'a revision takes one file');
  end;
  begin
    insert into app_public.score_files (revision_id, bytes)
    values ((select id from ids where name = 'lyrics_revision'), 'abc'::bytea);
    raise exception 'FAIL: a lyrics revision took a file';
  exception when check_violation then
    perform pg_temp.check(true, 'a lyrics revision cannot take a file');
  end;
end $$;
rollback;
