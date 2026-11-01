#!/usr/bin/env bash
# Builds the scratch database (giglist_dev_test) from the committed migrations and
# then migrations/current, the order graphile-migrate applies them; seeds it;
# and runs the SQL checks in tests/db as the authenticator, so RLS applies.
# Drops and recreates the scratch database every run via ops; leaves the live DB alone.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$here/../.."
cd "$repo"
set -a; source "$repo/.env"; set +a
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must be set by ops dev db up}"
# The scratch database ops dev db provisions: the path of TEST_DATABASE_URL.
db="${TEST_DATABASE_URL##*/}"; db="${db%%\?*}"
: "${DATABASE_URL:?}"
: "${AUTH_DATABASE_URL:?}"
# ops dev db writes the dev roles; the live roles share its server, so there is no fallback.
owner="${DATABASE_OWNER:?}"
authenticator="${DATABASE_AUTHENTICATOR:?}"
visitor="${DATABASE_VISITOR:?}"
# The RLS checks switch to the visitor role inside SQL functions, where psql variables do not
# reach, so they read it from this session setting.
export PGOPTIONS="-c test.visitor=$visitor"
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
test_auth="$(TEST_DB="$db" bun -e 'const u=new URL(process.env.AUTH_DATABASE_URL); u.pathname="/"+process.env.TEST_DB; process.stdout.write(u.toString())')"
for file in "$here"/*-owner.sql; do
  [ -e "$file" ] || continue
  psql -q "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
done
for file in "$here"/*-rls.sql; do
  [ -e "$file" ] || continue
  psql -q "$test_auth" -v ON_ERROR_STOP=1 -f "$file"
done
