import { describe, expect, test } from "vitest"
import type { SongInfo } from "~/api/client"
import { UNTITLED_SONG, songFromScore } from "./song-from-score"

const song = (over: Partial<SongInfo>): SongInfo =>
  ({ id: "s", title: UNTITLED_SONG, artist: null, key: null, tempo_bpm: null, duration_seconds: null, capo: null, notes: null, ...over }) as SongInfo

describe("songFromScore", () => {
  const meta = { title: "Blackbird", artist: "The Beatles", tempo: 94 }

  test("an untitled song takes the title, artist and tempo", () => {
    expect(songFromScore(song({}), meta)).toMatchObject({ title: "Blackbird", artist: "The Beatles", tempo_bpm: 94 })
  })

  test("a song with a title of its own is left alone", () => {
    expect(songFromScore(song({ title: "My title" }), meta)).toBeNull()
  })

  test("an artist or tempo the song already has is kept", () => {
    expect(songFromScore(song({ artist: "Me", tempo_bpm: 80 }), meta)).toMatchObject({ title: "Blackbird", artist: "Me", tempo_bpm: 80 })
  })

  test("a score with no title leaves the song as it is", () => {
    expect(songFromScore(song({}), { title: null, artist: null, tempo: null })).toBeNull()
  })
})
