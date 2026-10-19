/*
 * Every band has a public profile page (name + description). Owners can also
 * show the member list and setlist gig dates on that page.
 */

alter table app_public.bands
  add column if not exists show_members_publicly boolean not null default false,
  add column if not exists show_gig_dates_publicly boolean not null default false;

comment on column app_public.bands.show_members_publicly is
  E'When true, the public band page lists members (username, name, avatar).';
comment on column app_public.bands.show_gig_dates_publicly is
  E'When true, the public band page lists setlist gig dates (name + date only).';

-- Anyone (including signed-out visitors) can read the band row. Songs, setlists
-- and memberships stay member-scoped; member/gig lists go through the helpers.
create policy select_public on app_public.bands for select using (true);

grant update(description, show_members_publicly, show_gig_dates_publicly) on app_public.bands to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_band_members(band_slug citext)
returns table (
  username app_public.username,
  name text,
  avatar_url text,
  is_owner boolean
) as $$
begin
  if not exists (
    select 1 from app_public.bands
    where bands.slug = public_band_members.band_slug
      and bands.show_members_publicly is true
  ) then
    return;
  end if;

  return query
    select
      users.username,
      users.name,
      users.avatar_url::text,
      band_memberships.is_owner
    from app_public.band_memberships
    inner join app_public.users on users.id = band_memberships.user_id
    inner join app_public.bands on bands.id = band_memberships.band_id
    where bands.slug = public_band_members.band_slug
    order by band_memberships.is_owner desc, users.username asc;
end;
$$ language plpgsql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_band_members(citext) is
  E'Members of a band for its public profile, or empty when the owner has not enabled that.';

grant execute on function app_public.public_band_members(citext) to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_band_gig_dates(band_slug citext)
returns table (
  name text,
  gig_date date
) as $$
begin
  if not exists (
    select 1 from app_public.bands
    where bands.slug = public_band_gig_dates.band_slug
      and bands.show_gig_dates_publicly is true
  ) then
    return;
  end if;

  return query
    select setlists.name, setlists.gig_date
    from app_public.setlists
    inner join app_public.bands on bands.id = setlists.band_id
    where bands.slug = public_band_gig_dates.band_slug
      and setlists.gig_date is not null
    order by setlists.gig_date asc, setlists.name asc;
end;
$$ language plpgsql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_band_gig_dates(citext) is
  E'Setlist names and gig dates for a band public profile, or empty when disabled.';

grant execute on function app_public.public_band_gig_dates(citext) to :DATABASE_VISITOR;
