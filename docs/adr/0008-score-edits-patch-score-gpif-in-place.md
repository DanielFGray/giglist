---
status: proposed
---

# Score edits patch the Guitar Pro 7 score.gpif in place

ADR 0002 left open how an edited score is stored. A score edit is written into the `Content/score.gpif` XML of a Guitar Pro 7 file, and every other byte of the file stays as it was. A new score starts as a Guitar Pro 7 file. An uploaded Guitar Pro 6 file is repacked as Guitar Pro 7 on its first edit. An uploaded Guitar Pro 3, 4 or 5 file has no score.gpif, so its first edit converts it with alphaTab's Guitar Pro 7 exporter, and later edits patch the converted file. Every edit makes a new revision, so the uploaded file stays readable as the earlier revision.

Measured with alphaTab's MIDI output and its full score model, on 233 files in the owner's folder and a seeded sample of 1,996 GP3/4/5 files from the owner's archive:

| Path | Result |
|---|---|
| Patch score.gpif in place, 1,203 edits on 83 GP6/7/8 scores | the model differs only in the edited note in 1,203; MuseScore 4.7.4 opens the files and shows only that note changed |
| Repack GP6 score.gpif as GP7 | plays the same in 77 of 77 |
| Export as GP7 with no edit, alphaTab 1.9.0-alpha.1861 | plays differently: 173 of 233, 1,477 of 1,996 |
| Export as GP7 with no edit, alphaTab 1.9.0-alpha.1891 | plays differently: 78 of 233, 810 of 1,996 |
| Export as alphaTex with no edit | fails to load again: 306 (1861) and 637 (1891) of 1,996 |

## Considered options

- Keep the uploaded bytes and store edits beside them, replayed on load. It is exact for every format, but the editor would maintain a second representation, and a download of an edited file still needs the lossy export.
- Re-export through alphaTab on every save. Every save would carry the loss in the table, not only the first edit of a GP3/4/5 file.

## Consequences

- Guitar Pro stores each distinct beat and note once and refers to it by id, so one element can stand at several places in the music. An edit copies on write: it clones the note, its beat, voice and bar under new ids and points one master bar at the clones.
- A note stores its pitch four times: `Fret`, `Midi`, `ConcertPitch` and `TransposedPitch`. An edit rewrites all four. MuseScore spells a note from the pitch fields, so a stale one shows a wrong spelling.
- The first edit of a GP3/4/5 file can change how the score plays (drum pieces, bend shapes, rounded tempos, frets). The app tells the player before that first edit. The app runs alphaTab 1.9.0-alpha.1891, which changes about half as many files as 1.9.0-alpha.1861 did. Its patch in `patches/` also keeps a GP3/4/5 drum note whose MIDI number alphaTab's drum table lacks as a drum hit; unpatched, 1891 imports it as a fretted note with no fret (17 of 233 files).
- A GP7 conversion keeps every beat of every voice with notes at its position (233 of 233 and 1,996 of 1,996 on both alphaTab versions), so marks on the uploaded revision follow into the converted one with an empty change set (ADR 0001).
