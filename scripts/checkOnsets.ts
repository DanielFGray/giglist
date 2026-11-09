/**
 * Measures the click listener's note detection and placement on rendered
 * instruments. fluidsynth renders each MIDI file in tests/fixtures/onsets twice:
 * "wet" with its reverb and chorus, "dry" without. Each render follows 1.5 s of
 * noise, as a mic is open before the first note, and goes through a Listener in
 * 128-frame blocks, as the audio thread sends it.
 *
 * Detection is scored one to one: a MIDI note start (a chord's notes within
 * 70 ms are one) takes the nearest unused onset within 50 ms of the note plus
 * the clip's median offset. The rest are missed notes and extra onsets.
 *
 * Placement is scored against where each note starts when it sounds alone:
 * the script also renders every note (or chord) with the clip's other notes
 * silenced, dry, and takes its first sample within START_DB of its peak. That
 * start does not depend on the listener, so a soundfont sample's silent lead-in
 * does not count against placement. A matched onset's error is its time in the
 * clip minus that start.
 *
 * Per clip it prints the notes missed, the extra onsets, the median "lead-in"
 * (start minus MIDI time), and the placement error: its median, the distance
 * from that median that 90% of notes are within, and the largest distance.
 *
 * Usage: bun scripts/checkOnsets.ts <soundfont.sf2> [--noise 0.001,0.0001,0] [--gain 1]
 * (GeneralUser GS was used to choose the listener's constants; see ATTRIBUTIONS.md.)
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { Listener } from "../src/audio/click/listener"
import { noise } from "../src/audio/click/synth"

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { noise: { type: "string", default: "0.001,0.0001,0" }, gain: { type: "string", default: "1" } },
})
const soundfont = positionals[0]
if (!soundfont) throw new Error("usage: bun scripts/checkOnsets.ts <soundfont.sf2> [--noise 0.001,0.0001,0] [--gain 1]")
const noiseLevels = values.noise.split(",").map(Number)
const gain = Number(values.gain)

const CLIPS = join(import.meta.dir, "../tests/fixtures/onsets")
const SAMPLE_RATE = 44100
const LEAD_SECONDS = 1.5
const BLOCK = 128
const CHORD_SECONDS = 0.07
const MATCH_SECONDS = 0.05
/** A note starts at its first sample within this many dB of its peak. */
const START_DB = -40
/** fluidsynth runs this many renders at once. */
const RENDERS_AT_ONCE = 4

const scratch = mkdtempSync(join(tmpdir(), "onsets-"))
try {
  const clips = await Promise.all(
    readdirSync(CLIPS)
      .filter((file) => file.endsWith(".mid"))
      .sort()
      .map(async (file) => {
        const path = join(CLIPS, file)
        const bytes = readFileSync(path)
        const notes = noteGroups(readNotes(bytes))
        return { name: file.slice(0, -4), path, notes, alone: await startAlone(file, bytes, notes) }
      }),
  )
  for (const room of ["wet", "dry"] as const) {
    const renders = await Promise.all(clips.map(async (clip) => ({ ...clip, audio: (await render(clip.path, room, `${clip.name}-${room}`)).map((x) => x * gain) })))
    for (const level of noiseLevels) {
      console.log(`\n${room}, noise ${level}, gain ${gain}`)
      let missed = 0
      let extra = 0
      for (const clip of renders) {
        const score = scoreClip(clip.notes, clip.alone, listen(clip.audio, level))
        missed += score.missed.length
        extra += score.extra.length
        console.log(
          `  ${clip.name.padEnd(22)} missed ${score.missed.length} extra ${score.extra.length}  lead-in ${ms(score.leadIn)}  error ${ms(score.error)} 90% ±${ms(score.p90)} all ±${ms(score.worst)} ms` +
            (score.worst > 0.003 ? ` (worst at ${score.worstAt.toFixed(2)} s)` : "") +
            (score.missed.length > 0 ? `  missed at ${score.missed.map((t) => t.toFixed(2)).join(" ")}` : "") +
            (score.extra.length > 0 ? `  extra at ${score.extra.map((t) => t.toFixed(2)).join(" ")}` : ""),
        )
      }
      console.log(`  total missed ${missed}, extra ${extra}`)
    }
  }
} finally {
  rmSync(scratch, { recursive: true })
}

interface NoteGroup {
  /** MIDI time of the group's first note, in seconds. */
  readonly seconds: number
  readonly notes: ReadonlyArray<MidiNote>
}

/**
 * Each group's start when it sounds alone: the clip rendered dry with every
 * other note-on at velocity 0, so the render is digital silence until the
 * group sounds. The start is the first sample within START_DB of the render's
 * peak, a level relative to the group's own loudness, so velocity does not
 * move it. NaN when that sample is not within MATCH_SECONDS of the group.
 */
async function startAlone(file: string, bytes: Uint8Array, groups: ReadonlyArray<NoteGroup>): Promise<Array<number>> {
  const all = groups.flatMap((group) => group.notes)
  return pool(
    groups.map((group, i) => async () => {
      const muted = Uint8Array.from(bytes)
      for (const note of all) if (!group.notes.includes(note)) muted[note.velocityAt] = 0
      const midi = join(scratch, `${file}-${i}.mid`)
      writeFileSync(midi, muted)
      const audio = await render(midi, "dry", `${file}-${i}`)
      const peak = audio.reduce((top, x) => Math.max(top, Math.abs(x)), 0)
      const start = audio.findIndex((x) => Math.abs(x) >= peak * 10 ** (START_DB / 20)) / SAMPLE_RATE
      return Math.abs(start - group.seconds) < MATCH_SECONDS ? start : Number.NaN
    }),
    RENDERS_AT_ONCE,
  )
}

/** Renders a MIDI file to mono samples at SAMPLE_RATE. */
async function render(midi: string, room: "wet" | "dry", name: string): Promise<Float32Array> {
  const out = join(scratch, `${name}.wav`)
  const effects = room === "dry" ? ["-R", "0", "-C", "0"] : []
  const run = Bun.spawn(["fluidsynth", "-ni", "-F", out, "-T", "wav", "-O", "s16", "-r", String(SAMPLE_RATE), ...effects, soundfont!, midi], { stdout: "ignore", stderr: "pipe" })
  if ((await run.exited) !== 0) throw new Error(`fluidsynth failed on ${midi}: ${await new Response(run.stderr).text()}`)
  return readWav(readFileSync(out))
}

/** Feeds LEAD_SECONDS of noise, the clip, and 1 s more to a Listener; returns onsets in seconds from the clip's start. */
function listen(audio: Float32Array, level: number): Array<number> {
  const lead = LEAD_SECONDS * SAMPLE_RATE
  const signal = noise(lead + audio.length + SAMPLE_RATE, level, 1)
  audio.forEach((x, i) => (signal[lead + i]! += x))
  const listener = new Listener(SAMPLE_RATE)
  const onsets: Array<number> = []
  for (let i = 0; i + BLOCK <= signal.length; i += BLOCK) onsets.push(...listener.push(signal.subarray(i, i + BLOCK), i))
  return onsets.map((frame) => (frame - lead) / SAMPLE_RATE)
}

function scoreClip(groups: ReadonlyArray<NoteGroup>, alone: ReadonlyArray<number>, onsets: ReadonlyArray<number>) {
  const notes = groups.map((group) => group.seconds)
  const nearest = notes.map((note) => onsets.reduce((best, onset) => (Math.abs(onset - note) < Math.abs(best) ? onset - note : best), Infinity))
  const offset = median(nearest)
  const used = new Set<number>()
  const missed: Array<number> = []
  const errors: Array<{ at: number; error: number }> = []
  notes.forEach((note, n) => {
    let best = -1
    onsets.forEach((onset, i) => {
      const distance = Math.abs(onset - offset - note)
      if (!used.has(i) && distance < MATCH_SECONDS && (best < 0 || distance < Math.abs(onsets[best]! - offset - note))) best = i
    })
    if (best < 0) missed.push(note)
    else {
      used.add(best)
      if (!Number.isNaN(alone[n]!)) errors.push({ at: note, error: onsets[best]! - alone[n]! })
    }
  })
  const extra = onsets.filter((_, i) => !used.has(i)).map((onset) => onset - offset)
  const error = median(errors.map((e) => e.error))
  const distances = errors.map((e) => Math.abs(e.error - error)).sort((a, b) => a - b)
  const p90 = distances[Math.floor(0.9 * (distances.length - 1))]!
  const worst = errors.reduce((top, e) => (Math.abs(e.error - error) > Math.abs(top.error - error) ? e : top), { at: Number.NaN, error })
  const leadIns = alone.flatMap((onset, n) => (Number.isNaN(onset) ? [] : [onset - notes[n]!]))
  return { leadIn: median(leadIns), error, p90, worst: Math.abs(worst.error - error), worstAt: worst.at, missed, extra }
}

interface MidiNote {
  readonly seconds: number
  /** Byte offset of the note-on's velocity in the file, to silence the note. */
  readonly velocityAt: number
}

/** Groups notes that start within CHORD_SECONDS of the group's first note. */
function noteGroups(notes: ReadonlyArray<MidiNote>): Array<NoteGroup> {
  const groups: Array<{ seconds: number; notes: Array<MidiNote> }> = []
  for (const note of notes) {
    const last = groups.at(-1)
    if (last !== undefined && note.seconds - last.seconds <= CHORD_SECONDS) last.notes.push(note)
    else groups.push({ seconds: note.seconds, notes: [note] })
  }
  return groups
}

/** Note-ons from a standard MIDI file (format 0 or 1), timed by its tempo map. */
function readNotes(bytes: Uint8Array): Array<MidiNote> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const division = view.getUint16(12)
  const events: Array<{ tick: number; tempo?: number; velocityAt?: number }> = []
  for (let pos = 14; pos < bytes.length; ) {
    const id = String.fromCharCode(...bytes.subarray(pos, pos + 4))
    let p = pos + 8
    const end = p + view.getUint32(pos + 4)
    if (id === "MTrk") {
      let tick = 0
      let status = 0
      const quantity = () => {
        let value = 0
        for (;;) {
          const byte = bytes[p++]!
          value = (value << 7) | (byte & 0x7f)
          if ((byte & 0x80) === 0) return value
        }
      }
      while (p < end) {
        tick += quantity()
        // A data byte here repeats the last status (running status).
        if ((bytes[p]! & 0x80) !== 0) status = bytes[p++]!
        if (status === 0xff) {
          const type = bytes[p++]!
          const length = quantity()
          if (type === 0x51) events.push({ tick, tempo: (bytes[p]! << 16) | (bytes[p + 1]! << 8) | bytes[p + 2]! })
          p += length
        } else if (status === 0xf0 || status === 0xf7) p += quantity()
        else if ((status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0) p += 1
        else {
          // A note-on with velocity 0 is a note-off.
          if ((status & 0xf0) === 0x90 && bytes[p + 1]! > 0) events.push({ tick, velocityAt: p + 1 })
          p += 2
        }
      }
    }
    pos = end
  }
  // Tempo changes apply before notes on the same tick.
  events.sort((a, b) => a.tick - b.tick || (a.tempo === undefined ? 1 : -1))
  let microsPerBeat = 500_000
  let lastTick = 0
  let seconds = 0
  const notes: Array<MidiNote> = []
  for (const event of events) {
    seconds += ((event.tick - lastTick) * microsPerBeat) / division / 1e6
    lastTick = event.tick
    if (event.tempo !== undefined) microsPerBeat = event.tempo
    else if (event.velocityAt !== undefined) notes.push({ seconds, velocityAt: event.velocityAt })
  }
  return notes.sort((a, b) => a.seconds - b.seconds)
}

/** Runs the tasks, at most `limit` at a time, and returns their results in order. */
async function pool<A>(tasks: ReadonlyArray<() => Promise<A>>, limit: number): Promise<Array<A>> {
  const results: Array<A> = []
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]!()
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  return results
}

/** The samples of a 16-bit PCM WAV file, with its channels averaged. */
function readWav(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let channels = 1
  for (let pos = 12; pos < bytes.length; ) {
    const id = String.fromCharCode(...bytes.subarray(pos, pos + 4))
    const size = view.getUint32(pos + 4, true)
    if (id === "fmt ") channels = view.getUint16(pos + 10, true)
    if (id === "data") {
      return Float32Array.from({ length: size / 2 / channels }, (_, i) => {
        let sum = 0
        for (let c = 0; c < channels; c++) sum += view.getInt16(pos + 8 + (i * channels + c) * 2, true)
        return sum / channels / 32768
      })
    }
    pos += 8 + size + (size % 2)
  }
  throw new Error("no data chunk in WAV")
}

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]!
}

function ms(seconds: number): string {
  return (seconds * 1000).toFixed(1)
}
