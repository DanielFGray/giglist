# SetList

Collaborative musical setlist manager for bands.

## Tech Stack

- **Frontend**: TanStack Start (React 19, file-based routing, SSR), TanStack DB (reactive collections, optimistic mutations), TailwindCSS v4
- **Backend**: Effect-TS services calling PostgreSQL functions via @effect/sql-kysely (no promise conversion)
- **Database**: PostgreSQL 17 with graphile-migrate, graphile-worker
- **Runtime**: Bun

## Database Conventions (from graphile-starter)

- Three schemas: `app_public` (user-visible), `app_hidden` (internal but accessible), `app_private` (never exposed)
- RLS on all tables, scoped via `current_user_id()` / `current_session_id()`
- Business logic lives in PG functions (register, login, invite, accept, etc.) — Effect services wrap these, they don't reimplement them
- graphile-worker handles background jobs (email, audit) triggered by PG triggers
- graphile-migrate manages migrations: `migrations/committed/` (applied) and `migrations/current/` (in-progress)

## Two Database Connections

The app opens two pools, and which one a query uses decides whether RLS applies:

- `Db` — `DATABASE_URL`, the table **owner**. PostgreSQL skips RLS policies for the owner, so this pool is only for `app_private` (sessions, user creation) and tooling that must ignore policies.
- `AuthDb` — `AUTH_DATABASE_URL`, the **authenticator**. Requests run here, wrapped in `withAuthContext`, which sets the visitor role and `my.session_id` in a transaction. The role is transaction-local, so the connection returns to the authenticator when the request ends.

A service that reads or writes user data must `yield* Kysely` (the tag `withAuthContext` provides). Yielding `Db` directly bypasses every policy.

## Effect Patterns

- Use @effect/sql-kysely for all queries — stay in Effect, no promise conversion
- Services follow `Effect.Service` pattern (see postgres.garden for reference)
- Database access via `Kysely` tag, backed by `Db` by default and swapped by `withAuthContext`
- Use `withAuthContext` pattern to set RLS session context before queries

## Domain Model

- Users + auth (from graphile-starter migrations)
- Organizations = Bands (graphile-starter org pattern, conceptually renamed)
- Songs: band-scoped catalog with rich metadata (title, artist, key, tempo, duration, capo, notes)
- Setlists: ordered collection of songs for a gig, with sections (Set 1, Encore, etc.)
- SetlistEntries: song in a setlist, with optional per-entry overrides (key, tempo, notes) inheriting from song defaults
