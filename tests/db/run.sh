#!/usr/bin/env bash
# Builds the scratch database giglist_test_rls from the committed migrations and
# then migrations/current, the order graphile-migrate applies them; seeds it;
# and runs the SQL checks in tests/db as the authenticator, so RLS applies.
# Drops and recreates the scratch database every run; leaves the dev database alone.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$here/../.."
set -a; source "$repo/.env"; set +a
db=giglist_test_rls
swap_db() { echo "${1%/*}/$db"; }
# Shared ops-dev-pg17 roles (postgresRoles + postgresLoginRole), not the old compose logins.
owner="${DATABASE_OWNER:-giglist_owner}"
authenticator="${DATABASE_AUTHENTICATOR:-alchemy_giglist_api}"
visitor="${DATABASE_VISITOR:-giglist_visitor}"
vars=(-v ON_ERROR_STOP=1 -v DATABASE_NAME=$db -v DATABASE_OWNER=$owner -v DATABASE_AUTHENTICATOR=$authenticator -v DATABASE_VISITOR=$visitor)

psql -q "$ROOT_DATABASE_URL" -c "drop database if exists $db" -c "create database $db owner $owner"
psql -q "$(swap_db "$ROOT_DATABASE_URL")" "${vars[@]}" -f "$repo/migrations/afterReset.sql"
for file in "$repo"/migrations/committed/*.sql "$repo"/migrations/current/*.sql "$here"/*-seed.sql; do
  psql -q "$(swap_db "$DATABASE_URL")" "${vars[@]}" -1 -f "$file"
done
# Owner-only function checks (app_private.login / reset_password): same scratch
# DB, run as the table owner after seeds so the fixtures exist.
for file in "$here"/*-owner.sql; do
  psql -q "$(swap_db "$DATABASE_URL")" -v ON_ERROR_STOP=1 -f "$file"
done
for file in "$here"/*-rls.sql; do
  psql -q "$(swap_db "$AUTH_DATABASE_URL")" -v ON_ERROR_STOP=1 -f "$file"
done
