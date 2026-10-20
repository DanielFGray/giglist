---
status: proposed
---

# Lyrics charts store ChordPro text; scores store the uploaded file

A song has many charts. A lyrics chart (chords over lyrics) is stored as ChordPro text and rendered with ChordSheetJS. Players paste or type chords over lyrics, and that is the text they read and edit. ChordPro directives and alphaTex appear in it only for what chords over lyrics cannot say: a phrase (docs/adr/0003), a comment, or another directive. A power user can write them there, and a plain chart shows none. A score is stored as the Guitar Pro file the player uploaded, byte for byte, and rendered with alphaTab.

We store the original file because alphaTab cannot write any format that keeps a Guitar Pro score unchanged. Measured on 223 real files, comparing every beat's duration and notes after an export and re-import:

| alphaTab version | AlphaTex export | Guitar Pro 7 export |
|---|---|---|
| 1.8.4 | 154 kept, 32 changed, 37 fail to load again | 72 kept, 151 changed |
| 1.9.0-alpha.1891 | 153 kept, 22 changed, 48 fail to load again | 178 kept, 45 changed |

Pasted text goes through our own importer, not ChordSheetJS's chords-over-words parsers. On a sample chart, the Ultimate Guitar parser dropped spaces from 6 of 16 lyric lines. Neither parser turns headers such as `[Verse 1]` into sections. Our importer kept 16 of 16 lines, every chord column, and all 4 sections.

## Consequences

- An edited score is stored as described in docs/adr/0008: edits patch a Guitar Pro 7 file's score.gpif in place, and an uploaded Guitar Pro 3, 4 or 5 file is converted once, with loss, on its first edit.
- The bug in ChordSheetJS's Ultimate Guitar parser is not yet reported upstream.
