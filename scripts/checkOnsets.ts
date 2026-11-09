/**
 * Measures the click listener's note detection and placement on rendered
 * instruments. fluidsynth renders each MIDI file in tests/fixtures/onsets twice:
 * "wet" with its reverb and chorus, "dry" without. Each render follows 1.5 s of
 * noise, as a mic is open before the first note, and goes through a Listener in
 * 128-frame blocks, as the audio thread sends it.
 *
 * Scoring is one to one: a MIDI note start (a chord's notes within 70 ms are
 * one) takes the nearest unused onset within 50 ms of the note plus the clip's
 * median offset. Per clip it prints the notes missed, the extra onsets, the
 * median offset (instrument attack plus placement) and the spread of the
 * matched notes around it.
 *
 * Usage: bun scripts/checkOnsets.ts <soundfont.sf2> [--noise 0.001,0.0001,0] [--gain 1]
 * (GeneralUser GS was used to choose the listener's constants; see ATTRIBUTIONS.md.)
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
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

const scratch = mkdtempSync(join(tmpdir(), "onsets-"))
try {
  const clips = readdirSync(CLIPS)
    .filter((file) => file.endsWith(".mid"))
    .sort()
  for (const room of ["wet", "dry"] as const) {
    const renders = clips.map((file) => ({ name: file.slice(0, -4), notes: noteStarts(readFileSync(join(CLIPS, file))), audio: render(join(CLIPS, file), room) }))
    for (const level of noiseLevels) {
      console.log(`\n${room}, noise ${level}, gain ${gain}`)
      let missed = 0
      let extra = 0
      for (const clip of renders) {
        const score = scoreClip(clip.notes, listen(clip.audio, level))
        missed += score.missed.length
        extra += score.extra.length
        console.log(
          `  ${clip.name.padEnd(22)} missed ${score.missed.length} extra ${score.extra.length}  offset ${ms(score.offset)} ms  spread ${ms(score.spread)} ms` +
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

/** Renders a MIDI file to mono samples at SAMPLE_RATE, times `gain`. */
function render(midi: string, room: "wet" | "dry"): Float32Array {
  const out = join(scratch, "render.wav")
  const effects = room === "dry" ? ["-R", "0", "-C", "0"] : []
  const run = Bun.spawnSync(["fluidsynth", "-ni", "-F", out, "-T", "wav", "-O", "s16", "-r", String(SAMPLE_RATE), ...effects, soundfont!, midi])
  if (run.exitCode !== 0) throw new Error(`fluidsynth failed on ${midi}: ${run.stderr.toString()}`)
  return readWav(readFileSync(out)).map((x) => x * gain)
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

function scoreClip(noteTimes: ReadonlyArray<number>, onsets: ReadonlyArray<number>) {
  const notes: Array<number> = []
  for (const t of noteTimes) if (notes.length === 0 || t - notes.at(-1)! > CHORD_SECONDS) notes.push(t)
  const nearest = notes.map((note) => onsets.reduce((best, onset) => (Math.abs(onset - note) < Math.abs(best) ? onset - note : best), Infinity))
  const offset = median(nearest)
  const used = new Set<number>()
  const missed: Array<number> = []
  const deviations: Array<number> = []
  for (const note of notes) {
    let best = -1
    onsets.forEach((onset, i) => {
      const error = Math.abs(onset - offset - note)
      if (!used.has(i) && error < MATCH_SECONDS && (best < 0 || error < Math.abs(onsets[best]! - offset - note))) best = i
    })
    if (best < 0) missed.push(note)
    else {
      used.add(best)
      deviations.push(onsets[best]! - offset - note)
    }
  }
  const extra = onsets.filter((_, i) => !used.has(i)).map((onset) => onset - offset)
  const spread = deviations.length > 0 ? Math.max(...deviations) - Math.min(...deviations) : Number.NaN
  return { offset, spread, missed, extra }
}

/** Note-on times in seconds from a standard MIDI file (format 0 or 1), following its tempo map. */
function noteStarts(bytes: Uint8Array): Array<number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const division = view.getUint16(12)
  const events: Array<{ tick: number; tempo?: number }> = []
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
          if ((status & 0xf0) === 0x90 && bytes[p + 1]! > 0) events.push({ tick })
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
  const starts: Array<number> = []
  for (const event of events) {
    seconds += ((event.tick - lastTick) * microsPerBeat) / division / 1e6
    lastTick = event.tick
    if (event.tempo === undefined) starts.push(seconds)
    else microsPerBeat = event.tempo
  }
  return starts.sort((a, b) => a - b)
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
