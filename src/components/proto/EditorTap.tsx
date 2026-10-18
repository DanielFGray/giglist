// PROTOTYPE: throwaway. Variant: Tap a word, pick a chord.
import { useMemo, useState } from "react"
import { charts } from "~/api/client"
import { composeChanges } from "~/charts/changes"
import {
  addSection, directiveName, inPhrase, moveChord, moveSection, parseDoc, phraseAt,
  placeChord, removeChord, removeSection, renameSection, segments, serializeDoc, setPhrase, type DocLine, type Edit,
} from "~/charts/doc"
import { isPhraseStart, isTabStart, suggestedChords } from "~/charts/lyrics"
import { errorMessage } from "../form"
import { Phrase } from "../Phrase"
import { PhraseForm } from "../PhraseForm"
import type { ProtoEditorProps } from "./props"

const button =
  "px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"

type Sheet =
  | { kind: "word"; line: number; at: number }
  | { kind: "chord"; line: number; chordIndex: number }
  | { kind: "section"; line: number }
  | { kind: "phrase"; line: number }
  | { kind: "addSection" }
  | null

export function EditorTap({ chart, tempo, onSaved, onCancel }: ProtoEditorProps) {
  const base = useMemo(() => parseDoc(chart.source), [chart.source])
  const [steps, setSteps] = useState<ReadonlyArray<Edit>>([])
  const [sheet, setSheet] = useState<Sheet>(null)
  const [moveSource, setMoveSource] = useState<{ line: number; chord: number } | null>(null)
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

  const closeSheet = () => setSheet(null)

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

  const wordText = (line: number, at: number) => {
    const l = doc[line]
    if (l?.kind !== "lyrics") return ""
    // find segment containing at
    const seg = segments(l).find((s) => s.start === at)
    // segment text
    return l.text.slice(at, seg ? seg.end : at + 1).trim() || l.text.slice(Math.max(0, at - 3), at + 4).trim()
  }

  return (
    <div data-pwid="chart-editor" className="space-y-4">
      {moveSource && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-[var(--color-amber-accent)]/20 px-3 py-2 text-sm">
          <span>Tap a word to move the chord there.</span>
          <button type="button" className={button} onClick={() => setMoveSource(null)}>Cancel</button>
        </div>
      )}

      <div className="text-lg leading-relaxed font-mono">
        {doc.map((line, index) => {
          const hidden = line.kind === "literal" && inPhrase(doc, index)
          if (hidden) return null
          if (line.kind === "directive") {
            const section = /^\{\s*start_of_(\w+)\s*(?::\s*(.*?))?\s*\}$/.exec(line.raw)
            if (!section) return null
            const label = section[2] ?? ""
            if (isPhraseStart(section[1]!)) {
              const phrase = phraseAt(doc, index)
              return (
                <button
                  key={index}
                  type="button"
                  data-pwid="editor-phrase"
                  onClick={() => setSheet({ kind: "phrase", line: index })}
                  className="my-2 block w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-3 text-left min-h-[44px]"
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{phrase.name}</span>
                  <div className="mt-1"><Phrase tex={phrase.tex} tempo={tempo} /></div>
                </button>
              )
            }
            return (
              <button
                key={index}
                type="button"
                data-pwid="editor-section"
                onClick={() => setSheet({ kind: "section", line: index })}
                className="mt-3 mb-1 block w-full text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 min-h-[44px]"
              >
                {label || (isTabStart(directiveName(line)) ? "Tab" : "Section")}
              </button>
            )
          }
          if (line.kind === "literal") {
            return (
              <pre key={index} className="whitespace-pre text-sm">{line.text}</pre>
            )
          }
          // lyrics
          return (
            <div key={index} data-pwid="editor-line" className="flex flex-wrap items-end gap-x-1">
              {segments(line).map((segment) => (
                <span key={segment.start} className="inline-flex flex-col items-start">
                  <span className="flex min-h-[24px] flex-wrap gap-1">
                    {segment.chords.map((chordIndex) => {
                      const chord = line.chords[chordIndex]!.chord
                      return (
                        <button
                          key={chordIndex}
                          type="button"
                          data-pwid="placed-chord"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSheet({ kind: "chord", line: index, chordIndex })
                          }}
                          className="min-h-[44px] min-w-[44px] rounded-md px-2 text-base font-semibold text-[var(--color-amber-accent)]"
                        >
                          {chord}
                        </button>
                      )
                    })}
                  </span>
                  <button
                    type="button"
                    data-pwid="editor-segment"
                    onClick={() => {
                      if (moveSource) {
                        apply(moveChord(doc, moveSource, { line: index, at: segment.start }))
                        setMoveSource(null)
                        return
                      }
                      setSheet({ kind: "word", line: index, at: segment.start })
                    }}
                    className="min-h-[44px] min-w-[1ch] rounded-sm px-1 text-left hover:bg-[var(--color-amber-accent)]/10"
                  >
                    <span data-pwid="editor-lyric" className="whitespace-pre">
                      {line.text.slice(segment.start, segment.end) || "\u00a0"}
                    </span>
                  </button>
                </span>
              ))}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        data-pwid="add-section"
        onClick={() => setSheet({ kind: "addSection" })}
        className={button}
      >
        + Add section
      </button>

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

      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={closeSheet}>
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-auto rounded-t-2xl bg-[var(--color-surface-raised)] p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {sheet.kind === "word" && (
              <WordSheet
                word={wordText(sheet.line, sheet.at)}
                palette={palette}
                onPick={(chord) => {
                  apply(placeChord(doc, sheet.line, sheet.at, chord))
                  closeSheet()
                }}
                onOther={(chord) => {
                  apply(placeChord(doc, sheet.line, sheet.at, chord))
                  closeSheet()
                }}
              />
            )}
            {sheet.kind === "chord" && (
              <ChordSheet
                chord={(() => {
                  const l = doc[sheet.line]
                  return l?.kind === "lyrics" ? (l.chords[sheet.chordIndex]?.chord ?? "") : ""
                })()}
                onMove={() => {
                  const l = sheet.line
                  const ci = sheet.chordIndex
                  setMoveSource({ line: l, chord: ci })
                  closeSheet()
                }}
                onRemove={() => {
                  apply(removeChord(doc, sheet.line, sheet.chordIndex))
                  closeSheet()
                }}
              />
            )}
            {sheet.kind === "section" && (
              <SectionSheet
                label={sectionLabel(doc, sheet.line)}
                onRename={(label) => {
                  apply(renameSection(doc, sheet.line, label))
                  closeSheet()
                }}
                onMoveUp={() => {
                  apply(moveSection(doc, sheet.line, -1))
                }}
                onMoveDown={() => {
                  apply(moveSection(doc, sheet.line, 1))
                }}
                onDelete={() => {
                  apply(removeSection(doc, sheet.line))
                  closeSheet()
                }}
                onAddAfter={(label) => {
                  apply(addSection(doc, sheet.line, label))
                  closeSheet()
                }}
              />
            )}
            {sheet.kind === "phrase" && (
              <PhraseSheet
                name={phraseAt(doc, sheet.line).name}
                tex={phraseAt(doc, sheet.line).tex}
                tempo={tempo}
                onSave={(name, tex) => {
                  apply(setPhrase(doc, sheet.line, name, tex))
                  closeSheet()
                }}
                onCancel={closeSheet}
              />
            )}
            {sheet.kind === "addSection" && (
              <AddSectionSheet
                onAdd={(label) => {
                  const last = doc.length - 1
                  apply(addSection(doc, last >= 0 ? last : 0, label))
                  closeSheet()
                }}
                onCancel={closeSheet}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function WordSheet({ word, palette, onPick, onOther }: {
  word: string
  palette: ReadonlyArray<string>
  onPick: (chord: string) => void
  onOther: (chord: string) => void
}) {
  const [custom, setCustom] = useState("")
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">Chord for “{word || "word"}”</div>
      <div className="flex flex-wrap gap-2">
        {palette.map((chord) => (
          <button
            key={chord}
            type="button"
            data-pwid="sheet-chord"
            onClick={() => onPick(chord)}
            className="min-h-[44px] min-w-[44px] rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-sm font-semibold"
          >
            {chord}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (custom.trim()) onOther(custom.trim())
          setCustom("")
        }}
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Other chord"
          aria-label="Other chord"
          className="flex-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm"
        />
        <button type="submit" className={button}>Place</button>
      </form>
    </div>
  )
}

function ChordSheet({ chord, onMove, onRemove }: { chord: string; onMove: () => void; onRemove: () => void }) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">{chord}</div>
      <div className="flex flex-col gap-2">
        <button type="button" onClick={onMove} className="min-h-[44px] rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-left text-sm">
          Move to a word
        </button>
        <button type="button" onClick={onRemove} className="min-h-[44px] rounded-md border border-red-500/30 px-3 py-2 text-left text-sm text-red-400">
          Remove
        </button>
      </div>
    </div>
  )
}

function SectionSheet({ label, onRename, onMoveUp, onMoveDown, onDelete, onAddAfter }: {
  label: string | null
  onRename: (label: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onAddAfter: (label: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [newLabel, setNewLabel] = useState(label ?? "")
  const [adding, setAdding] = useState(false)
  const [addLabel, setAddLabel] = useState("")
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">{label || "Section"}</div>
      {renaming ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onRename(newLabel); setRenaming(false) }}>
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} autoFocus className="flex-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm" />
          <button type="submit" className={button}>Save</button>
          <button type="button" className={button} onClick={() => setRenaming(false)}>Cancel</button>
        </form>
      ) : adding ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (addLabel.trim()) onAddAfter(addLabel.trim()); setAdding(false) }}>
          <input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} autoFocus placeholder="New section name" className="flex-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm" />
          <button type="submit" className={button}>Add</button>
          <button type="button" className={button} onClick={() => setAdding(false)}>Cancel</button>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => setRenaming(true)} className="min-h-[44px] rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-left text-sm">Rename</button>
          <button type="button" onClick={onMoveUp} className="min-h-[44px] rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-left text-sm">Move up</button>
          <button type="button" onClick={onMoveDown} className="min-h-[44px] rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-left text-sm">Move down</button>
          <button type="button" onClick={onDelete} className="min-h-[44px] rounded-md border border-red-500/30 px-3 py-2 text-left text-sm text-red-400">Delete</button>
          <button type="button" onClick={() => setAdding(true)} className="min-h-[44px] rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-left text-sm">Add a section after</button>
        </div>
      )}
    </div>
  )
}

function AddSectionSheet({ onAdd, onCancel }: { onAdd: (label: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("")
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (label.trim()) onAdd(label.trim()) }}>
      <div className="text-sm font-semibold">New section</div>
      <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus placeholder="Section name" className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <button type="submit" className={button}>Add</button>
        <button type="button" className={button} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function PhraseSheet({ name, tex, tempo, onSave, onCancel }: {
  name: string
  tex: string
  tempo: number | null
  onSave: (name: string, tex: string) => void
  onCancel: () => void
}) {
  return (
    <PhraseForm
      name={name}
      tex={tex}
      tempo={tempo}
      onSave={onSave}
      onCancel={onCancel}
    />
  )
}

function sectionLabel(doc: ReadonlyArray<DocLine>, line: number): string | null {
  const l = doc[line]
  if (l?.kind !== "directive") return null
  const m = /^\{\s*start_of_\w+\s*(?::\s*(.*?))?\s*\}$/.exec(l.raw)
  return m ? (m[1] ?? null) : null
}
