/**
 * Guitar shapes: the fretted positions a hand holds, the fingers they need,
 * and the window of frets a diagram shows them in.
 * Pure and free of the DOM, so the diagram and the shape generator share it.
 */

/** A fretted shape: one entry per string, lowest-pitched string first; null = not played, 0 = open. */
export type Voicing = { readonly frets: ReadonlyArray<number | null> }

/** One finger laid across several strings at one fret. */
type Barre = { readonly fret: number; readonly from: number; readonly to: number }

/**
 * The barre of a shape, or null when it needs none.
 *
 * A shape has a barre only when it needs one. It needs one when more than
 * four strings are fretted (fret > 0) — a barre is how a hand plays more
 * than four fretted strings — and the fretted strings fit the ordinary
 * span rule: at fret `f`, the lowest fret > 0, at least two strings sound
 * `f`, and every string between the lowest and the highest of them sounds
 * a fret ≥ `f` — none open, none muted, since the barre presses every
 * string it covers. A chart draws separate dots otherwise, even for the
 * fretted spans of shapes like `x 0 2 2 2 0` and `x x 0 2 3 2`.
 */
export function barreOf(frets: Voicing["frets"]): Barre | null {
  // The barre lives at the lowest fretted fret in the shape.
  let lowest = Infinity
  for (const fret of frets) if (fret !== null && fret > 0 && fret < lowest) lowest = fret
  if (lowest === Infinity) return null

  const fretted = frets.filter((fret) => fret !== null && fret > 0).length
  // At most four fretted strings fill a hand one string per finger.
  if (fretted <= 4) return null

  let from = -1
  let to = -1
  for (const [i, fret] of frets.entries()) {
    if (fret === lowest) {
      if (from < 0) from = i
      to = i
    }
  }
  if (from === to) return null
  const span = frets.slice(from, to + 1)
  for (const fret of span) if (fret === null || fret < lowest) return null
  return { fret: lowest, from, to }
}

/**
 * How many fingers the shape needs: one per fretted string (fret > 0), with
 * the strings the barre holds at its fret counted as the barre's one finger.
 */
export function fingersNeeded(frets: Voicing["frets"]): number {
  const barre = barreOf(frets)
  let fingers = 0
  for (const fret of frets) {
    if (fret === null || fret === 0) continue
    // Every string at the barre fret lies inside the barre, and it holds them together.
    if (fret === barre?.fret) continue
    fingers++
  }
  return barre ? fingers + 1 : fingers
}

/**
 * The frets a diagram shows: from `first`, `rows` frets tall. A shape whose
 * highest fret sits low shows the nut (first = 1); a higher one starts the
 * box at its lowest fretted fret.
 */
export function fretWindow(frets: Voicing["frets"]): { readonly first: number; readonly rows: number } {
  let lowest = Infinity
  let highest = 0
  for (const fret of frets) {
    if (fret === null) continue
    if (fret > 0 && fret < lowest) lowest = fret
    if (fret > highest) highest = fret
  }
  if (highest <= 4) return { first: 1, rows: Math.max(4, highest) }
  return { first: lowest, rows: Math.max(4, highest - lowest + 1) }
}

/** `x 3 2 0 1 0`: the usual written form, also the diagram's data-frets. */
export function writeFrets(frets: Voicing["frets"]): string {
  return frets.map((fret) => (fret === null ? "x" : String(fret))).join(" ")
}
