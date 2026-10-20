import { describe, expect, test } from "bun:test"
import { matchSongs } from "./song-match"

const songs = [
  { title: "Roadhouse Blues", artist: "The Doors" },
  { title: "Hey Joe", artist: "Jimi Hendrix" },
  { title: "Blue Sky", artist: "Allman Brothers" },
]

describe("matchSongs", () => {
  test("ranks titles that start with the text over titles that contain it", () => {
    expect(matchSongs(songs, "blue").map((s) => s.title)).toEqual(["Blue Sky", "Roadhouse Blues"])
  })

  test("finds a song by its artist after every title match", () => {
    expect(matchSongs(songs, "doors").map((s) => s.title)).toEqual(["Roadhouse Blues"])
  })

  test("an empty query lists every song by title", () => {
    expect(matchSongs(songs, " ").map((s) => s.title)).toEqual(["Blue Sky", "Hey Joe", "Roadhouse Blues"])
  })
})
