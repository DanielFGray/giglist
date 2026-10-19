/**
 * What a Guitar Pro file says about its song, and how an untitled song takes it.
 * Pure and free of the DOM: the upload form reads the file with alphaTab and
 * hands the score here, and the tests pass plain objects.
 */
import type { SongInfo, SongUpdateData } from "~/api/client"

/** The title a song gets when a player adds it before knowing its name. */
export const UNTITLED_SONG = "Untitled song"

export type ScoreMeta = {
  readonly title: string | null
  readonly artist: string | null
  /** Beats per minute at the start of the score. */
  readonly tempo: number | null
}

/** The part of an alphaTab score this reads. */
type ScoreLike = { readonly title: string; readonly artist: string; readonly tempo: number }

export function scoreMeta(score: ScoreLike): ScoreMeta {
  const tempo = Math.round(score.tempo)
  return {
    title: tidy(score.title),
    artist: tidy(score.artist),
    tempo: tempo >= 1 && tempo <= 999 ? tempo : null,
  }
}

/**
 * The song a score fills in, or null when nothing changes. Only an untitled
 * song takes anything: a title the player chose is never replaced. The title
 * and artist come from the score, and a tempo fills only a song with none.
 */
export function songFromScore(song: SongInfo, meta: ScoreMeta): SongUpdateData | null {
  if (song.title !== UNTITLED_SONG) return null
  const next: SongUpdateData = {
    title: meta.title ?? song.title,
    artist: song.artist ?? meta.artist,
    key: song.key,
    tempo_bpm: song.tempo_bpm ?? meta.tempo,
    duration_seconds: song.duration_seconds,
    capo: song.capo,
    notes: song.notes,
  }
  const changed = next.title !== song.title || next.artist !== song.artist || next.tempo_bpm !== song.tempo_bpm
  return changed ? next : null
}

/** The text with runs of whitespace (a file's non-breaking spaces too) as one space, or null if nothing is left. */
function tidy(text: string): string | null {
  const clean = text.replace(/\s+/gu, " ").trim()
  return clean === "" ? null : clean.slice(0, 500)
}
