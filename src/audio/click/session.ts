import { Listener } from "./listener"
import { clickBias, median } from "./timing"

export interface SessionPlan {
  readonly sampleRate: number
  /** Context frame at which the first count-in click is scheduled. */
  readonly firstClick: number
  readonly framesPerBeat: number
  readonly countInBeats: number
}

export type SessionEvent =
  /** `clickLeak` is the instrument-band flux of a click alone (Listener.clickLeak), reported to compare rooms and speakers. */
  | { readonly _tag: "MeasuredLatency"; readonly latencyMs: number; readonly clickLeak: number }
  /** Too few count-in clicks reached the mic to measure the latency. Notes still follow. */
  | { readonly _tag: "MissedClick" }
  /**
   * A note start, `atMs` after the moment the first beat after the count-in
   * was scheduled to sound. The time includes the speaker-to-mic latency:
   * subtract it to place the note against the click the player heard.
   */
  | { readonly _tag: "Note"; readonly atMs: number }
  /** The mic stream skipped `frames` frames. Notes just after the gap may be missed. */
  | { readonly _tag: "Dropout"; readonly frames: number }

/**
 * One take: a count-in that measures the latency, then the notes played.
 *
 * During the count-in the session finds each click in the mic stream. The
 * first click heard fixes a rough latency; each later click is looked for close
 * to where that latency puts it, and the median of all of them is the latency.
 * A click can be lost, for example to a gap in the mic stream; the latency is
 * missed only when fewer than half the count-in clicks are heard, as with
 * headphones. The count-in also measures how much of each click leaks into the
 * instrument bands, which sets how far a note must rise to count
 * (Listener.clickLeak).
 *
 * Notes count from half a beat before the first beat after the count-in, as
 * the mic hears it: so a note on the count-in's last click never counts, and a
 * pickup note does. Notes heard before the count-in ends wait until it does.
 */
export class Session {
  private readonly plan: SessionPlan
  private listener: Listener
  private readonly bias: number
  private readonly latencies: Array<number> = []
  private nextClick = 0
  /** The frame from which notes count, once the count-in is over. */
  private earliest: number | undefined
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
    const events: Array<SessionEvent> = []
    // A busy audio thread can skip blocks. The listener cannot analyse across
    // the gap, so a new one starts after it; the latency stays.
    const expected = this.listener.expects
    if (!Number.isNaN(expected) && start !== expected) {
      events.push({ _tag: "Dropout", frames: start - expected })
      this.listener = new Listener(this.plan.sampleRate)
      this.listener.clickLeak = this.clickLeak()
      this.unmeasuredLeaks.length = 0
    }
    // A note the listener could not place goes untimed.
    for (const note of this.listener.push(samples, start)) if (note.frame !== undefined) this.waiting.push(note.frame)
    this.measureLeaks()
    while (this.earliest === undefined) {
      const measured = this.measureNextClick()
      if (measured === "pending") break
      if (measured !== "missed") this.latencies.push(measured)
      this.nextClick++
      if (this.nextClick === this.plan.countInBeats) events.push(this.endCountIn())
    }
    if (this.earliest === undefined) return events
    const { sampleRate, countInBeats } = this.plan
    const firstBeat = Session.clickFrame(this.plan, countInBeats)
    for (const onset of this.waiting.splice(0)) if (onset >= this.earliest) events.push({ _tag: "Note", atMs: ((onset - firstBeat) / sampleRate) * 1000 })
    return events
  }

  private endCountIn(): SessionEvent {
    const { sampleRate, countInBeats, framesPerBeat } = this.plan
    const heardFirstBeat = (latency: number) => Session.clickFrame(this.plan, countInBeats) + latency - framesPerBeat / 2
    if (this.latencies.length < countInBeats / 2) {
      // What the count-in took for clicks were other sounds, such as notes
      // played over headphones; their levels would hide every later note.
      this.unmeasuredLeaks.length = 0
      this.clickLeaks.length = 0
      this.listener.clickLeak = 0
      this.earliest = heardFirstBeat(0)
      return { _tag: "MissedClick" }
    }
    const latency = median(this.latencies)
    this.earliest = heardFirstBeat(latency)
    return { _tag: "MeasuredLatency", latencyMs: (latency / sampleRate) * 1000, clickLeak: this.clickLeak() }
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
