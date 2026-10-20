/*
 * A user's public profile is a theme the user writes, like a band's page
 * (docs/adr/0012): one HTML document with theme tags, plus the values the
 * user chose for the options the theme declares. There are no starter themes
 * for profiles; a NULL theme means the built-in default. `public_user` gains
 * the theme columns, so its return type changes and it is dropped first.
 */

alter table app_public.users
  add column if not exists page_theme text
    check (length(page_theme) <= 200000),
  add column if not exists page_options jsonb not null default '{}'
    check (jsonb_typeof(page_options) = 'object');

comment on column app_public.users.page_theme is
  E'The public profile''s theme: an HTML document with theme tags. Null means the built-in default theme.';
comment on column app_public.users.page_options is
  E'Values for the options the profile theme declares, keyed like "color:Accent"; an option with no value uses the theme''s default.';

grant update(page_theme, page_options) on app_public.users to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

drop function if exists app_public.public_user(citext);

create function app_public.public_user(handle citext)
returns table (
  username app_public.username,
  name text,
  bio text,
  avatar_url text,
  page_theme text,
  page_options jsonb
) as $$
  select
    users.username,
    users.name,
    users.bio,
    users.avatar_url::text,
    users.page_theme,
    users.page_options
  from app_public.users
  where users.username = public_user.handle
    and users.is_public;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_user(citext) is
  E'The public fields of one user, for their public profile; no row when the username is unknown or the profile is off.';

grant execute on function app_public.public_user(citext) to :DATABASE_VISITOR;
