import type { Viewer } from "./live"

/**
 * The other people who have the setlist open. Someone performing it shows the
 * number of their song; with `onFollow` that chip is a button that moves this
 * page to the same song, and `following` marks the one being followed.
 */
export function Viewers({
  viewers,
  me,
  following = null,
  onFollow,
  className = "",
}: {
  viewers: ReadonlyArray<Viewer>
  me: string
  following?: string | null
  onFollow?: (client: string | null) => void
  className?: string
}) {
  const others = viewers.filter((v) => v.client !== me)
  if (others.length === 0) return null
  return (
    <ul data-pwid="viewers" className={`flex flex-wrap items-center gap-2 text-xs ${className}`}>
      {others.map((v) => {
        const label = v.mode === "performing" && v.at !== null ? `${v.username} · song ${v.at}` : v.username
        const followable = onFollow && v.mode === "performing" && v.at !== null
        const base = "rounded-full border px-2.5 py-1"
        return (
          <li key={v.client} data-pwid="viewer" data-mode={v.mode}>
            {followable ? (
              <button
                type="button"
                data-pwid="viewer-follow"
                aria-pressed={following === v.client}
                onClick={() => onFollow(following === v.client ? null : v.client)}
                className={`${base} cursor-pointer ${following === v.client ? "border-[var(--color-amber-accent)] bg-[var(--color-amber-accent)] text-zinc-950" : "border-zinc-700 text-zinc-300"}`}
              >
                {following === v.client ? `Following ${label}` : `Follow ${label}`}
              </button>
            ) : (
              <span className={`${base} border-zinc-700 text-zinc-400`}>{label}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
