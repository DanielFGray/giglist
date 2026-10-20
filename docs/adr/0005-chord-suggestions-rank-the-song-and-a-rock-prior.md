---
status: proposed
---

# Chord suggestions rank the song's own changes over a rock-corpus prior

When a player taps a word in the chart editor and types its chord, the field offers chords for that place in two lists: **Likely here** (chords the song already uses) and **New to this song** (chords it does not use yet). Each chord shows its numeral and one reason: "leads to Em", "follows G in this song", "as in Verse 1", "borrowed from minor", "in the key, not used yet". The model is a pure module, `src/charts/suggest.ts`; `chartSlot` reads the place from the chart, and `suggest` ranks.

## The model

A chord counts by its **chord class**: the degree of its root in the key, with the case and mark of its triad (`V`, `vi`, `vii°`, `bVII`). A sus or power chord counts as major; held chords count once.

1. **Repeat.** If a section with the same name ("Verse 1" and "Verse 2" share one) has a chord at this place, it goes first. A place matches when this line's chords, with that chord added, agree with the other line's chords as far as the shorter line goes. A word that has no chord in the other verse gets no repeat.
2. **Ranking.** Every class gets P(class | chords before) × P(next chord | class). Each probability backs off from the song's trigram to its bigram, to the corpus bigram, to the corpus unigram, with Dirichlet smoothing. A layer with few counts leans on the layer below it. The pseudo-counts (`WEIGHTS`) were fitted by grid search on the corpus. The fit is flat: several settings reach 96.9% top-3.
3. **Names.** A class the song uses keeps the song's own spelling (`D/F#`, not `D`). Any other class is spelled on the key's letter (bVI in G is Eb). A major class that leads a fifth down to the next chord is offered as a dominant 7th (B7 before Em), named as an applied chord (V7/vi).

`fresh` holds the best five unused classes, then every other chord of the key not among them. So the key's unused chords are always offered, which was the first request. The two lists exist because the song's own counts favour chords it already has. On new chords, the full ranking finds the right chord in its top 3 only 51.7% of the time, but the ranking of unused chords alone finds it 67.2% of the time.

## The prior

The corpus layer is the rs200 corpus (Trevor de Clercq and David Temperley, *A corpus analysis of rock harmony*, CC BY 4.0, https://rockcorpus.midside.com): 200 rock songs, each analysed by two experts. `scripts/buildRockPrior.ts` turns it into `src/charts/rock-prior.json` (class unigram and bigram counts, about 5 KB, attribution inside). `scripts/rockCorpus.ts` reads the corpus's chord grammar. The band has no real charts yet, so this corpus is the only real data.

## Measured

`scripts/checkSuggestions.ts` hides each chord change in turn, in 5 folds by song, so a song never counts toward its own prior. It counts how often the hidden class is first or in the first three:

| Setting | Hidden chords | Editor palette | Most used in song | Corpus only | Model | Unused chords only |
|---|---|---|---|---|---|---|
| Between: the rest of the song is known | 18013 | 32.3 / 39.7 | 29.3 / 80.0 | 53.6 / 79.7 | 92.3 / 98.9 | n/a |
| Writing: only the chords before are known | 18013 | 32.3 / 39.7 | 32.2 / 78.5 | 40.5 / 70.3 | 79.2 / 94.9 | n/a |
| New chord: writing, chord not yet in the song | 1102 | 6.9 / 21.8 | 0 / 0 | 25.8 / 53.4 | 21.4 / 51.7 | 40.3 / 67.2 |

The "between" score is high partly because rs200 writes repeated sections out in full, so most chords have a copy elsewhere in the song.

## Numerals

`src/charts/numeral.ts` labels chords with Roman numerals:

- Quality: `°` diminished, `ø7` half-diminished, `+` augmented. Figured bass marks inversions: `6`, `64`, `65`, `43`, `42`.
- A slash bass that is not a chord tone is a key degree in Arabic numerals: `IV/5`.
- An **applied chord** is labelled `V/x` or `vii°/x` only when it is outside the key and resolves to the next chord. The target counts by its root on the key's scale, so a chain reads as one: E7 A7 D7 G is V7/vi V7/ii V7/V V. A cadential I64 before V counts as V.
- Minor keys count against the major scale (C in A minor is bIII), as rs200 does.

Checked against music21's `romanNumeralFromChord` (44 cases in `numeral.test.ts`). The intended differences, each noted in the test table, are:

- IVmaj7, not IV7.
- bIII in minor, not III.
- `Iadd9/3` and `IV/5`, not music21's added-tone figures (I763, IV742).
- No applied label without resolution.
- B7→E in A minor is V7/V, not V7/v.
- vii°7/ii, not #io7.

On the corpus's applied chords, the app agrees with the experts 47.6% of the time. The two experts agree with each other 48.4% of the time (`scripts/checkNumerals.ts`).

## Consequences

- With no written key, the field offers nothing but the typed name.
- The prior is rock. A band that plays jazz or folk gets rock's corpus odds until its own songs outweigh them.
- Suggestions are read from the chart being edited only. The band's other songs do not feed the model.
- The chord shapes panel, chord strip and staff label a chord without the next chord, so they show no applied numerals. Only the chart's chord row has that context.
