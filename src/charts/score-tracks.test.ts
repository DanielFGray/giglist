import { expect, test } from "bun:test"
import { trackOptions } from "./score-tracks"

test("labels a track by its name, or by its place when the name is blank", () => {
  expect(trackOptions([{ name: "Guitar 1" }, { name: "  " }, { name: "" }, { name: " Bass " }])).toEqual([
    { index: 0, label: "Guitar 1" },
    { index: 1, label: "Track 2" },
    { index: 2, label: "Track 3" },
    { index: 3, label: "Bass" },
  ])
})
