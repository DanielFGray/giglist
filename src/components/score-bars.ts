/** A bar's span in MIDI ticks: `start` is inclusive, `end` is where the next bar starts. */
export type BarTicks = { readonly start: number; readonly end: number }

/** A run of bars, counted from 0, with both ends inclusive. */
export type BarSpan = { readonly first: number; readonly last: number }

/**
 * The bars a playback range covers: from the bar its start falls in through the
 * bar its end falls in. The end is exclusive, so a range that ends where a bar
 * begins does not take that bar.
 */
export function barsOfTicks(bars: ReadonlyArray<BarTicks>, startTick: number, endTick: number): BarSpan {
  const first = Math.max(0, bars.findLastIndex((bar) => bar.start <= startTick))
  const last = Math.max(first, bars.findLastIndex((bar) => bar.start < endTick))
  return { first, last }
}

/** The playback range of a run of bars, from the first bar's start to the last bar's end. */
export function ticksOfBars(bars: ReadonlyArray<BarTicks>, span: BarSpan): { startTick: number; endTick: number } {
  return { startTick: bars[span.first]!.start, endTick: bars[span.last]!.end }
}

/** Each master bar's span in ticks, from alphaTab's model. */
export function barTicksOf(masterBars: ReadonlyArray<{ readonly start: number; calculateDuration(): number }>): Array<BarTicks> {
  return masterBars.map((bar) => ({ start: bar.start, end: bar.start + bar.calculateDuration() }))
}

/**
 * The bars a drag selected, given the playback range alphaTab now holds. The
 * drawn bars are the range a view plays by default, so that range is no
 * selection, and neither is no range at all.
 */
export function selectedBars(
  bars: ReadonlyArray<BarTicks>,
  playbackRange: { readonly startTick: number; readonly endTick: number } | null,
  drawn: BarSpan | null,
): BarSpan | null {
  if (!playbackRange) return null
  const span = barsOfTicks(bars, playbackRange.startTick, playbackRange.endTick)
  return drawn && drawn.first === span.first && drawn.last === span.last ? null : span
}

/** A span written for a reader, which counts bars from 1: "Bar 3" or "Bars 3–4". */
export function barsLabel(span: BarSpan): string {
  return span.first === span.last ? `Bar ${span.first + 1}` : `Bars ${span.first + 1}–${span.last + 1}`
}

/** Whether two spans name the same bars. Two nulls are the same: no selection. */
export function sameBars(a: BarSpan | null, b: BarSpan | null): boolean {
  return a === b || (a !== null && b !== null && a.first === b.first && a.last === b.last)
}
