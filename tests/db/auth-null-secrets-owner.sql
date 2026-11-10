/*
 * NULL-unsafe secret comparisons in login, reset_password and change_password:
 * a stored NULL must reject, and a matching secret must still succeed.
 * reset_password must also refuse a token older than its 3-day lifetime. Run as
 * the owner by tests/db/run.sh (app_private.login / reset_password are not
 * granted to the visitor). Uses fixtures from charts-seed.sql.
 */
\set ON_ERROR_STOP 1

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', what; end if;
  raise notice 'pass: %', what;
end $$;

-- Valid paths call graphile_worker.add_job; the scratch DB has no worker schema.
create schema if not exists graphile_worker;
create or replace function graphile_worker.add_job(identifier text, payload json default null)
  returns void language plpgsql as $$ begin end $$;

-- login: NULL password_hash must not authenticate
begin;
update app_private.user_secrets
  set password_hash = null, failed_password_attempts = 0, first_failed_password_attempt = null
  where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check(
  app_private.login('test_rls_ana', 'any-password-at-all') is null,
  'login rejects a user with a NULL password_hash'
);
rollback;

-- login: a correct hash still authenticates
begin;
update app_private.user_secrets
  set password_hash = crypt('correct-horse-battery', gen_salt('bf')),
      failed_password_attempts = 0, first_failed_password_attempt = null
  where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check(
  (app_private.login('test_rls_ana', 'correct-horse-battery')).user_id
    = '00000000-0000-0000-0000-0000000000a1',
  'login accepts a matching password'
);
select pg_temp.check(
  app_private.login('test_rls_ana', 'wrong-password') is null,
  'login rejects a wrong password'
);
rollback;

-- reset_password: no pending token must not reset
begin;
update app_private.user_secrets
  set reset_password_token = null,
      reset_password_token_generated = null,
      failed_reset_password_attempts = 0,
      first_failed_reset_password_attempt = null
  where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check(
  app_private.reset_password(
    '00000000-0000-0000-0000-0000000000a1',
    'any-token',
    'new-password-ok'
  ) is null,
  'reset_password rejects when no reset token is pending'
);
rollback;

-- reset_password: a matching token still resets
begin;
update app_private.user_secrets
  set reset_password_token = 'pending-reset-token',
      reset_password_token_generated = now(),
      failed_reset_password_attempts = 0,
      first_failed_reset_password_attempt = null
  where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check(
  (app_private.reset_password(
    '00000000-0000-0000-0000-0000000000a1',
    'pending-reset-token',
    'new-password-ok'
  )).user_id = '00000000-0000-0000-0000-0000000000a1',
  'reset_password accepts a matching token'
);
select pg_temp.check(
  (select password_hash is not null and reset_password_token is null
     from app_private.user_secrets
     where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'reset_password stores the new hash and clears the token'
);
rollback;

-- reset_password: a matching token past its 3-day lifetime must not reset
begin;
update app_private.user_secrets
  set password_hash = crypt('before-reset', gen_salt('bf')),
      reset_password_token = 'expired-reset-token',
      reset_password_token_generated = now() - interval '3 days 1 minute',
      failed_reset_password_attempts = 0,
      first_failed_reset_password_attempt = null
  where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check(
  app_private.reset_password(
    '00000000-0000-0000-0000-0000000000a1',
    'expired-reset-token',
    'new-password-ok'
  ) is null,
  'reset_password rejects an expired token'
);
select pg_temp.check(
  (select password_hash = crypt('before-reset', password_hash)
      and reset_password_token = 'expired-reset-token'
      and failed_reset_password_attempts = 1
     from app_private.user_secrets
     where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'an expired token leaves the password, keeps the token and counts a failed attempt'
);
rollback;

-- reset_password: a matching token with no generated time must not reset
begin;
update app_private.user_secrets
  set reset_password_token = 'undated-reset-token',
      reset_password_token_generated = null,
      failed_reset_password_attempts = 0,
      first_failed_reset_password_attempt = null
  where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check(
  app_private.reset_password(
    '00000000-0000-0000-0000-0000000000a1',
    'undated-reset-token',
    'new-password-ok'
  ) is null,
  'reset_password rejects a token with a NULL generated time'
);
rollback;

-- change_password: NULL password_hash must raise CREDS
begin;
update app_private.user_secrets
  set password_hash = null
  where user_id = '00000000-0000-0000-0000-0000000000a1';
select set_config('my.session_id', '00000000-0000-0000-0000-0000000000a2', true);
do $$
begin
  perform app_public.change_password('anything', 'new-password-ok');
  raise exception 'FAIL: change_password accepted a NULL password_hash';
exception when sqlstate 'CREDS' then
  perform pg_temp.check(true, 'change_password rejects a NULL password_hash');
end $$;
rollback;

-- change_password: the old password must still match
begin;
update app_private.user_secrets
  set password_hash = crypt('old-password-ok', gen_salt('bf'))
  where user_id = '00000000-0000-0000-0000-0000000000a1';
select set_config('my.session_id', '00000000-0000-0000-0000-0000000000a2', true);
select pg_temp.check(
  app_public.change_password('old-password-ok', 'new-password-ok') is true,
  'change_password accepts the correct old password'
);
do $$
begin
  perform app_public.change_password('wrong-old', 'another-password');
  raise exception 'FAIL: change_password accepted a wrong old password';
exception when sqlstate 'CREDS' then
  perform pg_temp.check(true, 'change_password rejects a wrong old password');
end $$;
rollback;
