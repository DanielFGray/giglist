/*
 * Fixtures for public-user-rls.sql, inserted by the owner: ana (from
 * charts-seed.sql) has a public profile with a Markdown bio; her band's page
 * is on (public-band-seed.sql), so it lists on her profile.
 */
update app_public.users
  set is_public = true, name = 'Ana', bio = '**Drums** in the band.'
  where id = '00000000-0000-0000-0000-0000000000a1';
