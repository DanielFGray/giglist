/*
 * Fixtures for scores-rls.sql, inserted by the owner. They use their own band and
 * users so the counts in charts-rls.sql do not change: sam is in the band, oz is
 * not. The score's file is the three bytes 'abc'; its revision stores their sha256.
 */
insert into app_public.users (id, username) values
  ('00000000-0000-0000-0000-000000000511', 'test_rls_sam'),
  ('00000000-0000-0000-0000-000000000512', 'test_rls_oz');
insert into app_private.sessions (uuid, user_id) values
  ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000511'),
  ('00000000-0000-0000-0000-000000000522', '00000000-0000-0000-0000-000000000512');
insert into app_public.bands (id, slug, name) values ('00000000-0000-0000-0000-000000000531', 'test-rls-scores-band', 'Test RLS Scores Band');
insert into app_public.band_memberships (band_id, user_id, is_owner) values
  ('00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-000000000511', true);
insert into app_public.songs (id, band_id, title, key) values
  ('00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-000000000531', 'Smoke on the Water', 'G');
insert into app_public.charts (id, song_id, kind, name) values
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000541', 'score', 'Lead guitar');
insert into app_public.chart_revisions (id, chart_id, file_key, file_sha256) values
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000501', 'lead.gp5', sha256('abc'::bytea));
insert into app_public.score_files (revision_id, bytes) values
  ('00000000-0000-0000-0000-000000000502', 'abc'::bytea);
insert into app_public.charts (id, song_id, kind, name) values
  ('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000541', 'lyrics', 'Chords');
insert into app_public.chart_revisions (id, chart_id, source) values
  ('00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000503', '[G]Smoke');
