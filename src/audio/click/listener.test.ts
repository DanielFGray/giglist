import { expect, it } from "bun:test"
import { Listener } from "./listener"
import { drum, mix, noise, pluck, SAMPLE_RATE } from "./synth"

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
