---
status: proposed
---

# A score upload offers chords over lyrics read from the score

When a player adds a Guitar Pro score, the browser also reads the score's chords and lyrics as **chords over lyrics**: the text the paste box takes. The player corrects it in the form, and it is stored as a separate lyrics chart beside the score (`charts.createLyrics`), in the key the chords suggest. Nothing is stored that the player did not see. `src/charts/score-chart.ts` writes the text and `src/charts/score-chords.ts` works out chords.

## Where the chords come from

Few files name their chords. In a private archive of 52,551 Guitar Pro files, 7,286 (14%) name chords, 838 (1.6%) have lyrics, and 267 have both in real amounts. So when the author's chord names cover fewer than half the bars played, the chords are **worked out from the notes**, and the form says so.

For each bar, every pitched track's notes are weighed by how long they sound, and the lowest note sounding counts extra. Each root and each quality (major, minor, power chord) is scored against that, and a bar takes two chords when two fit clearly better than one. The names follow the key that the chords suggest (`keyOfChords`), so an Ab song shows Db, not C#.

The method was measured against the files that do name chords. A chord counts as agreeing when its root is the same and its third agrees; a power or sus chord agrees with either third. On 582 files not used for tuning, 76.7% of named chords agree. The median file reaches 83%, and 322 files reach 80% or more. Taking the lowest note as the root gives 74%. The worked-out chords change about 1.36 times as often as the named ones. Seventh, sus and maj7 qualities made agreement lower, because melody notes made them win on plain chords. A rule that removed a short chord between two equal ones also made it lower.

## Where the chords go

Chords and lyrics often sit on different tracks, so both go on one timeline: the bars in playing order, with one level of repeats unrolled. On pass N through a repeat, a bar sings the Nth lyric line under it when there is one. A chord goes over the syllable that sounds when the chord starts, and a chord in a rest goes over the next syllable. A line's first chord moves to the line's first word when it comes in the line's first bar. A chord in the rest after a line goes over the line's last word. Chords more than a bar before a lyric line go on chord-only lines of four bars.

alphaTab's `Track.applyLyrics` gives the n-th syllable to the n-th beat that is not a rest. Guitar Pro also passes over a beat whose notes are all tied over, so in alphaTab's model every held word moves the later syllables one note late, and lines end on the next line's first word. A `bun patch` of alphaTab (`patches/`) makes `applyLyrics` pass over those beats too; this also corrects the lyrics the score viewer draws under the staff. `applyLyrics` places every lyric stored as a track's text: all Guitar Pro 3 to 5 files, GP6 and GP7 files whose beats carry no syllables of their own, and alphaTex. On six songs with human sheets, this raised same-word agreement on the three files with five or more ties (Your Song from 27% to 34%, Back On The Chain Gang from 15% to 20%, Heart of Gold from 36% to 40%), and lowered Michelle, with 2 ties, from 30% to 29%.

alphaTab keeps one syllable per beat and drops the line ends of the author's lyric text. Lines therefore end at sections and split at their longest rest until each fits 48 characters. On the 267 files, this gives the same median line length as the author's line ends (29 to 31 characters), so the app does not read the raw lyric text from the file.

## Consequences

- Against Ultimate Guitar chord sheets for nine songs, between 14% and 65% of chords fall on the same word, and between 18% and 72% within one word. Much of the miss comes from the files: lyrics are often typed on a guitar track, not a sung melody, and they drift away from the notes after the first verse. Human sheets also put a line's chords on its first and last words more than the timing does. The text is a draft for the player to correct, not a finished chart.
- Leaving the lyric track out of the chord count lowered agreement from 75.5% to 68.5% on the files with both chords and lyrics, because in a third of them the lyrics are on the guitar track.
- The alphaTab patch is tied to the installed version. An alphaTab upgrade must carry the patch forward, or those lyrics sit one note late again after each held word.
- Worked-out chords are the sounding pitches. A guitar part played with a capo shows the sounding chords, not the shapes.
- The form names the chart "Chords" and starts its "Written in" field at the key `keyOfChords` suggests. The chart editor cannot change the key later, so the player sets it in the form.
- `guessKey`, which the server runs on a pasted chart saved without a key, now names keys the same way: it used to return G# major for a song in Ab.
