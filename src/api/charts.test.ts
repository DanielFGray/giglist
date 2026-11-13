import { describe, expect, test } from "vitest"
import { Schema as S } from "effect"
import { ChartChange } from "./charts"

describe("ChartChange", () => {
  test("ChartChange accepts source when present and rejects a negative source", () => {
    const withoutSource: unknown = { from: 1, to: 2, insert: 3 }
    const withSource: unknown = { from: 1, to: 2, insert: 3, source: 4 }
    const negativeSource: unknown = { from: 1, to: 2, insert: 3, source: -1 }
    expect(S.decodeUnknownSync(ChartChange)(withoutSource)).toEqual({ from: 1, to: 2, insert: 3 })
    expect(S.decodeUnknownSync(ChartChange)(withSource)).toEqual({ from: 1, to: 2, insert: 3, source: 4 })
    expect(() => S.decodeUnknownSync(ChartChange)(negativeSource)).toThrow()
  })
})
