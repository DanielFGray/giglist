#!/usr/bin/env bash
# Builds the scratch database giglist_test from the committed migrations and
# then migrations/current, the order graphile-migrate applies them; seeds it;
# and runs the SQL checks in tests/db as the authenticator, so RLS applies.
# Drops and recreates the scratch database every run via ops; leaves the live DB alone.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$here/../.."
cd "$repo"
set -a; source "$repo/.env"; set +a
db=giglist_test
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must be set by ops dev db up}"
: "${DATABASE_URL:?}"
: "${AUTH_DATABASE_URL:?}"
# Shared ops-dev-pg17 roles (postgresRoles + postgresLoginRole), not the old compose logins.
owner="${DATABASE_OWNER:-giglist_owner}"
authenticator="${DATABASE_AUTHENTICATOR:-alchemy_giglist_api}"
visitor="${DATABASE_VISITOR:-giglist_visitor}"
vars=(-v ON_ERROR_STOP=1 -v DATABASE_NAME=$db -v DATABASE_OWNER=$owner -v DATABASE_AUTHENTICATOR=$authenticator -v DATABASE_VISITOR=$visitor)

ops dev db reset "$db"

# afterReset grants + migrations against the ops-provisioned test database.
psql -q "$TEST_DATABASE_URL" "${vars[@]}" -f "$repo/migrations/afterReset.sql"
for file in "$repo"/migrations/committed/*.sql "$repo"/migrations/current/*.sql "$here"/*-seed.sql; do
  [ -e "$file" ] || continue
  psql -q "$TEST_DATABASE_URL" "${vars[@]}" -1 -f "$file"
done
# Owner-only function checks (app_private.login / reset_password): same scratch
# DB, run as the table owner after seeds so the fixtures exist.
# Migration login is already SET ROLE owner; AUTH_DATABASE_URL swapped to the test DB.
test_auth="$(bun -e 'const u=new URL(process.env.AUTH_DATABASE_URL); u.pathname="/giglist_test"; process.stdout.write(u.toString())')"
for file in "$here"/*-owner.sql; do
  [ -e "$file" ] || continue
  psql -q "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
done
for file in "$here"/*-rls.sql; do
  [ -e "$file" ] || continue
  psql -q "$test_auth" -v ON_ERROR_STOP=1 -f "$file"
done
