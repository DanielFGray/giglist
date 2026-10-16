/*
 * Fixtures for charts-rls.sql, inserted by the owner (RLS does not apply).
 * Fixed ids keep the test free of variable passing.
 *   ana 0000...a1, ben ...b1, cy ...c1; sessions ...a2, ...b2, ...c2
 */
insert into app_public.users (id, username) values
  ('00000000-0000-0000-0000-0000000000a1', 'test_rls_ana'),
  ('00000000-0000-0000-0000-0000000000b1', 'test_rls_ben'),
  ('00000000-0000-0000-0000-0000000000c1', 'test_rls_cy');
insert into app_private.sessions (uuid, user_id) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1');
insert into app_public.bands (id, slug, name) values ('00000000-0000-0000-0000-0000000000d1', 'test-rls-band', 'Test RLS Band');
insert into app_public.band_memberships (band_id, user_id, is_owner) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', true),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', false);
insert into app_public.songs (id, band_id, title, key) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'Amazing Grace', 'G');
insert into app_public.charts (id, song_id, kind, name, written_key) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'lyrics', 'Chords', 'G');
insert into app_public.chart_revisions (id, chart_id, source) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', '[G]Amazing grace');
insert into app_public.marks (user_id, revision_id, scope, range_start, range_end, side, dx, dy, scale, body, visibility) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f2', '{"kind":"chart"}', 0, 11, 'inline', 0, -1, 1, '{"kind":"text","text":"breathe"}', 'private'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f2', '{"kind":"chart"}', 0, 11, 'margin', 0, 0, 1, '{"kind":"text","text":"tacet 1st x"}', 'band');
insert into app_public.stamps (user_id, name, body) values
  ('00000000-0000-0000-0000-0000000000a1', 'half-time', '{"kind":"text","text":"1/2x"}');
