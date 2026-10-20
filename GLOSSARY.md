# GigList

A band's own songs, the charts each player reads them from, and the setlists the band plays them in.

## Gigs and setlists

**Catalog**:
All of a band's songs. The Songs page edits it as a grid.
_Avoid_: library, repertoire

**Setlist**:
A named, ordered list of songs from the catalog. One setlist can serve many gigs, so an edit to it changes every gig that plays it (docs/adr/0009).
_Avoid_: set list for a gig, running order

**Override**:
A key, tempo or notes that one setlist entry uses in place of the song's own. A cleared override goes back to the song's value.

**Copy**:
A new setlist with the same songs and overrides as another, made when one gig needs its own version. "Copy for this gig" also puts the copy in the original's place in that gig.
_Avoid_: fork, duplicate

**Gig**:
One performance: where, when, and the setlists it plays, in order.
_Avoid_: show, event, booking

**Set**:
One of a gig's setlists, as played at that gig. The stage view heads each song with its set's name.
_Avoid_: section (a section is a part of a chart, such as a verse)

**Grid**:
A page that edits rows like a spreadsheet: arrows and Tab move between cells, typing edits, and the last row adds a row.
_Avoid_: table (a grid can be edited), spreadsheet

## Songs and charts

**Song**:
A piece the band plays, with its default key, tempo and notes.

**Chart**:
One way to read a song: chords over lyrics, or a score with tab. A song can have many charts.
_Avoid_: sheet, lead sheet, PDF

**Lyrics chart**:
A chart of lyrics with chord names placed over the words.
_Avoid_: chord sheet, ChordPro

**Score**:
A chart in standard notation and tab for one or more instruments, uploaded as a Guitar Pro file.
_Avoid_: tab file, notation

**Score link**:
A directive in a lyrics chart that draws a range of bars (a section or bar numbers) from a score chart, always its latest revision (docs/adr/0004).
_Avoid_: embed, include

**Inferred chord**:
A chord name the app worked out from a score's notes, for a Guitar Pro file whose author named none (docs/adr/0007). The form shows it as "worked out from the notes", for the player to check.
_Avoid_: detected chord, recognized chord

**Tab**:
Lines of ASCII tablature in a lyrics chart, drawn exactly as written.
_Avoid_: tab file

**Phrase**:
A short piece of real notation in a lyrics chart (a riff, a lick, a fill, a groove), with a name, drawn as a row between lyric lines and played at the song's tempo.
_Avoid_: snippet, lick block, notation block

**Chord shape**:
One way to hold a chord on the guitar: a fret, open or not-played for each string. A player taps a chord name to see its shapes, best first.
_Avoid_: fingering, grip, chord diagram (the diagram is the drawing of a shape)

**Revision**:
One saved version of a chart. A revision never changes; an edit makes a new one.
_Avoid_: version, draft

**Written key**:
The key a lyrics chart is written in.

**Shown key**:
The key a player sees a chart in, for example a setlist's key for the song.
_Avoid_: capo key

## Harmony

**Numeral**:
A chord's place in the key as a Roman numeral: upper case for major (IV), lower case for minor (vi), with ° for diminished, ø7 for half-diminished and + for augmented. A flat or sharp in front marks a root outside the major scale (bVII). Minor keys count against the major scale, so C in A minor is bIII.
_Avoid_: Nashville number, scale degree

**Applied chord**:
A chord outside the key that leads to the chord after it, as if that chord were a key of its own: B7 before Em in G is V7/vi ("five seven of six"). Labelled only when the next chord is its target.
_Avoid_: secondary chord, tonicization

**Secondary dominant**:
An applied chord that is a dominant (V or V7) of its target. The most common applied chord, and the passing chord the editor offers before a chord.

**Borrowed chord**:
A chord taken from the parallel key, major from minor or minor from major: bVII, bVI or iv in a major key.
_Avoid_: modal mixture

**Figured bass**:
Numbers after a numeral that name an inversion by the intervals above the bass: 6 and 64 for a triad's first and second inversion, 65, 43 and 42 for a seventh chord's. A bass that is not a chord tone is written as a key degree instead: IV/5.
_Avoid_: slash numeral

**Chord class**:
A chord counted by its numeral without a 7th, inversion or added tones, so G, G7 and G/B in G are all I. Suggestions rank chord classes, then name each one as the song spells it.

## Marks

**Mark**:
A player's own ink, text, or pasted stamp, placed on a chart and attached to the chart content under it. Private unless the player shares it.
_Avoid_: annotation, note, highlight

**Shared mark**:
A mark its player lets the whole band see. Bandmates can read it but not change it.

**Stamp**:
A mark body a player saved so they can paste copies of it onto any chart.
_Avoid_: template, snippet

**Anchor**:
The chart content a mark is attached to: a range of a lyrics chart, or of the beats in one voice of a score.

**Margin**:
The space beside a chart for marks that belong to a line, not to a word or beat.

**Tray**:
Where a mark goes when its content was deleted, or its place cannot be proven after a new revision.
_Avoid_: orphan list, trash

## Public pages

**Public page**:
A band's page at `/b/:slug` that anyone can open, while the band's owner keeps it on.
_Avoid_: profile page, band site

**Public profile**:
A user's page at `/u/:username` that anyone can open, while the user keeps it on. Like a public page, it is a theme the user writes (there are no starter themes for profiles); the built-in default shows their name, picture, Markdown bio, and their bands whose public pages are on.
_Avoid_: user page, account page

**Description**:
A band's public text on its page, written as Markdown. A YouTube, Spotify, Vimeo, TikTok or Instagram link standing alone in it shows as that provider's player.
_Avoid_: bio, blurb, about

**Theme**:
The HTML document a band writes for its public page, with theme tags where the band's data goes.
_Avoid_: template, skin, layout

**Theme tag**:
A placeholder in a theme, such as `{BandName}` or `<block:Gig>…</block:Gig>`, that the page fills with the band's data.

**Theme option**:
A setting a theme declares with a `<meta>` tag (a color, an image link, a text or a flag). The band sets it in a form field instead of in the HTML.

**Starter theme**:
A theme that ships with GigList. Picking one copies it into the band's own theme.
