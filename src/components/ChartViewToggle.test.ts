import { describe, expect, it } from "bun:test"
import type { ChartInfo } from "~/api/client"
import { chartsInView, hasBothKinds } from "./ChartViewToggle"

const chart = (id: string, kind: "lyrics" | "score") => ({ id, kind }) as ChartInfo
const sheet = chart("sheet", "lyrics")
const score = chart("score", "score")

describe("chartsInView", () => {
  it("shows one kind at a time when a song has both", () => {
    const list = [sheet, score]
    expect(hasBothKinds(list)).toBe(true)
    expect(chartsInView(list, "chords")).toEqual([sheet])
    expect(chartsInView(list, "score")).toEqual([score])
  })

  it("shows every chart of a song with one kind, whatever the view", () => {
    expect(hasBothKinds([sheet])).toBe(false)
    expect(chartsInView([sheet], "score")).toEqual([sheet])
    expect(chartsInView([score], "chords")).toEqual([score])
  })
})
