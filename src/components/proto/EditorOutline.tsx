// PROTOTYPE: throwaway. Variant D: structure-first section cards for phone editing.
import { useMemo, useState } from "react"
import { charts } from "~/api/client"
import { composeChanges } from "~/charts/changes"
import { addPhrase, addSection, editLine, insertLineAfter, moveSection, parseDoc, phraseAt, renameSection, serializeDoc, setPhrase as setPhraseDoc, type ChartDoc, type DocLine, type Edit } from "~/charts/doc"
import { directiveName } from "~/charts/doc"
import { isPhraseStart } from "~/charts/lyrics"
import { errorMessage } from "../form"
import { Phrase } from "../Phrase"
import { OutlineTabGrid } from "./outline-tab-grid"
import type { ProtoEditorProps } from "./props"

const button = "min-h-11 rounded-md border border-[var(--color-border-subtle)] px-3 text-sm cursor-pointer"

type Block = { start: number; end: number; label: string; phrase: boolean }

function blocks(doc: ChartDoc): Block[] {
  const starts = doc.flatMap((line, index) => line.kind === "directive" && /^\{\s*start_of_/.test(line.raw) ? [index] : [])
  return starts.map((start, position) => {
    const line = doc[start]!
    const kind = directiveName(line).replace("start_of_", "")
    const end = doc.findIndex((candidate, index) => index > start && candidate.kind === "directive" && directiveName(candidate) === `end_of_${kind}`)
    const next = starts[position + 1]
    const final = end >= 0 && (!next || end < next) ? end : (next ?? doc.length)
    return { start, end: final, label: line.kind === "directive" ? (/^\{\s*start_of_\w+\s*(?::\s*(.*?))?\s*\}$/.exec(line.raw)?.[1] ?? kind) : kind, phrase: isPhraseStart(`start_of_${kind}`) }
  })
}

function lineWithChords(line: Extract<DocLine, { kind: "lyrics" }>): { chords: string; lyrics: string } {
  const chords = line.chords.map((chord) => `${" ".repeat(chord.at)}[${chord.chord}]`).join("").trimStart()
  return { chords, lyrics: line.text }
}

function assemble(chords: string, lyrics: string): string {
  const found = [...chords.matchAll(/\[([^\]]+)\]/g)]
  return found.reduce((text, match) => {
    const at = match.index ?? 0
    const chord = match[1]!
    const column = Math.min(at, text.length)
    return `${text.slice(0, column)}[${chord}]${text.slice(column)}`
  }, lyrics)
}

export function EditorOutline({ chart, tempo, onSaved, onCancel }: ProtoEditorProps) {
  const base = useMemo(() => parseDoc(chart.source), [chart.source])
  const [steps, setSteps] = useState<ReadonlyArray<Edit>>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [phrase, setPhraseEditor] = useState<{ line: number; tex: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const doc = steps.at(-1)?.doc ?? base
  const sections = blocks(doc)
  const apply = (edit: Edit) => { if (edit.changes.length > 0) setSteps((old) => [...old, edit]) }
  const save = async () => {
    setPending(true); setError(null)
    try {
      await charts.saveRevision(chart.id, { parent_id: chart.revision_id, source: serializeDoc(doc), changes: steps.reduce<Array<{ from: number; to: number; insert: number }>>((all, step) => composeChanges(all, step.changes), []) })
      await onSaved()
    } catch (e) { setError(errorMessage(e)) } finally { setPending(false) }
  }
  const renderLine = (line: DocLine, index: number) => {
    if (line.kind !== "lyrics") return <div key={index} className="py-1 font-mono text-sm text-zinc-500">{line.kind === "directive" ? line.raw : line.text}</div>
    if (editing === index) {
      const initial = lineWithChords(line)
      return <LineEdit key={index} initial={initial} onDone={(chords, lyrics) => { apply(editLine(doc, index, assemble(chords, lyrics))); setEditing(null) }} onCancel={() => setEditing(null)} />
    }
    return <div key={index} data-pwid="outline-line" className="flex items-start gap-2 border-b border-[var(--color-border-subtle)]/40 py-2"><div className="min-w-0 flex-1 font-mono text-sm"><div className="min-h-4 text-amber-300">{line.chords.map((chord, i) => <span key={i} className="mr-3">{chord.chord}</span>)}</div><div className="whitespace-pre-wrap">{line.text || "…"}</div></div><button type="button" aria-label="Edit line" onClick={() => setEditing(index)} className="min-h-11 min-w-11 rounded border border-[var(--color-border-subtle)] text-lg">✎</button></div>
  }
  return <div data-pwid="chart-editor" className="space-y-3 font-sans">
    <p className="text-xs text-zinc-500">Tap a section to focus its shape. Edit one lyric line at a time.</p>
    {sections.length === 0 && <div className="rounded border border-[var(--color-border-subtle)] p-3">No sections yet.</div>}
    {sections.map((section, sectionIndex) => {
      const isCollapsed = collapsed.has(section.start)
      if (section.phrase) {
        const details = phraseAt(doc, section.start)
        return <article key={section.start} className="rounded-lg border border-violet-400/40 bg-violet-950/10 p-3"><div className="flex items-center justify-between"><h2 className="font-semibold">♫ {details.name}</h2><button type="button" className={button} onClick={() => setPhraseEditor({ line: section.start, tex: details.tex })}>Edit tab</button></div><Phrase tex={details.tex} tempo={tempo} /></article>
      }
      return <article key={section.start} data-pwid="outline-section" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-3"><header className="flex items-center gap-2"><button type="button" className="min-h-11 min-w-11 text-xl" aria-label={`Collapse ${section.label}`} onClick={() => setCollapsed((old) => { const next = new Set(old); if (next.has(section.start)) next.delete(section.start); else next.add(section.start); return next })}>{isCollapsed ? "▸" : "▾"}</button><SectionName value={section.label} onDone={(label) => apply(renameSection(doc, section.start, label))} /><div className="ml-auto flex gap-1"><button type="button" className={button} onClick={() => apply(moveSection(doc, section.start, -1))} disabled={sectionIndex === 0}>↑</button><button type="button" className={button} onClick={() => apply(moveSection(doc, section.start, 1))} disabled={sectionIndex === sections.length - 1}>↓</button></div></header>{!isCollapsed && <div className="mt-2">{doc.slice(section.start + 1, section.end).map((line, offset) => renderLine(line, section.start + 1 + offset))}<div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} onClick={() => { const edit = addSection(doc, section.end, "New section"); apply(edit) }}>+ Section</button><button type="button" className={button} onClick={() => apply(insertLineAfter(doc, Math.max(section.start, section.end - 1)))}>+ line</button><button type="button" className={button} onClick={() => setPhraseEditor({ line: -1, tex: "" })}>+ phrase</button></div></div>}</article>
    })}
    {phrase?.line === -1 && <OutlineTabGrid initial="" tempo={tempo} onDone={(tex) => { apply(addPhrase(doc, doc.length - 1, "Tab phrase", tex)); setPhraseEditor(null) }} onCancel={() => setPhraseEditor(null)} />}
    {phrase && phrase.line >= 0 && <OutlineTabGrid initial={phrase.tex} tempo={tempo} onDone={(tex) => { apply(setPhraseDoc(doc, phrase.line, "Tab phrase", tex)); setPhraseEditor(null) }} onCancel={() => setPhraseEditor(null)} />}
    {error && <div data-pwid="editor-error" className="text-sm text-red-400">{error}</div>}
    <div className="flex gap-2"><button data-pwid="editor-save" type="button" onClick={save} disabled={steps.length === 0 || pending} className="min-h-11 rounded-md bg-[var(--color-amber-accent)] px-4 text-sm font-semibold text-zinc-950 disabled:opacity-50">{pending ? "Saving…" : "Save changes"}</button><button type="button" className={button} onClick={onCancel}>Cancel</button></div>
  </div>
}

function SectionName({ value, onDone }: { value: string; onDone: (value: string) => void }) {
  const [editing, setEditing] = useState(false); const [text, setText] = useState(value)
  if (editing) return <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { setEditing(false); onDone(text) }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }} className="min-h-11 min-w-0 flex-1 rounded border border-[var(--color-amber-accent)] bg-[var(--color-surface-raised)] px-2 font-semibold" />
  return <button type="button" onClick={() => setEditing(true)} className="min-h-11 min-w-0 flex-1 truncate text-left text-lg font-semibold">{value || "Untitled"}</button>
}

function LineEdit({ initial, onDone, onCancel }: { initial: { chords: string; lyrics: string }; onDone: (chords: string, lyrics: string) => void; onCancel: () => void }) {
  const [chords, setChords] = useState(initial.chords); const [lyrics, setLyrics] = useState(initial.lyrics)
  return <div className="space-y-1 border border-[var(--color-amber-accent)] p-2"><input autoFocus aria-label="Chords" value={chords} onChange={(e) => setChords(e.target.value)} className="w-full border-b border-amber-400/40 bg-transparent font-mono text-sm text-amber-300" /><textarea aria-label="Lyrics" value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={2} className="w-full bg-transparent font-mono text-sm" /><button type="button" className={button} onClick={() => onDone(chords, lyrics)}>Done</button><button type="button" className={button} onClick={onCancel}>Cancel</button></div>
}
