import { Listener } from "./listener"
import { clickBias, type Grid, type Hit, median, placeHit, type Subdivision } from "./timing"

export interface SessionPlan {
  readonly sampleRate: number
  /** Context frame at which the first count-in click is scheduled. */
  readonly firstClick: number
  readonly framesPerBeat: number
  readonly countInBeats: number
  readonly subdivision: Subdivision
}

export type SessionEvent =
  /** `clickLeak` is the instrument-band flux of a click alone (Listener.clickLeak), reported to compare rooms and speakers. */
  | { readonly _tag: "MeasuredLatency"; readonly latencyMs: number; readonly clickLeak: number }
  | { readonly _tag: "MissedClick" }
  | { readonly _tag: "Hit"; readonly hit: Hit }
  /** The mic stream skipped `frames` frames. Notes just after the gap may be missed. */
  | { readonly _tag: "Dropout"; readonly frames: number }

/**
 * One take: a count-in that measures the latency, then scored playing.
 *
 * During the count-in the session finds each click in the mic stream. The
 * first click heard fixes a rough latency; each later click is looked for close
 * to where that latency puts it, and the median of all of them is the latency.
 * A click can be lost, for example to a gap in the mic stream; the take fails
 * only when fewer than half the count-in clicks are heard. The count-in also
 * measures how much of each click leaks into the instrument bands, which sets
 * how far a note must rise to count (Listener.clickLeak).
 * Notes start to count from half a grid step before the first beat after the
 * count-in. Notes heard before the latency is known wait until it is.
 */
export class Session {
  private readonly plan: SessionPlan
  private listener: Listener
  private readonly bias: number
  private readonly latencies: Array<number> = []
  private nextClick = 0
  private grid: Grid | undefined
  private failed = false
  private readonly waiting: Array<number> = []
  /** Arrivals of heard count-in clicks whose leak the listener cannot measure yet. */
  private readonly unmeasuredLeaks: Array<number> = []
  private readonly clickLeaks: Array<number> = []

  constructor(plan: SessionPlan) {
    this.plan = plan
    this.listener = new Listener(plan.sampleRate)
    this.bias = clickBias(plan.sampleRate)
  }

  /** The context frame at which click `beat` is scheduled, the count-in's first click being 0. */
  static clickFrame(plan: SessionPlan, beat: number): number {
    return plan.firstClick + Math.round(beat * plan.framesPerBeat)
  }

  hear(samples: Float32Array, start: number): Array<SessionEvent> {
    if (this.failed) return []
    const events: Array<SessionEvent> = []
    // A busy audio thread can skip blocks. The listener cannot analyse across
    // the gap, so a new one starts after it; the grid and the latency stay.
    const expected = this.listener.expects
    if (!Number.isNaN(expected) && start !== expected) {
      events.push({ _tag: "Dropout", frames: start - expected })
      this.listener = new Listener(this.plan.sampleRate)
      this.listener.clickLeak = this.clickLeak()
      this.unmeasuredLeaks.length = 0
    }
    this.waiting.push(...this.listener.push(samples, start))
    this.measureLeaks()
    while (this.grid === undefined && !this.failed) {
      const measured = this.measureNextClick()
      if (measured === "pending") break
      if (measured !== "missed") this.latencies.push(measured)
      this.nextClick++
      if (this.nextClick === this.plan.countInBeats) events.push(...this.fixGrid())
    }
    if (this.grid === undefined) return events
    const grid = this.grid
    const earliest = grid.firstBeat - grid.framesPerBeat / grid.subdivision / 2
    for (const onset of this.waiting.splice(0)) if (onset >= earliest) events.push({ _tag: "Hit", hit: placeHit(grid, onset) })
    return events
  }

  private fixGrid(): Array<SessionEvent> {
    if (this.latencies.length < this.plan.countInBeats / 2) {
      this.failed = true
      return [{ _tag: "MissedClick" }]
    }
    const latency = median(this.latencies)
    this.grid = {
      firstBeat: Session.clickFrame(this.plan, this.plan.countInBeats) + latency,
      framesPerBeat: this.plan.framesPerBeat,
      subdivision: this.plan.subdivision,
      sampleRate: this.plan.sampleRate,
    }
    return [{ _tag: "MeasuredLatency", latencyMs: (latency / this.plan.sampleRate) * 1000, clickLeak: this.clickLeak() }]
  }

  /** The latency in frames shown by the next count-in click, once the mic has had time to hear it. */
  private measureNextClick(): number | "missed" | "pending" {
    const { sampleRate, framesPerBeat } = this.plan
    const scheduled = Session.clickFrame(this.plan, this.nextClick)
    const rough = this.latencies[0]
    // Until a click is heard, the next one may arrive any time within one beat;
    // after that, a click must arrive close to the first one's latency, which
    // keeps the search off its neighbours.
    const [from, to] =
      rough === undefined
        ? [scheduled, scheduled + Math.min(framesPerBeat, MAX_LATENCY_SECONDS * sampleRate)]
        : [scheduled + rough + this.bias - CLICK_SEARCH_SECONDS * sampleRate, scheduled + rough + this.bias + CLICK_SEARCH_SECONDS * sampleRate]
    if (this.listener.analysedUpTo < to) return "pending"
    const arrival = this.listener.clickArrival(from, to)
    if (arrival === undefined) return "missed"
    this.unmeasuredLeaks.push(arrival)
    return arrival - this.bias - scheduled
  }

  /**
   * Measures the leak of each heard count-in click once the listener has
   * analysed past it. The median keeps a stray note in the count-in from
   * raising the note threshold.
   */
  private measureLeaks(): void {
    while (this.unmeasuredLeaks.length > 0) {
      const leak = this.listener.leakAt(this.unmeasuredLeaks[0]!)
      if (leak === undefined) return
      this.unmeasuredLeaks.shift()
      this.clickLeaks.push(leak)
      this.listener.clickLeak = this.clickLeak()
    }
  }

  private clickLeak(): number {
    return this.clickLeaks.length === 0 ? 0 : median(this.clickLeaks)
  }
}

const MAX_LATENCY_SECONDS = 0.5
const CLICK_SEARCH_SECONDS = 0.015
