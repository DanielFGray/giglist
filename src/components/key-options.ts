import { MusicalKeys, type MusicalKeyType } from "~/api/contracts"

/** The choices for the key a chart is written in, with "Not set" first. */
export const keyOptions: ReadonlyArray<{ value: MusicalKeyType | ""; label: string }> = [
  { value: "", label: "Not set" },
  ...MusicalKeys.map((key) => ({ value: key, label: key })),
]

/**
 * The keys that match what a player typed, best first: the key typed exactly
 * (ignoring case), then keys that start with it, then the rest that contain it.
 * Typing "c" offers C before C# and Cm.
 */
export function matchKeys(query: string): Array<MusicalKeyType> {
  const needle = query.trim().toLowerCase()
  const rank = (key: string) => {
    const lower = key.toLowerCase()
    return lower === needle ? 0 : lower.startsWith(needle) ? 1 : lower.includes(needle) ? 2 : 3
  }
  return MusicalKeys.filter((key) => rank(key) < 3).toSorted((a, b) => rank(a) - rank(b))
}
