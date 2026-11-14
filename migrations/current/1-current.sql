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

-- What an emailed invitation's link shows before sign-in: the band, the address
-- the invitation went to, and whether that address already belongs to an
-- account (then the visitor signs in rather than signs up). Only the link's
-- code opens it, so the address and band name reach no one else.
create or replace function app_public.invitation_preview(invitation_id uuid, code text)
  returns table (band_name text, email citext, has_account boolean) as $$
  select band.name, invitation.email, exists(
    select 1 from app_public.user_emails
    where user_emails.email = invitation.email and user_emails.is_verified
  )
  from app_public.band_invitations as invitation
  join app_public.bands as band on band.id = invitation.band_id
  where invitation.id = invitation_preview.invitation_id
    and invitation.code = invitation_preview.code
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

grant execute on function app_public.invitation_preview(uuid, text) to :DATABASE_VISITOR;

-- Signs up the person an emailed invitation went to and makes them a member of
-- its band. Holding the link's code proves they read that address, so the new
-- account's email is the invitation's, already verified: no verification email
-- is sent. Every invitation to the band for that address is used up.
create or replace function app_private.join_band_by_invitation(
  invitation_id uuid,
  code text,
  username citext,
  avatar_url text,
  password text
) returns table (user_id uuid, band_id uuid) as $$
declare
  v_invitation app_public.band_invitations;
  v_user app_public.users;
begin
  select * into v_invitation from app_public.band_invitations as invitation
    where invitation.id = join_band_by_invitation.invitation_id;

  if v_invitation is null then
    raise exception 'We could not find that invitation' using errcode = 'NTFND';
  end if;

  if v_invitation.code is null or v_invitation.code is distinct from join_band_by_invitation.code then
    raise exception 'Incorrect invitation code' using errcode = 'INCOD';
  end if;

  v_user = app_private.really_create_user(
    username => join_band_by_invitation.username,
    name => null,
    avatar_url => join_band_by_invitation.avatar_url,
    email_is_verified => true,
    email => v_invitation.email,
    password => join_band_by_invitation.password
  );

  insert into app_public.band_memberships (band_id, user_id)
    values (v_invitation.band_id, v_user.id);

  delete from app_public.band_invitations where id = v_invitation.id;

  return query select v_user.id, v_invitation.band_id;
end;
$$ language plpgsql volatile set search_path = pg_catalog, public, pg_temp;

-- An invitation to a member's verified address would show that member a Join
-- for their own band, so it is refused like an invitation to their username.
create or replace function app_public.invite_to_band(band_id uuid, username citext = null, email citext = null)
  returns void as $$
declare
  v_code text;
  v_user app_public.users;
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to invite a user' using errcode = 'LOGIN';
  end if;

  select * into v_user from app_public.users where users.username = invite_to_band.username;

  if not exists(
    select 1 from app_public.band_memberships
      where band_memberships.band_id = invite_to_band.band_id
      and band_memberships.user_id = app_public.current_user_id()
      and is_owner is true
  ) then
    raise exception 'You''re not the owner of this band' using errcode = 'DNIED';
  end if;

  if exists(
    select 1 from app_public.band_memberships as membership
      where membership.band_id = invite_to_band.band_id
      and (
        membership.user_id = v_user.id
        or exists(
          select 1 from app_public.user_emails
            where user_emails.user_id = membership.user_id
            and user_emails.email = invite_to_band.email
            and user_emails.is_verified
        )
      )
  ) then
    raise exception 'Cannot invite someone who is already a member' using errcode = 'ISMBR';
  end if;

  if email is not null then
    v_code = encode(gen_random_bytes(7), 'hex');
  end if;

  if v_user.id is not null and not v_user.is_verified then
    raise exception 'The user you attempted to invite has not verified their account' using errcode = 'VRFY2';
  end if;

  if v_user.id is null and email is null then
    raise exception 'Could not find person to invite' using errcode = 'NTFND';
  end if;

  insert into app_public.band_invitations(band_id, user_id, email, code)
    values (invite_to_band.band_id, v_user.id, email, v_code);
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;
