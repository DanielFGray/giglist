import { useMemo, useState } from "react"
import { readPhrase } from "alphatab-kit/charts/phrase"
import { Phrase } from "./Phrase"
import { RecordTake } from "./RecordTake"

const EXAMPLE = ":8 0.6 3.6 5.5 3.5 | 5.5 3.5 0.5 5.6"

/**
 * Writes or changes a phrase: a name and its alphaTex, drawn as it is typed.
 * Save waits until alphaTab can read the notation, so a chart never holds a
 * phrase that cannot be drawn.
 */
export function PhraseForm({
  name: initialName,
  tex: initialTex,
  tempo,
  onSave,
  onCancel,
}: {
  name: string
  tex: string
  tempo: number | null
  onSave: (name: string, tex: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [tex, setTex] = useState(initialTex)
  const readable = useMemo(() => tex.trim() !== "" && "score" in readPhrase(tex, null), [tex])
  const field =
    "w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-sm"
  const button =
    "px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
  return (
    <div data-pwid="phrase-form" className="my-2 space-y-2 font-sans">
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Name</span>
        <input data-pwid="phrase-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Intro riff" className={field} />
      </label>
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>
          Notation in{" "}
          <a href="https://alphatab.net/docs/alphatex/introduction" target="_blank" rel="noreferrer" className="underline">
            alphaTex
          </a>
          : <code>fret.string</code> for tab, <code>C4</code> for a pitch, <code>:8</code> for eighth notes, <code>|</code> between bars.
        </span>
        <textarea data-pwid="phrase-tex" value={tex} onChange={(e) => setTex(e.target.value)} rows={4} placeholder={EXAMPLE} className={field} />
      </label>
      {tempo === null ? (
        <p className="text-xs text-zinc-500">Give the song a tempo to record a take to its click.</p>
      ) : (
        <RecordTake bpm={tempo} onTex={setTex} className={button} />
      )}
      {tex.trim() !== "" && <Phrase tex={tex} tempo={tempo} />}
      <div className="flex gap-2">
        <button data-pwid="phrase-save" type="button" disabled={!readable || name.trim() === ""} onClick={() => onSave(name, tex)} className={button}>
          Keep phrase
        </button>
        <button data-pwid="phrase-cancel" type="button" onClick={onCancel} className={button}>
          Cancel
        </button>
      </div>
    </div>
  )
}
