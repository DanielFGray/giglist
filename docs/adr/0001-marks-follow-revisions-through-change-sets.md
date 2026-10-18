---
status: proposed
---

# Marks follow chart revisions through change sets

A player's mark (ink, text, or a pasted stamp) is anchored to a range in the chart revision it was made on: characters of the lyrics chart, or beats of one voice of a score. It is never anchored to page coordinates or to a quoted snippet. To show a mark on a later revision, the app maps its range through the change set of each revision after it. The in-app editor records each change set as it edits. A revision from outside the editor (a re-uploaded file, a paste-over) gets a change set from a whole-song diff. Where that diff could have aligned repeated content (a doubled chorus, a repeated riff) either way, a mark that touches the ambiguous span goes to the tray. The app never guesses.

We chose this because songs repeat. Measured on the owner's 223 Guitar Pro files with 8,469 marks and four kinds of edit:

- A quote with surrounding context, found again by fuzzy search (the W3C Web Annotation and Hypothesis approach), put 229–593 marks per edit kind on the wrong repeat of a riff.
- Recorded change sets put 100% of marks in the right place.
- Derived diffs with the tray rule put 0 marks in the wrong place, and sent 4–5% to the tray after an edit above them.

The same code handles chord charts and tab, because both are sequences: a chart is its characters, and a voice is one token per beat.

## Consequences

- Revisions are immutable, and a mark keeps the id of the revision it was made on. Moving a mark anchors it again on the current revision.
- Transposition is done only at display time. Anchors point into the stored chart, which never changes key, so a transposed chart needs no mapping. ChordSheetJS moves chords by the interval between the two tonics and keeps each chord's quality, so a key override that changes the mode (G to Em) shows the major-key chords a minor third down. Changing mode correctly is wanted later, not now.
- alphaTab's `Beat.id` changes on every load, so a beat is identified only by its position in its voice.
- The editor must record change sets in anchor-text offsets. A change may also set `source` on inserted text: `[source, source + insert)` names the exact source range in the earlier revision, and must be wholly covered by text deleted by this change set. `insert` must be positive; source ranges cannot overlap. This records a move, never a copy. A mark wholly inside that moved stretch maps to the same offset in the inserted text; a mark crossing its edge follows the normal changed-or-orphaned rule. Composing change sets preserves and chains these exact source links; edits inside the moved stretch remove the link only for the affected part, and a move that a later change undoes composes to no change. A mark on text a move carried and a later change then deleted is lost, as for any deleted text. A later edit inside a moved mark's own words goes to the tray; without the move the same edit would only flag the mark as changed. Players edit a lyrics chart by dropping chords onto words, so each editor operation knows exactly what it changed. If the editor records nothing, every edit is treated like a paste-over: no mark is placed wrong, but more go to the tray.
- A mark is private to its player unless the player shares it with the band. Bandmates can see a shared mark but cannot change it.
