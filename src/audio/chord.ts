import { STANDARD_TUNING } from "~/charts/voicing"

/**
 * Plays a guitar chord from its voicing. The sound is synthesized with a
 * Karplus-Strong pluck so it starts instantly, without loading a sound font.
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
  const context = getContext()
  const pitches = frets.flatMap((fret, i) => (fret === null ? [] : [STANDARD_TUNING[i]! + fret]))
  if (pitches.length === 0) return Promise.resolve()
  const now = context.currentTime
  const gain = context.createGain()
  gain.gain.value = 1 / Math.max(1, pitches.length)
  gain.connect(context.destination)
  for (const midi of pitches) {
    const frequency = 440 * Math.pow(2, (midi - 69) / 12)
    const source = context.createBufferSource()
    source.buffer = pluckBuffer(context, frequency)
    source.connect(gain)
    source.start(now)
  }
  return Promise.resolve()
}