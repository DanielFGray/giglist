/**
 * The song a score fills in when a player uploads it. Only an untitled song
 * takes the score's title, artist and tempo. The song types live in setlist's
 * API client, so this stays with the app while the score's metadata comes from
 * gigbag.js.
 */
import type { ScoreMeta } from "gigbag.js/charts/score-meta"

/** The title a song gets when a player adds it before knowing its name. */
export const UNTITLED_SONG = "Untitled song"

/** The song details a score can fill in. */
type ScoreFilled = { readonly title: string; readonly artist: string | null; readonly tempo_bpm: number | null }

/**
 * The details a score fills in, or null when nothing changes. Only an untitled
 * song takes anything: a title the player chose is never replaced. The title
 * and artist come from the score, and a tempo fills only a song with none.
 */
export function songFromScore(song: ScoreFilled, meta: ScoreMeta): ScoreFilled | null {
  if (song.title !== UNTITLED_SONG) return null
  const next: ScoreFilled = {
    title: meta.title ?? song.title,
    artist: song.artist ?? meta.artist,
    tempo_bpm: song.tempo_bpm ?? meta.tempo,
  }
  const changed = next.title !== song.title || next.artist !== song.artist || next.tempo_bpm !== song.tempo_bpm
  return changed ? next : null
}
