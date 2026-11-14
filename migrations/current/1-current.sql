-- An invitation belongs to the signed-in user when it names their account, or
-- when it was sent to one of their verified emails: verifying an address proves
-- the same ownership as holding the code mailed to it. So an email invitation
-- shows on the invitee's home page and is accepted there without its code, even
-- when the address was verified after the invitation was sent. An address the
-- user has not verified still needs the code.
create or replace function app_private.invitation_is_mine(invitation app_public.band_invitations)
  returns boolean as $$
  select coalesce(invitation.user_id = app_public.current_user_id(), false)
    or exists(
      select 1 from app_public.user_emails
      where user_emails.user_id = app_public.current_user_id()
        and user_emails.email = invitation.email
        and user_emails.is_verified
    );
$$ language sql stable set search_path = pg_catalog, public, pg_temp;

-- One row per band: a user invited to a band by username and by email sees one
-- "Join", and accepting or declining it answers both.
create or replace function app_public.my_band_invitations()
  returns table (id uuid, band_id uuid, band_name text) as $$
  select mine.id, mine.band_id, mine.band_name from (
    select distinct on (invitation.band_id) invitation.id, invitation.band_id, band.name as band_name
    from app_public.band_invitations as invitation
    join app_public.bands as band on band.id = invitation.band_id
    where app_private.invitation_is_mine(invitation)
    order by invitation.band_id, invitation.id
  ) as mine
  order by mine.band_name
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

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

  if not app_private.invitation_is_mine(v_invitation) then
    if v_invitation.user_id is not null then
      raise exception 'That invitation is not for you' using errcode = 'DNIED';
    elsif v_invitation.code is distinct from code then
      raise exception 'Incorrect invitation code' using errcode = 'INCOD';
    end if;
  end if;

  select * into v_band from app_public.bands where id = v_invitation.band_id;

  return v_band;
end;
$$ language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp;

-- Joining uses up every invitation of the user's to that band.
create or replace function app_public.accept_invitation_to_band(invitation_id uuid, code text = null)
  returns uuid as $$
declare
  v_band app_public.bands;
begin
  v_band = app_public.band_for_invitation(invitation_id, code);

  insert into app_public.band_memberships (band_id, user_id)
    values(v_band.id, app_public.current_user_id())
    on conflict do nothing;

  delete from app_public.band_invitations
    where band_invitations.id = accept_invitation_to_band.invitation_id
    or (band_invitations.band_id = v_band.id and app_private.invitation_is_mine(band_invitations));

  return v_band.id;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create or replace function app_public.decline_invitation_to_band(invitation_id uuid)
  returns void as $$
  delete from app_public.band_invitations
    where app_private.invitation_is_mine(band_invitations)
    and band_invitations.band_id in (
      select answered.band_id from app_public.band_invitations as answered
      where answered.id = decline_invitation_to_band.invitation_id
        and app_private.invitation_is_mine(answered)
    );
$$ language sql volatile security definer set search_path = pg_catalog, public, pg_temp;
