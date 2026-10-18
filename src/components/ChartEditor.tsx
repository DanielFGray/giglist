import { useMemo, useRef, useState, type DragEvent } from "react"
import { charts, type ChartInfo } from "~/api/client"
import { composeChanges } from "~/charts/changes"
import {
  addPhrase, addSection, deleteLine, directiveName, editLine, inPhrase, insertLineAfter, moveChord, moveSection, parseDoc, phraseAt, placeChord,
  removeChord, removeSection, renameSection, segments, serializeDoc, setPhrase, type DocLine, type Edit,
} from "~/charts/doc"
import { isPhraseStart, isTabStart, suggestedChords } from "~/charts/lyrics"
import { errorMessage } from "./form"
import { Phrase } from "./Phrase"
import { PhraseForm } from "./PhraseForm"
import { EditorOutline } from "./proto/EditorOutline"
import { EditorTap } from "./proto/EditorTap"
import { EditorText } from "./proto/EditorText"
import { PrototypeSwitcher, useVariant } from "./proto/PrototypeSwitcher"
import type { ProtoEditorProps } from "./proto/props"

/** A chord in hand: dragged or armed from the palette (no `from`), or picked up off the chart. */
type Held = { chord: string; from?: { line: number; chord: number } }

const DRAG_TYPE = "application/x-setlist-chord"

const button =
  "px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"

/**
 * Edits a lyrics chart by dropping chords onto words. Every edit is one step
 * with its change set; Save sends the text and the composed change set as one
 * revision, so a mark anchored in the chart follows it (docs/adr/0001).
 * The chart is edited in the key it is written in.
 */
function DragEditor({
  chart,
  tempo,
  onSaved,
  onCancel,
}: {
  chart: ChartInfo & { source: string }
  /** The song's tempo, which phrases play at. */
  tempo: number | null
  onSaved: () => Promise<void>
  onCancel: () => void
}) {
  const base = useMemo(() => parseDoc(chart.source), [chart.source])
  const [steps, setSteps] = useState<ReadonlyArray<Edit>>([])
  const [held, setHeld] = useState<Held | null>(null)
  const [custom, setCustom] = useState("")
  const [editingLine, setEditingLine] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doc = steps.at(-1)?.doc ?? base
  const palette = useMemo(() => {
    const used = doc.flatMap((line) => (line.kind === "lyrics" ? line.chords.map((c) => c.chord) : []))
    const suggested = chart.written_key ? suggestedChords(chart.written_key) : []
    return [...new Set([...suggested, ...used])]
  }, [doc, chart.written_key])

  const apply = (edit: Edit) => {
    if (edit.changes.length === 0) return
    setSteps([...steps, edit])
  }

  const dropOn = (line: number, at: number, dropped: Held) => {
    apply(dropped.from ? moveChord(doc, dropped.from, { line, at }) : placeChord(doc, line, at, dropped.chord))
    setHeld(dropped.from ? null : held)
  }

  const save = async () => {
    setPending(true)
    setError(null)
    try {
      await charts.saveRevision(chart.id, {
        parent_id: chart.revision_id,
        source: serializeDoc(doc),
        changes: steps.reduce<Array<{ from: number; to: number; insert: number }>>((all, step) => composeChanges(all, step.changes), []),
      })
      await onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <div data-pwid="chart-editor" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" data-pwid="palette">
        {palette.map((chord) => (
          <Chip key={chord} chord={chord} armed={held?.chord === chord && !held.from} onHold={setHeld} />
        ))}
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (custom.trim()) setHeld({ chord: custom.trim() })
            setCustom("")
          }}
        >
          <input
            data-pwid="palette-custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Other chord"
            aria-label="Other chord"
            className="w-28 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs"
          />
          <button data-pwid="palette-custom-add" type="submit" className={button}>
            Pick up
          </button>
        </form>
        <RemoveZone
          held={held?.from ? held : null}
          onRemove={(from) => {
            apply(removeChord(doc, from.line, from.chord))
            setHeld(null)
          }}
        />
      </div>
      <p className="text-xs text-zinc-500">
        {held
          ? `Holding ${held.chord}. Click a word to put it there, or drag it.`
          : `Drag a chord onto a word, or click a chord and then a word. Editing in ${chart.written_key ?? "the written key"}.`}
      </p>

      <div className="font-mono text-sm leading-tight">
        {doc.map((line, index) => (
          <Line
            key={index}
            line={line}
            index={index}
            phrase={line.kind === "directive" && isPhraseStart(directiveName(line)) ? phraseAt(doc, index) : null}
            hidden={line.kind === "literal" && inPhrase(doc, index)}
            tempo={tempo}
            held={held}
            editing={editingLine === index}
            onDrop={dropOn}
            onHold={setHeld}
            onEditStart={() => setEditingLine(index)}
            onEditEnd={(text) => {
              setEditingLine(null)
              if (text !== null) apply(editLine(doc, index, text))
            }}
            onInsertAfter={() => {
              const edit = insertLineAfter(doc, index)
              apply(edit)
              setEditingLine(index + 1)
            }}
            onDelete={() => apply(deleteLine(doc, index))}
            onRename={(label) => apply(renameSection(doc, index, label))}
            onAddSection={(label) => apply(addSection(doc, index, label))}
            onRemoveSection={() => apply(removeSection(doc, index))}
            onMoveSection={(delta) => apply(moveSection(doc, index, delta))}
            onAddPhrase={(name, tex) => apply(addPhrase(doc, index, name, tex))}
            onSetPhrase={(name, tex) => apply(setPhrase(doc, index, name, tex))}
          />
        ))}
      </div>

      {error && <div data-pwid="editor-error" className="text-sm text-red-400">{error}</div>}
      <div className="flex gap-2">
        <button
          data-pwid="editor-save"
          type="button"
          onClick={save}
          disabled={steps.length === 0 || pending}
          className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          data-pwid="editor-undo"
          type="button"
          onClick={() => setSteps(steps.slice(0, -1))}
          disabled={steps.length === 0}
          className={button}
        >
          Undo
        </button>
        <button data-pwid="editor-cancel" type="button" onClick={onCancel} className={button}>
          {steps.length === 0 ? "Close" : "Discard changes"}
        </button>
      </div>
    </div>
  )
}

function Chip({ chord, armed, onHold }: { chord: string; armed: boolean; onHold: (held: Held | null) => void }) {
  return (
    <button
      data-pwid="palette-chord"
      type="button"
      draggable
      onDragStart={(event) => startDrag(event, { chord })}
      onClick={() => onHold(armed ? null : { chord })}
      aria-pressed={armed}
      className={`px-2.5 py-1 rounded-md border text-sm font-semibold cursor-grab ${
        armed
          ? "border-[var(--color-amber-accent)] bg-[var(--color-amber-accent)] text-zinc-950"
          : "border-[var(--color-border-subtle)]"
      }`}
    >
      {chord}
    </button>
  )
}

/** Dropping a chord taken off the chart here removes it; so does clicking while holding one. */
function RemoveZone({ held, onRemove }: { held: Held | null; onRemove: (from: { line: number; chord: number }) => void }) {
  return (
    <button
      data-pwid="palette-remove"
      type="button"
      onClick={() => held?.from && onRemove(held.from)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const dropped = readDrag(event)
        if (dropped?.from) onRemove(dropped.from)
      }}
      className={button}
    >
      {held ? `Remove ${held.chord}` : "Drop here to remove"}
    </button>
  )
}

function Line(props: {
  line: DocLine
  index: number
  /** Set on a phrase's start line, which draws the whole phrase. */
  phrase: { name: string; tex: string } | null
  /** A line of a phrase's notation: the phrase's start line draws it. */
  hidden: boolean
  tempo: number | null
  held: Held | null
  editing: boolean
  onDrop: (line: number, at: number, dropped: Held) => void
  onHold: (held: Held | null) => void
  onEditStart: () => void
  onEditEnd: (text: string | null) => void
  onInsertAfter: () => void
  onDelete: () => void
  onRename: (label: string) => void
  onAddSection: (label: string) => void
  onRemoveSection: () => void
  onMoveSection: (delta: -1 | 1) => void
  onAddPhrase: (name: string, tex: string) => void
  onSetPhrase: (name: string, tex: string) => void
}) {
  const { line } = props
  const [naming, setNaming] = useState(false)
  const [writingPhrase, setWritingPhrase] = useState(false)
  if (props.hidden) return null
  if (props.phrase) {
    return <PhraseBlock {...props.phrase} tempo={props.tempo} onSet={props.onSetPhrase} onRemove={props.onRemoveSection} />
  }
  if (line.kind === "directive") {
    const section = /^\{\s*start_of_\w+\s*(?::\s*(.*?))?\s*\}$/.exec(line.raw)
    return section ? (
      <SectionHeading
        label={section[1] ?? ""}
        tab={isTabStart(directiveName(line))}
        onRename={props.onRename}
        onRemove={props.onRemoveSection}
        onMove={props.onMoveSection}
      />
    ) : null
  }
  if (props.editing) return <LyricInput text={line.text} onDone={props.onEditEnd} />
  if (line.kind === "literal") {
    // Tab is kept as written: no chords go on it, but its text can be corrected.
    return (
      <div data-pwid="editor-tab" className="group relative flex items-center">
        <span className="whitespace-pre">{line.text}</span>
        {/* Out of the flow: a row as tall as the buttons would pull the tab's rows apart. */}
        <span className="absolute left-full z-10 ml-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <button data-pwid="line-edit" type="button" onClick={props.onEditStart} aria-label="Edit tab line" className={button}>
            Edit
          </button>
          <button data-pwid="line-delete" type="button" onClick={props.onDelete} aria-label="Delete line" className={button}>
            Delete
          </button>
        </span>
      </div>
    )
  }
  if (naming) {
    return (
      <LyricInput
        text=""
        pwid="new-section-input"
        onDone={(label) => {
          setNaming(false)
          if (label?.trim()) props.onAddSection(label)
        }}
      />
    )
  }
  return (
    <>
      <LyricLine {...props} onWritePhrase={() => setWritingPhrase(true)} onName={() => setNaming(true)} />
      {writingPhrase && (
        <PhraseForm
          name=""
          tex=""
          tempo={props.tempo}
          onCancel={() => setWritingPhrase(false)}
          onSave={(name, tex) => {
            setWritingPhrase(false)
            props.onAddPhrase(name, tex)
          }}
        />
      )}
    </>
  )
}

/** A lyric line: words to drop chords on, and the line's own buttons. */
function LyricLine(props: Parameters<typeof Line>[0] & { onWritePhrase: () => void; onName: () => void }) {
  const { line, index } = props
  if (line.kind !== "lyrics") return null
  return (
    <div data-pwid="editor-line" className="group flex flex-wrap items-end">
      {segments(line).map((segment) => (
        <span
          key={segment.start}
          data-pwid="editor-segment"
          onClick={() => props.held && props.onDrop(index, segment.start, props.held)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const dropped = readDrag(event)
            if (dropped) props.onDrop(index, segment.start, dropped)
          }}
          className={`inline-flex flex-col rounded-sm ${props.held ? "cursor-copy hover:bg-[var(--color-amber-accent)]/20" : ""}`}
        >
          <span className="flex h-5 gap-1">
            {segment.chords.map((chordIndex) => {
              const chord = line.chords[chordIndex]!.chord
              const picked = props.held?.from?.line === index && props.held.from.chord === chordIndex
              return (
                <button
                  key={chordIndex}
                  data-pwid="placed-chord"
                  type="button"
                  draggable
                  onDragStart={(event) => startDrag(event, { chord, from: { line: index, chord: chordIndex } })}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onHold(picked ? null : { chord, from: { line: index, chord: chordIndex } })
                  }}
                  className={`font-semibold cursor-grab ${picked ? "bg-[var(--color-amber-accent)] text-zinc-950" : "text-[var(--color-amber-accent)]"}`}
                >
                  {chord}
                </button>
              )
            })}
          </span>
          <span data-pwid="editor-lyric" className="whitespace-pre min-w-[1ch]">
            {line.text.slice(segment.start, segment.end) || " "}
          </span>
        </span>
      ))}
      <span className="ml-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button data-pwid="line-edit" type="button" onClick={props.onEditStart} aria-label="Edit words" className={button}>
          Edit words
        </button>
        <button data-pwid="line-add" type="button" onClick={props.onInsertAfter} aria-label="Add a line below" className={button}>
          + Line
        </button>
        <button data-pwid="line-section" type="button" onClick={props.onName} aria-label="Start a section here" className={button}>
          + Section
        </button>
        <button data-pwid="line-phrase" type="button" onClick={props.onWritePhrase} aria-label="Add a phrase below" className={button}>
          + Phrase
        </button>
        <button data-pwid="line-delete" type="button" onClick={props.onDelete} aria-label="Delete line" className={button}>
          Delete
        </button>
      </span>
    </div>
  )
}

/** A phrase drawn as it will show, with its name; Edit opens it in the phrase form. */
function PhraseBlock({
  name,
  tex,
  tempo,
  onSet,
  onRemove,
}: {
  name: string
  tex: string
  tempo: number | null
  onSet: (name: string, tex: string) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <PhraseForm
        name={name}
        tex={tex}
        tempo={tempo}
        onCancel={() => setEditing(false)}
        onSave={(newName, newTex) => {
          setEditing(false)
          onSet(newName, newTex)
        }}
      />
    )
  }
  return (
    <div data-pwid="editor-phrase" className="group my-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{name}</span>
        <span className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <button data-pwid="phrase-edit" type="button" onClick={() => setEditing(true)} aria-label="Edit phrase" className={button}>
            Edit phrase
          </button>
          <button data-pwid="phrase-remove" type="button" onClick={onRemove} aria-label="Remove phrase" className={button}>
            Remove phrase
          </button>
        </span>
      </div>
      <Phrase tex={tex} tempo={tempo} />
    </div>
  )
}

function SectionHeading({
  label,
  tab,
  onRename,
  onRemove,
  onMove,
}: {
  label: string
  /** A tab section: removing it removes its tab lines too. */
  tab: boolean
  onRename: (label: string) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <LyricInput
        text={label}
        pwid="section-input"
        onDone={(text) => {
          setEditing(false)
          if (text !== null) onRename(text)
        }}
      />
    )
  }
  return (
    <div className="group mt-3 mb-1 flex items-center gap-2">
      <button
        data-pwid="editor-section"
        type="button"
        onClick={() => setEditing(true)}
        title="Rename section"
        className="block text-xs font-semibold uppercase tracking-wide text-zinc-400 cursor-text"
      >
        {label || (tab ? "Tab" : "Section")}
      </button>
      <span className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button data-pwid="section-move-up" type="button" onClick={() => onMove(-1)} aria-label="Move section up" className={button}>
          ↑
        </button>
        <button data-pwid="section-move-down" type="button" onClick={() => onMove(1)} aria-label="Move section down" className={button}>
          ↓
        </button>
        <button data-pwid="section-remove" type="button" onClick={onRemove} aria-label={tab ? "Remove tab" : "Remove section"} className={button}>
          {tab ? "Remove tab" : "Remove section"}
        </button>
      </span>
    </div>
  )
}

/** A one-line text box: Enter keeps the text, Escape (or leaving it unchanged) keeps the old. */
function LyricInput({ text, pwid = "line-input", onDone }: { text: string; pwid?: string; onDone: (text: string | null) => void }) {
  const [value, setValue] = useState(text)
  // Enter and the blur that follows it must report once.
  const done = useRef(false)
  const finish = (next: string | null) => {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  return (
    <input
      data-pwid={pwid}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value)
        if (e.key === "Escape") finish(null)
      }}
      onBlur={() => finish(value)}
      className="w-full rounded-md border border-[var(--color-amber-accent)] bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-sm"
    />
  )
}

function startDrag(event: DragEvent, held: Held) {
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(held))
  event.dataTransfer.effectAllowed = "move"
}

function readDrag(event: DragEvent): Held | null {
  event.preventDefault()
  const raw = event.dataTransfer.getData(DRAG_TYPE)
  return raw ? (JSON.parse(raw) as Held) : null
}

// PROTOTYPE: throwaway switch between editing designs, chosen by `?editor=`.
const VARIANTS = ["A", "B", "C", "D"] as const
const VARIANT_NAMES = { A: "Drag (today)", B: "Text area with a toolbar", C: "Tap a word, pick a chord", D: "Sections as cards" }

export function ChartEditor(props: ProtoEditorProps) {
  const [variant, setVariant] = useVariant(VARIANTS)
  return (
    <>
      {variant === "A" && <DragEditor {...props} />}
      {variant === "B" && <EditorText {...props} />}
      {variant === "C" && <EditorTap {...props} />}
      {variant === "D" && <EditorOutline {...props} />}
      <PrototypeSwitcher names={VARIANT_NAMES} current={variant} onChange={setVariant} />
    </>
  )
}
