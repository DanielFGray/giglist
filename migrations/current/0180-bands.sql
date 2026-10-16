drop function if exists app_public.transfer_band_ownership(uuid, uuid);
drop function if exists app_public.delete_band(uuid);
drop function if exists app_public.remove_from_band(uuid, uuid);
drop function if exists app_public.bands_current_user_is_owner(app_public.bands);
drop function if exists app_public.decline_invitation_to_band(uuid) cascade;
drop function if exists app_public.my_band_invitations() cascade;
drop function if exists app_public.accept_invitation_to_band(uuid, text) cascade;
drop function if exists app_public.get_band_for_invitation(uuid, text) cascade;
drop function if exists app_public.band_for_invitation(uuid, text) cascade;
drop function if exists app_public.invite_user_to_band(uuid, uuid) cascade;
drop function if exists app_public.invite_to_band(uuid, citext, citext) cascade;
drop function if exists app_public.current_user_invited_band_ids() cascade;
drop function if exists app_public.current_user_member_band_ids() cascade;
drop table if exists app_public.band_invitations;
drop table if exists app_public.band_memberships;
drop table if exists app_public.bands cascade;

--------------------------------------------------------------------------------

create table app_public.bands (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);
alter table app_public.bands enable row level security;

grant select on app_public.bands to :DATABASE_VISITOR;
grant update(name, slug) on app_public.bands to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create table app_public.band_memberships (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  user_id uuid not null references app_public.users on delete cascade,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (band_id, user_id)
);
alter table app_public.band_memberships enable row level security;

create index on app_public.band_memberships (user_id);

grant select on app_public.band_memberships to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create table app_public.band_invitations (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  code text,
  user_id uuid references app_public.users on delete cascade,
  email citext,
  check ((user_id is null) <> (email is null)),
  check ((code is null) = (email is null)),
  unique (band_id, user_id),
  unique (band_id, email)
);
alter table app_public.band_invitations enable row level security;

create index on app_public.band_invitations(user_id);
-- grant select on app_public.band_invitations to :DATABASE_VISITOR;

--------------------------------------------------------------------------------
create function app_public.current_user_member_band_ids() returns setof uuid as $$
  select band_id from app_public.band_memberships
    where user_id = app_public.current_user_id();
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.current_user_invited_band_ids() returns setof uuid as $$
  select band_id from app_public.band_invitations
    where user_id = app_public.current_user_id();
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

create policy select_member on app_public.bands
  for select using (id in (select app_public.current_user_member_band_ids()));

create policy select_invited on app_public.bands
  for select using (id in (select app_public.current_user_invited_band_ids()));

create policy select_member on app_public.band_memberships
  for select using (band_id in (select app_public.current_user_member_band_ids()));

create policy select_invited on app_public.band_memberships
  for select using (band_id in (select app_public.current_user_invited_band_ids()));

--------------------------------------------------------------------------------
create function app_public.create_band(slug citext, name text) returns app_public.bands as $$
declare
  v_band app_public.bands;
begin
  insert into app_public.bands (slug, name) values (slug, name) returning * into v_band;
  insert into app_public.band_memberships (band_id, user_id, is_owner)
    values(v_band.id, app_public.current_user_id(), true);
  return v_band;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.invite_to_band(band_id uuid, username citext = null, email citext = null)
  returns void as $$
declare
  v_code text;
  v_user app_public.users;
begin
  -- Are we allowed to add this person
  -- Are we logged in
  if app_public.current_user_id() is null then
    raise exception 'You must log in to invite a user' using errcode = 'LOGIN';
  end if;

  select * into v_user from app_public.users where users.username = invite_to_band.username;

  -- Are we the owner of this band
  if not exists(
    select 1 from app_public.band_memberships
      where band_memberships.band_id = invite_to_band.band_id
      and band_memberships.user_id = app_public.current_user_id()
      and is_owner is true
  ) then
    raise exception 'You''re not the owner of this band' using errcode = 'DNIED';
  end if;

  if v_user.id is not null and exists(
    select 1 from app_public.band_memberships
      where band_memberships.band_id = invite_to_band.band_id
      and band_memberships.user_id = v_user.id
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

  -- Invite the user
  insert into app_public.band_invitations(band_id, user_id, email, code)
    values (invite_to_band.band_id, v_user.id, email, v_code);
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.band_for_invitation(invitation_id uuid, code text = null)
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
      raise exception 'Incorrect invitation code' using errcode = 'DNIED';
    end if;
  end if;

  select * into v_band from app_public.bands where id = v_invitation.band_id;

  return v_band;
end;
$$ language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.accept_invitation_to_band(invitation_id uuid, code text = null)
  returns void as $$
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
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

-- The invitations addressed to the current user. The visitor role cannot select
-- band_invitations (an invitation by email carries a secret code), so the user
-- reads their own through this function, which never returns the code.
create function app_public.my_band_invitations()
  returns table (id uuid, band_id uuid, band_name text) as $$
  select invitation.id, invitation.band_id, band.name
  from app_public.band_invitations as invitation
  join app_public.bands as band on band.id = invitation.band_id
  where invitation.user_id = app_public.current_user_id()
  order by band.name
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.decline_invitation_to_band(invitation_id uuid)
  returns void as $$
  delete from app_public.band_invitations
    where id = invitation_id and user_id = app_public.current_user_id();
$$ language sql volatile security definer set search_path = pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------

create trigger _500_send_email after insert on app_public.band_invitations
  for each row execute procedure app_private.tg__add_job('band_invitations__send_invite');

--------------------------------------------------------------------------------

create function app_public.bands_current_user_is_owner(
  band app_public.bands
) returns boolean as $$
  select exists(
    select 1
    from app_public.band_memberships
    where band_id = band.id
    and user_id = app_public.current_user_id()
    and is_owner is true
  )
$$ language sql stable;

create policy update_owner on app_public.bands for update using (exists(
  select 1
  from app_public.band_memberships
  where band_id = bands.id
  and user_id = app_public.current_user_id()
  and is_owner is true
));

create function app_public.remove_from_band(
  band_id uuid,
  user_id uuid
) returns void as $$
declare
  v_my_membership app_public.band_memberships;
begin
  select * into v_my_membership
    from app_public.band_memberships
    where band_memberships.band_id = remove_from_band.band_id
    and band_memberships.user_id = app_public.current_user_id();

  if (v_my_membership is null) then
    -- I'm not a member of that band
    return;
  elsif v_my_membership.is_owner then
    if remove_from_band.user_id <> app_public.current_user_id() then
      -- Delete it
    else
      -- Need to transfer ownership before I can leave
      return;
    end if;
  elsif v_my_membership.user_id = user_id then
    -- Delete it
  else
    -- Not allowed to delete it
    return;
  end if;

  delete from app_public.band_memberships
    where band_memberships.band_id = remove_from_band.band_id
    and band_memberships.user_id = remove_from_band.user_id;

end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------

create function app_public.tg_users__deletion_band_checks_and_actions() returns trigger as $$
begin
  -- Check they're not a band owner
  if exists(
    select 1
    from app_public.band_memberships
    where user_id = app_public.current_user_id()
    and is_owner is true
  ) then
    raise exception 'You cannot delete your account until you are not the owner of any bands.' using errcode = 'OWNER';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger _500_deletion_band_checks_and_actions
  before delete
  on app_public.users
  for each row
  when (app_public.current_user_id() is not null)
  execute procedure app_public.tg_users__deletion_band_checks_and_actions();

create function app_public.delete_band(band_id uuid) returns void as $$
begin
  if exists(
    select 1
    from app_public.band_memberships
    where user_id = app_public.current_user_id()
    and band_memberships.band_id = delete_band.band_id
    and is_owner is true
  ) then
    delete from app_public.bands where id = band_id;
  end if;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create function app_public.transfer_band_ownership(band_id uuid, user_id uuid) returns app_public.bands as $$
declare
 v_band app_public.bands;
begin
  if exists(
    select 1
    from app_public.band_memberships
    where band_memberships.user_id = app_public.current_user_id()
    and band_memberships.band_id = transfer_band_ownership.band_id
    and is_owner is true
  ) then
    update app_public.band_memberships
      set is_owner = true
      where band_memberships.band_id = transfer_band_ownership.band_id
      and band_memberships.user_id = transfer_band_ownership.user_id;
    if found then
      update app_public.band_memberships
        set is_owner = false
        where band_memberships.band_id = transfer_band_ownership.band_id
        and band_memberships.user_id = app_public.current_user_id();

      select * into v_band from app_public.bands where id = band_id;
      return v_band;
    end if;
  end if;
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
