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

No code follows a published paper yet.

## Libraries with conditions beyond MIT

- **ChordSheetJS**: parses, transposes and formats stored ChordPro. GPL-2.0-only. <https://github.com/martijnversluis/ChordSheetJS>
- **alphaTab**: draws and plays scores and phrases. MPL-2.0. <https://alphatab.net>
- **diff-match-patch**: maps a player's marks through later chart revisions (`src/charts/follow.ts`). Apache-2.0. <https://github.com/JackuB/diff-match-patch>

Every other runtime dependency in `package.json` uses the MIT or MIT-0 license.

## Test material

- **"Amazing Grace"**: words by John Newton (1779), in the public domain. Used in `tests/fixtures/amazing-grace.*`.
