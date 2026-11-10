import { CLICK_ONSET_SECONDS, clickWaveform } from "./click"

/**
 * Synthetic mic recordings for the listener's tests: the click as a room and
 * a cheap speaker colour it, and instrument notes with known start frames.
 */

export const SAMPLE_RATE = 48000

/** A small deterministic random source, so a failing test fails the same way twice. */
export const random = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Adds `sound` into `signal` from frame `at` on, times `gain`. */
export const mix = (signal: Float32Array, sound: Float32Array, at: number, gain = 1): void => {
  // A fractional index writes a property, not a sample, and the sound would vanish without an error.
  if (!Number.isInteger(at)) throw new RangeError(`mix: frame ${at} is not a whole number`)
  for (let i = 0; i < sound.length && at + i < signal.length; i++) if (at + i >= 0) signal[at + i]! += sound[i]! * gain
}

/** Adds the room click into `signal` so that it sounds at frame `at`, times `gain`. */
export const mixClick = (signal: Float32Array, at: number, gain: number): void =>
  mix(signal, roomClick(SAMPLE_RATE), Math.round(at - CLICK_ONSET_SECONDS * SAMPLE_RATE), gain)

/** The click as the mic hears it from a speaker: some distortion, then three room reflections. */
export const roomClick = (sampleRate: number): Float32Array => {
  const dry = clickWaveform(sampleRate).map((x) => 0.8 * x + 0.15 * x * x + 0.1 * x * x * x)
  const echoes: ReadonlyArray<readonly [seconds: number, gain: number]> = [
    [0, 1],
    [0.007, 0.35],
    [0.013, 0.2],
    [0.023, 0.12],
  ]
  const out = new Float32Array(dry.length + Math.ceil(0.03 * sampleRate))
  for (const [seconds, gain] of echoes) mix(out, dry, Math.round(seconds * sampleRate), gain)
  return out
}

export const noise = (length: number, level: number, seed: number): Float32Array => {
  const next = random(seed)
  return Float32Array.from({ length }, () => (next() * 2 - 1) * level)
}

/** A drum hit: a decaying noise burst over a low decaying thump. */
export const drum = (sampleRate: number, seed: number): Float32Array => {
  const next = random(seed)
  return Float32Array.from({ length: Math.round(0.25 * sampleRate) }, (_, i) => {
    const t = i / sampleRate
    return 0.5 * (next() * 2 - 1) * Math.exp(-t / 0.04) + 0.5 * Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t / 0.08)
  })
}

/** A plucked string by Karplus-Strong: a noise burst through a damped delay line. */
export const pluck = (sampleRate: number, pitchHz: number, seed: number): Float32Array => {
  const next = random(seed)
  const period = Math.round(sampleRate / pitchHz)
  const out = new Float32Array(Math.round(0.8 * sampleRate))
  for (let i = 0; i < out.length; i++) {
    out[i] = i < period ? next() * 2 - 1 : 0.498 * (out[i - period]! + out[i - period + 1]!)
  }
  return fadeOut(out.map((x) => x * 0.4), sampleRate)
}

/** A piano-like note: decaying harmonics after a 2 ms attack, with a short hammer knock. */
export const keyNote = (sampleRate: number, pitchHz: number, seed: number): Float32Array => {
  const next = random(seed)
  return fadeOut(
    Float32Array.from({ length: Math.round(0.8 * sampleRate) }, (_, i) => {
    const t = i / sampleRate
    let tone = 0
    for (let h = 1; h <= 8; h++) tone += (Math.sin(2 * Math.PI * pitchHz * h * t) / h) * Math.exp(-t / (0.8 / h))
    const attack = Math.min(1, t / 0.002)
    return 0.25 * attack * tone + 0.15 * (next() * 2 - 1) * Math.exp(-t / 0.005)
  }),
    sampleRate,
  )
}

/**
 * A bass note: a fundamental under the thump band (see click.ts) with five
 * harmonics, swelling over a 15 ms attack, as a finger on a heavy string does.
 * Most of its energy lies where the listener does not look.
 */
export const bassNote = (sampleRate: number, pitchHz: number): Float32Array =>
  fadeOut(
    Float32Array.from({ length: Math.round(0.5 * sampleRate) }, (_, i) => {
      const t = i / sampleRate
      let tone = 0
      for (let h = 1; h <= 6; h++) tone += Math.sin(2 * Math.PI * pitchHz * h * t) / h
      return 0.3 * Math.min(1, t / 0.015) * Math.exp(-t / 0.4) * tone
    }),
    sampleRate,
  )

/** Ends a sound with a 20 ms fade, as a damper or a decay would. A sound cut off dead is a real attack-like transient. */
const fadeOut = (sound: Float32Array, sampleRate: number): Float32Array => {
  const fade = Math.round(0.02 * sampleRate)
  for (let i = 0; i < fade; i++) sound[sound.length - 1 - i]! *= i / fade
  return sound
}
