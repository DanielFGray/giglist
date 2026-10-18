import { degrees } from "~/charts/degrees"
import { numeral } from "~/charts/numeral"
import { spell } from "~/charts/spelling"
import { voicings } from "~/charts/voicing"
import { ChordDiagram } from "./ChordDiagram"
import type { ChordDiagrams } from "./ChordShapes"
import { ChordStaffBlock } from "./ChordStaff"

/**
 * A row of every chord in a chart: one entry per distinct chord, in first-seen
 * order, drawn in the key the chart is shown in. Each entry is the same picture
 * as the panel's first shape: for Guitar, the best shape with degree labels; for
 * Staff, the name, numeral and stacked notes. A chord with no shape or no
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
      case "guitar": {
        const best = voicings(spelling)[0]
        if (best === undefined) break
        return <ChordDiagram frets={best.frets} name={name} numeral={numeral(name, shownKey) ?? undefined} labels={degrees(spelling, best)} />
      }
    }
  }
  return <div className="text-sm font-semibold">{name}</div>
}
