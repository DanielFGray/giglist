/**
 * `mm:ss`, the form the catalog reads and writes song durations in.
 *
 * `[0-5]?\d` accepts a partly-typed ":4" so the field does not turn red
 * mid-keystroke; a missing part counts as zero.
 */
export const DURATION = /^\d{1,3}(:[0-5]?\d)?$/

/** Seconds to `mm:ss`; null (unknown duration) renders as an empty string. */
export const formatDuration = (seconds: number | null): string =>
  seconds === null
    ? ""
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

/**
 * `mm:ss` to seconds. The caller validates the text against {@link DURATION}
 * first, so the parts are always digits or absent; an absent part is zero.
 */
export const parseDuration = (text: string | null): number | null => {
  if (text === null || text === "") return null
  const [minutes = "0", seconds = "0"] = text.split(":")
  return Number(minutes) * 60 + Number(seconds)
}
