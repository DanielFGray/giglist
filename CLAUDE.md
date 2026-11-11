# GigList

Collaborative musical setlist manager for bands.

## Tech Stack

- **Frontend**: TanStack Start (React 19, file-based routing, SSR), TanStack DB (reactive collections, optimistic mutations), TailwindCSS v4
- **Backend**: Effect-TS services calling PostgreSQL functions via @effect/sql-kysely (no promise conversion)
- **Database**: PostgreSQL 17 with graphile-migrate, graphile-worker — local shared cluster via `ops dev db up` (`ops-dev-pg17` on `127.0.0.1:5417`); compose only runs Valkey
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

A service that reads or writes user data must `yield* RequestDatabase`, which only `withAuthContext` provides; with no request session (the public pages) it runs as an anonymous visitor. Yielding `Db` directly bypasses every policy.

## Rate limits

An endpoint is limited when its contract adds `RateLimitMiddleware`, before `SessionMiddleware` so the limit can key on the signed-in user. The limit itself is a row of `rules` in `src/server/httpapi/rate-limit.ts`, found by the endpoint's name. Counts live in the shared Valkey instance (`VALKEY_URL`, keys `${VALKEY_KEY_PREFIX}rl:*`, so `giglist:rl:*`); `RATE_LIMIT=off` disables the middleware, and Playwright sets it. The caller is `X-Real-IP` (set by the edge proxy, Traefik in production; IPv6 grouped by /64, `client-ip.ts`), or the socket address in development. Each recipient address also has a cap of 5 mails per hour, checked by the worker's `send_email` task (`worker/email/send-email.ts`), the one place every email passes; security notices (`account_activity.mjml`) are exempt. The worker runs in the API process and shares its limiter (`RateLimiterValkey` in `src/server/services/rate-limiter.ts`), which `ServerLive` provides once; the API tests use `RateLimiterMemory`.

## Backend reference

The backend follows ~/build/effect-web-template. Before you add or change a
backend pattern (config, HTTP server, database access, errors, sessions, rate
limits, Valkey, realtime, worker, tests), read how the template does it and do
the same. Security code and auth SQL come from the ~/build/effect-backend
packages.

When the template has no pattern for what you need, file a task in
effect-web-template and ask; do not invent a local one.

## Effect Patterns

- Use @effect/sql-kysely for all queries — stay in Effect, no promise conversion
- Services follow `Effect.Service` pattern (see postgres.garden for reference)
- Database access via the `RequestDatabase` tag, which only `withAuthContext` provides
- Use `withAuthContext` pattern to set RLS session context before queries

## Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.

## Verification

- `bun run typecheck` — patched `tsc` with Effect diagnostics (`TS377xxx`)
- `bun run lint` — type-aware oxlint with Effect rules (`effecttsgo/*`)
- `bun run prepare` — re-patches `tsc` and `oxlint` binaries after install
- `bun run test` — Playwright specs in `tests/`; builds the client and serves it on `vite preview` (needs the database and the API on `PORT`, which Playwright starts if it is down)
- `bun run test:clean` — deletes the `test_*` users and bands the specs left behind (run it when no suite is running)
- `bun run test:unit` — pure-module tests next to the code in `src/`
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

## Domain Model

- Users + auth (from graphile-starter migrations)
- Organizations = Bands (graphile-starter org pattern, conceptually renamed)
- Songs: band-scoped catalog with rich metadata (title, artist, key, tempo, duration, capo, notes)
- Setlists: a named, ordered list of songs with a status (draft, rehearsal, final). A setlist has no venue, date or sections: those belong to the gig. One setlist can serve many gigs, and an edit to it changes every gig that plays it. A setlist's page adds it to any of the band's gigs. A copy is a separate list with the same songs and overrides: "Copy" on the setlists page (`POST /api/setlists/:id/copy`) makes one in no gig, and "Copy for this gig" on a gig's page (`POST /api/gigs/:id/setlists/:setlistId/copy`) puts one in the original's place in that gig only, while the other gigs keep the original. The gig page shows that button only on a setlist that other gigs also play (`gig_count` on `GigSetlist`)
- SetlistEntries: song in a setlist, with optional per-entry overrides (key, tempo, notes) inheriting from song defaults. Only catalog songs go in a setlist; the song's own fields (title, artist, length) are edited on the Songs page
- Gigs: one performance, with an optional `venue`, `gig_date`, `address`, `notes` and, as wall-clock times at the venue on `gig_date` (`time` without a time zone), `load_in_time` and `performance_time`. A gig has no name: the app labels it by its venue, or by its date when it has none (`gigLabel` in `src/components/gig-label.ts`). `gig_setlists` lists the setlists a gig plays, in order, each at most once; a gig's sets are its setlists. Only the venue and date of upcoming gigs are public on the band page; the rest stays private to the band. Deleting a setlist takes it out of every gig
- Order: setlist entries, and a gig's setlists, each have a sortable text `position_key` (base-62, collation `C`; `src/components/position.ts` makes a key between two others). A move is `PUT /api/setlists/:id/move` or `PUT /api/gigs/:id/setlists/move` with `{ id, previous }` (`previous` is the row that must stand right before it, or null for first); the server locks the setlist or gig, and `placeAfter` writes one key between `previous` and its next sibling, or renumbers the list when a key passes 32 characters, so two people moving different rows at once both survive. Adds take the same lock. Reads order by `position_key, id`. `src/components/arrangement.ts` holds the pure moves
- Spreadsheet grids: the Songs page and a setlist's page edit rows in `Grid.tsx`, a `role="grid"` table built here because React Aria's table keeps the arrow keys from a cell's input. The keys are pure in `src/components/grid-keys.ts`: arrows move, Tab and Enter save and move, typing starts an edit, Delete clears, Escape cancels, Alt+↑/↓ moves a row, Ctrl+Delete removes one. A column's `save` resolves once the page has reloaded the row; until then the cell shows what was typed and carries `aria-busy`. The last row adds a row, so a band can type a run of titles and fill the other columns later. The gig page uses React Aria's `GridList` (drag and keyboard reorder) and `ComboBox` (pick a setlist, or type a new name to make one)
- Band invitations: `invite_to_band` writes `band_invitations`, which the visitor role cannot select; a user reads their own through `my_band_invitations()` and answers with `accept_invitation_to_band` / `decline_invitation_to_band` (`/api/my/bands/invitations`, panel on the home page). An invitation to an email address has a code: `band_invitations__send_invite` mails a link to `/invitations/accept?id=…&code=…`, and the signed-in invitee presses Accept, which posts `{ code }` (an account invitation posts `code: null`). A wrong code fails with `INCOD`. Specs read an invitation's id and code from `GET /api/testing/band-invitation`, and specs that only need a second member use `POST /api/testing/band-member`.
- Public band pages: a band has a page at `/b/:slug` only while its owner keeps `bands.is_public` on (the "Enable public profile" switch on the band page; off by default); anyone can open it, signed in or not. `bands` stays member-scoped under RLS; the page reads only through the security-definer functions `public_band`, `public_band_members`, `public_band_gig_dates` (upcoming only; venue and date) and `public_band_songs`. All four return no rows while the page is off, and each list function also returns none while the owner keeps that list hidden. Do not add a select policy on `bands` for the page: "my bands" and every later query that trusts RLS would then see every band. The look is a theme the band writes (docs/adr/0006): `bands.page_theme` is an HTML document with Tumblr-style theme tags (null means Classic), and `bands.page_options` holds the band's values for the options the theme declares with `<meta name="color:Accent" content="…">`. `src/components/band-theme.ts` fills the tags in, `src/components/themes/*.html` are the starter themes, and `BandPage.tsx` shows the result in a sandboxed iframe on `/b/:slug` and as the live preview in the band settings. The description is Markdown (docs/adr/0010): `src/components/description.ts` renders it (`{DescriptionHTML}`; `{Description}` is the source), and a YouTube, Spotify, Vimeo, TikTok or Instagram link standing alone becomes that provider's player. The frame allows scripts only for those players: it still has no forms or same-origin access, and `src/components/theme-sanitize.ts` strips the theme's own scripts, handlers and frames first. Specs read the page through the frame: `locator('[data-pwid="public-band-page"]').contentFrame()`.
- Public user profiles: a user has a page at `/u/:username` only while they keep `users.is_public` on (the "Public profile" switch in Settings; off by default, docs/adr/0011). Like a band page it is a theme the user writes (docs/adr/0012): `users.page_theme`/`page_options` mirror the band columns, `userScope` in `band-theme.ts` fills the tags (`{DisplayName}`, `{BioHTML}` for the Markdown bio, `<block:Band>` for their public bands), a null theme means the built-in default in `user-theme.html`, and profiles have no starter themes — Restore in Settings returns to the default. `UserPage.tsx` shows it in the same sanitised sandbox frame as a band page, previewed live in Settings. The page reads only through the security-definer functions `public_user` and `public_user_bands`, which return no rows while the profile is off. A member's bio never appears on a band page.
- Live pages: a setlist and a gig are each a room. `GET /api/setlists/:id/events` and `GET /api/gigs/:id/events` are server-sent-event streams (`LiveEvent` in `src/api/setlists.ts`). `changed` carries only who wrote, so each page reloads through the normal endpoints and RLS decides what it sees; `presence` lists the people with the room open; a performing viewer reports its song number with `POST /:id/presence`, and others can follow it. The hub (`services/live-hub.ts`) lives in one process's memory: a second server process would need the events sent through Postgres LISTEN/NOTIFY. Pages use `useLive` (`components/live.ts`). A write method of the `Setlists` or `Gigs` service (`services/setlists.ts`, `services/gigs.ts`) returns a `Written` that names its rooms: a setlist write, the setlist and every gig that plays it; a gig write, the gig and every setlist it played before or after the write, because a setlist's page lists its gigs. Its handler pipes `announced` after the transaction, so the rooms hear only committed writes. A new write must do the same, and a write to songs announces to no room.
- Performance mode: `/band/:bandId/gigs/:gigId/perform?at=N` plays a gig's setlists one after the other, with each song headed by its setlist's name; `/band/:bandId/setlists/:setlistId/perform?at=N` plays one setlist, for rehearsal. Both are full-window dark overlays drawn by `PerformView.tsx` (the trailing underscore in `$gigId_.perform.tsx` and `$setlistId_.perform.tsx` keeps them from nesting under their pages). The URL holds the song number, counted across the whole gig; navigation rules are pure in `src/components/perform.ts`. `src/routeTree.gen.ts` is generated and git-ignored: `bun --env-file=.env -b vite build --outDir <scratch>` regenerates it without a dev server.
- Charts: a song has many charts (lyrics chart or score), each a chain of immutable revisions; a lyrics chart is stored as ChordPro text and is transposed at display time (`src/charts/lyrics.ts`); players read and edit it as chords over lyrics, where ChordPro directives and alphaTex show only for what that form cannot say (docs/adr/0002), so power users can write them. Pasted ASCII tab is stored in `{start_of_tab}` sections, whose lines ChordSheetJS keeps unparsed; they are drawn as written in every key, and the editor puts no chords on them. A phrase (real notation: a riff, lick or groove) is alphaTex in a `{start_of_textblock: Name}` section (docs/adr/0003): `src/charts/phrase.ts` reads it, `Phrase.tsx` draws it on the page's thread and starts alphaTab's player only on the first Play, and the editor writes it with `PhraseForm.tsx`. A player can also record a phrase (docs/adr/0013): 'Record a take' in the phrase form (`RecordTake.tsx`) plays the click with the mic open, and `src/charts/take.ts` snaps the notes to 16ths and writes them as a slash staff; the audio stays in the browser. Marks are a player's own ink/text/stamps anchored to a revision: `src/charts/follow.ts` maps a mark's range through later revisions, `src/charts/marks.ts` resolves marks and draws ink, `MarkedChart.tsx` is the view (a mark sits at its anchored item plus an em offset; the chart must not shift while a drag is in progress). Chord shapes are generated, not looked up: `src/charts/spelling.ts` spells a chord name into required and optional notes, `voicing.ts` searches standard tuning for every playable shape and ranks them (weights fitted to ChordSheetJS's chord table), `fretting.ts` holds barres and fingers, and `ChordShapes.tsx` shows the best 8 when a player taps a chord in Read mode or on stage. Numerals (`src/charts/numeral.ts`) mark inversions with figured bass and label an applied chord (V7/vi) only when the next chord is its target, so `chordNumerals` labels a whole chart at once. In the editor a player taps a word and types its chord into `ChordInput.tsx`; Tab goes to the next word. The field lists chords from `src/charts/suggest.ts`, which ranks the song's own changes over a prior from the rs200 rock corpus (`rock-prior.json`, CC BY, built by `scripts/buildRockPrior.ts`; `scripts/checkSuggestions.ts` measures it; docs/adr/0005). Design: `docs/adr/`, vocabulary: `GLOSSARY.md`.
- Reading a chart from a file: `POST /api/charts/read` takes a PDF or an image and returns chords-over-lyrics text for the paste box; nothing is stored, and the player corrects the text beside the file before `importPasted` makes the chart. The server runs `pdftotext -bbox` for a PDF's text layer, or `pdftoppm` and `tesseract` for a scan or photo (`services/chart-reader.ts`), so poppler and tesseract with English data must be installed where the API runs. Both give word boxes, and `src/charts/scanned.ts` places each chord over the lyric character under its left edge. The browser redraws a photo at 3000 pixels on its long side before upload (`ReadChartFile.tsx`): it applies EXIF rotation, and Tesseract misreads one-letter chords in small images. `tests/fixtures/make-scans.ts` regenerates the scan fixtures.
- Reading a chart from a score: the "Add a score" form (`AddScore.tsx`) also offers the Guitar Pro file's chords and lyrics as chords over lyrics, which the player corrects and adds as a separate lyrics chart (docs/adr/0007). `src/charts/score-chart.ts` lays them out on the played timeline. alphaTab is patched (`patches/`, `bun patch`) to place a track's lyric text past tied notes, as Guitar Pro does; carry the patch forward on an alphaTab upgrade. When the author named chords in fewer than half the bars, `src/charts/score-chords.ts` works them out from the notes and the form says so.
- `generated/DB.ts` holds the Kysely table types and is maintained by hand: add an interface when a migration adds a table.
