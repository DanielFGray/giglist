# Attributions

This file lists every outside source SetList uses: code we adapted, data we fitted to, assets we serve, research the code follows, and libraries whose license asks more than MIT does.

When a change brings in a source, add its entry in the same commit, with a link. The code comment that uses the source names it, so a reader can find the entry here.

## Code adapted

- **graphile-starter**: the user, session, email and organization migrations in `migrations/`, the three-schema layout, and the email jobs and templates in `worker/` follow it. MIT License, Copyright © 2020 Graphile Ltd. <https://github.com/graphile/starter>. License text: <https://github.com/graphile/starter/blob/main/GRAPHILE_STARTER_LICENSE.md>

## Data

- **ChordSheetJS chord table**: the scoring weights in `src/charts/voicing.ts` were fitted to its guitar shapes, and `src/charts/spelling.test.ts` checks that every one of its 902 chord names spells. GPL-2.0-only. <https://github.com/martijnversluis/ChordSheetJS>

## Fonts

- **Bravura** by Steinberg Media Technologies: the music font that alphaTab serves, and that `src/components/ChordStaff.tsx` draws staff glyphs with. SIL Open Font License 1.1. <https://github.com/steinbergmedia/bravura>. Glyph names follow SMuFL: <https://w3c.github.io/smufl/latest/>
- **DM Sans** and **JetBrains Mono**: loaded from Google Fonts. SIL Open Font License 1.1. <https://fonts.google.com/specimen/DM+Sans>, <https://fonts.google.com/specimen/JetBrains+Mono>

## Research

Read while planning key detection from chord symbols. No code uses them yet.

- **Noland, K. and Sandler, M.** (2006). "Key Estimation Using a Hidden Markov Model." ISMIR 2006. A 24-state HMM over chord transitions; 91% correct on 110 Beatles songs. <https://archives.ismir.net/ismir2006/paper/000091.pdf>
- **Lee, K.** (2007). "A Unified System for Chord Transcription and Key Extraction Using Hidden Markov Models." ISMIR 2007. One HMM per key. <https://archives.ismir.net/ismir2007/paper/000245.pdf>
- **Temperley, D. and de Clercq, T.** (2013). "Statistical Analysis of Harmony and Melody in Rock Music." *Journal of New Music Research* 42(3): 187–204. Key finding from chord roots and metrical position. <https://doi.org/10.1080/09298215.2013.788039>. Author copy: <https://www.midside.com/publications/temperley_declercq_2013.pdf>
- **Bunks, C. and Weyde, T.** (2022). "Jazz Contrafact Detection." arXiv:2208.00792. Picks the key signature whose diatonic chords hold the most beats. <https://arxiv.org/abs/2208.00792>

## Libraries with conditions beyond MIT

- **ChordSheetJS**: parses, transposes and formats stored ChordPro. GPL-2.0-only. <https://github.com/martijnversluis/ChordSheetJS>
- **alphaTab**: draws and plays scores and phrases. MPL-2.0. <https://alphatab.net>
- **diff-match-patch**: maps a player's marks through later chart revisions (`src/charts/follow.ts`). Apache-2.0. <https://github.com/JackuB/diff-match-patch>

Every other runtime dependency in `package.json` uses the MIT or MIT-0 license.

## Test material

- **"Amazing Grace"**: words by John Newton (1779), in the public domain. Used in `tests/fixtures/amazing-grace.*`.
