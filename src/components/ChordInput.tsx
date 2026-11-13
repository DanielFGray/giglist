import { useRef, useState, type CSSProperties } from "react"
import { isChordName } from "alphatab-kit/charts/lyrics"
import type { Suggestion } from "alphatab-kit/charts/suggest"
import { placement } from "./ChordShapes"

/** What the field asks the editor to do with the word's chord. */
export type ChordEntry = { readonly put: string } | { readonly remove: true } | null

/**
 * A text field over a word's chord row: the word's chord, ready to be typed over,
 * and a list of chords for this place under the word.
 *
 * Enter or leaving the field keeps what was typed: a chord name puts it on the
 * word, an empty field takes the word's chord off, and the unchanged text does
 * nothing. Tab does the same and moves to the next word, Shift+Tab to the one
 * before, so a line can be written without the mouse. Arrow keys pick from the
 * list; Escape closes without a change.
 *
 * The list shows the best of the song's own chords for this place first (its
 * patterns, and the chord at the same place in a repeated section), then the
 * chords the song does not use yet, each with its numeral; typing narrows both to
 * names that start with it.
 */
export function ChordInput({
  current,
  likely,
  fresh,
  anchor,
  onDone,
}: {
  current: string | null
  likely: ReadonlyArray<Suggestion>
  fresh: ReadonlyArray<Suggestion>
  /** The CSS anchor name of the word, which the list sits under. */
  anchor: string
  /** The entry, and the step to the next (1) or previous (-1) word, or 0 to stay. */
  onDone: (entry: ChordEntry, step: -1 | 0 | 1) => void
}) {
  const [typed, setTyped] = useState(current ?? "")
  /** The option the arrow keys are on: Enter takes it instead of the typed name. */
  const [picked, setPicked] = useState<number | null>(null)
  /** The option under the pointer, whose reason the list explains. */
  const [hovered, setHovered] = useState<number | null>(null)
  // Enter, Tab or a tap ends the entry, and the blur that follows must not end it again.
  const ended = useRef(false)
  const end = (entry: ChordEntry, step: -1 | 0 | 1) => {
    if (ended.current) return
    ended.current = true
    onDone(entry, step)
  }
  const name = typed.trim()
  const invalid = name !== "" && !isChordName(name)

  const filter = (list: ReadonlyArray<Suggestion>) =>
    name === "" || name === current ? list : list.filter(({ chord }) => chord.toLowerCase().startsWith(name.toLowerCase()) && chord !== name)
  const shownLikely = filter(likely.filter(({ chord }) => chord !== current)).slice(0, LIKELY)
  const shownFresh = filter(fresh.filter(({ chord }) => chord !== current))
  const options = [...shownLikely, ...shownFresh]
  const explained = options[hovered ?? picked ?? 0]

  const entryFor = (chord: string): ChordEntry => {
    if (chord === (current ?? "")) return null
    return chord === "" ? { remove: true } : { put: chord }
  }
  /** Ends the entry with the picked option, or else the typed name. False when the typed name is not a chord. */
  const finish = (step: -1 | 0 | 1): boolean => {
    const option = picked === null ? undefined : options[picked]
    if (option) return (end(entryFor(option.chord), step), true)
    if (invalid) return false
    end(entryFor(name), step)
    return true
  }

  return (
    <>
      <input
        data-pwid="chord-input"
        autoFocus
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value)
          setPicked(null)
        }}
        onFocus={(event) => event.target.select()}
        // The field sits inside its word, whose click would open the field again.
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") end(null, 0)
          else if (event.key === "Enter") finish(0)
          else if (event.key === "Tab") {
            event.preventDefault()
            finish(event.shiftKey ? -1 : 1)
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            if (options.length === 0) return
            const from = picked ?? (event.key === "ArrowDown" ? -1 : options.length)
            setPicked((from + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length)
          }
        }}
        // A tap on the list keeps the focus (see below), so a blur means the player went elsewhere.
        onBlur={() => {
          if (!finish(0)) end(null, 0)
        }}
        placeholder="Chord"
        aria-label={current ? `Chord on this word, now ${current}` : "Chord for this word"}
        aria-invalid={invalid}
        aria-controls="chord-options"
        aria-activedescendant={picked === null ? undefined : `chord-option-${picked}`}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="absolute -top-1 left-0 z-20 h-7 w-[7ch] min-w-full rounded-sm border border-[var(--color-amber-accent)] bg-[var(--color-surface-raised)] px-1 font-mono text-sm font-semibold"
      />
      <div
        id="chord-options"
        data-pwid="chord-options"
        role="listbox"
        aria-label="Chords for this word"
        style={{ ...placement(anchor), zIndex: 30 } as CSSProperties}
        // The input keeps the focus, so a tap on an option is not a blur that ends the entry first.
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
        className="w-max max-w-[min(24rem,calc(100vw-2rem))] space-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2 font-sans shadow-lg"
      >
        {invalid && (
          <p data-pwid="chord-input-error" role="alert" className="text-xs text-red-400">
            “{name}” is not a chord name. Leave out brackets and spaces.
          </p>
        )}
        <Options label="Likely here" list={shownLikely} offset={0} picked={picked} onPick={(chord) => end(entryFor(chord), 0)} onHover={setHovered} />
        <Options label="New to this song" list={shownFresh} offset={shownLikely.length} picked={picked} onPick={(chord) => end(entryFor(chord), 0)} onHover={setHovered} />
        {explained && (
          <p data-pwid="chord-reason" className="text-xs text-zinc-400">
            {explained.chord}
            {explained.numeral && ` (${explained.numeral})`}: {explained.reason}
          </p>
        )}
        {current && (
          <button data-pwid="chord-remove" type="button" onClick={() => end({ remove: true }, 0)} className="min-h-11 rounded-md px-2 text-xs text-red-400">
            Remove {current}
          </button>
        )}
      </div>
    </>
  )
}

/** How many likely chords the list shows. */
const LIKELY = 4

function Options({
  label,
  list,
  offset,
  picked,
  onPick,
  onHover,
}: {
  label: string
  list: ReadonlyArray<Suggestion>
  /** The index of the first of these among all the options, for the arrow keys. */
  offset: number
  picked: number | null
  onPick: (chord: string) => void
  onHover: (index: number) => void
}) {
  if (list.length === 0) return null
  return (
    <div role="group" aria-label={label}>
      <div className="mb-1 text-[0.7rem] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="flex flex-wrap gap-1">
        {list.map((option, index) => (
          <button
            key={option.chord}
            id={`chord-option-${offset + index}`}
            data-pwid="chord-option"
            type="button"
            role="option"
            aria-selected={picked === offset + index}
            title={option.reason}
            onClick={() => onPick(option.chord)}
            onPointerEnter={() => onHover(offset + index)}
            className="flex min-h-11 min-w-11 flex-col items-center justify-center rounded-md border border-[var(--color-border-subtle)] px-2 leading-tight aria-selected:border-[var(--color-amber-accent)]"
          >
            <span className="font-mono text-sm font-semibold">{option.chord}</span>
            {option.numeral && <span className="text-[0.7rem] text-zinc-500">{option.numeral}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
