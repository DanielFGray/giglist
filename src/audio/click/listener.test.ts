import { expect, it } from "bun:test"
import { Listener } from "./listener"
import { bassNote, drum, keyNote, mix, noise, pluck, SAMPLE_RATE } from "./synth"

it("hears the same notes whatever the size of the mic blocks", () => {
  const signal = noise(SAMPLE_RATE * 3, 0.001, 3)
  for (let i = 0; i < 8; i++) mix(signal, i % 2 === 0 ? drum(SAMPLE_RATE, i + 1) : pluck(SAMPLE_RATE, 110 * (i + 1), i + 1), 9000 + i * 15000)
  const inBlocks = (size: number) => {
    const listener = new Listener(SAMPLE_RATE)
    const onsets: Array<number> = []
    for (let i = 0; i < signal.length; i += size) onsets.push(...listener.push(signal.subarray(i, i + size), 500 + i))
    return onsets
  }
  const reference = inBlocks(128)
  expect(reference).toHaveLength(8)
  expect(inBlocks(1000)).toEqual(reference)
  expect(inBlocks(signal.length)).toEqual(reference)
})

it("hears low, slow bass notes the same at any input level", () => {
  const pitches = [41.2, 55, 73.4, 98, 41.2, 55, 73.4, 98]
  const signal = noise(SAMPLE_RATE * 6, 0.001, 5)
  pitches.forEach((pitchHz, i) => mix(signal, bassNote(SAMPLE_RATE, pitchHz), Math.round((1 + i * 0.6) * SAMPLE_RATE)))
  const loudest = signal.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0)
  // A mic gain scales the notes and the room noise together.
  const atPeak = (dB: number) => {
    const listener = new Listener(SAMPLE_RATE)
    const scaled = signal.map((x) => (x * 10 ** (dB / 20)) / loudest)
    const onsets: Array<number> = []
    for (let i = 0; i < scaled.length; i += 128) onsets.push(...listener.push(scaled.subarray(i, i + 128), i))
    return onsets
  }
  const reference = atPeak(-13)
  expect(reference).toHaveLength(pitches.length)
  for (const dB of [-33, -43]) {
    const onsets = atPeak(dB)
    expect(onsets).toHaveLength(pitches.length)
    onsets.forEach((onset, i) => expect(Math.abs(onset - reference[i]!)).toBeLessThan(SAMPLE_RATE / 1000))
  }
})

it("hears a chord rolled over 60 ms as one note", () => {
  // Six notes of a guitar chord, low to high, each 12 ms after the last, as a strum plays them.
  // A sharp attack on each note gives each its own rise.
  const strings = [82.4, 110, 146.8, 196, 246.9, 329.6]
  const strums = 4
  const signal = noise(SAMPLE_RATE * 4, 0.001, 9)
  for (let s = 0; s < strums; s++) {
    strings.forEach((pitchHz, i) => mix(signal, keyNote(SAMPLE_RATE, pitchHz, 10 * s + i + 1), Math.round((0.5 + 0.8 * s + 0.012 * i) * SAMPLE_RATE)))
  }
  const listener = new Listener(SAMPLE_RATE)
  const onsets: Array<number> = []
  for (let i = 0; i < signal.length; i += 128) onsets.push(...listener.push(signal.subarray(i, i + 128), i))
  expect(onsets).toHaveLength(strums)
})
