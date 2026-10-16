/**
 * What a score upload must be (docs/adr/0002). The app stores the Guitar Pro
 * file unchanged, so the only checks are on its outside: a size limit and the
 * magic bytes that name the format. Whether alphaTab can read the contents is
 * known only when the viewer loads it.
 */

/** The database refuses a larger file (`score_files.bytes`). */
export const MAX_SCORE_BYTES = 20 * 1024 * 1024

export type ScoreFormat = "gp3-5" | "gpx" | "gp7"

/**
 * The Guitar Pro format that `bytes` start like, or null if it is none.
 * - Guitar Pro 3 to 5: a length byte, then the text "FICHIER GUITAR PRO v".
 * - Guitar Pro 6 (.gpx): "BCFZ" (compressed) or "BCFS".
 * - Guitar Pro 7 and 8 (.gp): a zip archive.
 */
export function scoreFormat(bytes: Uint8Array): ScoreFormat | null {
  if (startsWith(bytes, 1, "FICHIER GUITAR PRO v")) return "gp3-5"
  if (startsWith(bytes, 0, "BCFZ") || startsWith(bytes, 0, "BCFS")) return "gpx"
  if (startsWith(bytes, 0, "PK\u0003\u0004")) return "gp7"
  return null
}

/** The chart name a file gets by default: its file name without the extension. */
export function chartNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  const stem = base.replace(/\.[^.]+$/, "").trim()
  return stem === "" ? "Score" : stem.slice(0, 200)
}

function startsWith(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}
