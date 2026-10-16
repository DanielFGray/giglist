#!/usr/bin/env bash
# Builds the scratch database setlist_test_rls from migrations/current, seeds it,
# and runs the SQL checks in tests/db as the authenticator, so RLS applies.
# Drops and recreates the scratch database every run; leaves the dev database alone.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$here/../.."
set -a; source "$repo/.env"; set +a
db=setlist_test_rls
swap_db() { echo "${1%/*}/$db"; }
vars=(-v ON_ERROR_STOP=1 -v DATABASE_NAME=$db -v DATABASE_OWNER=setlist -v DATABASE_AUTHENTICATOR=setlist_authenticator -v DATABASE_VISITOR=setlist_visitor)

psql -q "$ROOT_DATABASE_URL" -c "drop database if exists $db" -c "create database $db owner setlist"
psql -q "$(swap_db "$ROOT_DATABASE_URL")" "${vars[@]}" -f "$repo/migrations/afterReset.sql"
for file in "$repo"/migrations/current/*.sql "$here"/*-seed.sql; do
  psql -q "$(swap_db "$DATABASE_URL")" "${vars[@]}" -1 -f "$file"
done
for file in "$here"/*-rls.sql; do
  psql -q "$(swap_db "$AUTH_DATABASE_URL")" -v ON_ERROR_STOP=1 -f "$file"
done
