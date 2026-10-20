#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL must be set}"

backup_dir=${BACKUP_DIR:-/var/backups/giglist}
mkdir -p "$backup_dir"

timestamp=$(date +%Y%m%d-%H%M%S)
dest="$backup_dir/giglist-$timestamp.dump"
partial="$backup_dir/.giglist-$timestamp.dump.partial"

# Write to a name that never matches *.dump, and remove it on any failure,
# so a failed dump leaves no partial file behind.
cleanup_partial() {
  rm -f "$partial"
}
trap cleanup_partial EXIT

pg_dump --format=custom --file="$partial" "$DATABASE_URL"
mv "$partial" "$dest"
trap - EXIT

# Retention: keep 14 days of dumps. -mtime +13 matches files whose data was
# last modified at least 14*24h ago (find rounds the age down to whole days).
find "$backup_dir" -maxdepth 1 -type f -name 'giglist-*.dump' -mtime +13 -delete

printf '%s\n' "$dest"

if [[ -n ${BACKUP_COPY_CMD:-} ]]; then
  # BACKUP_COPY_CMD is a command (a wrapper script, or a command with its own
  # flags); the new dump's path is appended as its final, only added argument.
  read -r -a copy_cmd <<<"$BACKUP_COPY_CMD"
  "${copy_cmd[@]}" "$dest"
fi
