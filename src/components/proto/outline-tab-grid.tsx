// PROTOTYPE: throwaway. A phone-sized tab grid for phrase editing.
import { useMemo, useState } from "react"
import { Phrase } from "../Phrase"

const strings = [6, 5, 4, 3, 2, 1]

type Grid = Array<Array<string>>

function texFor(grid: Grid): string {
  const beats = grid.map((beat, index) => {
    const notes = beat.flatMap((fret, row) => (fret.trim() ? [`${fret.trim()}.${strings[row]}`] : []))
    return `${notes.join(" ") || "r"}${(index + 1) % 8 === 0 && index + 1 < grid.length ? " |" : ""}`
  })
  return `:8 ${beats.join(" ")}`
}

export function OutlineTabGrid({ initial, tempo, onDone, onCancel }: { initial: string; tempo: number | null; onDone: (tex: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("Tab phrase")
  const [grid, setGrid] = useState<Grid>(() => Array.from({ length: 8 }, () => Array(6).fill("")))
  const [selected, setSelected] = useState<{ beat: number; row: number } | null>(null)
  const [raw, setRaw] = useState(false)
  const [rawText, setRawText] = useState(initial || ":8 ")
  const tex = useMemo(() => texFor(grid), [grid])
  const setCell = (value: string) => {
    if (!selected) return
    setGrid((old) => old.map((beat, beatIndex) => beatIndex !== selected.beat ? beat : beat.map((fret, row) => row === selected.row ? value.replace(/[^0-9x]/gi, "").slice(0, 2) : fret)))
  }
  const addBeat = () => setGrid((old) => [...old, Array(6).fill("")])
  const output = raw ? rawText : tex
  return (
    <div data-pwid="outline-tab-form" className="space-y-3 rounded-lg border border-[var(--color-amber-accent)]/50 p-3">
      <label className="block text-xs text-zinc-400">Phrase name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-2 text-sm" /></label>
      <div className="overflow-x-auto">
        <div className="min-w-[360px] rounded border border-[var(--color-border-subtle)] p-2 font-mono text-xs">
          {strings.map((string, row) => <div key={string} className="flex items-center gap-1"><span className="w-4 text-zinc-500">{string}</span>{grid.map((beat, beatIndex) => <button key={beatIndex} type="button" aria-label={`String ${string}, beat ${beatIndex + 1}`} onClick={() => setSelected({ beat: beatIndex, row })} className={`h-9 min-w-9 border ${selected?.beat === beatIndex && selected.row === row ? "border-[var(--color-amber-accent)] bg-amber-500/20" : "border-[var(--color-border-subtle)]"}`}>{beat[row] || "·"}</button>)}</div>)}
          <div className="ml-5 flex gap-1 pt-1">{grid.map((_, i) => <span key={i} className="min-w-9 text-center text-[10px] text-zinc-600">{i + 1}</span>)}</div>
        </div>
      </div>
      {selected && <div className="flex items-center gap-2"><span className="text-xs text-zinc-500">Fret</span><input autoFocus inputMode="numeric" value={grid[selected.beat]![selected.row]} onChange={(e) => setCell(e.target.value)} className="h-11 w-16 rounded border border-[var(--color-amber-accent)] bg-[var(--color-surface-raised)] px-2 text-center text-lg" /><button type="button" onClick={() => setCell("")} className="h-11 rounded border border-[var(--color-border-subtle)] px-3 text-xs">Clear</button></div>}
      <button type="button" onClick={addBeat} className="min-h-11 rounded border border-[var(--color-border-subtle)] px-3 text-sm">+ Beat</button>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={raw} onChange={(e) => { setRaw(e.target.checked); if (!e.target.checked) setRawText(tex) }} /> Raw alphaTex</label>
      {raw ? <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={3} className="w-full rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2 font-mono text-xs" /> : <Phrase tex={output} tempo={tempo} />}
      <div className="flex gap-2"><button type="button" data-pwid="outline-phrase-done" onClick={() => onDone(output)} disabled={!name.trim()} className="min-h-11 rounded bg-[var(--color-amber-accent)] px-4 text-sm font-semibold text-zinc-950">Done</button><button type="button" onClick={onCancel} className="min-h-11 rounded border border-[var(--color-border-subtle)] px-4 text-sm">Cancel</button></div>
    </div>
  )
}
