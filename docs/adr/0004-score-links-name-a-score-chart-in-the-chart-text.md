---
status: accepted
---

# A score link is a ChordPro directive that names a score chart

A player can draw bars of a score inside a lyrics chart. The bars come from the score chart's latest revision, so a re-upload of the score changes them. Each link is one directive line in the lyrics chart's text:

    {score: chart=<score chart id> track="Lead Gtr" section="Chorus"}
    {score: chart=<score chart id> track="Lead Gtr" bars=5-8}

The directive names the score chart, never its file, so the link survives a re-upload and needs no new table. The line is ordinary chart text, so it is part of the revisions, change sets and mark mapping like any other directive (docs/adr/0001).

A range names bars in one of two ways. A section marker runs from its bar up to the bar before the next marker. Bar numbers (1-based, as the score shows them) are the second form. A bar-number range can silently move when a re-upload adds bars before it, so a range past the score's last bar says so, and a link whose track or section is gone says so too. The app never rewrites the chart text to fix a link.

To draw only the range, the app clips the score before rendering. alphaTab draws a range with `display.startBar` and `display.barCount`. A repeat sign whose partner lies outside the range is cleared, since it would otherwise tell the player to repeat to a point the excerpt does not show. The tempo in effect at the first bar is written on that bar, because alphaTab stores a tempo change on the bar that makes it. The staff profile is set on every link, since the score's own profile can hide the tab.

Playback is not part of the first slice. A range that cuts a repeat plays wrongly.
