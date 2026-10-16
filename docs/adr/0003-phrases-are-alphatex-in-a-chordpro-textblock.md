---
status: proposed
---

# A phrase is alphaTex, stored in a ChordPro textblock

A phrase is written in alphaTex, the text notation that alphaTab draws and plays. alphaTab already draws the band's scores, and one alphaTex text can hold tab, pitched notes or a drum groove. A phrase lives inside the lyrics chart's ChordPro text, so it is part of the chart's revisions and its marks follow it like any other content (docs/adr/0001):

    {start_of_textblock: Intro riff}
    :8 0.6 3.6 5.5{h} 7.5 | 5.5 3.5 0.5 5.6
    {end_of_textblock}

ChordPro has no section for alphaTex. ChordSheetJS 18 keeps the lines of six section kinds unparsed (abc, grid, ly, svg, tab, textblock); every other section's lines are read as lyrics, where `[2.5]` is a chord, `{h}` is a directive and `\tempo` stops the parser. Of the six, ChordSheetJS also rewrites chord-like words when it transposes tab and grid (`G4 A4` became `A4 B4` in a tab section), and abc, ly and svg name other notations. Only textblock keeps alphaTex exactly in every key. So in a SetList chart every textblock is a phrase, and the section's label is the phrase's name.

## Consequences

- Another ChordPro program shows a phrase as its alphaTex text, under its name.
- A notation line written as `{...}` alone would end the block, so the editor indents it by one space; alphaTex ignores the space.
- A phrase starts at the song's tempo (or the setlist's tempo for the song) when the song has one, whatever its own `\tempo` says.
- The notation is drawn as written in every key until phrases follow the shown key.
