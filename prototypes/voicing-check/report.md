# Do our generated shapes match real chord diagrams?

`voicings(spell(name))` from `src/charts/voicing.ts` against two references: the chord diagrams in
`/home/dan/Guitar Pro Tabs` read with alphaTab, and ChordSheetJS 18's own 902-entry guitar chord table.
Two references, one question: does the generator give the shapes guitarists actually use?

## Headline

| Reference | Shapes | `spell` reads | Playable by our rules | In `voicings(...)` | In our top 3 |
| --- | --- | --- | --- | --- | --- |
| Guitar Pro | 32 | 32 (100.0%) | 23 | 34.8% | 30.4% |
| ChordSheetJS | 801 | 801 (100.0%) | 697 | 72.2% | 59.7% |

### Guitar Pro

- Shapes read: 32. Names `spell` could not read: 0.
- Shapes that satisfy our playability rules: 23. The other 9 are disagreements to judge, not failures.
- Of those 23: 8 appear in `voicings(...)` (34.8%), 7 in the top 3 (30.4%).

Why the rest failed our rules:

- `outside note n`: 4
- `only n strings sound`: 3
- `missing note n`: 1
- `bass is n, not n`: 1

### ChordSheetJS

- Shapes read: 801. Names `spell` could not read: 0.
- Shapes that satisfy our playability rules: 697. The other 104 are disagreements to judge, not failures.
- Of those 697: 503 appear in `voicings(...)` (72.2%), 416 in the top 3 (59.7%).

Why the rest failed our rules:

- `n fingers > n`: 95
- `bass is n, not n`: 8
- `span n > n`: 1

## What the numbers say

1. The rules are not what costs us shapes. Of the playable reference shapes, most of the loss comes after
   playability: our eight-shape cap and the dedupe that drops a shape a better one covers. The playability
   rules themselves exclude shapes mostly through one rule, four fingers.
2. The four-finger rule is the single biggest disagreement with the references.
   ChordSheetJS prints 95 shapes that `fingersNeeded` puts over four. Guitar Pro prints none.
   The mechanism is where a barre is allowed to sit: `barreOf` only builds one at the lowest fret of the
   shape, and only when two strings share it, so a shape whose lowest fret is a single string gets no barre
   credit and every other fretted string costs a finger. ChordSheetJS's `x 4 3 4 4 4` (C#9) is the plain
   case: five fretted notes, one at fret 3, four at fret 4. These are judgements, not failures, and the brief
   calls this a disagreement to judge, so this report states it and does not change the rule.
3. The Guitar Pro rate rests on 23 playable shapes, which is too few to plan from. ChordSheetJS's 697 is the number with weight behind it. A better Guitar Pro sample would need files that carry diagrams: 6 of the 731 staves in the folder have any at all.

## How each reference was read

### Guitar Pro

alphaTab 1.8.4 read 225 files (223 read, 2 failed):
- `Diminished to Be.gp5: undefined is not an object (evaluating 'nextVoice.beats')`
- `Mine - Garrett trent.gp5: Unexpected end of data within reader`

Those files hold 731 staves. 6 staves in standard tuning carry chord diagrams;
1 more were skipped for a capo, since a capo shifts what a shape sounds without changing the frets
drawn. The staves kept hold 32 distinct (name, shape) pairs.

**`model.Chord.strings` holds absolute frets, not frets relative to `firstFret`.** Three pieces of evidence:

- The chord-diagram painter subtracts before it draws: `fret -= this._chord.firstFret - 1` (alphaTab.core.mjs:50822).
  That subtraction is only needed when the stored fret is absolute.
- The GPIF reader (GP7 `.gpx`) builds absolute frets itself: `chord.strings[...] = baseFret + fret` (alphaTab.core.mjs:20108).
- Known chords read correctly as absolute:

  | Name | Source | `firstFret` | `strings` (highest first) | Reads as |
  | --- | --- | --- | --- | --- |
  | `A5` | `Carry On My Wayward Son.gp5` | 5 | `5,5,-1,-1,7,5` | `5 7 x x 5 5` |
  | `F6` | `Carry On My Wayward Son.gp5` | 1 | `-1,3,5,-1,3,1` | `1 3 x 5 3 x` |
  | `Dm` | `Carry On My Wayward Son.gp5` | 1 | `1,3,2,0,-1,-1` | `x x 0 2 3 1` |
  | `C/G` | `Carry On My Wayward Son.gp5` | 1 | `3,1,0,2,3,-1` | `x 3 2 0 1 3` |

`A5` is the one that settles it: `firstFret` is 5 and the frets are 5 and 7, the A-shape power chord at the
5th fret. Read as relative to `firstFret` the shape would sit at fret 5 of an A5 at the nut, which is not a
chord. `Dm` reads as the open `x x 0 2 3 1` and `F6` as the standard barre at the 1st fret.

alphaTab reports the highest string first, so every shape was reversed into our lowest-string-first order with -1
as `null`. Each (name, shape) pair counts once across the whole folder.

### ChordSheetJS

The table holds 902 entries. Each entry's `base-fret` is read both ways, plus the fret taken as
absolute when `base-fret` is 0 or 1, and the reading whose sounded notes fit the name's own spelling wins.

| Reading | Entries |
| --- | --- |
| fret as absolute (`base-fret` 0 or 1) | 735 |
| absolute = pos + base - 1 | 50 |
| absolute = pos + base | 16 |
| no reading fit | 101 |

Both readings the brief names hold up. `A11` (base 2, frets `4 3 x 1 2 2`) is right as pos + base - 1, giving the
standard `5 4 x 2 3 3`. `A13(b9)` (base 3, frets `2 x 2 3 4 3`) is right as pos + base, giving `5 x 5 6 7 6`.
The 101 entries with no fitting reading hold notes outside their name under every reading, so they
are left out rather than guessed at. A sample:

| Name | Table frets | base-fret |
| --- | --- | --- |
| `A/F#` | `2 0 2 2 0 0` | 1 |
| `A/G` | `3 0 2 2 0 0` | 1 |
| `A/G#` | `4 x 2 2 0 0` | 1 |
| `A5/E` | `0 0 1 1 1 4` | 2 |
| `Aaug7` | `x 0 3 2 2 1` | 1 |
| `A7/G` | `3 x 2 0 2 0` | 1 |
| `A9` | `x 0 2 4 0 0` | 1 |
| `Adim` | `x 0 1 2 1 2` | 1 |
| `Am7/G` | `3 x 2 0 1 0` | 1 |
| `Am9` | `x 0 2 4 1 0` | 1 |
| `B/A#` | `x 1 4 3 0 x` | 1 |
| `B/E` | `0 2 4 4 0 0` | 1 |
| `B2/A#` | `x 1 4 4 0 x` | 1 |
| `B2/D#` | `x 3 1 1 0 x` | 1 |
| `B2/G#` | `4 x 4 4 0 x` | 1 |

## Names `spell` cannot read

Total across both references: 0.

None.

## Misses

Reference shapes that satisfy every playability rule but do not appear in `voicings(...)`.

A shape that passed every playability rule can still be absent, for two reasons our generator gives us:
it keeps at most eight shapes per name (`kept.length === 8`, voicing.ts:33), and it drops a shape that one
already kept covers by leaving strings out (voicing.ts:31). Which of the two applies is not always knowable
from outside, because the generator does not report the rank of a shape it dropped. A shape our best one
covers was certainly dropped, since nothing outranks our best; a shape only a later one of ours covers was
probably dropped. The reason column says which. A fret past 15 would be a third reason, and no reference shape
has one.

Miss reasons across both references:

- `our best shape covers it with strings left out`: 70
- `ranked 9th or lower, past our top 8`: 40
- `our #2 shape probably covers it with strings left out`: 36
- `our #3 shape probably covers it with strings left out`: 30
- `our #4 shape probably covers it with strings left out`: 10
- `our #6 shape probably covers it with strings left out`: 8
- `our #5 shape probably covers it with strings left out`: 7
- `our #8 shape probably covers it with strings left out`: 5
- `our #7 shape probably covers it with strings left out`: 3

| Reference | Name | Reference shape | Our top 3 | Why missed |
| --- | --- | --- | --- | --- |
| Guitar Pro | `A5` | `5 7 x x 5 5` | `x 0 2 2 x x`, `x 0 2 2 x 0`, `x 0 2 2 5 5` | ranked 9th or lower, past our top 8 |
| Guitar Pro | `Gadd11` | `3 2 x 5 3 x` | `3 3 0 0 0 3`, `3 2 0 0 1 3`, `3 3 5 4 3 3` | ranked 9th or lower, past our top 8 |
| Guitar Pro | `G5` | `3 5 x 0 3 x` | `x x x 0 3 3`, `3 x 0 0 3 3`, `3 5 5 x x x` | our #4 shape probably covers it with strings left out |
| Guitar Pro | `Gadd11` | `3 2 x 0 1 x` | `3 3 0 0 0 3`, `3 2 0 0 1 3`, `3 3 5 4 3 3` | our #2 shape probably covers it with strings left out |
| Guitar Pro | `B7/F#` | `2 x 1 2 0 x` | `2 0 1 2 0 2`, `2 2 1 2 0 x`, `2 2 4 2 4 2` | our best shape covers it with strings left out |
| Guitar Pro | `F#dim7` | `2 x 1 2 1 x` | `2 0 1 2 1 2`, `2 3 1 2 1 x`, `2 3 4 2 4 2` | our best shape covers it with strings left out |
| Guitar Pro | `F#7sus4` | `x x 4 6 5 7` | `2 2 2 4 2 0`, `2 2 2 4 2 2`, `2 2 4 4 2 0` | ranked 9th or lower, past our top 8 |
| Guitar Pro | `Aadd9` | `x 12 9 9 10 9` | `5 2 2 2 2 0`, `x 0 2 4 2 0`, `5 2 2 2 2 5` | ranked 9th or lower, past our top 8 |
| Guitar Pro | `Fm6` | `x 8 6 7 6 x` | `1 3 3 1 3 1`, `1 3 0 1 1 x`, `1 3 0 1 3 x` | ranked 9th or lower, past our top 8 |
| Guitar Pro | `F#madd9` | `x 9 7 x 9 x` | `2 4 4 2 2 4`, `2 0 4 1 2 x`, `2 0 x 1 2 2` | ranked 9th or lower, past our top 8 |
| Guitar Pro | `Aadd9` | `x 12 11 x 12 x` | `5 2 2 2 2 0`, `x 0 2 4 2 0`, `5 2 2 2 2 5` | ranked 9th or lower, past our top 8 |
| Guitar Pro | `Eadd9` | `x 7 6 x 7 x` | `0 2 2 1 0 2`, `0 2 4 1 0 0`, `0 2 4 1 0 2` | ranked 9th or lower, past our top 8 |
| Guitar Pro | `E6add9` | `x 7 6 6 7 x` | `0 4 4 1 0 0`, `0 2 4 1 2 0`, `0 2 4 4 2 4` | ranked 9th or lower, past our top 8 |
| Guitar Pro | `E` | `x 7 9 9 9 7` | `0 2 2 1 0 0`, `0 2 2 1 0 4`, `0 2 2 4 5 4` | our #8 shape probably covers it with strings left out |
| Guitar Pro | `Em` | `x 7 9 9 8 7` | `0 2 2 0 0 0`, `0 2 2 0 0 3`, `0 2 2 0 5 3` | ranked 9th or lower, past our top 8 |
| ChordSheetJS | `A2/G#` | `4 x 2 2 0 0` | `4 2 2 2 2 0`, `4 2 2 2 2 4`, `4 0 2 4 2 0` | our #5 shape probably covers it with strings left out |
| ChordSheetJS | `G#ma9` | `4 x 1 3 1 3` | `4 1 1 1 1 3`, `4 1 1 3 1 3`, `4 1 1 0 1 x` | our #2 shape probably covers it with strings left out |
| ChordSheetJS | `B/G#` | `4 x 4 4 4 x` | `4 2 1 1 0 2`, `4 2 1 1 0 4`, `4 6 4 4 4 4` | our #3 shape probably covers it with strings left out |
| ChordSheetJS | `Bsus/F#` | `2 2 4 4 0 0` | `2 2 2 x x x`, `2 2 2 x 0 0`, `2 2 2 4 5 2` | ranked 9th or lower, past our top 8 |
| ChordSheetJS | `B5` | `x 2 4 4 0 x` | `x x x x 0 2`, `x 2 4 4 x x`, `x 2 4 x 0 2` | our #5 shape probably covers it with strings left out |
| ChordSheetJS | `B6/9` | `x 2 1 1 2 x` | `x 2 1 1 2 2`, `x 2 1 1 2 4`, `7 4 4 4 4 4` | our best shape covers it with strings left out |
| ChordSheetJS | `B7(b9)` | `x 2 1 2 1 x` | `x 2 1 2 1 2`, `7 6 7 5 0 x`, `7 9 7 8 0 8` | our best shape covers it with strings left out |
| ChordSheetJS | `A#11` | `x 1 0 3 4 4` | `x 1 1 1 1 1`, `x 1 1 1 3 1`, `x 1 0 1 4 1` | ranked 9th or lower, past our top 8 |
| ChordSheetJS | `A#aug7` | `x 1 4 1 3 x` | `x 1 0 1 3 2`, `x 1 4 1 3 2`, `x 1 4 1 3 4` | our #2 shape probably covers it with strings left out |
| ChordSheetJS | `A#7(#9)` | `x 1 0 1 2 x` | `x 1 0 1 2 1`, `x 1 0 1 2 4`, `x 1 0 3 2 4` | our best shape covers it with strings left out |
| ChordSheetJS | `A#ma9` | `x 1 0 2 1 x` | `x 1 0 2 1 1`, `6 3 3 3 3 5`, `6 3 3 5 3 5` | our best shape covers it with strings left out |
| ChordSheetJS | `C#2` | `x 4 1 1 2 x` | `x 4 1 1 2 1`, `x 4 1 1 4 1`, `x 4 3 1 4 1` | our best shape covers it with strings left out |
| ChordSheetJS | `C#aug7` | `x 4 3 2 0 x` | `x 4 3 2 0 1`, `x 4 3 2 0 5`, `x 4 3 6 0 5` | our best shape covers it with strings left out |
| ChordSheetJS | `C#7(b5)` | `x 4 3 4 x 3` | `x 4 3 0 0 1`, `x 4 3 0 0 3`, `x 4 3 4 6 3` | our #3 shape probably covers it with strings left out |
| ChordSheetJS | `C#7(b9)` | `x 4 3 4 3 x` | `x 4 0 1 0 1`, `x 4 3 4 3 4`, `x 4 0 4 2 1` | our #2 shape probably covers it with strings left out |
| ChordSheetJS | `C/F` | `x x 3 0 1 0` | `1 3 2 0 1 0`, `1 3 3 0 1 0`, `1 x 2 0 1 1` | our #2 shape probably covers it with strings left out |
| ChordSheetJS | `C7(b9)` | `x 3 2 3 2 x` | `x 3 2 3 2 3`, `x 3 2 3 2 0`, `x 3 5 3 2 0` | our best shape covers it with strings left out |
| ChordSheetJS | `C7/G` | `3 x 2 3 1 0` | `3 1 2 0 1 0`, `3 1 2 3 1 0`, `3 3 2 3 x x` | our #2 shape probably covers it with strings left out |
| ChordSheetJS | `Cdim7` | `x 3 4 2 4 x` | `x 3 1 2 1 2`, `x 3 4 2 4 2`, `x 3 4 x 4 5` | our #2 shape probably covers it with strings left out |
| ChordSheetJS | `Cm` | `x 3 1 x 1 3` | `x 3 1 0 1 3`, `x 3 1 0 4 3`, `x 3 5 5 4 3` | our best shape covers it with strings left out |
| ChordSheetJS | `Cm/D#` | `x x 1 x 1 3` | `x x 1 0 1 x`, `x x 1 0 1 3`, `x 6 5 5 4 x` | our #2 shape probably covers it with strings left out |
| ChordSheetJS | `Cma9` | `x 3 2 4 3 x` | `x 3 0 0 0 0`, `x 3 0 4 1 0`, `x 3 0 4 3 0` | our #6 shape probably covers it with strings left out |
| ChordSheetJS | `D/C` | `x 3 x 2 3 2` | `x 3 0 2 1 2`, `x 3 0 2 3 2`, `x 3 4 2 3 2` | our #2 shape probably covers it with strings left out |
| ChordSheetJS | `D/C#` | `x 4 x 2 3 2` | `x 4 0 2 2 2`, `x 4 0 2 3 2`, `x 4 4 2 3 2` | our #2 shape probably covers it with strings left out |
| ChordSheetJS | `D/E` | `x x 2 2 3 2` | `0 0 0 2 3 2`, `0 0 2 2 3 2`, `0 0 4 2 3 0` | our #2 shape probably covers it with strings left out |

## Rerun

```sh
cd /tmp/claude-1000/-home-dan-build-setlist/6a9e8901-3e20-4ac6-8145-468f3542f3b9/scratchpad/voicing-check
bun extract-gp.ts    # writes gp.json
bun extract-csjs.ts  # writes csjs.json
bun compare.ts       # writes report.md
```
