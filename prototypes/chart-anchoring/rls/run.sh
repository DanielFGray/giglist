#!/usr/bin/env bash
# PROTOTYPE: builds the scratch database setlist_proto_wipeme from
# migrations/current plus rls/charts.sql, seeds it, and runs rls/test.sql as
# the authenticator. Drops and recreates the scratch database every run.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$here/../../.."
set -a; source "$repo/.env"; set +a
db=setlist_proto_wipeme
swap_db() { echo "${1%/*}/$db"; }
vars=(-v ON_ERROR_STOP=1 -v DATABASE_NAME=$db -v DATABASE_OWNER=setlist -v DATABASE_AUTHENTICATOR=setlist_authenticator -v DATABASE_VISITOR=setlist_visitor)

psql -q "$ROOT_DATABASE_URL" -c "drop database if exists $db" -c "create database $db owner setlist"
psql -q "$(swap_db "$ROOT_DATABASE_URL")" "${vars[@]}" -f "$repo/migrations/afterReset.sql"
for file in "$repo"/migrations/current/*.sql "$here/charts.sql" "$here/seed.sql"; do
  psql -q "$(swap_db "$DATABASE_URL")" "${vars[@]}" -1 -f "$file"
done
psql -q "$(swap_db "$AUTH_DATABASE_URL")" -v ON_ERROR_STOP=1 -f "$here/test.sql"
