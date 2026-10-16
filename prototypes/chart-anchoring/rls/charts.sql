/*
 * PROTOTYPE draft schema for charts and personal marks. Applied only to the
 * scratch database setlist_proto_wipeme by rls/run.sh; not a migration.
 *
 * A song has many charts (lyrics and chords, a Guitar Pro score, ...). A chart
 * is a chain of immutable revisions. A mark belongs to one user and is anchored
 * to a range in the revision it was made on; the app maps that range to later
 * revisions through each revision's change set.
 */

create table app_public.charts (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references app_public.songs on delete cascade,
  kind text not null check (kind in ('lyrics', 'score')),
  name text not null check (length(name) between 1 and 200),
  -- The key the chart is written in; display-time transposition starts here.
  written_key app_public.musical_key,
  created_by uuid references app_public.users on delete set null,
  created_at timestamptz not null default now()
);
alter table app_public.charts enable row level security;
create index on app_public.charts (song_id);

-- A chart is visible where its song is: the subquery runs under the songs policy.
create policy select_song_visible on app_public.charts
  for select using (exists (select 1 from app_public.songs s where s.id = song_id));
create policy insert_song_visible on app_public.charts
  for insert with check (exists (select 1 from app_public.songs s where s.id = song_id));
create policy update_song_visible on app_public.charts
  for update using (exists (select 1 from app_public.songs s where s.id = song_id));
create policy delete_song_visible on app_public.charts
  for delete using (exists (select 1 from app_public.songs s where s.id = song_id));

grant select, delete on app_public.charts to :DATABASE_VISITOR;
grant insert (song_id, kind, name, written_key, created_by) on app_public.charts to :DATABASE_VISITOR;
grant update (name, written_key) on app_public.charts to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * Revisions are never updated: marks anchored to one must find the same
 * content forever. The current revision is the newest one.
 */
create table app_public.chart_revisions (
  id uuid primary key default gen_random_uuid(),
  chart_id uuid not null references app_public.charts on delete cascade,
  parent_id uuid references app_public.chart_revisions,
  -- Lyrics charts store their text; scores store the uploaded file's bytes by key.
  source text check (length(source) <= 200000),
  file_key text,
  file_sha256 bytea,
  -- The change set the editor recorded against the parent, per anchor scope.
  -- Null when the revision came from outside the editor; the app derives it.
  changes jsonb,
  created_by uuid references app_public.users on delete set null,
  created_at timestamptz not null default now(),
  check ((source is null) <> (file_key is null)),
  check ((file_key is null) = (file_sha256 is null)),
  check (parent_id is not null or changes is null)
);
alter table app_public.chart_revisions enable row level security;
create index on app_public.chart_revisions (chart_id, created_at desc);

create policy select_chart_visible on app_public.chart_revisions
  for select using (exists (select 1 from app_public.charts c where c.id = chart_id));
create policy insert_chart_visible on app_public.chart_revisions
  for insert with check (exists (select 1 from app_public.charts c where c.id = chart_id));

grant select on app_public.chart_revisions to :DATABASE_VISITOR;
grant insert (chart_id, parent_id, source, file_key, file_sha256, changes, created_by)
  on app_public.chart_revisions to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * A player's mark. `scope` names what the range counts: characters of the
 * lyrics chart's anchor text ({"kind":"chart"}) or beats of one voice
 * ({"kind":"voice","track":0,"staff":0,"voice":0}). Placement offsets and
 * scale are in em, so marks follow the chart's font size.
 */
create table app_public.marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default app_public.current_user_id() references app_public.users on delete cascade,
  revision_id uuid not null references app_public.chart_revisions on delete cascade,
  scope jsonb not null,
  range_start int not null check (range_start >= 0),
  range_end int not null check (range_end > range_start),
  side text not null check (side in ('inline', 'margin')),
  dx real not null,
  dy real not null,
  scale real not null check (scale > 0),
  body jsonb not null,
  visibility text not null default 'private' check (visibility in ('private', 'band')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.marks enable row level security;
create index on app_public.marks (revision_id, user_id);
create index on app_public.marks (user_id);

create trigger _100_timestamps
  before insert or update on app_public.marks
  for each row
  execute procedure app_private.tg__timestamps();

-- Your own marks, plus marks bandmates chose to share, on charts you can see.
create policy select_own_or_shared on app_public.marks
  for select using (
    (user_id = app_public.current_user_id() or visibility = 'band')
    and exists (select 1 from app_public.chart_revisions r where r.id = revision_id)
  );
create policy insert_own on app_public.marks
  for insert with check (
    user_id = app_public.current_user_id()
    and exists (select 1 from app_public.chart_revisions r where r.id = revision_id)
  );
create policy update_own on app_public.marks
  for update using (user_id = app_public.current_user_id())
  with check (exists (select 1 from app_public.chart_revisions r where r.id = revision_id));
create policy delete_own on app_public.marks
  for delete using (user_id = app_public.current_user_id());

grant select, delete on app_public.marks to :DATABASE_VISITOR;
grant insert (revision_id, scope, range_start, range_end, side, dx, dy, scale, body, visibility)
  on app_public.marks to :DATABASE_VISITOR;
-- Moving a mark re-anchors it to the revision it was dropped on.
grant update (revision_id, scope, range_start, range_end, side, dx, dy, scale, body, visibility)
  on app_public.marks to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

-- A player's saved mark bodies. Pasting copies the body into a new mark.
create table app_public.stamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default app_public.current_user_id() references app_public.users on delete cascade,
  name text not null check (length(name) between 1 and 200),
  body jsonb not null,
  created_at timestamptz not null default now()
);
alter table app_public.stamps enable row level security;
create index on app_public.stamps (user_id);

create policy all_own on app_public.stamps
  for all using (user_id = app_public.current_user_id())
  with check (user_id = app_public.current_user_id());

grant select, delete on app_public.stamps to :DATABASE_VISITOR;
grant insert (name, body) on app_public.stamps to :DATABASE_VISITOR;
grant update (name, body) on app_public.stamps to :DATABASE_VISITOR;
