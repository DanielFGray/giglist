import { degrees } from "alphatab-kit/charts/degrees"
import { numeral } from "~/charts/numeral"
import { spell } from "alphatab-kit/charts/spelling"
import { voicings } from "alphatab-kit/charts/voicing"
import { useEffect } from "react"
import { ChordDiagram } from "./ChordDiagram"
import { playChord, preloadChordPlayer } from "~/audio/chord"
import type { ChordDiagrams } from "./ChordShapes"
import { ChordStaffBlock } from "./ChordStaff"
import { ChordPianoBlock } from "./PianoDiagram"

/**
 * A row of every chord in a chart: one entry per distinct chord, in first-seen
 * order, drawn in the key the chart is shown in. Each entry is the same picture
 * as the panel's first shape: for Guitar, the best shape with degree labels; for
 * Staff, the name, numeral and stacked notes; for Piano, the name, numeral and pressed keys. A chord with no shape or no
 * spelling shows its name alone.
 */
export function ChordStrip({
  chords,
  shownKey,
  diagrams,
}: {
  chords: ReadonlyArray<string>
  shownKey: string | null
  diagrams: Exclude<ChordDiagrams, "off">
}) {
  useEffect(() => {
    preloadChordPlayer()
  }, [])
  return (
    <div data-pwid="chord-strip" className="flex flex-nowrap gap-3 overflow-x-auto py-2 sm:flex-wrap sm:overflow-visible">
      {chords.map((name) => (
        <div key={name} data-pwid="chord-strip-entry">
          <Entry name={name} shownKey={shownKey} diagrams={diagrams} />
        </div>
      ))}
    </div>
  )
}

function Entry({ name, shownKey, diagrams }: { name: string; shownKey: string | null; diagrams: Exclude<ChordDiagrams, "off"> }) {
  const spelling = spell(name)
  if (spelling !== null) {
    switch (diagrams) {
      case "staff":
        return <ChordStaffBlock name={name} spelling={spelling} shownKey={shownKey} />
      case "piano":
        return <ChordPianoBlock name={name} spelling={spelling} shownKey={shownKey} />
      case "guitar": {
        const best = voicings(spelling)[0]
        if (best === undefined) break
        return <ChordDiagram frets={best.frets} name={name} numeral={numeral(name, shownKey) ?? undefined} labels={degrees(spelling, best)} onClick={() => void playChord(best.frets)} />
      }
    }
  }
  return <div className="text-sm font-semibold">{name}</div>
}
