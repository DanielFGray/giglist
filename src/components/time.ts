/**
 * A time of day on the gig date, as the database and a `type="time"` field
 * spell it: `HH:MM`, with `:SS` when the database answers.
 */

/** The `HH:MM` a time input holds, whatever seconds the database added. */
export const timeInputValue = (time: string | null): string =>
  time === null ? "" : time.slice(0, 5)

/** `20:30:00` reads as `8:30 PM`; null (no time set) renders as an empty string. */
export const formatTimeOfDay = (time: string | null): string => {
  if (time === null) return ""
  const [hours = "0", minutes = "0"] = time.split(":")
  const hour = Number(hours)
  const suffix = hour < 12 ? "AM" : "PM"
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minutes.padStart(2, "0")} ${suffix}`
}

/** `2026-11-07` reads as `Sat, Nov 7, 2026`; the date is the venue's, so it is never shifted to another zone. */
export const formatGigDate = (date: string, locale?: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
