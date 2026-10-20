#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROOT_DATABASE_URL:?ROOT_DATABASE_URL must be set}"

backup_dir=${BACKUP_DIR:-/var/backups/giglist}
scratch_db=giglist_restore_check

db_name_from_url() {
  local url=$1
  url=${url%%\?*}
  url=${url%%#*}
  printf '%s' "${url##*/}"
}

source_db=$(db_name_from_url "$DATABASE_URL")
if [[ "$source_db" == "$scratch_db" ]]; then
  echo "refusing to run: DATABASE_URL points at the scratch database $scratch_db" >&2
  exit 1
fi

root_db=$(db_name_from_url "$ROOT_DATABASE_URL")
if [[ "$root_db" == "$scratch_db" ]]; then
  echo "refusing to run: ROOT_DATABASE_URL points at the scratch database $scratch_db" >&2
  exit 1
fi

if (( $# > 1 )); then
  echo "Usage: bash scripts/restoreCheck.sh [dump-file]" >&2
  exit 2
fi

if (( $# == 1 )); then
  dump=$1
else
  if [[ ! -d "$backup_dir" ]]; then
    echo "no backup directory: $backup_dir" >&2
    exit 1
  fi
  # Newest by modification time; dump names also sort by their timestamp.
  dump=$(find "$backup_dir" -maxdepth 1 -type f -name 'giglist-*.dump' \
    -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)
  if [[ -z "$dump" ]]; then
    echo "no dumps found in $backup_dir" >&2
    exit 1
  fi
fi

if [[ ! -f "$dump" ]]; then
  echo "dump file not found: $dump" >&2
  exit 1
fi

# Same server and credentials as ROOT_DATABASE_URL, at the scratch database.
root_base=${ROOT_DATABASE_URL%%\?*}
root_query=
if [[ "$ROOT_DATABASE_URL" == *\?* ]]; then
  root_query="?${ROOT_DATABASE_URL#*\?}"
fi
scratch_url="${root_base%/*}/$scratch_db$root_query"

created=0
drop_scratch() {
  local status=$?
  if (( created == 1 )); then
    psql "$ROOT_DATABASE_URL" --no-psqlrc --quiet -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS \"$scratch_db\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap drop_scratch EXIT

# Clear a scratch database left behind by an interrupted earlier run.
psql "$ROOT_DATABASE_URL" --no-psqlrc --quiet -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$scratch_db\" WITH (FORCE)"
psql "$ROOT_DATABASE_URL" --no-psqlrc --quiet -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"$scratch_db\""
created=1

echo "Restoring $dump into $scratch_db"
pg_restore --no-owner --no-privileges --dbname="$scratch_url" "$dump"

for table in users bands songs; do
  exists=$(psql "$scratch_url" --no-psqlrc --tuples-only --no-align \
    -v ON_ERROR_STOP=1 -c "SELECT to_regclass('app_public.$table') IS NOT NULL")
  if [[ "$exists" != "t" ]]; then
    echo "missing table after restore: app_public.$table" >&2
    exit 1
  fi
  count=$(psql "$scratch_url" --no-psqlrc --tuples-only --no-align \
    -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM app_public.$table")
  printf 'app_public.%s: %s\n' "$table" "$count"
done

echo "Restore check passed: $dump"
