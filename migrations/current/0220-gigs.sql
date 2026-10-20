/*
 * A gig is one performance: where, when, and which setlists the band plays,
 * in order (Set 1, Set 2, Encore). A gig has no name: the app labels it by its
 * venue, or by its date when it has none, so a band never keeps a title in
 * step with the gig.
 *
 * The venue and date are public on the band's page when it lists gig dates.
 * The address, the times and the notes stay private to the band. The times
 * are wall-clock times at the venue on the gig date (`time` without a time
 * zone, read with `gig_date`), so no time zone is stored.
 */

create table app_public.gigs (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  venue text check (length(venue) between 1 and 200),
  gig_date date,
  address text check (length(address) <= 1000),
  load_in_time time,
  performance_time time,
  notes text check (length(notes) <= 5000),
  created_by uuid references app_public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The target of gig_setlists' foreign key, which keeps a gig and its setlists in one band.
  unique (band_id, id)
);
alter table app_public.gigs enable row level security;

create index idx_gigs_band_date on app_public.gigs (band_id, gig_date desc nulls last);

create trigger _100_timestamps
  before insert or update on app_public.gigs
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.gigs is
  E'One performance by a band: venue, date, times, and the setlists it plays in order.';
comment on column app_public.gigs.venue is
  E'Where the gig is; the gig''s label, and public with the date.';
comment on column app_public.gigs.address is
  E'The venue address, as the band would paste into a map.';
comment on column app_public.gigs.load_in_time is
  E'When the band must arrive and load in, as a wall-clock time at the venue on the gig date.';
comment on column app_public.gigs.performance_time is
  E'When the performance starts, as a wall-clock time at the venue on the gig date.';
comment on column app_public.gigs.notes is
  E'Notes for the band only.';

create policy select_member on app_public.gigs
  for select using (band_id in (select app_public.current_user_member_band_ids()));
create policy insert_member on app_public.gigs
  for insert with check (band_id in (select app_public.current_user_member_band_ids()));
create policy update_member on app_public.gigs
  for update using (band_id in (select app_public.current_user_member_band_ids()));
create policy delete_member on app_public.gigs
  for delete using (band_id in (select app_public.current_user_member_band_ids()));

grant select on app_public.gigs to :DATABASE_VISITOR;
grant insert (band_id, venue, gig_date, address, load_in_time, performance_time, notes) on app_public.gigs to :DATABASE_VISITOR;
grant update (venue, gig_date, address, load_in_time, performance_time, notes) on app_public.gigs to :DATABASE_VISITOR;
grant delete on app_public.gigs to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * The setlists a gig plays, in order. A gig plays a setlist at most once.
 * `band_id` is in both foreign keys, so a gig can only play its own band's
 * setlists, and a row that changes its `setlist_id` (a gig that plays its own
 * copy in the original's place) stays in the band. Deleting a gig or a
 * setlist removes the row; the other side stays.
 */

create table app_public.gig_setlists (
  band_id uuid not null,
  gig_id uuid not null,
  setlist_id uuid not null,
  position_key text collate "C" not null,
  primary key (gig_id, setlist_id),
  foreign key (band_id, gig_id) references app_public.gigs (band_id, id) on delete cascade,
  foreign key (band_id, setlist_id) references app_public.setlists (band_id, id) on delete cascade
);
alter table app_public.gig_setlists enable row level security;

create index idx_gig_setlists_order on app_public.gig_setlists (gig_id, position_key);
create index idx_gig_setlists_setlist on app_public.gig_setlists (setlist_id);

comment on table app_public.gig_setlists is
  E'The setlists a gig plays, ordered by position_key (then setlist_id).';

create policy select_member on app_public.gig_setlists
  for select using (band_id in (select app_public.current_user_member_band_ids()));
create policy insert_member on app_public.gig_setlists
  for insert with check (band_id in (select app_public.current_user_member_band_ids()));
create policy update_member on app_public.gig_setlists
  for update using (band_id in (select app_public.current_user_member_band_ids()));
create policy delete_member on app_public.gig_setlists
  for delete using (band_id in (select app_public.current_user_member_band_ids()));

grant select on app_public.gig_setlists to :DATABASE_VISITOR;
grant insert (band_id, gig_id, setlist_id, position_key) on app_public.gig_setlists to :DATABASE_VISITOR;
grant update (setlist_id, position_key) on app_public.gig_setlists to :DATABASE_VISITOR;
grant delete on app_public.gig_setlists to :DATABASE_VISITOR;
