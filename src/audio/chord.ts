import { STANDARD_TUNING } from "alphatab-kit/charts/voicing"

/**
 * Plays a chord from a guitar voicing or from piano pitches. Both sounds are synthesized, with a
 * Karplus-Strong pluck for guitar and summed harmonics for piano, so they start instantly
 * without loading a sound font.
 */

let audioContext: AudioContext | null = null
const bufferCache = new Map<number, AudioBuffer>()

const getContext = (): AudioContext => {
  if (audioContext === null) audioContext = new AudioContext()
  if (audioContext.state === "suspended") void audioContext.resume()
  return audioContext
}

const pluckBuffer = (context: AudioContext, frequency: number): AudioBuffer => {
  const cached = bufferCache.get(frequency)
  if (cached !== undefined) return cached
  const sampleRate = context.sampleRate
  const duration = 1.6
  const length = Math.floor(sampleRate * duration)
  const delayLength = Math.max(2, Math.floor(sampleRate / frequency))
  const buffer = context.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  const delay = new Float32Array(delayLength)
  for (let i = 0; i < delayLength; i++) delay[i] = Math.random() * 2 - 1
  let position = 0
  for (let i = 0; i < length; i++) {
    const next = (position + 1) % delayLength
    const sample = delay[position]
    data[i] = sample
    delay[position] = 0.5 * (delay[position] + delay[next]) * 0.994
    position = next
  }
  // Taper the tail so the pluck dies out instead of clicking off.
  for (let i = 0; i < length; i++) {
    const envelope = Math.exp(-2.2 * (i / (sampleRate * duration)))
    data[i] *= envelope
  }
  bufferCache.set(frequency, buffer)
  return buffer
}

export const preloadChordPlayer = (): void => {
  // Nothing to preload; kept for callers.
}

export const playChord = (frets: ReadonlyArray<number | null>): Promise<void> => {
  const pitches = frets.flatMap((fret, i) => (fret === null ? [] : [STANDARD_TUNING[i]! + fret]))
  return strike(pitches, (context, midi, output) => {
    const source = context.createBufferSource()
    source.buffer = pluckBuffer(context, frequencyOf(midi))
    source.connect(output)
    source.start(context.currentTime)
  })
}

/**
 * Plays a piano chord from its MIDI pitches, all at once. Each note is a few
 * harmonics with a quick attack and an exponential decay: a soft electric-piano
 * sound that needs no sample files, like the guitar pluck.
 */
export const playPianoChord = (pitches: ReadonlyArray<number>): Promise<void> =>
  strike(pitches, (context, midi, output) => pianoNote(context, frequencyOf(midi), output))

const frequencyOf = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

/** Sounds every pitch at the same moment through one gain, shared so a big chord does not clip. */
const strike = (
  pitches: ReadonlyArray<number>,
  voice: (context: AudioContext, midi: number, output: AudioNode) => void,
): Promise<void> => {
  if (pitches.length === 0) return Promise.resolve()
  const context = getContext()
  const gain = context.createGain()
  gain.gain.value = 1 / pitches.length
  gain.connect(context.destination)
  for (const midi of pitches) voice(context, midi, gain)
  return Promise.resolve()
}

/** Each harmonic's level; the first is the note itself. */
const HARMONICS: ReadonlyArray<number> = [1, 0.5, 0.25, 0.12, 0.06]
const PIANO_SECONDS = 1.8

const pianoNote = (context: AudioContext, frequency: number, output: AudioNode): void => {
  const now = context.currentTime
  const envelope = context.createGain()
  envelope.gain.setValueAtTime(0, now)
  envelope.gain.linearRampToValueAtTime(1, now + 0.005)
  envelope.gain.exponentialRampToValueAtTime(0.001, now + PIANO_SECONDS)
  envelope.connect(output)
  HARMONICS.forEach((level, i) => {
    const partial = context.createOscillator()
    partial.frequency.value = frequency * (i + 1)
    const partialGain = context.createGain()
    partialGain.gain.value = level
    partial.connect(partialGain).connect(envelope)
    partial.start(now)
    partial.stop(now + PIANO_SECONDS)
  })
}
