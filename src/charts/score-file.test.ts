import { describe, expect, test } from "bun:test"
import { chartNameFromFile, scoreFormat } from "./score-file"

const bytes = (...codes: ReadonlyArray<number>) => new Uint8Array(codes)
const text = (s: string, lead = 0) => new Uint8Array(new TextEncoder().encode(" ".repeat(lead) + s))

describe("scoreFormat", () => {
  test("recognises Guitar Pro 3 to 5 by the header text after the length byte", () => {
    expect(scoreFormat(text("FICHIER GUITAR PRO v5.10", 1))).toBe("gp3-5")
  })

  test("recognises Guitar Pro 6 and 7 containers", () => {
    expect(scoreFormat(text("BCFZ...."))).toBe("gpx")
    expect(scoreFormat(text("BCFS...."))).toBe("gpx")
    expect(scoreFormat(bytes(0x50, 0x4b, 0x03, 0x04, 0))).toBe("gp7")
  })

  test("refuses other files and short input", () => {
    expect(scoreFormat(text("%PDF-1.7"))).toBeNull()
    expect(scoreFormat(text("FICHIER GUITAR PRO v5.10"))).toBeNull() // header not at offset 1
    expect(scoreFormat(new Uint8Array())).toBeNull()
    expect(scoreFormat(bytes(0x50, 0x4b))).toBeNull()
  })
})

describe("chartNameFromFile", () => {
  test("drops the directory and the extension", () => {
    expect(chartNameFromFile("Amazing Grace.gp5")).toBe("Amazing Grace")
    expect(chartNameFromFile("C:\\tabs\\riff.v2.gpx")).toBe("riff.v2")
  })

  test("falls back for an empty stem and caps the length", () => {
    expect(chartNameFromFile(".gp5")).toBe("Score")
    expect(chartNameFromFile(`${"a".repeat(300)}.gp`)).toHaveLength(200)
  })
})
