/*
 * Fixtures for setlists-rls.sql, inserted by the owner (RLS does not apply), after charts-seed.sql.
 * The "foreign" entry puts a song of cy's band on ana's band's setlist, the state a bulk import
 * or a cross-band copy could create if it skipped the handler's band check.
 */
insert into app_public.bands (id, slug, name) values ('00000000-0000-0000-0000-0000000000d2', 'test-rls-other', 'Test RLS Other Band');
insert into app_public.band_memberships (band_id, user_id, is_owner) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', true);
insert into app_public.songs (id, band_id, title, key) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d2', 'Secret Song', 'D');
insert into app_public.setlists (id, band_id, name) values
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000d1', 'Friday');
insert into app_public.setlist_entries (setlist_id, song_id, position_key) values
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000e1', 'Ab'),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000e2', 'aB');
