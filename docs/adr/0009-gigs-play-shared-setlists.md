---
status: accepted
---

# Gigs play shared setlists, and lists edit as grids

A **setlist** is a named list of songs. A **gig** is one performance, and it plays one or more setlists in order. Before this change one table held both: a setlist had a venue, a date and times, and divided its songs into sections ("Set 1", "Encore"). A band that plays the same set at three venues had to build it three times, and a gig with two sets had to fit them into one list.

## What is stored

- `setlists` has a `name` and a `status`. It has no venue, date or sections.
- `setlist_entries` has a song, a `position_key`, and the key, tempo and notes overrides.
- `gigs` has the venue, date, address, load-in and performance times, and notes. All are optional.
- `gig_setlists` joins a gig to the setlists it plays, with a `position_key` for their order. Its primary key is `(gig_id, setlist_id)`, so a gig plays a setlist at most once.

Both lists move the same way: `PUT …/move` with `{ id, previous }`, under a row lock on the setlist or the gig, through `placeAfter` in `src/components/position.ts`.

## Shared, with a copy for one gig

A gig names its setlists; it does not copy them. An edit to a setlist changes every gig that plays it, and the setlist's page lists those gigs and warns when there is more than one. A setlist's page can add it to any of the band's gigs, so one list joins many gigs without a visit to each gig's page.

A band that wants one gig to differ makes a **copy**: a new setlist with the same songs and overrides. On a gig's page, "Copy for this gig" makes the copy and puts it in the original's place in that gig, in one step; the other gigs keep the original. The button shows only on a setlist that other gigs also play, because a setlist that one gig plays is already that gig's own. The swap changes `setlist_id` on the gig's `gig_setlists` row, so the copy keeps the original's `position_key`; the composite foreign key keeps the new setlist in the band. "Copy" on the setlists page makes a copy in no gig.

The other choice was to copy a setlist into each gig. Then an edit to the band's standard set would not reach the gigs already booked, and the band would edit each one by hand.

## Sections are gone

A gig's sets are its setlists. Sections inside a setlist would give a second way to say the same thing, so they are removed. The stage view of a gig plays its setlists one after the other and heads each song with its setlist's name. A setlist's own stage view plays only that list, for rehearsal.

## Live rooms

A setlist and a gig are each a room in `services/liveHub.ts`. A write to a setlist is announced to the setlist and to every gig that plays it, because the gig's page shows each setlist's song count and length and the gig's stage view plays its songs. A write to a gig is announced to the gig and to every setlist it played before or after the write, because a setlist's page lists the gigs that play it.

## Grids

The Songs page and a setlist's page edit their rows as a grid: arrows and Tab move between cells, typing starts an edit, Enter saves and moves down, and the last row adds a row. A band can type a run of song titles, then go back up and fill in the artist column.

A setlist takes only songs from the catalog. Its song cell lists the catalog's matches as the player types. The song's own columns (artist, length) are read-only there; key, tempo and notes are overrides for this list, shown grey while they follow the song.

The grid is `Grid.tsx`, a `role="grid"` table written for this app. React Aria's `Table` and `useGridCell` take the arrow keys before an input inside a cell can see them, and Tab leaves the table instead of moving to the next cell. Both break typing in a cell. React Aria still does the gig page, where nothing is typed into a row: `GridList` gives drag and keyboard reorder of the gig's setlists, and `ComboBox` picks a setlist or makes one from a typed name.

## Consequences

- The public band page lists upcoming gigs, which now come from `gigs`.
- A song in the catalog cannot be made from the setlist grid. The player adds it on the Songs page first.
- Deleting a setlist takes it out of every gig that played it.
