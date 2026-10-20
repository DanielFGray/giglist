/*
 * A band's owner can turn on a public page at /b/:slug; it is off until they do.
 * The bands table stays member-scoped: signed-out visitors and other users read
 * a band only through the security definer functions below, which return
 * exactly the public fields and the lists the owner has turned on. An open
 * select policy on bands would let every query that trusts RLS (such as "my
 * bands") return every band.
 *
 * The page's look is a theme the band writes: one HTML document with theme
 * tags, plus the values the band chose for the options the theme declares
 * (docs/adr/0006). The browser fills the tags in and shows the result in a
 * sandboxed frame, so the database stores the theme as text and never runs it.
 */

drop function if exists app_public.public_band(citext);
drop function if exists app_public.public_band_members(citext);
drop function if exists app_public.public_band_gig_dates(citext);
drop function if exists app_public.public_band_songs(citext);

alter table app_public.bands
  add column if not exists is_public boolean not null default false,
  add column if not exists show_members_publicly boolean not null default false,
  add column if not exists show_gig_dates_publicly boolean not null default false,
  add column if not exists show_songs_publicly boolean not null default false,
  add column if not exists page_theme text
    check (length(page_theme) <= 200000),
  add column if not exists page_options jsonb not null default '{}'
    check (jsonb_typeof(page_options) = 'object');

comment on column app_public.bands.is_public is
  E'When true, anyone can open the band''s public page; when false, /b/:slug answers not found.';
comment on column app_public.bands.show_members_publicly is
  E'When true, the public band page lists members (username, name, avatar).';
comment on column app_public.bands.show_gig_dates_publicly is
  E'When true, the public band page lists upcoming gigs (venue + date only).';
comment on column app_public.bands.show_songs_publicly is
  E'When true, the public band page lists the band''s songs (title + artist only).';
comment on column app_public.bands.page_theme is
  E'The public page''s theme: an HTML document with theme tags. Null means the built-in Classic theme.';
comment on column app_public.bands.page_options is
  E'Values for the options the theme declares, keyed like "color:Accent"; an option with no value uses the theme''s default.';

grant update(
  description,
  is_public,
  show_members_publicly,
  show_gig_dates_publicly,
  show_songs_publicly,
  page_theme,
  page_options
) on app_public.bands to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_band(band_slug citext)
returns table (
  slug citext,
  name text,
  description text,
  page_theme text,
  page_options jsonb
) as $$
  select
    bands.slug,
    bands.name,
    bands.description,
    bands.page_theme,
    bands.page_options
  from app_public.bands
  where bands.slug = public_band.band_slug
    and bands.is_public;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_band(citext) is
  E'The public fields of one band, for its public page; no row when the slug is unknown or the page is off.';

grant execute on function app_public.public_band(citext) to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_band_members(band_slug citext)
returns table (
  username app_public.username,
  name text,
  avatar_url text,
  is_owner boolean
) as $$
  select
    users.username,
    users.name,
    users.avatar_url::text,
    band_memberships.is_owner
  from app_public.band_memberships
  inner join app_public.users on users.id = band_memberships.user_id
  inner join app_public.bands on bands.id = band_memberships.band_id
  where bands.slug = public_band_members.band_slug
    and bands.is_public
    and bands.show_members_publicly
  order by band_memberships.is_owner desc, users.username asc;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_band_members(citext) is
  E'Members of a band for its public page, or empty when the owner has not enabled that.';

grant execute on function app_public.public_band_members(citext) to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_band_gig_dates(band_slug citext)
returns table (
  venue text,
  gig_date date
) as $$
  select gigs.venue, gigs.gig_date
  from app_public.gigs
  inner join app_public.bands on bands.id = gigs.band_id
  where bands.slug = public_band_gig_dates.band_slug
    and bands.is_public
    and bands.show_gig_dates_publicly
    and gigs.gig_date >= current_date
  order by gigs.gig_date asc, gigs.venue asc nulls last;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_band_gig_dates(citext) is
  E'Upcoming gig venues and dates for a band public page, or empty when disabled.';

grant execute on function app_public.public_band_gig_dates(citext) to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_band_songs(band_slug citext)
returns table (
  title text,
  artist text
) as $$
  select songs.title, songs.artist
  from app_public.songs
  inner join app_public.bands on bands.id = songs.band_id
  where bands.slug = public_band_songs.band_slug
    and bands.is_public
    and bands.show_songs_publicly
  order by lower(songs.title) asc, songs.id asc;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_band_songs(citext) is
  E'Song titles and artists for a band public page, or empty when the owner has not enabled that.';

grant execute on function app_public.public_band_songs(citext) to :DATABASE_VISITOR;
