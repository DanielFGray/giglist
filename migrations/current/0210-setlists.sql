/*
 * Setlists are ordered collections of songs for a gig or rehearsal.
 * They belong to a band and contain sections and entries.
 *
 * Workflow: draft → rehearsal → final
 *   - draft: being built, not ready
 *   - rehearsal: locked in for practice
 *   - final: the version used for the gig
 */

create type app_public.setlist_status as enum ('draft', 'rehearsal', 'final');

create table app_public.setlists (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  name text not null check (length(name) > 0 and length(name) <= 500),
  description text check (length(description) <= 5000),
  gig_date date,
  status app_public.setlist_status not null default 'draft',
  created_by uuid references app_public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.setlists enable row level security;

create index idx_setlists_band on app_public.setlists (band_id);
create index idx_setlists_gig_date on app_public.setlists (band_id, gig_date desc nulls last);

create trigger _100_timestamps
  before insert or update on app_public.setlists
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.setlists is
  E'A setlist for a gig or rehearsal. Contains sections and song entries.';
comment on column app_public.setlists.gig_date is
  E'The date of the gig/event this setlist is for.';
comment on column app_public.setlists.status is
  E'Workflow status: draft → rehearsal → final.';

-- Same RLS pattern as songs: scoped to band membership.
create policy select_member on app_public.setlists
  for select using (band_id in (select app_public.current_user_member_band_ids()));
create policy insert_member on app_public.setlists
  for insert with check (band_id in (select app_public.current_user_member_band_ids()));
create policy update_member on app_public.setlists
  for update using (band_id in (select app_public.current_user_member_band_ids()));
create policy delete_member on app_public.setlists
  for delete using (band_id in (select app_public.current_user_member_band_ids()));

grant select on app_public.setlists to :DATABASE_VISITOR;
grant insert (band_id, name, description, gig_date, status) on app_public.setlists to :DATABASE_VISITOR;
grant update (name, description, gig_date, status) on app_public.setlists to :DATABASE_VISITOR;
grant delete on app_public.setlists to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * Sections divide a setlist into named groups (Set 1, Set 2, Encore, etc).
 * Position determines the ordering of sections within a setlist.
 */

create table app_public.setlist_sections (
  id uuid primary key default gen_random_uuid(),
  setlist_id uuid not null references app_public.setlists on delete cascade,
  name text not null check (length(name) > 0 and length(name) <= 200),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.setlist_sections enable row level security;

create index idx_setlist_sections_setlist on app_public.setlist_sections (setlist_id, position);

create trigger _100_timestamps
  before insert or update on app_public.setlist_sections
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.setlist_sections is
  E'A named section within a setlist (e.g. "Set 1", "Encore"). Songs are placed into sections.';

-- RLS: accessible if the parent setlist is accessible.
-- We check via the setlist's band_id.
create policy select_member on app_public.setlist_sections
  for select using (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_sections.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));
create policy insert_member on app_public.setlist_sections
  for insert with check (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_sections.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));
create policy update_member on app_public.setlist_sections
  for update using (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_sections.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));
create policy delete_member on app_public.setlist_sections
  for delete using (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_sections.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));

grant select on app_public.setlist_sections to :DATABASE_VISITOR;
grant insert (setlist_id, name, position) on app_public.setlist_sections to :DATABASE_VISITOR;
grant update (name, position) on app_public.setlist_sections to :DATABASE_VISITOR;
grant delete on app_public.setlist_sections to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * Setlist entries are the individual songs in a setlist. Each entry references
 * a song and optionally a section. Entries can override song defaults for key,
 * tempo, and notes — allowing the same song to appear in different keys for
 * different gigs.
 *
 * Position uses gap-based integers (e.g. 1000, 2000, 3000) to allow cheap
 * reordering without updating every row. Reindex when gaps run out.
 */

create table app_public.setlist_entries (
  id uuid primary key default gen_random_uuid(),
  setlist_id uuid not null references app_public.setlists on delete cascade,
  section_id uuid references app_public.setlist_sections on delete set null,
  song_id uuid not null references app_public.songs on delete cascade,
  position int not null default 0,
  -- Per-entry overrides (null = inherit from song)
  key_override app_public.musical_key,
  tempo_override int check (tempo_override > 0 and tempo_override <= 999),
  notes_override text check (length(notes_override) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.setlist_entries enable row level security;

create index idx_setlist_entries_setlist on app_public.setlist_entries (setlist_id, position);
create index idx_setlist_entries_section on app_public.setlist_entries (section_id, position);
create index idx_setlist_entries_song on app_public.setlist_entries (song_id);

create trigger _100_timestamps
  before insert or update on app_public.setlist_entries
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.setlist_entries is
  E'A song placed in a setlist. May override the song''s default key, tempo, and notes for this specific performance.';
comment on column app_public.setlist_entries.key_override is
  E'Override the song''s default key for this setlist. Null = use song default.';
comment on column app_public.setlist_entries.tempo_override is
  E'Override the song''s default tempo for this setlist. Null = use song default.';
comment on column app_public.setlist_entries.notes_override is
  E'Override the song''s default notes for this setlist. Null = use song default.';
comment on column app_public.setlist_entries.position is
  E'Ordering position within the section (or setlist if no section). Uses gap-based integers for cheap reordering.';

-- RLS: same pattern as sections — check via parent setlist.
create policy select_member on app_public.setlist_entries
  for select using (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_entries.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));
create policy insert_member on app_public.setlist_entries
  for insert with check (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_entries.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));
create policy update_member on app_public.setlist_entries
  for update using (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_entries.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));
create policy delete_member on app_public.setlist_entries
  for delete using (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_entries.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));

grant select on app_public.setlist_entries to :DATABASE_VISITOR;
grant insert (setlist_id, section_id, song_id, position, key_override, tempo_override, notes_override) on app_public.setlist_entries to :DATABASE_VISITOR;
grant update (section_id, position, key_override, tempo_override, notes_override) on app_public.setlist_entries to :DATABASE_VISITOR;
grant delete on app_public.setlist_entries to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * Convenience view: setlist entries with inherited song data + overrides applied.
 * Use this for reading setlists — it resolves inheritance so the client
 * doesn't have to.
 */

create view app_public.setlist_entries_resolved as
  select
    e.id,
    e.setlist_id,
    e.section_id,
    e.song_id,
    e.position,
    s.title,
    s.artist,
    coalesce(e.key_override, s.key) as key,
    coalesce(e.tempo_override, s.tempo_bpm) as tempo_bpm,
    coalesce(e.notes_override, s.notes) as notes,
    s.duration_seconds,
    s.capo,
    e.key_override is not null as key_overridden,
    e.tempo_override is not null as tempo_overridden,
    e.notes_override is not null as notes_overridden,
    e.created_at,
    e.updated_at
  from app_public.setlist_entries e
  join app_public.songs s on s.id = e.song_id;

comment on view app_public.setlist_entries_resolved is
  E'Setlist entries with song defaults resolved — overrides take precedence, nulls fall through to the song''s values.';

grant select on app_public.setlist_entries_resolved to :DATABASE_VISITOR;
