/* Replace gap integers with sortable keys so one move updates one row. */
alter table app_public.setlist_sections
  add column position_key text collate "C" not null default 'U';
alter table app_public.setlist_entries
  add column position_key text collate "C" not null default 'U';

with numbered as (
  select id, lpad(row_number() over (partition by setlist_id order by position, id)::text, 12, '0') as key
  from app_public.setlist_sections
)
update app_public.setlist_sections s
set position_key = numbered.key
from numbered
where numbered.id = s.id;

with numbered as (
  select id, lpad(row_number() over (partition by setlist_id, section_id order by position, id)::text, 12, '0') as key
  from app_public.setlist_entries
)
update app_public.setlist_entries e
set position_key = numbered.key
from numbered
where numbered.id = e.id;

alter table app_public.setlist_sections alter column position_key drop default;
alter table app_public.setlist_entries alter column position_key drop default;
drop view app_public.setlist_entries_resolved;
alter table app_public.setlist_sections drop column position;
alter table app_public.setlist_entries drop column position;

create index idx_setlist_sections_setlist_key on app_public.setlist_sections (setlist_id, position_key);
create index idx_setlist_entries_section_key on app_public.setlist_entries (setlist_id, section_id, position_key);

grant insert (position_key) on app_public.setlist_sections to :DATABASE_VISITOR;
grant insert (position_key) on app_public.setlist_entries to :DATABASE_VISITOR;
grant update (position_key) on app_public.setlist_sections to :DATABASE_VISITOR;
grant update (section_id, position_key) on app_public.setlist_entries to :DATABASE_VISITOR;

create view app_public.setlist_entries_resolved as
  select
    e.id, e.setlist_id, e.section_id, e.song_id, e.position_key,
    s.title, s.artist,
    coalesce(e.key_override, s.key) as key,
    coalesce(e.tempo_override, s.tempo_bpm) as tempo_bpm,
    coalesce(e.notes_override, s.notes) as notes,
    s.duration_seconds, s.capo,
    e.key_override is not null as key_overridden,
    e.tempo_override is not null as tempo_overridden,
    e.notes_override is not null as notes_overridden,
    e.created_at, e.updated_at
  from app_public.setlist_entries e
  join app_public.songs s on s.id = e.song_id;
alter view app_public.setlist_entries_resolved set (security_invoker = true);
grant select on app_public.setlist_entries_resolved to :DATABASE_VISITOR;
