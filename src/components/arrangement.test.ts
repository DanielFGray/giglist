import { describe, expect, test } from "bun:test"
import { groupEntries, placeEntry, stepEntry, stepSection, toPayload, type Slot } from "./arrangement"

const sections = [{ id: "s1", name: "Set 1" }, { id: "s2", name: "Set 2" }]
const entry = (id: string, section_id: string | null): Slot => ({ id, section_id })
const shape = (groups: ReturnType<typeof groupEntries<Slot, (typeof sections)[number]>>) =>
  groups.map((g) => `${g.section?.id ?? "-"}:${g.entries.map((e) => e.id).join("")}`).join(" ")

const base = () => groupEntries(sections, [entry("a", "s1"), entry("b", "s1"), entry("c", "s2"), entry("d", null)])

describe("groupEntries", () => {
  test("puts the unsectioned group first and keeps entry order within a group", () => {
    expect(shape(base())).toBe("-:d s1:ab s2:c")
  })

  test("drops an empty unsectioned group once sections exist, but keeps it when there are none", () => {
    expect(shape(groupEntries(sections, [entry("a", "s1")]))).toBe("s1:a s2:")
    expect(shape(groupEntries([], []))).toBe("-:")
  })

  test("treats an entry of an unknown section as unsectioned", () => {
    expect(shape(groupEntries(sections, [entry("a", "gone")]))).toBe("-:a s1: s2:")
  })
})

describe("placeEntry", () => {
  test("moves before another entry in the same group", () => {
    expect(shape(placeEntry(base(), "b", "s1", "a"))).toBe("-:d s1:ba s2:c")
  })

  test("moves across groups, to the end when no entry is named", () => {
    expect(shape(placeEntry(base(), "a", "s2", null))).toBe("-:d s1:b s2:ca")
    expect(shape(placeEntry(base(), "a", "s2", "c"))).toBe("-:d s1:b s2:ac")
  })

  test("takes the section of the group it lands in", () => {
    const groups = placeEntry(base(), "d", "s2", null)
    expect(groups.find((g) => g.section?.id === "s2")!.entries.map((e) => e.section_id)).toEqual(["s2", "s2"])
  })

  test("dropping an entry before itself changes nothing", () => {
    expect(shape(placeEntry(base(), "a", "s1", "a"))).toBe("-:d s1:ab s2:c")
  })
})

describe("stepEntry", () => {
  test("moves within a group", () => {
    expect(shape(stepEntry(base(), "b", -1))).toBe("-:d s1:ba s2:c")
    expect(shape(stepEntry(base(), "a", 1))).toBe("-:d s1:ba s2:c")
  })

  test("crosses into the neighbouring group at a boundary", () => {
    expect(shape(stepEntry(base(), "b", 1))).toBe("-:d s1:a s2:bc")
    expect(shape(stepEntry(base(), "c", -1))).toBe("-:d s1:abc s2:")
    expect(shape(stepEntry(base(), "a", -1))).toBe("-:da s1:b s2:c")
  })

  test("stays put at the very start and end", () => {
    expect(shape(stepEntry(base(), "d", -1))).toBe("-:d s1:ab s2:c")
    expect(shape(stepEntry(base(), "c", 1))).toBe("-:d s1:ab s2:c")
  })
})

describe("stepSection and toPayload", () => {
  test("swaps sections but never moves one above the unsectioned group", () => {
    expect(shape(stepSection(base(), "s2", -1))).toBe("-:d s2:c s1:ab")
    expect(shape(stepSection(base(), "s1", -1))).toBe("-:d s1:ab s2:c")
  })

  test("the payload lists groups and entry ids in order", () => {
    expect(toPayload(placeEntry(base(), "a", "s2", null))).toEqual({
      groups: [
        { section_id: null, entries: ["d"] },
        { section_id: "s1", entries: ["b"] },
        { section_id: "s2", entries: ["c", "a"] },
      ],
    })
  })
})
