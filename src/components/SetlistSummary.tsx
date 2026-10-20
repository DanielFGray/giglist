import { useState } from "react"
import type { SetlistStatusType } from "~/api/contracts"
import { formatDuration } from "./duration"
import { errorMessage } from "./form"

const STATUS_BADGE: Record<SetlistStatusType, string> = {
  draft: "bg-zinc-500/10 text-zinc-400",
  rehearsal: "bg-[var(--color-amber-accent)]/10 text-[var(--color-amber-accent)]",
  final: "bg-green-500/10 text-green-400",
}

export function StatusBadge({ status }: { status: SetlistStatusType }) {
  return (
    <span data-pwid="setlist-status-badge" className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_BADGE[status]}`}>
      {status}
    </span>
  )
}

/** "12 songs · 48:30": how long a list plays. Songs without a length count as nothing. */
export const listLength = (list: { song_count: number; duration_seconds: number }): string =>
  [
    `${list.song_count} ${list.song_count === 1 ? "song" : "songs"}`,
    list.duration_seconds > 0 ? formatDuration(list.duration_seconds) : null,
  ]
    .flatMap((part) => (part === null ? [] : [part]))
    .join(" · ")

/**
 * One text field and a button: what creating or copying a setlist asks for.
 * The field empties after `onSubmit` succeeds, and shows its error otherwise.
 */
export function NameForm({
  pwid,
  label,
  placeholder,
  submitLabel,
  initial = "",
  autoFocus = false,
  onSubmit,
}: {
  pwid: string
  label: string
  placeholder: string
  submitLabel: string
  initial?: string
  autoFocus?: boolean
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      data-pwid={pwid}
      onSubmit={async (e) => {
        e.preventDefault()
        if (name.trim() === "") return
        setPending(true)
        setError(null)
        try {
          await onSubmit(name.trim())
          setName("")
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setPending(false)
        }
      }}
      className="space-y-1"
    >
      <div className="flex gap-2">
        <input
          data-pwid={`${pwid}-name`}
          aria-label={label}
          value={name}
          autoFocus={autoFocus}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          maxLength={200}
          className="flex-1 min-w-0 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
        />
        <button
          type="submit"
          data-pwid={`${pwid}-submit`}
          disabled={pending || name.trim() === ""}
          className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shrink-0"
        >
          {submitLabel}
        </button>
      </div>
      {error && <div data-pwid={`${pwid}-error`} className="text-sm text-red-400">{error}</div>}
    </form>
  )
}
