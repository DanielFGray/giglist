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
