---
status: accepted
---

# A score link is a ChordPro directive that names a score chart

A player can draw bars of a score inside a lyrics chart. The bars come from the score chart's latest revision, so a re-upload of the score changes them. Each link is one directive line in the lyrics chart's text:

    {score: chart=<score chart id> track="Lead Gtr" section="Chorus"}
    {score: chart=<score chart id> track="Lead Gtr" bars=5-8}

The directive names the score chart, never its file, so the link survives a re-upload and needs no new table. The editor writes a link through a picker that reads the score's tracks and sections, so the directive it writes always names a track and a range the picker has checked. The line is ordinary chart text, so it is part of the revisions, change sets and mark mapping like any other directive (docs/adr/0001).

A range names bars in one of two ways. A section marker runs from its bar up to the bar before the next marker. Bar numbers (1-based, as the score shows them) are the second form. A bar-number range can silently move when a re-upload adds bars before it, so a range past the score's last bar says so, and a link whose track or section is gone says so too. The app never rewrites the chart text to fix a link.

A link names a section by its marker, so two sections with the same marker cannot be told apart. The editor's picker does not offer such a section and says to use bar numbers for it. The app never rewrites the chart text to fix a link.

To draw only the range, the app clips the score before rendering. alphaTab draws a range with `display.startBar` and `display.barCount`. A repeat sign whose partner lies outside the range is cleared, since it would otherwise tell the player to repeat to a point the excerpt does not show. The tempo in effect at the first bar is written on that bar, because alphaTab stores a tempo change on the bar that makes it. The staff profile is set on every link, since the score's own profile can hide the tab.

Score links and the picker support playback of the drawn track and bars. A mouse drag uses alphaTab's built-in selection and reports the selected bars to the owner. The picker's From and To inputs edit that same selection. Playback uses the selection when present, otherwise the drawn range. The controls can loop playback. In the picker, Clear resets From and To to the whole score.

The shared score view starts alphaTab 1.8.4 in external-media mode for its cursors and built-in drag selection. This mode loads neither the synthesizer nor the sound font. Play switches to the synthesizer and reapplies the owner's selected passage when the audio player is ready, before starting playback. The synthesizer and sound font load only when playback is requested. Shift+click is outside this scope.
