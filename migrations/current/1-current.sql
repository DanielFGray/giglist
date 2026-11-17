-- A gig's place on the map, saved when the band picks a suggested venue. The
-- venue search leans toward the band's gig nearest today that has one.
alter table app_public.gigs
  drop column if exists latitude,
  drop column if exists longitude;
alter table app_public.gigs
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add constraint gigs_location_whole check ((latitude is null) = (longitude is null));

comment on column app_public.gigs.latitude is
  E'Where the venue is, from the map place or past venue the band picked; null when the address was typed by hand.';
comment on column app_public.gigs.longitude is
  E'Where the venue is, with latitude.';

grant insert (latitude, longitude), update (latitude, longitude) on app_public.gigs to :DATABASE_VISITOR;
