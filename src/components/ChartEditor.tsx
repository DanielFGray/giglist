import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react"
import { charts, type ChartInfo } from "~/api/client"
import { composeChanges } from "gigbag.js/charts/changes"
import {
  addChordLine, addPhrase, addScoreLink, addSection, anchorLine, blockRange, canMoveBlockTo, chordLineText, deleteBlock, deleteLine, directiveName, dropSlots,
  duplicateBlock, editLine, hasHandle, inPhrase, insertLineAfter, isChordOnly, moveBlock, moveBlockTo, moveChord, parseDoc, pasteAfter, phraseAt, placeChord,
  removeChord, removeSection, renameSection, segments, serializeDoc, setChordLine, setPhrase, type ChartDoc, type DocLine, type Edit,
} from "gigbag.js/charts/doc"
import { isChordLine, isChordName, isPhraseStart, isTabStart, suggestedChords } from "gigbag.js/charts/lyrics"
import { readScoreLink } from "gigbag.js/charts/score-link"
import { chartSlot, suggest, type Suggestion } from "gigbag.js/charts/suggest"
import { BlockHandle } from "./BlockHandle"
import type { Point } from "./pointer-drag"
import { ChordInput, type ChordEntry } from "./ChordInput"
import { slotUnder, type DropRow, type DropSlot } from "./drop-slot"
import { errorMessage } from "./form"
import { Phrase } from "./Phrase"
import { PasteForm } from "./PasteForm"
import { PhraseForm } from "./PhraseForm"
import { ScoreLink } from "./ScoreLink"
import { ScorePicker } from "./ScorePicker"

/** A chord in hand: dragged or armed from the palette (no `from`), or picked up off the chart. */
type Held = { chord: string; from?: { line: number; chord: number } }

const DRAG_TYPE = "application/x-setlist-chord"

/** A word of the chart: its lyric line, and the column it starts at. */
type Place = { readonly line: number; readonly at: number }

/** The open chord field, as a line draws it on its word at column `at`. */
type EntryView = {
  readonly at: number
  readonly anchor: string
  readonly likely: ReadonlyArray<Suggestion>
  readonly fresh: ReadonlyArray<Suggestion>
  readonly onDone: (result: ChordEntry, step: -1 | 0 | 1) => void
}

const NO_SUGGESTIONS = { likely: [], fresh: [] } as const

/** A block lifted by its handle, and the slot the pointer is over, if the block may go there. */
type Drag = { block: number; over: DropSlot | null }

const button =
  "px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"

/**
 * Edits a lyrics chart by dropping chords onto words. Every edit is one step
 * with its change set; Save sends the text and the composed change set as one
 * revision, so a mark anchored in the chart follows it (docs/adr/0001).
 * The chart is edited in the key it is written in.
 */
export function ChartEditor({
  chart,
  tempo,
  scoreCharts,
  onSaved,
  onCancel,
}: {
  chart: ChartInfo & { source: string }
  /** The song's tempo, which phrases play at. */
  tempo: number | null
  /** The song's score charts: score links draw from them, and the picker offers them. */
  scoreCharts: ReadonlyArray<ChartInfo>
  onSaved: () => Promise<void>
  onCancel: () => void
}) {
  const base = useMemo(() => parseDoc(chart.source), [chart.source])
  const [steps, setSteps] = useState<ReadonlyArray<Edit>>([])
  const [held, setHeld] = useState<Held | null>(null)
  const [custom, setCustom] = useState("")
  const [editingLine, setEditingLine] = useState<number | null>(null)
  /** The word whose chord is being typed: its line, and the column it starts at. */
  const [entry, setEntry] = useState<Place | null>(null)
  /**
   * Chords typed over a word that no chip had. They stay on the chips for this
   * chart even after a replace or an undo drops their last use.
   */
  const [extra, setExtra] = useState<ReadonlyArray<string>>([])
  const [drag, setDrag] = useState<Drag | null>(null)
  /** The line a paste goes below, while the paste form is open. */
  const [pasting, setPasting] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doc = steps.at(-1)?.doc ?? base
  const customValid = isChordName(custom.trim())
  const customInvalid = custom.trim() !== "" && !customValid
  const palette = useMemo(() => {
    const used = doc.flatMap((line) => (line.kind === "lyrics" ? line.chords.map((c) => c.chord) : []))
    const suggested = chart.written_key ? suggestedChords(chart.written_key) : []
    return [...new Set([...suggested, ...used, ...extra])]
  }, [doc, chart.written_key, extra])

  // The chords offered for the word being typed over, from the chart's key and its own chords.
  const offered = useMemo(
    () => (entry && chart.written_key ? suggest(chartSlot(doc, chart.written_key, entry.line, entry.at)) : NO_SUGGESTIONS),
    [entry, doc, chart.written_key],
  )
  const entryAnchor = `--entry-${useId().replace(/\W/g, "")}`

  // On a phone the keyboard covers the bottom of the window, so the word being typed over is brought to the middle.
  const entryLine = entry?.line
  const entryColumn = entry?.at
  useEffect(() => {
    if (entryLine === undefined) return
    document.querySelector(`[data-line="${entryLine}"] [data-at="${entryColumn}"]`)?.scrollIntoView({ block: "center" })
  }, [entryLine, entryColumn])

  /** The one place the steps change. The chord field and the paste form name lines by index, so any change to the chart closes them. */
  const commit = (next: ReadonlyArray<Edit>) => {
    setEntry(null)
    setPasting(null)
    setSteps(next)
  }

  const apply = (edit: Edit) => {
    if (edit.changes.length === 0) return setEntry(null)
    commit([...steps, edit])
  }

  /** Puts or removes the typed chord, then opens the field on the word `step` words along, if any. */
  const endEntry = (place: Place, result: ChordEntry, step: -1 | 0 | 1) => {
    const line = doc[place.line]
    const chordIndex = line?.kind === "lyrics" ? line.chords.findIndex((chord) => chord.at === place.at) : -1
    if (result && "put" in result && !palette.includes(result.put)) setExtra((all) => [...all, result.put])
    const edit =
      result && "put" in result
        ? placeChord(doc, place.line, place.at, result.put)
        : result && chordIndex >= 0
          ? removeChord(doc, place.line, chordIndex)
          : null
    if (edit) apply(edit)
    else setEntry(null)
    // The edited chart, since a chord put on a chord-only line opens a new stretch past it for the next chord.
    if (step !== 0) setEntry(wordAlong(edit?.doc ?? doc, place, step))
  }

  const dropOn = (line: number, at: number, dropped: Held) => {
    apply(dropped.from ? moveChord(doc, dropped.from, { line, at }) : placeChord(doc, line, at, dropped.chord))
    setHeld(dropped.from ? null : held)
  }

  const liftedRange = drag ? blockRange(doc, drag.block) : null

  /** The slot under the pointer for the block at `block`, if the block may go there. */
  const slotAt = (block: number, point: Point): Drag["over"] => {
    const rows = [...document.querySelectorAll<HTMLElement>("[data-before]")].map((row): DropRow => {
      const { left, right, top, bottom } = row.getBoundingClientRect()
      return { line: Number(row.dataset.line), before: Number(row.dataset.before), after: Number(row.dataset.after), left, right, top, bottom }
    })
    const over = slotUnder(rows, point)
    return over && canMoveBlockTo(doc, block, over.slot) ? over : null
  }

  const dragBlock = (block: number, point: Point) => setDrag({ block, over: slotAt(block, point) })

  const dropBlock = (block: number, point: Point | null) => {
    const over = point ? slotAt(block, point) : null
    setDrag(null)
    if (over) apply(moveBlockTo(doc, block, over.slot))
  }


  const pasteForm = (after: number) => (
    <PasteForm
      doc={doc}
      after={after}
      scoreCharts={scoreCharts}
      onPaste={(source) => apply(pasteAfter(doc, after, source))}
      onCancel={() => setPasting(null)}
    />
  )

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
          <Chip key={chord} chord={chord} armed={held?.chord === chord} onHold={setHeld} />
        ))}
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (customValid) setHeld({ chord: custom.trim() })
            setCustom("")
          }}
        >
          <input
            data-pwid="palette-custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Other chord"
            aria-label="Other chord"
            aria-invalid={customInvalid}
            className="w-28 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs"
          />
          <button data-pwid="palette-custom-add" type="submit" disabled={!customValid} className={button}>
            Pick up
          </button>
        </form>
        {customInvalid && (
          <span data-pwid="palette-custom-error" role="alert" className="text-xs text-red-400">
            Not a chord name: leave out brackets and spaces.
          </span>
        )}
        <RemoveZone onRemove={(from) => apply(removeChord(doc, from.line, from.chord))} />
      </div>
      <p className="text-xs text-zinc-500">
        {held
          ? `Holding ${held.chord}. Click a word to put it there, or drag it.`
          : `Tap a word and type its chord; Tab goes on to the next word. Drag a chord to move it. Editing in ${chart.written_key ?? "the written key"}.`}
      </p>

      <div className="font-mono text-sm leading-tight">
        {doc.map((line, index) => {
          const hidden = line.kind === "literal" && inPhrase(doc, index)
          const handled = hasHandle(doc, index)
          if (hidden || (!handled && line.kind !== "literal")) return null
          const { before, after } = dropSlots(doc, index)
          const lifted = liftedRange !== null && index >= liftedRange.start && index <= liftedRange.end
          return (
            <div
              key={index}
              data-line={index}
              data-before={before}
              data-after={after}
              data-drop={drag?.over?.line === index ? drag.over.side : undefined}
              className={`relative pl-7 ${lifted ? "opacity-40" : ""} data-[drop=before]:shadow-[0_-2px_0_var(--color-amber-accent)] data-[drop=after]:shadow-[0_2px_0_var(--color-amber-accent)]`}
            >
              {handled && editingLine !== index && (
                <BlockHandle
                  label={blockLabel(line)}
                  deleteLabel={line.kind === "lyrics" || directiveName(line) === "score" ? "Delete" : "Delete section and lines"}
                  canMove={(delta) => moveBlock(doc, index, delta).changes.length > 0}
                  onMove={(delta) => apply(moveBlock(doc, index, delta))}
                  onDuplicate={() => apply(duplicateBlock(doc, index))}
                  onDelete={() => apply(deleteBlock(doc, index))}
                  onDrag={(point) => dragBlock(index, point)}
                  onDrop={(point) => dropBlock(index, point)}
                />
              )}
              <Line
                line={line}
                index={index}
                phrase={line.kind === "directive" && isPhraseStart(directiveName(line)) ? phraseAt(doc, index) : null}
                tempo={tempo}
                scoreCharts={scoreCharts}
                held={held}
                editing={editingLine === index}
                onDrop={dropOn}
                onEntry={(line, at) => setEntry({ line, at })}
                entry={
                  entry?.line === index
                    ? { at: entry.at, anchor: entryAnchor, ...offered, onDone: (result, step) => endEntry(entry, result, step) }
                    : null
                }
                onEditStart={() => setEditingLine(index)}
                onEditEnd={(text) => {
                  setEditingLine(null)
                  if (text !== null) apply(isChordOnly(line) ? setChordLine(doc, index, text) : editLine(doc, index, text))
                }}
                onAddChords={(text) => apply(addChordLine(doc, index, text))}
                onPaste={() => setPasting(index)}
                onInsertAfter={() => {
                  const edit = insertLineAfter(doc, index)
                  apply(edit)
                  setEditingLine(index + 1)
                }}
                onDelete={() => apply(deleteLine(doc, index))}
                onRename={(label) => apply(renameSection(doc, index, label))}
                onAddSection={(label) => apply(addSection(doc, index, label))}
                onRemoveSection={() => apply(removeSection(doc, index))}
                onAddPhrase={(name, tex) => apply(addPhrase(doc, index, name, tex))}
                onAddScoreLink={(value) => apply(addScoreLink(doc, index, value))}
                onSetPhrase={(name, tex) => apply(setPhrase(doc, index, name, tex))}
              />
              {pasting === index && pasting !== doc.length - 1 && pasteForm(index)}
            </div>
          )
        })}
        {/* The slot after the last line, which a block dragged to the end of the chart lands on. */}
        <div
          data-line={doc.length}
          data-before={doc.length}
          data-after={doc.length}
          data-drop={drag?.over?.line === doc.length ? "before" : undefined}
          className="h-8 data-[drop=before]:shadow-[0_-2px_0_var(--color-amber-accent)]"
        />
        {pasting === doc.length - 1 ? (
          pasteForm(doc.length - 1)
        ) : (
          <button data-pwid="editor-paste-end" type="button" onClick={() => setPasting(doc.length - 1)} className={`${button} mt-2 font-sans`}>
            Paste text
          </button>
        )}
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
          onClick={() => commit(steps.slice(0, -1))}
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

/** Dropping a chord taken off the chart here removes it. */
function RemoveZone({ onRemove }: { onRemove: (from: { line: number; chord: number }) => void }) {
  return (
    <button
      data-pwid="palette-remove"
      type="button"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const dropped = readDrag(event)
        if (dropped?.from) onRemove(dropped.from)
      }}
      className={button}
    >
      Drop here to remove
    </button>
  )
}

function Line(props: {
  line: DocLine
  index: number
  /** Set on a phrase's start line, which draws the whole phrase. */
  phrase: { name: string; tex: string } | null
  tempo: number | null
  scoreCharts: ReadonlyArray<ChartInfo>
  held: Held | null
  editing: boolean
  onDrop: (line: number, at: number, dropped: Held) => void
  /** Opens the chord field on the word at column `at` of the line. */
  onEntry: (line: number, at: number) => void
  /** The chord field, when it is open on a word of this line. */
  entry: EntryView | null
  onEditStart: () => void
  /** The line's new words, or for a chord-only line its chords as typed; null keeps the line. */
  onEditEnd: (text: string | null) => void
  /** Puts a chord-only line, typed as `G  C  D`, below this one. */
  onAddChords: (text: string) => void
  /** Opens the paste form below this line. */
  onPaste: () => void
  onInsertAfter: () => void
  onDelete: () => void
  onRename: (label: string) => void
  onAddSection: (label: string) => void
  onRemoveSection: () => void
  onAddPhrase: (name: string, tex: string) => void
  onAddScoreLink: (value: string) => void
  onSetPhrase: (name: string, tex: string) => void
}) {
  const { line } = props
  const [naming, setNaming] = useState(false)
  const [addingChords, setAddingChords] = useState(false)
  const [writingPhrase, setWritingPhrase] = useState(false)
  const [pickingScore, setPickingScore] = useState(false)
  if (props.phrase) {
    return <PhraseBlock {...props.phrase} tempo={props.tempo} onSet={props.onSetPhrase} onRemove={props.onRemoveSection} />
  }
  if (line.kind === "directive") {
    const score = /^\{\s*score\s*:\s*(.*?)\s*\}$/.exec(line.raw)
    if (score) return <ScoreLinkLine value={score[1]!} scoreCharts={props.scoreCharts} onDelete={props.onDelete} />
    const section = /^\{\s*start_of_\w+\s*(?::\s*(.*?))?\s*\}$/.exec(line.raw)
    return section ? (
      <SectionHeading
        label={section[1] ?? ""}
        tab={isTabStart(directiveName(line))}
        onRename={props.onRename}
        onRemove={props.onRemoveSection}
        onPaste={props.onPaste}
      />
    ) : null
  }
  if (props.editing) {
    return isChordOnly(line) && line.kind === "lyrics" ? (
      <LyricInput text={chordLineText(line)} pwid="chord-line-input" refusal={chordLineRefusal} onDone={props.onEditEnd} />
    ) : (
      <LyricInput text={line.text} onDone={props.onEditEnd} />
    )
  }
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
      <LyricLine
        {...props}
        onWritePhrase={() => setWritingPhrase(true)}
        onPickScore={() => setPickingScore(true)}
        onName={() => setNaming(true)}
        onWriteChords={() => setAddingChords(true)}
      />
      {addingChords && (
        <LyricInput
          text=""
          pwid="chord-line-input"
          refusal={chordLineRefusal}
          onDone={(text) => {
            setAddingChords(false)
            if (text?.trim()) props.onAddChords(text)
          }}
        />
      )}
      {pickingScore && (
        <ScorePicker
          scoreCharts={props.scoreCharts}
          onCancel={() => setPickingScore(false)}
          onSave={(value) => {
            setPickingScore(false)
            props.onAddScoreLink(value)
          }}
        />
      )}
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

/** A score link line (docs/adr/0004): the bars it draws, with a Delete button above them. */
function ScoreLinkLine({ value, scoreCharts, onDelete }: { value: string; scoreCharts: ReadonlyArray<ChartInfo>; onDelete: () => void }) {
  const reading = useMemo(() => readScoreLink(value), [value])
  const revisionId = "link" in reading ? scoreCharts.find((chart) => chart.id === reading.link.chartId)?.revision_id : undefined
  return (
    <div data-pwid="editor-score-link" className="my-2 space-y-1">
      <div className="flex justify-end">
        <button data-pwid="line-delete" type="button" onClick={onDelete} aria-label="Delete score link" className={button}>
          Delete
        </button>
      </div>
      <ScoreLink reading={reading} revisionId={revisionId} />
    </div>
  )
}

/** A lyric line: words to drop chords on, and the line's own buttons. */
function LyricLine(
  props: Parameters<typeof Line>[0] & { onWritePhrase: () => void; onPickScore: () => void; onName: () => void; onWriteChords: () => void },
) {
  const { line, index } = props
  if (line.kind !== "lyrics") return null
  return (
    <div data-pwid="editor-line" className="group flex flex-wrap items-end">
      {segments(line).map((segment) => {
        const open = props.entry?.at === segment.start ? props.entry : null
        return (
          <span
            key={segment.start}
            data-pwid="editor-segment"
            data-at={segment.start}
            onClick={() => (props.held ? props.onDrop(index, segment.start, props.held) : props.onEntry(index, segment.start))}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const dropped = readDrag(event)
              if (dropped) props.onDrop(index, segment.start, dropped)
            }}
            style={open ? ({ anchorName: open.anchor } as CSSProperties) : undefined}
            className={`relative inline-flex flex-col rounded-sm ${props.held ? "cursor-copy hover:bg-[var(--color-amber-accent)]/20" : "cursor-text"}`}
          >
            <span className="flex h-5 gap-1">
              {segment.chords.map((chordIndex) => {
                const chord = line.chords[chordIndex]!.chord
                return (
                  <button
                    key={chordIndex}
                    data-pwid="placed-chord"
                    type="button"
                    draggable
                    onDragStart={(event) => startDrag(event, { chord, from: { line: index, chord: chordIndex } })}
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onEntry(index, line.chords[chordIndex]!.at)
                    }}
                    className="font-semibold cursor-grab"
                  >
                    {chord}
                  </button>
                )
              })}
            </span>
            <span data-pwid="editor-lyric" className="whitespace-pre min-w-[1ch]">
              {line.text.slice(segment.start, segment.end) || " "}
            </span>
            {open && (
              <ChordInput
                current={line.chords.find((chord) => chord.at === segment.start)?.chord ?? null}
                likely={open.likely}
                fresh={open.fresh}
                anchor={open.anchor}
                onDone={open.onDone}
              />
            )}
          </span>
        )
      })}
      {/* Hidden on a phone, which has no hover and no room: the row is wider than the screen. */}
      <span className="ml-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:hidden">
        {isChordOnly(line) ? (
          <button data-pwid="line-edit" type="button" onClick={props.onEditStart} aria-label="Edit chords" className={button}>
            Edit chords
          </button>
        ) : (
          <button data-pwid="line-edit" type="button" onClick={props.onEditStart} aria-label="Edit words" className={button}>
            Edit words
          </button>
        )}
        <button data-pwid="line-add" type="button" onClick={props.onInsertAfter} aria-label="Add a line below" className={button}>
          + Line
        </button>
        <button data-pwid="line-chords" type="button" onClick={props.onWriteChords} aria-label="Add a line of chords below" className={button}>
          + Chords
        </button>
        <button data-pwid="line-section" type="button" onClick={props.onName} aria-label="Start a section here" className={button}>
          + Section
        </button>
        <button data-pwid="line-phrase" type="button" onClick={props.onWritePhrase} aria-label="Add a phrase below" className={button}>
          + Phrase
        </button>
        <button data-pwid="line-score" type="button" onClick={props.onPickScore} aria-label="Add score bars below" className={button}>
          + Score
        </button>
        <button data-pwid="line-paste" type="button" onClick={props.onPaste} aria-label="Paste text below" className={button}>
          Paste below
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
  onPaste,
}: {
  label: string
  /** A tab section: removing it removes its tab lines too, and nothing is pasted into it. */
  tab: boolean
  onRename: (label: string) => void
  onRemove: () => void
  /** Opens the paste form at the top of the section. */
  onPaste: () => void
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
        {!tab && (
          <button data-pwid="section-paste" type="button" onClick={onPaste} aria-label="Paste text into the section" className={button}>
            Paste
          </button>
        )}
        <button data-pwid="section-remove" type="button" onClick={onRemove} aria-label={tab ? "Remove tab" : "Remove section"} className={button}>
          {tab ? "Remove tab" : "Remove section"}
        </button>
      </span>
    </div>
  )
}

/**
 * A one-line text box: Enter keeps the text, Escape (or leaving it unchanged) keeps the old.
 * Text that `refusal` gives a reason for is not kept: the box stays open and says why.
 */
function LyricInput({
  text,
  pwid = "line-input",
  refusal,
  onDone,
}: {
  text: string
  pwid?: string
  refusal?: (text: string) => string | null
  onDone: (text: string | null) => void
}) {
  const [value, setValue] = useState(text)
  // Enter and the blur that follows it must report once.
  const done = useRef(false)
  const reason = refusal?.(value) ?? null
  const finish = (next: string | null) => {
    if (done.current || (next !== null && reason)) return
    done.current = true
    onDone(next)
  }
  return (
    <span className="block w-full">
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
        aria-invalid={reason !== null}
        className="w-full rounded-md border border-[var(--color-amber-accent)] bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-sm"
      />
      {reason && (
        <span data-pwid={`${pwid}-error`} role="alert" className="block font-sans text-xs text-red-400">
          {reason}
        </span>
      )}
    </span>
  )
}

/** Why typed text is not a line of chords, or null when it is one (blank text clears the line). */
const chordLineRefusal = (text: string): string | null =>
  text.trim() === "" || isChordLine(text) ? null : "Only chords, bar lines and spaces: put words on a line of their own."

/**
 * The next word after `place` (step 1) or the one before it (step -1), over line ends, or null past
 * either end of the chart. `place` need not be a word of `doc`: removing a chord from a chord-only
 * line takes away the stretch it stood on.
 */
function wordAlong(doc: ChartDoc, place: Place, step: -1 | 1): Place | null {
  const words = doc.flatMap((line, index) => (line.kind === "lyrics" ? segments(line).map((segment) => ({ line: index, at: segment.start })) : []))
  const after = (word: Place) => word.line > place.line || (word.line === place.line && word.at > place.at)
  const before = (word: Place) => word.line < place.line || (word.line === place.line && word.at < place.at)
  return (step === 1 ? words.find(after) : words.findLast(before)) ?? null
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

/** What a block's handle moves, in words: the line's text, or the section's or phrase's name. */
function blockLabel(line: DocLine): string {
  if (line.kind === "lyrics") return `line "${line.text.slice(0, 40) || "(empty)"}"`
  if (directiveName(line) === "score") return "score link"
  const name = anchorLine(line)
  return `${isPhraseStart(directiveName(line)) ? "phrase" : "section"} "${name || "(unnamed)"}"`
}
