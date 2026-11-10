---
status: proposed
---

# A recorded take becomes a phrase, rhythm first

The phrase form can record a take. The player plays to the song's click, and the browser writes the take as alphaTex for the phrase (docs/adr/0003). It reads the take in three steps; each step uses the one before it:

1. When: the click's listener (`src/audio/click/`, the one onset detector in GigList) finds where each sound starts, and each start snaps to the click's grid (`src/charts/take.ts`). The output is a slash staff (`\staff {slash}`): rhythm only, for any instrument, drums included.
2. What: each start gets its pitch (basic-pitch, Bittner et al. 2022) or, for drums, its drum.
3. Relations: string and fret, chords, ties and rests.

The browser reads the take; no audio goes to the server.

The time from a click to the moment its note shows in the recording is the sum of the device's output and input delays and the instrument's attack. When the microphone hears the count-in clicks, their arrival gives the expected delay; with headphones it does not, and the delay the browser reports stands in. The notes' common offset from the grid (their circular mean) then gives the delay within one grid slot, and the expected delay picks the slot. A bar whose notes sit between slots is flagged for the player to check. A take that read a slot early or late as a whole moves with "16th earlier" and "16th later", and each move writes the phrase again.

## Consequences

- Step 1 needs no model, so it ships first.
- The click sets the grid, so the tempo is not detected. A song without a tempo cannot be recorded.
- The grid is 16th notes in 4/4, the click's only meter. Odd meters, triplets, swing and pickup notes do not read yet.
- The form suggests speakers, so the count-in measures the delay. The listener ignores the click's own frequency bands, so the click does not read as notes. Headphones still work, with the browser's rougher estimate of the delay.
- A take whose delay is near half a grid slot can read one slot early or late as a whole; the player shifts it.
