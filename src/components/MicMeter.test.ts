import { expect, test } from "vitest"
import { meterFill } from "./MicMeter"

test("the mic meter spans -60 to 0 dBFS", () => {
  expect(meterFill(0)).toBe(0)
  expect(meterFill(0.001)).toBe(0)
  expect(meterFill(1)).toBe(1)
  expect(meterFill(0.0316)).toBeCloseTo(0.5, 2)
})
