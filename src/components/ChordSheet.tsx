import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { isChordName } from "~/charts/lyrics"

/**
 * The chord sheet: chips for the chords of the key and of the chart, and a field
 * for any chord name. It sits at the bottom of the window on a phone and at the
 * side on a wide screen. A chip puts its chord on the word at once, replacing the
 * word's chord if it has one; the field does the same on Put.
 *
 * It is not modal: the chart behind it stays usable, and the focus is not
 * trapped. On open, focus moves to the sheet itself, not the field, so Escape
 * works at once and a phone keeps its keyboard down; on close, focus returns to
 * what opened it.
 */
export function ChordSheet({
  chips,
  word,
  current,
  onPick,
  onType,
  onRemove,
  onClose,
}: {
  chips: ReadonlyArray<string>
  /** The word the chord goes on. */
  word: string
  /** The chord the word has now, if any. */
  current: string | null
  /** A chip was chosen. */
  onPick: (chord: string) => void
  /** A chord name was typed and put. */
  onType: (chord: string) => void
  /** Takes the word's chord off; null when it has none. */
  onRemove: (() => void) | null
  onClose: () => void
}) {
  const [typed, setTyped] = useState("")
  const sheet = useRef<HTMLDivElement>(null)
  const name = typed.trim()
  const invalid = name !== "" && !isChordName(name)

  useEffect(() => {
    const opener = document.activeElement
    sheet.current?.focus({ preventScroll: true })
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", escape)
    return () => document.removeEventListener("keydown", escape)
  }, [onClose])

  // In the body, so no ancestor's transform or stacking order can hold a fixed sheet inside the page.
  return createPortal(
    <div
      ref={sheet}
      tabIndex={-1}
      data-pwid="chord-sheet"
      role="dialog"
      aria-label={current ? `Change ${current} on ${word}` : `Add a chord to ${word}`}
      className="fixed inset-x-0 bottom-0 z-50 space-y-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 shadow-lg outline-none md:inset-y-0 md:left-auto md:right-0 md:w-80 md:border-l md:border-t-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-zinc-300">
          {current ? `Change ${current} on “${word}”` : `Add a chord to “${word}”`}
        </span>
        <button
          data-pwid="sheet-close"
          type="button"
          onClick={onClose}
          aria-label="Close the chord sheet"
          className="min-h-11 min-w-11 text-sm text-zinc-400"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((chord) => (
          <button
            key={chord}
            data-pwid="sheet-chip"
            type="button"
            onClick={() => onPick(chord)}
            aria-pressed={chord === current}
            className={`min-h-11 min-w-11 rounded-md border px-3 text-sm font-semibold ${
              chord === current ? "border-[var(--color-amber-accent)] text-[var(--color-amber-accent)]" : "border-[var(--color-border-subtle)]"
            }`}
          >
            {chord}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (name && !invalid) onType(name)
        }}
      >
        <input
          data-pwid="sheet-input"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Any chord, like F#m7"
          aria-label="Chord name"
          aria-invalid={invalid}
          aria-describedby={invalid ? "sheet-input-error" : undefined}
          autoCapitalize="off"
          autoCorrect="off"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 text-sm"
        />
        <button
          data-pwid="sheet-put"
          type="submit"
          disabled={name === "" || invalid}
          className="min-h-11 min-w-11 rounded-md bg-[var(--color-amber-accent)] px-4 text-sm font-semibold text-zinc-950 disabled:opacity-50"
        >
          Put
        </button>
      </form>
      {invalid && (
        <p id="sheet-input-error" data-pwid="sheet-error" role="alert" className="text-sm text-red-400">
          “{name}” is not a chord name. Leave out brackets and spaces.
        </p>
      )}
      {onRemove && (
        <button
          data-pwid="sheet-remove"
          type="button"
          onClick={onRemove}
          className="min-h-11 min-w-11 rounded-md border border-[var(--color-border-subtle)] px-3 text-sm text-red-400"
        >
          Remove {current}
        </button>
      )}
    </div>,
    document.body,
  )
}
