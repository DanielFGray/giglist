# GigList

Collaborative musical setlist manager for bands.

## Tech Stack

- **Frontend**: TanStack Start (React 19, file-based routing, SSR), TanStack DB (reactive collections, optimistic mutations), TailwindCSS v4
- **Backend**: Effect-TS services calling PostgreSQL functions via @effect/sql-kysely (no promise conversion)
- **Database**: PostgreSQL 17 with graphile-migrate, graphile-worker — local shared cluster via `ops dev db up` (`ops-dev-pg17` on `127.0.0.1:5417`); compose only runs Valkey
- **Runtime**: Bun

## Backend reference

The backend follows ~/build/effect-web-template. Before you add or change a
backend pattern (config, HTTP server, database access, errors, sessions, rate
limits, Valkey, realtime, worker, tests), read how the template does it and do
the same. Security code and auth SQL will come from `@danielfgray/stompbox`
(~/build/stompbox); this app does not depend on it yet.

When the template has no pattern for what you need, file a task in
effect-web-template and ask; do not invent a local one.

## Effect Patterns

- Use @effect/sql-kysely for all queries — stay in Effect, no promise conversion
- Database access via the `RequestDatabase` tag, which only `withAuthContext` provides
- Use `withAuthContext` pattern to set RLS session context before queries

## Design references

- Read [docs/design/data-access.md](docs/design/data-access.md) before changing database access, rate limits, or public-page security.
- Read [docs/design/domain-model.md](docs/design/domain-model.md) before changing songs, setlists, gigs, invitations, live updates, or performance mode.
- Read [docs/design/charts.md](docs/design/charts.md) before changing chart formats or reading flows.
- Decisions with their reasons are in `docs/adr/`; the project vocabulary is in `GLOSSARY.md`.

## Verification

- `bun run typecheck` — patched `tsc` with Effect diagnostics (`TS377xxx`)
- `bun run lint` — type-aware oxlint with Effect rules (`effecttsgo/*`)
- `bun run prepare` — re-patches `tsc` and `oxlint` binaries after install
- `bun run test` — Playwright specs in `tests/`; builds the client and serves it on `vite preview` (needs the database and the API on `PORT`, which Playwright starts if it is down)
- `bun run test:clean` — deletes the `test_*` users and bands the specs left behind (run it when no suite is running)
- `bun run test:unit` — the vitest `unit` project: tests next to the code in `src/` and `worker/`, no database
- `bun run test:db` — RLS checks in `tests/db/` as the authenticator, on a scratch database `giglist_dev_test` (`ops dev db reset`)
- `bun run test:api` — HTTP API tests in `src/**/*.api.test.ts`, run in-process by vitest on `giglist_dev_test` (it recreates that database, so do not run it at the same time as `test:db`)

## Reaching the dev server from another machine

`HOST=0.0.0.0 bun run dev` makes Vite listen on every interface (it defaults to the host in `VITE_ROOT_URL`, so `localhost`). Open `http://<tailscale-ip-or-name>:3001`. Vite accepts IP addresses and `*.ts.net` names; any other Host header gets a 403. The API server listens on loopback by default. Set `API_HOST=0.0.0.0` when the API must accept remote connections. Vite proxies `/api` to it.

## Dev login

Log in as a throwaway user by opening a URL — no signup, no console:

    http://localhost:3001/api/testing/login?username=dev_dan

It creates the user on first use, sets the session cookie, and redirects into the
app. The password defaults to `TestUserPassword`; add `&password=...` to pick one.
Two things to know:

- Pick a username that does NOT start with `test_` or `testuser` — `POST
  /api/testing/clear` (and `bun run test:clean`) deletes exactly those.
- This exists only while the testing API is mounted: `src/server/runtime.ts` does not
  import `src/server/httpapi/testing.ts` under `NODE_ENV=production`, and the testing
  group's layer dies at build if anything else does.

Scripts can use the JSON form instead: `POST /api/testing/login` with
`{ "username": ..., "password": ... }`.

## Live update rule

Every write to a setlist or gig must announce the affected rooms after its transaction commits; song writes announce to no room. Read [docs/design/domain-model.md](docs/design/domain-model.md) for how each write determines its rooms.

## Chart patch rule

Carry the alphaTab patch in `patches/` forward when upgrading alphaTab. Read [docs/design/charts.md](docs/design/charts.md) for the score-reading behavior it preserves.

## Generated database types

- `generated/DB.ts` holds the Kysely table types and is maintained by hand: add an interface when a migration adds a table.

## Public page security rule

Keep `bands` member-scoped under RLS. Public pages must use the security-definer functions `public_band`, `public_band_members`, `public_band_gig_dates`, and `public_band_songs`; do not add a select policy on `bands` for public pages, because that would expose every band to queries that trust RLS. Read [docs/design/data-access.md](docs/design/data-access.md) for the full public-page behavior.
