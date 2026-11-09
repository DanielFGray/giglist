import { describe, expect, it, setDefaultTimeout } from "bun:test"
import { ACCENT_GAIN, BEAT_GAIN, BEATS_PER_BAR, COUNT_IN_BEATS } from "./click"
import { Session, type SessionEvent, type SessionPlan } from "./session"
import { drum, keyNote, mix, mixClick, noise, pluck, SAMPLE_RATE } from "./synth"
import { placeHit, type Subdivision } from "./timing"

interface Played {
  /** Grid step the note aims at, counted from the first beat after the count-in. */
  readonly step: number
  readonly offsetMs: number
  readonly sound: Float32Array
}

interface Take {
  readonly latencySeconds: number
  readonly notes: ReadonlyArray<Played>
  readonly bpm?: number
  readonly subdivision?: Subdivision
  readonly clickLevel?: number
  /** Peak of the background noise. */
  readonly noiseLevel?: number
  /** Gain on the whole recording: click, notes and noise, as a quieter mic would give. */
  readonly gain?: number
  /** Extra sound mixed in at a frame counted from the first click: a stray note, a sustained bed. */
  readonly extra?: ReadonlyArray<readonly [sound: Float32Array, at: number]>
}

/** The context frame of the first mic sample. A nonzero start checks that frames stay absolute. */
const FIRST_FRAME = 12345

/**
 * Records a synthetic take and feeds it to a session in 128-frame blocks, as
 * the audio thread delivers them. The mic hears the click `latencySeconds`
 * after it is scheduled, and a note `offsetMs` after the click it aims at.
 */
const listen = ({ latencySeconds, notes, bpm = 100, subdivision = 1, clickLevel = 0.5, noiseLevel = 0.001, gain = 1, extra = [] }: Take): Array<SessionEvent> => {
  const plan: SessionPlan = {
    sampleRate: SAMPLE_RATE,
    firstClick: FIRST_FRAME + Math.round(0.2 * SAMPLE_RATE),
    framesPerBeat: (60 / bpm) * SAMPLE_RATE,
    countInBeats: COUNT_IN_BEATS,
  }
  const beats = COUNT_IN_BEATS + Math.ceil((notes.at(-1)?.step ?? 0) / subdivision) + 3
  const signal = noise(Math.round(plan.firstClick - FIRST_FRAME + beats * plan.framesPerBeat), noiseLevel, 7)
  const latency = Math.round(latencySeconds * SAMPLE_RATE)
  for (let beat = 0; beat < beats; beat++) {
    const gain = clickLevel * (beat % BEATS_PER_BAR === 0 ? ACCENT_GAIN : BEAT_GAIN)
    mixClick(signal, Session.clickFrame(plan, beat) + latency - FIRST_FRAME, gain)
  }
  const firstBeat = Session.clickFrame(plan, COUNT_IN_BEATS)
  for (const note of notes) {
    const at = firstBeat + latency + (note.step * plan.framesPerBeat) / subdivision + (note.offsetMs / 1000) * SAMPLE_RATE
    mix(signal, note.sound, Math.round(at) - FIRST_FRAME)
  }
  for (const [sound, at] of extra) mix(signal, sound, plan.firstClick - FIRST_FRAME + at)
  for (let i = 0; i < signal.length; i++) signal[i]! *= gain
  const session = new Session(plan)
  const events: Array<SessionEvent> = []
  for (let i = 0; i < signal.length; i += 128) events.push(...session.hear(signal.subarray(i, i + 128), FIRST_FRAME + i))
  return events
}

const OFFSETS_MS = [-35, -20, -8, -3, 0, 0, 2, 5, 11, 18, 30, 0]

// Each test analyses up to 25 s of audio, several times; under load that exceeds the 5 s default.
setDefaultTimeout(30_000)

const latencyOf = (events: ReadonlyArray<SessionEvent>) => events.flatMap((event) => (event._tag === "MeasuredLatency" ? [event.latencyMs] : []))
const notesOf = (events: ReadonlyArray<SessionEvent>) => events.flatMap((event) => (event._tag === "Note" ? [event.atMs] : []))

/** Places each note against the click as the player heard it, at 100 BPM. */
const hitsOf = (events: ReadonlyArray<SessionEvent>, subdivision: Subdivision = 1) => {
  const latencyMs = latencyOf(events)[0] ?? Number.NaN
  return notesOf(events).map((atMs) => placeHit(atMs - latencyMs, 600, subdivision))
}

const expectHits = (events: ReadonlyArray<SessionEvent>, notes: ReadonlyArray<Played>, toleranceMs: number, subdivision: Subdivision = 1) => {
  const hits = hitsOf(events, subdivision)
  expect(hits).toHaveLength(notes.length)
  hits.forEach((hit, i) => {
    const note = notes[i]!
    expect(Math.abs(hit.offsetMs - note.offsetMs), `note ${i} played ${note.offsetMs} ms off, heard ${hit.offsetMs.toFixed(2)} ms`).toBeLessThan(toleranceMs)
  })
}

describe("Session", () => {
  it("measures the speaker-to-mic latency from the count-in and hears no notes in the click", () => {
    for (const latencySeconds of [0.012, 0.087, 0.231]) {
      const events = listen({ latencySeconds, notes: [] })
      expect(latencyOf(events)).toHaveLength(1)
      expect(Math.abs(latencyOf(events)[0]! - latencySeconds * 1000)).toBeLessThan(0.5)
      expect(hitsOf(events)).toHaveLength(0)
    }
  })

  it("times drum hits, including hits on top of the click", () => {
    const notes = OFFSETS_MS.map((offsetMs, step) => ({ step, offsetMs, sound: drum(SAMPLE_RATE, step + 1) }))
    expectHits(listen({ latencySeconds: 0.087, notes }), notes, 1)
  })

  it("times plucked strings, including notes at the click's pitch", () => {
    const pitches = [82, 110, 147, 196, 247, 330, 500, 1000, 2000, 660, 220, 1500]
    const notes = OFFSETS_MS.map((offsetMs, step) => ({ step, offsetMs, sound: pluck(SAMPLE_RATE, pitches[step]!, step + 1) }))
    expectHits(listen({ latencySeconds: 0.087, notes }), notes, 1.5)
  })

  it("times piano-like notes that ring over each other on eighth notes", () => {
    const pitches = [262, 330, 392, 523, 262, 349, 440, 523, 247, 294, 392, 494]
    const notes = OFFSETS_MS.map((offsetMs, step) => ({ step, offsetMs, sound: keyNote(SAMPLE_RATE, pitches[step]!, step + 1) }))
    // The first note follows silence, and its 2 ms fade-in places it about 2.7 ms late.
    expectHits(listen({ latencySeconds: 0.087, notes, subdivision: 2 }), notes, 3, 2)
  })

  it("measures the latency at a fast tempo, where the next click comes before the first is heard", () => {
    const events = listen({ latencySeconds: 0.2, notes: [], bpm: 240 })
    expect(Math.abs(latencyOf(events)[0]! - 200)).toBeLessThan(0.5)
  })

  it("reports a missed click when the mic cannot hear the click, and still times the notes", () => {
    // Headphones: the click never reaches the mic, so no delay is measured.
    const notes = OFFSETS_MS.map((offsetMs, step) => ({ step, offsetMs, sound: drum(SAMPLE_RATE, step + 1) }))
    const events = listen({ latencySeconds: 0.05, notes, clickLevel: 0 })
    expect(events[0]?._tag).toBe("MissedClick")
    const atMs = notesOf(events)
    expect(atMs).toHaveLength(notes.length)
    atMs.forEach((at, i) => expect(Math.abs(at - 50 - (notes[i]!.step * 600 + notes[i]!.offsetMs))).toBeLessThan(1))
  })

  it("after a missed click, a note played in the count-in does not raise the threshold", () => {
    // With headphones, the session can take a note in the count-in for a
    // click. That note's level is no click's leak.
    const notes = OFFSETS_MS.map((offsetMs, step) => ({ step, offsetMs, sound: pluck(SAMPLE_RATE, 220, step + 1) }))
    const strays = [1.5, 3.5, 5.5].map((beats, i) => [pluck(SAMPLE_RATE, 220, 50 + i), Math.round(beats * 0.6 * SAMPLE_RATE)] as const)
    const events = listen({ latencySeconds: 0.05, notes, clickLevel: 0, extra: strays })
    expect(events.map((event) => event._tag)).toContain("MissedClick")
    expect(notesOf(events)).toHaveLength(notes.length)
  })
})

describe("Session after a dropout", () => {
  it("measures the latency wherever a gap in the count-in falls", () => {
    const plan: SessionPlan = { sampleRate: SAMPLE_RATE, firstClick: 9600, framesPerBeat: SAMPLE_RATE * 0.6, countInBeats: 4 }
    const signal = noise(Math.round(SAMPLE_RATE * 4), 0.001, 7)
    const latency = Math.round(0.05 * SAMPLE_RATE)
    for (let beat = 0; beat < 6; beat++) mixClick(signal, Session.clickFrame(plan, beat) + latency, 0.3)
    // One skipped block: inside the first click's search window, which loses
    // that click; then just after a click early and late in the count-in, where
    // the new listener has almost no history when the next click comes.
    for (const seconds of [0.46, 0.683, 2.045]) {
      const gap = Math.round((seconds * SAMPLE_RATE) / 128) * 128
      const session = new Session(plan)
      const events: Array<SessionEvent> = []
      for (let i = 0; i < signal.length; i += 128) if (i < gap || i >= gap + 128) events.push(...session.hear(signal.subarray(i, i + 128), i))
      const measured = events.find((event) => event._tag === "MeasuredLatency")
      expect(measured, `gap at frame ${gap}`).toBeDefined()
      expect(Math.abs((measured as { latencyMs: number }).latencyMs - 50), `gap at frame ${gap}`).toBeLessThan(0.5)
    }
  })

  it("keeps scoring when the mic stream skips a block", () => {
    const plan: SessionPlan = { sampleRate: SAMPLE_RATE, firstClick: 9600, framesPerBeat: SAMPLE_RATE * 0.6, countInBeats: 4 }
    const signal = noise(Math.round(SAMPLE_RATE * 6), 0.001, 5)
    const latency = Math.round(0.05 * SAMPLE_RATE)
    for (let beat = 0; beat < 9; beat++) mixClick(signal, Session.clickFrame(plan, beat) + latency, 0.3)
    for (let beat = 4; beat < 9; beat++) mix(signal, drum(SAMPLE_RATE, beat), Session.clickFrame(plan, beat) + latency)
    const session = new Session(plan)
    const events: Array<SessionEvent> = []
    // Skips one block between the 6th and 7th beat, where nothing sounds.
    const gap = Math.round(Session.clickFrame(plan, 6) + 0.3 * SAMPLE_RATE)
    for (let i = 0; i < signal.length; i += 128) if (i < gap || i >= gap + 128) events.push(...session.hear(signal.subarray(i, i + 128), i))
    expect(events.filter((event) => event._tag === "Dropout")).toHaveLength(1)
    expect(hitsOf(events).map((hit) => hit.beat)).toEqual([0, 1, 2, 3, 4])
    hitsOf(events).forEach((hit) => expect(Math.abs(hit.offsetMs)).toBeLessThan(1))
  })
})

describe("Session at any level", () => {
  const notes = OFFSETS_MS.map((offsetMs, step) => ({ step, offsetMs, sound: drum(SAMPLE_RATE, step + 1) }))

  it("hears the same take the same at full, a tenth and a hundredth of the gain", () => {
    const takes = [1, 0.1, 0.01].map((gain) => listen({ latencySeconds: 0.05, notes, gain }))
    for (const events of takes) expectHits(events, notes, 1)
    const [loud, ...quiet] = takes.map((events) => hitsOf(events))
    for (const hits of quiet) hits.forEach((hit, i) => expect(Math.abs(hit.offsetMs - loud![i]!.offsetMs)).toBeLessThan(0.5))
  })

  it("hears no notes in a loud click over a laptop mic's noise or a quiet interface's", () => {
    for (const noiseLevel of [0.001, 0.0001]) {
      const events = listen({ latencySeconds: 0.05, notes: [], noiseLevel, clickLevel: 0.9 })
      expect(latencyOf(events), `noise ${noiseLevel}`).toHaveLength(1)
      expect(hitsOf(events), `noise ${noiseLevel}`).toHaveLength(0)
    }
  })

  it("hears notes 30 dB under the click", () => {
    const quiet = OFFSETS_MS.map((offsetMs, step) => ({ step, offsetMs, sound: drum(SAMPLE_RATE, step + 1).map((x) => x * 0.03) }))
    expectHits(listen({ latencySeconds: 0.05, notes: quiet }), quiet, 1.5)
  })

  it("keeps its threshold when a note sounds during the count-in", () => {
    const quiet = OFFSETS_MS.map((offsetMs, step) => ({ step, offsetMs, sound: drum(SAMPLE_RATE, step + 1).map((x) => x * 0.03) }))
    // A loud hit between the 2nd and 3rd count-in clicks, at 100 BPM.
    const stray = [drum(SAMPLE_RATE, 99), Math.round(1.5 * 0.6 * SAMPLE_RATE)] as const
    expectHits(listen({ latencySeconds: 0.05, notes: quiet, extra: [stray] }), quiet, 1.5)
  })

  it("hears drum hits over a loud, sustained wash", () => {
    // A cymbal-like wash at about -30 dBFS fills every band to the end of the
    // take. It swells in over the last two count-in beats; a wash that starts
    // at full level is itself a note.
    const swell = SAMPLE_RATE
    const wash = noise(Math.round(10 * SAMPLE_RATE), 0.03, 21).map((x, i) => x * Math.min(1, i / swell))
    expectHits(listen({ latencySeconds: 0.05, notes, extra: [[wash, Math.round(6 * 0.6 * SAMPLE_RATE)]] }), notes, 1)
  })
})

describe("Session after a loud note", () => {
  it("hears a ghost note 25 dB under an accent 300 ms before it", () => {
    // Accents on the beat, ghost notes on the "and", at eighth notes (300 ms apart at 100 BPM).
    const notes = OFFSETS_MS.map((offsetMs, step) => {
      const sound = drum(SAMPLE_RATE, step + 1)
      return { step, offsetMs, sound: step % 2 === 0 ? sound : sound.map((x) => x * 0.056) }
    })
    expectHits(listen({ latencySeconds: 0.05, notes, subdivision: 2 }), notes, 1.5, 2)
  })
})
