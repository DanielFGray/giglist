/**
 * The band's songs that match what a player typed into a setlist's title
 * cell, best first: titles that start with the text, then titles that contain
 * it, then songs whose artist contains it. Case is ignored, and an empty query
 * matches every song in title order.
 */
export function matchSongs<S extends { title: string; artist: string | null }>(
  songs: ReadonlyArray<S>,
  query: string,
): Array<S> {
  const needle = query.trim().toLowerCase()
  const rank = (song: S) => {
    const title = song.title.toLowerCase()
    if (title.startsWith(needle)) return 0
    if (title.includes(needle)) return 1
    return (song.artist ?? "").toLowerCase().includes(needle) ? 2 : 3
  }
  return songs
    .filter((song) => rank(song) < 3)
    .toSorted((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
}
