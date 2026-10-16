/*
 * Songs belong to a band. Each song has rich metadata that
 * can be overridden per-setlist entry.
 *
 * Musical keys use a text type with a check constraint rather than an enum,
 * since enums are painful to extend in PostgreSQL.
 */

create domain app_public.musical_key as text check (
  value in (
    'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb',
    'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
    'Cm', 'C#m', 'Dbm', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gbm',
    'Gm', 'G#m', 'Abm', 'Am', 'A#m', 'Bbm', 'Bm'
  )
);
comment on domain app_public.musical_key is
  E'A musical key, e.g. ''C'', ''F#m'', ''Bb''. Major keys are bare, minor keys have an ''m'' suffix.';

create table app_public.songs (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  title text not null check (length(title) > 0 and length(title) <= 500),
  artist text check (length(artist) <= 500),
  key app_public.musical_key,
  tempo_bpm int check (tempo_bpm > 0 and tempo_bpm <= 999),
  duration_seconds int check (duration_seconds > 0 and duration_seconds <= 86400),
  capo int check (capo >= 0 and capo <= 12),
  notes text check (length(notes) <= 10000),
  created_by uuid references app_public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.songs enable row level security;

create index idx_songs_band on app_public.songs (band_id);
create index idx_songs_title on app_public.songs (band_id, title);

create trigger _100_timestamps
  before insert or update on app_public.songs
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.songs is
  E'A song in a band''s catalog. Contains default metadata that can be overridden per-setlist.';
comment on column app_public.songs.key is
  E'Default musical key for this song.';
comment on column app_public.songs.tempo_bpm is
  E'Default tempo in beats per minute.';
comment on column app_public.songs.duration_seconds is
  E'Estimated duration in seconds.';
comment on column app_public.songs.capo is
  E'Default capo position (0 = no capo).';
comment on column app_public.songs.notes is
  E'Freeform notes about the song (chords, arrangement, etc).';

-- Songs are visible to all members of the band.
create policy select_member on app_public.songs
  for select using (band_id in (select app_public.current_user_member_band_ids()));

-- Any member can create songs.
create policy insert_member on app_public.songs
  for insert with check (band_id in (select app_public.current_user_member_band_ids()));

-- Any member can update songs.
create policy update_member on app_public.songs
  for update using (band_id in (select app_public.current_user_member_band_ids()));

-- Any member can delete songs.
create policy delete_member on app_public.songs
  for delete using (band_id in (select app_public.current_user_member_band_ids()));

grant select on app_public.songs to :DATABASE_VISITOR;
grant insert (band_id, title, artist, key, tempo_bpm, duration_seconds, capo, notes, created_by) on app_public.songs to :DATABASE_VISITOR;
grant update (title, artist, key, tempo_bpm, duration_seconds, capo, notes) on app_public.songs to :DATABASE_VISITOR;
grant delete on app_public.songs to :DATABASE_VISITOR;
