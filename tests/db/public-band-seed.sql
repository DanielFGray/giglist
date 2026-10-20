/*
 * Fixtures for public-band-rls.sql, inserted by the owner after charts-seed.sql:
 * ana's band has a public page that shows its songs and gig dates but keeps its
 * members hidden.
 */
update app_public.bands
  set is_public = true, show_songs_publicly = true, show_gig_dates_publicly = true
  where id = '00000000-0000-0000-0000-0000000000d1';
insert into app_public.gigs (band_id, venue, gig_date) values
  ('00000000-0000-0000-0000-0000000000d1', 'Last Year', current_date - 365),
  ('00000000-0000-0000-0000-0000000000d1', 'Next Week', current_date + 7);
