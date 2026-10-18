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

## Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.

## Sources

`ATTRIBUTIONS.md` lists every outside source with a link: adapted code, fitted data, served assets, followed research, and libraries licensed beyond MIT. A commit that brings in a source adds its entry, and the code comment that uses it names the source.

## Verification

- `bun run typecheck` — patched `tsc` with Effect diagnostics (`TS377xxx`)
- `bun run lint` — type-aware oxlint with Effect rules (`effecttsgo/*`)
- `bun run prepare` — re-patches `tsc` and `oxlint` binaries after install
- `bun run test` — Playwright specs in `tests/` (needs the dev server and database)
- `bun run test:unit` — pure-module tests next to the code in `src/`
- `bun run test:db` — RLS checks in `tests/db/` as the authenticator, on a scratch database `setlist_test_rls`

## Reaching the dev server from another machine

`HOST=0.0.0.0 bun run dev` makes Vite listen on every interface (it defaults to the host in `VITE_ROOT_URL`, so `localhost`). Open `http://<tailscale-ip-or-name>:3001`. Vite accepts IP addresses and `*.ts.net` names; any other Host header gets a 403. The API server always listens on every interface, and Vite proxies `/api` to it.

## Dev login

Log in as a throwaway user by opening a URL — no signup, no console:

    http://localhost:3001/api/testing/login?username=dev_dan

It creates the user on first use, sets the session cookie, and redirects into the
app. The password defaults to `TestUserPassword`; add `&password=...` to pick one.
Two things to know:

- Pick a username that does NOT start with `test_` or `testuser` — `POST
  /api/testing/clear` deletes exactly those (the Playwright suite calls it).
- This exists only while the testing API is mounted; `src/server/httpapi/testing.ts`
  throws at import under `NODE_ENV=production`.

Scripts can use the JSON form instead: `POST /api/testing/login` with
`{ "username": ..., "password": ... }`.

## Domain Model

- Users + auth (from graphile-starter migrations)
- Organizations = Bands (graphile-starter org pattern, conceptually renamed)
- Songs: band-scoped catalog with rich metadata (title, artist, key, tempo, duration, capo, notes)
- Setlists: ordered collection of songs for a gig, with sections (Set 1, Encore, etc.)
- SetlistEntries: song in a setlist, with optional per-entry overrides (key, tempo, notes) inheriting from song defaults
- Setlist order: every entry and section has a sortable text `position_key` (base-62, collation `C`; `src/components/position.ts` makes a key between two others). A move is `PUT /api/setlists/:id/move` with the row, its section, and `previous` (the row that must stand right before it, or null for first); the server locks the setlist, writes one key between `previous` and its next sibling, and renumbers that group with `rebalance` when a key passes 32 characters, so two people moving different rows at once both survive. Adds take the same lock. Reads order by `position_key, id`. `src/components/arrangement.ts` holds the pure moves. Entries with no section form a group that always comes first.
- Band invitations: `invite_to_band` writes `band_invitations`, which the visitor role cannot select; a user reads their own through `my_band_invitations()` and answers with `accept_invitation_to_band` / `decline_invitation_to_band` (`/api/my/bands/invitations`, panel on the home page). Invitations by email need a code and have no page yet. Specs that only need a second member use `POST /api/testing/band-member`.
- Live setlists: `GET /api/setlists/:id/events` is a server-sent-event stream (`SetlistEvent` in `contracts.ts`). `changed` carries only who wrote, so each page reloads through the normal endpoints and RLS decides what it sees; `presence` lists the people with the setlist open; a performing viewer reports its song number with `POST /:id/presence`, and others can follow it. The hub (`services/setlist-hub.ts`) lives in one process's memory: a second server process would need the events sent through Postgres LISTEN/NOTIFY. Pages use `useSetlistLive` (`components/live.ts`). Writes are announced by `asWriter` in `httpapi/setlists.ts`; a new setlist write handler must use it, and a write to songs does not announce to setlists.
- Performance mode: `/band/:bandId/setlists/:setlistId/perform?at=N` is a full-window dark overlay (`$setlistId_.perform.tsx`; the trailing underscore keeps it from nesting under the setlist page). The URL holds the song number; navigation rules are pure in `src/components/perform.ts`. `src/routeTree.gen.ts` is generated and git-ignored: `bun --env-file=.env -b vite build --outDir <scratch>` regenerates it without a dev server.
- Charts: a song has many charts (lyrics chart or score), each a chain of immutable revisions; a lyrics chart is stored as ChordPro text and is transposed at display time (`src/charts/lyrics.ts`); players read and edit it as chords over lyrics, where ChordPro directives and alphaTex show only for what that form cannot say (docs/adr/0002), so power users can write them. Pasted ASCII tab is stored in `{start_of_tab}` sections, whose lines ChordSheetJS keeps unparsed; they are drawn as written in every key, and the editor puts no chords on them. A phrase (real notation: a riff, lick or groove) is alphaTex in a `{start_of_textblock: Name}` section (docs/adr/0003): `src/charts/phrase.ts` reads it, `Phrase.tsx` draws it on the page's thread and starts alphaTab's player only on the first Play, and the editor writes it with `PhraseForm.tsx`. Marks are a player's own ink/text/stamps anchored to a revision: `src/charts/follow.ts` maps a mark's range through later revisions, `src/charts/marks.ts` resolves marks and draws ink, `MarkedChart.tsx` is the view (a mark sits at its anchored item plus an em offset; the chart must not shift while a drag is in progress). Chord shapes are generated, not looked up: `src/charts/spelling.ts` spells a chord name into required and optional notes, `voicing.ts` searches standard tuning for every playable shape and ranks them (weights fitted to ChordSheetJS's chord table), `fretting.ts` holds barres and fingers, and `ChordShapes.tsx` shows the best 8 when a player taps a chord in Read mode or on stage. Design: `docs/adr/`, vocabulary: `GLOSSARY.md`.
- Reading a chart from a file: `POST /api/charts/read` takes a PDF or an image and returns chords-over-lyrics text for the paste box; nothing is stored, and the player corrects the text beside the file before `importPasted` makes the chart. The server runs `pdftotext -bbox` for a PDF's text layer, or `pdftoppm` and `tesseract` for a scan or photo (`services/chart-reader.ts`), so poppler and tesseract with English data must be installed where the API runs. Both give word boxes, and `src/charts/scanned.ts` places each chord over the lyric character under its left edge. The browser redraws a photo at 3000 pixels on its long side before upload (`ReadChartFile.tsx`): it applies EXIF rotation, and Tesseract misreads one-letter chords in small images. `tests/fixtures/make-scans.ts` regenerates the scan fixtures.
- `generated/DB.ts` holds the Kysely table types and is maintained by hand: add an interface when a migration adds a table.
