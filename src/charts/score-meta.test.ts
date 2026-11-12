import { describe, expect, test } from "vitest"
import type { SongInfo } from "~/api/client"
import { UNTITLED_SONG, scoreMeta, songFromScore } from "./score-meta"

const song = (over: Partial<SongInfo>): SongInfo =>
  ({ id: "s", title: UNTITLED_SONG, artist: null, key: null, tempo_bpm: null, duration_seconds: null, capo: null, notes: null, ...over }) as SongInfo

describe("scoreMeta", () => {
  test("tidies the text and rounds the tempo", () => {
    expect(scoreMeta({ title: "  Fixture Title ", artist: "The  Band", tempo: 119.6 })).toEqual({ title: "Fixture Title", artist: "The Band", tempo: 120 })
  })

  test("a blank field or an impossible tempo is null", () => {
    expect(scoreMeta({ title: "  ", artist: "", tempo: 0 })).toEqual({ title: null, artist: null, tempo: null })
  })
})

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
