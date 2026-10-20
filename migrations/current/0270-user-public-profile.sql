/*
 * A user can turn on a public profile at /u/:username; it is off until they do
 * (docs/adr/0011). Signed-out visitors read a profile only through the security
 * definer functions below, which return exactly the public fields, and only
 * while the profile is on. The bio is Markdown (docs/adr/0010), sized like a
 * band's description so it has room for prose and pasted embed code.
 */

alter table app_public.users
  add column if not exists is_public boolean not null default false;

alter table app_public.users
  drop constraint if exists users_bio_check,
  add constraint users_bio_check check (length(bio) <= 10000);

comment on column app_public.users.is_public is
  E'When true, anyone can open the user''s public profile; when false, /u/:username answers not found.';
comment on column app_public.users.bio is
  E'A short public note about the user, written as Markdown; shown on the public profile while it is on.';

grant update(is_public) on app_public.users to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_user(handle citext)
returns table (
  username app_public.username,
  name text,
  bio text,
  avatar_url text
) as $$
  select
    users.username,
    users.name,
    users.bio,
    users.avatar_url::text
  from app_public.users
  where users.username = public_user.handle
    and users.is_public;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_user(citext) is
  E'The public fields of one user, for their public profile; no row when the username is unknown or the profile is off.';

grant execute on function app_public.public_user(citext) to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_user_bands(handle citext)
returns table (
  slug citext,
  name text
) as $$
  select bands.slug, bands.name
  from app_public.band_memberships
  inner join app_public.users on users.id = band_memberships.user_id
  inner join app_public.bands on bands.id = band_memberships.band_id
  where users.username = public_user_bands.handle
    and users.is_public
    and bands.is_public
  order by bands.name asc;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_user_bands(citext) is
  E'The bands with public pages that a user belongs to, for their public profile; empty while the profile is off.';

grant execute on function app_public.public_user_bands(citext) to :DATABASE_VISITOR;
