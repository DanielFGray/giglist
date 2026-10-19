import { useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import { charts, type ChartInfo } from "~/api/client"
import { composeChanges } from "~/charts/changes"
import {
  addPhrase, addScoreLink, addSection, anchorLine, blockRange, canMoveBlockTo, deleteBlock, deleteLine, directiveName, dropSlots, duplicateBlock, editLine, hasHandle, inPhrase,
  insertLineAfter, moveBlock, moveBlockTo, moveChord, parseDoc, phraseAt, placeChord, removeChord, removeSection, renameSection, segments, serializeDoc,
  setPhrase, type DocLine, type Edit,
} from "~/charts/doc"
import { isChordName, isPhraseStart, isTabStart, suggestedChords } from "~/charts/lyrics"
import { readScoreLink } from "~/charts/score-link"
import { BlockHandle, type Point } from "./BlockHandle"
import { ChordSheet } from "./ChordSheet"
import { slotUnder, type DropRow, type DropSlot } from "./drop-slot"
import { errorMessage } from "./form"
import { Phrase } from "./Phrase"
import { PhraseForm } from "./PhraseForm"
import { ScoreLink } from "./ScoreLink"
import { ScorePicker } from "./ScorePicker"

/** A chord in hand: dragged or armed from the palette (no `from`), or picked up off the chart. */
type Held = { chord: string; from?: { line: number; chord: number } }

const DRAG_TYPE = "application/x-setlist-chord"

/** A block lifted by its handle, and the slot the pointer is over, if the block may go there. */
type Drag = { block: number; over: DropSlot | null }

/** While dragging a block, a pointer this close to the top or bottom of the window scrolls the page. */
const EDGE = 70
const SCROLL_STEP = 14

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
  const [sheet, setSheet] = useState<{ line: number; at: number } | null>(null)
  /**
   * Chords typed into the chord sheet that no chip had. They stay on the chips for
   * this chart even after a replace or an undo drops their last use.
   */
  const [extra, setExtra] = useState<ReadonlyArray<string>>([])
  const [drag, setDrag] = useState<Drag | null>(null)
  const pointer = useRef<Point | null>(null)
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

  // The chord sheet's word, read from the current chart.
  const sheetLine = sheet ? doc[sheet.line] : undefined
  const target =
    sheet && sheetLine?.kind === "lyrics"
      ? (() => {
          const found = sheetLine.chords.findIndex((c) => c.at === sheet.at)
          return {
            ...sheet,
            chordIndex: found >= 0 ? found : null,
            current: found >= 0 ? sheetLine.chords[found]!.chord : null,
            word: sheetLine.text.slice(sheet.at).trim().split(/\s+/)[0] || "the end of the line",
          }
        })()
      : null

  // On a phone the sheet covers the bottom of the window, so the word it edits is brought to the middle.
  const sheetLineIndex = sheet?.line
  const sheetColumn = sheet?.at
  useEffect(() => {
    if (sheetLineIndex === undefined) return
    document.querySelector(`[data-line="${sheetLineIndex}"] [data-at="${sheetColumn}"]`)?.scrollIntoView({ block: "center" })
  }, [sheetLineIndex, sheetColumn])

  /** The one place the steps change. The chord sheet names a word by line and column, so any change to the chart closes it. */
  const commit = (next: ReadonlyArray<Edit>) => {
    setSheet(null)
    setSteps(next)
  }

  const apply = (edit: Edit) => {
    if (edit.changes.length === 0) return setSheet(null)
    commit([...steps, edit])
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

  const dragBlock = (block: number, point: Point) => {
    pointer.current = point
    setDrag({ block, over: slotAt(block, point) })
  }

  const dropBlock = (block: number, point: Point | null) => {
    const over = point ? slotAt(block, point) : null
    pointer.current = null
    setDrag(null)
    if (over) apply(moveBlockTo(doc, block, over.slot))
  }

  // A touch drag cannot scroll the page itself, so while a block is held near the top or bottom
  // edge the page scrolls, even when the pointer is still. The slot under the pointer changes as it scrolls.
  const heldBlock = drag?.block
  useEffect(() => {
    if (heldBlock === undefined) return
    const id = setInterval(() => {
      const point = pointer.current
      if (!point) return
      if (point.y < EDGE) window.scrollBy(0, -SCROLL_STEP)
      else if (point.y > window.innerHeight - EDGE) window.scrollBy(0, SCROLL_STEP)
      else return
      setDrag({ block: heldBlock, over: slotAt(heldBlock, point) })
    }, 16)
    return () => clearInterval(id)
  })


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
          : `Tap a word to add a chord, or a chord to change it. Drag a chord to move it. Editing in ${chart.written_key ?? "the written key"}.`}
      </p>
      {target && (
        <ChordSheet
          key={`${target.line}:${target.at}`}
          chips={palette}
          word={target.word}
          current={target.current}
          onPick={(chord) => apply(placeChord(doc, target.line, target.at, chord))}
          onType={(chord) => {
            if (!palette.includes(chord)) setExtra((all) => [...all, chord])
            apply(placeChord(doc, target.line, target.at, chord))
          }}
          onRemove={target.chordIndex === null ? null : () => apply(removeChord(doc, target.line, target.chordIndex!))}
          onClose={() => setSheet(null)}
        />
      )}

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
                onSheet={(line, at) => setSheet({ line, at })}
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
                onAddPhrase={(name, tex) => apply(addPhrase(doc, index, name, tex))}
                onAddScoreLink={(value) => apply(addScoreLink(doc, index, value))}
                onSetPhrase={(name, tex) => apply(setPhrase(doc, index, name, tex))}
              />
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
  /** Opens the chord sheet on the word at column `at` of the line. */
  onSheet: (line: number, at: number) => void
  onEditStart: () => void
  onEditEnd: (text: string | null) => void
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
      <LyricLine
        {...props}
        onWritePhrase={() => setWritingPhrase(true)}
        onPickScore={() => setPickingScore(true)}
        onName={() => setNaming(true)}
      />
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
function LyricLine(props: Parameters<typeof Line>[0] & { onWritePhrase: () => void; onPickScore: () => void; onName: () => void }) {
  const { line, index } = props
  if (line.kind !== "lyrics") return null
  return (
    <div data-pwid="editor-line" className="group flex flex-wrap items-end">
      {segments(line).map((segment) => (
        <span
          key={segment.start}
          data-pwid="editor-segment"
          data-at={segment.start}
          onClick={() => (props.held ? props.onDrop(index, segment.start, props.held) : props.onSheet(index, segment.start))}
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
              return (
                <button
                  key={chordIndex}
                  data-pwid="placed-chord"
                  type="button"
                  draggable
                  onDragStart={(event) => startDrag(event, { chord, from: { line: index, chord: chordIndex } })}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onSheet(index, line.chords[chordIndex]!.at)
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
        <button data-pwid="line-score" type="button" onClick={props.onPickScore} aria-label="Add score bars below" className={button}>
          + Score
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
}: {
  label: string
  /** A tab section: removing it removes its tab lines too. */
  tab: boolean
  onRename: (label: string) => void
  onRemove: () => void
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

/** What a block's handle moves, in words: the line's text, or the section's or phrase's name. */
function blockLabel(line: DocLine): string {
  if (line.kind === "lyrics") return `line "${line.text.slice(0, 40) || "(empty)"}"`
  if (directiveName(line) === "score") return "score link"
  const name = anchorLine(line)
  return `${isPhraseStart(directiveName(line)) ? "phrase" : "section"} "${name || "(unnamed)"}"`
}
