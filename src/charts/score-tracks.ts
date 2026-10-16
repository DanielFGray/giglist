/**
 * The tracks of a score as a player picks them. A Guitar Pro file can name a
 * track with spaces only or not at all, so the label falls back to the track's
 * place in the file.
 */
export type TrackOption = { readonly index: number; readonly label: string }

export function trackOptions(tracks: ReadonlyArray<{ readonly name: string }>): Array<TrackOption> {
  return tracks.map((track, index) => ({ index, label: track.name.trim() || `Track ${index + 1}` }))
}
