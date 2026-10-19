import { describe, expect, test } from "bun:test"
import { BOTH_NOTATIONS, staffNotation, toggleNotation } from "./score-notation"

describe("toggleNotation", () => {
  test("turns one notation off while the other stays on", () => {
    expect(toggleNotation(BOTH_NOTATIONS, "tab")).toEqual({ standard: true, tab: false })
    expect(toggleNotation(BOTH_NOTATIONS, "standard")).toEqual({ standard: false, tab: true })
  })
  test("turning off the only notation on turns the other on", () => {
    expect(toggleNotation({ standard: false, tab: true }, "tab")).toEqual({ standard: true, tab: false })
    expect(toggleNotation({ standard: true, tab: false }, "standard")).toEqual({ standard: false, tab: true })
  })
  test("turns a hidden notation back on", () => {
    expect(toggleNotation({ standard: false, tab: true }, "standard")).toEqual(BOTH_NOTATIONS)
  })
})

describe("staffNotation", () => {
  test("a stringed staff follows the choice", () => {
    expect(staffNotation(true, { standard: false, tab: true })).toEqual({ standard: false, tab: true })
    expect(staffNotation(true, { standard: true, tab: false })).toEqual({ standard: true, tab: false })
  })
  test("a staff without tab (piano, drums) always keeps standard notation and never shows tab", () => {
    expect(staffNotation(false, { standard: false, tab: true })).toEqual({ standard: true, tab: false })
  })
})
