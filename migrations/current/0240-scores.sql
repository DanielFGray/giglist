/*
 * The bytes of a score revision: the Guitar Pro file a player uploaded, kept
 * unchanged (docs/adr/0002). They live in the database so one backup, one set
 * of row-level security policies and one transaction cover a score and its
 * revision. Revisions are immutable, so a file row is inserted once and never
 * updated.
 */

create table app_public.score_files (
  revision_id uuid primary key references app_public.chart_revisions on delete cascade,
  bytes bytea not null check (length(bytes) between 1 and 20971520)
);
alter table app_public.score_files enable row level security;

comment on table app_public.score_files is
  E'The uploaded Guitar Pro file of a score revision, byte for byte. Never re-exported.';
comment on column app_public.chart_revisions.file_key is
  E'Name of the uploaded Guitar Pro file of a score. The bytes are in score_files.';

-- A file is visible and insertable wherever its revision is.
create policy select_revision_visible on app_public.score_files
  for select using (exists (select 1 from app_public.chart_revisions r where r.id = revision_id));
create policy insert_revision_visible on app_public.score_files
  for insert with check (exists (select 1 from app_public.chart_revisions r where r.id = revision_id));

grant select on app_public.score_files to :DATABASE_VISITOR;
grant insert (revision_id, bytes) on app_public.score_files to :DATABASE_VISITOR;

/*
 * The stored bytes must be the bytes the revision's hash names, so a client
 * cannot attach a different file to a revision after the fact.
 */
create function app_private.tg__score_file_matches_revision() returns trigger as $$
declare
  expected bytea;
begin
  select file_sha256 into expected from app_public.chart_revisions where id = new.revision_id;
  if expected is null then
    raise exception 'no file revision with that id is visible to you' using errcode = 'check_violation';
  end if;
  if sha256(new.bytes) <> expected then
    raise exception 'the file does not match the revision''s sha256' using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger _100_matches_revision
  before insert on app_public.score_files
  for each row
  execute procedure app_private.tg__score_file_matches_revision();

/*
 * The other direction: a revision that names a file must get its bytes before
 * the transaction commits. Deferred, because the revision is inserted first.
 */
create function app_private.tg__file_revision_has_bytes() returns trigger as $$
begin
  if not exists (select 1 from app_public.score_files where revision_id = new.id) then
    raise exception 'a file revision needs its bytes in score_files' using errcode = 'check_violation';
  end if;
  return null;
end;
$$ language plpgsql;

create constraint trigger _200_has_bytes
  after insert on app_public.chart_revisions
  deferrable initially deferred
  for each row
  when (new.file_key is not null)
  execute procedure app_private.tg__file_revision_has_bytes();
