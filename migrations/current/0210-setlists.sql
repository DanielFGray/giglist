/*
 * A setlist is a named, ordered list of songs ("Standard 60", "Acoustic").
 * It belongs to a band. A gig plays one or more setlists in order (see
 * 0220-gigs.sql), and one setlist can serve many gigs, so the setlist holds
 * no venue or date of its own.
 *
 * Workflow: draft → rehearsal → final
 *   - draft: being built, not ready
 *   - rehearsal: locked in for practice
 *   - final: the version the band plays
 */

create type app_public.setlist_status as enum ('draft', 'rehearsal', 'final');

create table app_public.setlists (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  name text not null check (length(name) between 1 and 200),
  status app_public.setlist_status not null default 'draft',
  created_by uuid references app_public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The target of gig_setlists' foreign key, which keeps a gig and its setlists in one band.
  unique (band_id, id)
);
alter table app_public.setlists enable row level security;

create index idx_setlists_band on app_public.setlists (band_id, name);

create trigger _100_timestamps
  before insert or update on app_public.setlists
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.setlists is
  E'A named, ordered list of songs. Gigs play setlists; one setlist can serve many gigs.';
comment on column app_public.setlists.status is
  E'Workflow status: draft → rehearsal → final.';

create policy select_member on app_public.setlists
  for select using (band_id in (select app_public.current_user_member_band_ids()));
create policy insert_member on app_public.setlists
  for insert with check (band_id in (select app_public.current_user_member_band_ids()));
create policy update_member on app_public.setlists
  for update using (band_id in (select app_public.current_user_member_band_ids()));
create policy delete_member on app_public.setlists
  for delete using (band_id in (select app_public.current_user_member_band_ids()));

grant select on app_public.setlists to :DATABASE_VISITOR;
grant insert (band_id, name, status) on app_public.setlists to :DATABASE_VISITOR;
grant update (name, status) on app_public.setlists to :DATABASE_VISITOR;
grant delete on app_public.setlists to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * Setlist entries are the songs in a setlist, in order. An entry can override
 * the song's key, tempo and notes for this setlist only.
 *
 * `position_key` is a sortable text key (base-62, collation "C"), so moving
 * one entry writes one row: the server picks a key between the new
 * neighbours' keys, and renumbers the setlist when a key grows long.
 */

create table app_public.setlist_entries (
  id uuid primary key default gen_random_uuid(),
  setlist_id uuid not null references app_public.setlists on delete cascade,
  song_id uuid not null references app_public.songs on delete cascade,
  position_key text collate "C" not null,
  -- Per-entry overrides (null = inherit from song)
  key_override app_public.musical_key,
  tempo_override int check (tempo_override > 0 and tempo_override <= 999),
  notes_override text check (length(notes_override) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.setlist_entries enable row level security;

create index idx_setlist_entries_setlist on app_public.setlist_entries (setlist_id, position_key);
create index idx_setlist_entries_song on app_public.setlist_entries (song_id);

create trigger _100_timestamps
  before insert or update on app_public.setlist_entries
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.setlist_entries is
  E'A song placed in a setlist. May override the song''s default key, tempo, and notes for this setlist.';
comment on column app_public.setlist_entries.key_override is
  E'Override the song''s default key for this setlist. Null = use song default.';
comment on column app_public.setlist_entries.tempo_override is
  E'Override the song''s default tempo for this setlist. Null = use song default.';
comment on column app_public.setlist_entries.notes_override is
  E'Override the song''s default notes for this setlist. Null = use song default.';
comment on column app_public.setlist_entries.position_key is
  E'Sortable key for the entry''s place in the setlist; read in order of (position_key, id).';

-- RLS: accessible if the parent setlist is accessible.
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
grant insert (setlist_id, song_id, position_key, key_override, tempo_override, notes_override) on app_public.setlist_entries to :DATABASE_VISITOR;
grant update (position_key, key_override, tempo_override, notes_override) on app_public.setlist_entries to :DATABASE_VISITOR;
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
    e.song_id,
    e.position_key,
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

-- A view runs with its owner's rights, which skips RLS on the tables it reads.
-- With security_invoker the caller's policies on setlist_entries and songs apply.
alter view app_public.setlist_entries_resolved set (security_invoker = true);

comment on view app_public.setlist_entries_resolved is
  E'Setlist entries with song defaults resolved — overrides take precedence, nulls fall through to the song''s values.';

grant select on app_public.setlist_entries_resolved to :DATABASE_VISITOR;
