--! Previous: sha1:a74fdf8bdd8c08e9cf8069affcad2103eb43360c
--! Hash: sha1:72347be6563c4455c23b4c2a0bd9a16f71559ee7
--! Message: release 2

--! split: 1-current.sql
-- A wrong code raises its own error code, so the accept page can say the code
-- is wrong instead of telling the reader the invitation is not for them.
create or replace function app_public.band_for_invitation(invitation_id uuid, code text = null)
  returns app_public.bands as $$
declare
  v_invitation app_public.band_invitations;
  v_band app_public.bands;
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to accept an invitation' using errcode = 'LOGIN';
  end if;

  select * into v_invitation from app_public.band_invitations where id = invitation_id;

  if v_invitation is null then
    raise exception 'We could not find that invitation' using errcode = 'NTFND';
  end if;

  if v_invitation.user_id is not null then
    if v_invitation.user_id is distinct from app_public.current_user_id() then
      raise exception 'That invitation is not for you' using errcode = 'DNIED';
    end if;
  else
    if v_invitation.code is distinct from code then
      raise exception 'Incorrect invitation code' using errcode = 'INCOD';
    end if;
  end if;

  select * into v_band from app_public.bands where id = v_invitation.band_id;

  return v_band;
end;
$$ language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp;

-- The owner reads pending invitations without the secret code. Non-owners get
-- DNIED so a member cannot fish for emailed invite codes through this list.
-- create or replace cannot change a return type, so drop first.
drop function if exists app_public.band_pending_invitations(uuid);
create function app_public.band_pending_invitations(band_id uuid)
  returns table (id uuid, username app_public.username, email citext) as $$
begin
  if not exists(
    select 1 from app_public.band_memberships
      where band_memberships.band_id = band_pending_invitations.band_id
      and band_memberships.user_id = app_public.current_user_id()
      and is_owner is true
  ) then
    raise exception 'You''re not the owner of this band' using errcode = 'DNIED';
  end if;

  return query
    select invitation.id, u.username, invitation.email
    from app_public.band_invitations as invitation
    left join app_public.users as u on u.id = invitation.user_id
    where invitation.band_id = band_pending_invitations.band_id
    order by invitation.email nulls last, u.username;
end;
$$ language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp;

-- Cancel deletes the row. No email is sent and nothing is re-sent. The owner
-- check runs before the lookup, so a non-owner gets DNIED for every id and
-- cannot tell which invitations exist. A new argument list makes a new function,
-- so drop the one-argument form first.
drop function if exists app_public.cancel_invitation(uuid);
create or replace function app_public.cancel_invitation(band_id uuid, invitation_id uuid)
  returns void as $$
begin
  if not exists(
    select 1 from app_public.band_memberships
      where band_memberships.band_id = cancel_invitation.band_id
      and band_memberships.user_id = app_public.current_user_id()
      and is_owner is true
  ) then
    raise exception 'You''re not the owner of this band' using errcode = 'DNIED';
  end if;

  delete from app_public.band_invitations
    where band_invitations.id = cancel_invitation.invitation_id
    and band_invitations.band_id = cancel_invitation.band_id;

  if not found then
    raise exception 'We could not find that invitation' using errcode = 'NTFND';
  end if;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

-- Refusals raise DNIED rather than returning silently, so the caller can report
-- them. Leave also calls this with the caller's own id: a non-owner may delete
-- their own row, and an owner must transfer ownership before leaving.
create or replace function app_public.remove_from_band(band_id uuid, user_id uuid)
  returns void as $$
declare
  v_my_membership app_public.band_memberships;
begin
  select * into v_my_membership
    from app_public.band_memberships
    where band_memberships.band_id = remove_from_band.band_id
    and band_memberships.user_id = app_public.current_user_id();

  if v_my_membership is null then
    raise exception 'You cannot remove that member' using errcode = 'DNIED';
  elsif v_my_membership.is_owner then
    if remove_from_band.user_id = app_public.current_user_id() then
      raise exception 'You cannot remove that member' using errcode = 'DNIED';
    end if;
  elsif remove_from_band.user_id <> app_public.current_user_id() then
    raise exception 'You cannot remove that member' using errcode = 'DNIED';
  end if;

  delete from app_public.band_memberships
    where band_memberships.band_id = remove_from_band.band_id
    and band_memberships.user_id = remove_from_band.user_id;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

-- Returns the band's id so the accept page can open the band. Changing a return
-- type needs the drop first.
drop function if exists app_public.accept_invitation_to_band(uuid, text);
create function app_public.accept_invitation_to_band(invitation_id uuid, code text = null)
  returns uuid as $$
declare
  v_band app_public.bands;
begin
  v_band = app_public.band_for_invitation(invitation_id, code);

  -- Accept the user into the band
  insert into app_public.band_memberships (band_id, user_id)
    values(v_band.id, app_public.current_user_id())
    on conflict do nothing;

  -- Delete the invitation
  delete from app_public.band_invitations where id = invitation_id;

  return v_band.id;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

--! split: 2-null-safe-auth.sql
-- Reject when a stored secret is NULL or does not match. The previous
-- `stored != input` form skipped the reject branch when stored was NULL
-- (IF NULL is false in PL/pgSQL), so login, reset_password and
-- change_password accepted any input for users with no hash / no token.
-- reset_password also refuses a token older than v_token_max_duration; before,
-- an emailed reset token stayed valid until it was used.

create or replace function app_private.login(username citext, password text) returns app_private.sessions as $$
declare
  v_user app_public.users;
  v_user_secret app_private.user_secrets;
  v_login_attempt_window_duration interval = interval '5 minutes';
  v_session app_private.sessions;
begin
  if username like '%@%' then
    -- It's an email
    select users.* into v_user
    from app_public.users
    inner join app_public.user_emails
    on (user_emails.user_id = users.id)
    where user_emails.email = login.username
    order by
      user_emails.is_verified desc, -- Prefer verified email
      user_emails.created_at asc -- Failing that, prefer the first registered (unverified users _should_ verify before logging in)
    limit 1;
  else
    -- It's a username
    select users.* into v_user
    from app_public.users
    where users.username = login.username;
  end if;

  if v_user is null then
    -- No user with that email/username was found
    return null;
  end if;

  -- Load their secrets
  select * into v_user_secret from app_private.user_secrets
  where user_secrets.user_id = v_user.id;

  -- Have there been too many login attempts?
  if (
    v_user_secret.first_failed_password_attempt is not null
  and
    v_user_secret.first_failed_password_attempt > NOW() - v_login_attempt_window_duration
  and
    v_user_secret.failed_password_attempts >= 3
  ) then
    raise exception 'User account locked - too many login attempts. Try again after 5 minutes.' using errcode = 'LOCKD';
  end if;

  -- Reject when there is no hash or the password does not match. A NULL hash
  -- must not fall through: in PL/pgSQL, IF NULL skips the branch.
  if v_user_secret.password_hash is null
  or v_user_secret.password_hash is distinct from crypt(password, v_user_secret.password_hash) then
    -- Wrong password, bump all the attempt tracking figures
    update app_private.user_secrets
    set
      failed_password_attempts = (case when first_failed_password_attempt is null or first_failed_password_attempt < now() - v_login_attempt_window_duration then 1 else failed_password_attempts + 1 end),
      first_failed_password_attempt = (case when first_failed_password_attempt is null or first_failed_password_attempt < now() - v_login_attempt_window_duration then now() else first_failed_password_attempt end)
    where user_id = v_user.id;
    return null; -- Must not throw otherwise transaction will be aborted and attempts won't be recorded
  end if;

  -- Excellent - they're logged in! Let's reset the attempt tracking
  update app_private.user_secrets
  set failed_password_attempts = 0, first_failed_password_attempt = null, last_login_at = now()
  where user_id = v_user.id;
  -- Create a session for the user
  insert into app_private.sessions (user_id) values (v_user.id) returning * into v_session;
  -- And finally return the session
  return v_session;
end;
$$ language plpgsql strict volatile;

create or replace function app_private.reset_password(user_id uuid, reset_token text, new_password text) returns app_private.sessions as $$
declare
  v_user app_public.users;
  v_user_secret app_private.user_secrets;
  v_token_max_duration interval = interval '3 days';
  v_session app_private.sessions;
begin
  select users.* into v_user
  from app_public.users
  where id = user_id;

  if v_user is null then
    return null;
  end if;

  -- Load their secrets
  select * into v_user_secret from app_private.user_secrets
  where user_secrets.user_id = v_user.id;

  -- Have there been too many reset attempts?
  if (
    v_user_secret.first_failed_reset_password_attempt is not null
  and
    v_user_secret.first_failed_reset_password_attempt > NOW() - v_token_max_duration
  and
    v_user_secret.failed_reset_password_attempts >= 20
  ) then
    raise exception 'Password reset locked - too many reset attempts' using errcode = 'LOCKD';
  end if;

  -- Reject when there is no pending token, the token does not match, or the
  -- token is older than its lifetime. The age test uses the same boundary as
  -- forgot_password, so a token is refused exactly when a new one would be
  -- issued. A NULL generated time rejects too.
  if v_user_secret.reset_password_token is null
  or v_user_secret.reset_password_token is distinct from reset_token
  or v_user_secret.reset_password_token_generated is null
  or v_user_secret.reset_password_token_generated < now() - v_token_max_duration then
    -- Wrong or expired token, bump all the attempt tracking figures
    update app_private.user_secrets
    set
      failed_reset_password_attempts = (case when first_failed_reset_password_attempt is null or first_failed_reset_password_attempt < now() - v_token_max_duration then 1 else failed_reset_password_attempts + 1 end),
      first_failed_reset_password_attempt = (case when first_failed_reset_password_attempt is null or first_failed_reset_password_attempt < now() - v_token_max_duration then now() else first_failed_reset_password_attempt end)
    where user_secrets.user_id = v_user.id;
    return null;
  end if;

  -- Excellent - they're legit
  -- perform app_private.assert_valid_password(new_password);

  -- Let's reset the password as requested
  update app_private.user_secrets
  set
    password_hash = crypt(new_password, gen_salt('bf')),
    failed_password_attempts = 0,
    first_failed_password_attempt = null,
    reset_password_token = null,
    reset_password_token_generated = null,
    failed_reset_password_attempts = 0,
    first_failed_reset_password_attempt = null
  where user_secrets.user_id = v_user.id;

  -- Revoke the users' sessions
  delete from app_private.sessions
  where sessions.user_id = v_user.id;

  -- Notify user their password was reset
  perform graphile_worker.add_job(
    'user__audit',
    json_build_object(
      'type', 'reset_password',
      'user_id', v_user.id,
      'current_user_id', app_public.current_user_id()
    ));

  -- Create a new session for the user
  insert into app_private.sessions (user_id) values (v_user.id) returning * into v_session;
  return v_session;
end;
$$ language plpgsql strict volatile;

create or replace function app_public.change_password(old_password text, new_password text) returns boolean as $$
declare
  v_user app_public.users;
  v_user_secret app_private.user_secrets;
begin
  select users.* into v_user
  from app_public.users
  where id = app_public.current_user_id();

  if v_user is null then
    raise exception 'You must log in to change your password' using errcode = 'LOGIN';
  end if;

  -- Load their secrets
  select * into v_user_secret from app_private.user_secrets
  where user_secrets.user_id = v_user.id;

  if v_user_secret.password_hash is null
  or v_user_secret.password_hash is distinct from crypt(old_password, v_user_secret.password_hash) then
    raise exception 'Incorrect password' using errcode = 'CREDS';
  end if;
  -- perform app_private.assert_valid_password(new_password);

  -- Reset the password as requested
  update app_private.user_secrets
  set
    password_hash = crypt(new_password, gen_salt('bf'))
  where user_secrets.user_id = v_user.id;

  -- Revoke all other sessions
  delete from app_private.sessions
  where sessions.user_id = v_user.id
  and sessions.uuid <> app_public.current_session_id();

  -- Notify user their password was changed
  perform graphile_worker.add_job(
    'user__audit',
    json_build_object(
      'type', 'change_password',
      'user_id', v_user.id,
      'current_user_id', app_public.current_user_id()
    ));

  return true;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;

--! split: 3-songs-created-by-default.sql
-- Production was built from an earlier draft of release 1, in which songs.created_by had no
-- default. Release 1 as committed has it, so on every other database this changes nothing.
alter table app_public.songs alter column created_by set default app_public.current_user_id();
