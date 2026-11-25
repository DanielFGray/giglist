import { cx } from "tailwind-variants/lite"
import { ToggleButton } from "react-aria-components"
import type { Viewer } from "./live"
import { button } from "./ui/button"

/** Viewer chips: a follow button when followable, a plain chip otherwise. */
const pill = button({ size: "pill", tone: "raised" })

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
        return (
          <li key={v.client} data-pwid="viewer" data-mode={v.mode}>
            {followable ? (
              <ToggleButton
                data-pwid="viewer-follow"
                isSelected={following === v.client}
                onChange={() => onFollow(following === v.client ? null : v.client)}
                className={({ isSelected }) =>
                  cx(
                    pill,
                    "cursor-pointer outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-[var(--color-amber-accent)]",
                    isSelected
                      ? "border-[var(--color-amber-accent)] bg-[var(--color-amber-accent)] text-zinc-950"
                      : "text-zinc-300",
                  )
                }
              >
                {following === v.client ? `Following ${label}` : `Follow ${label}`}
              </ToggleButton>
            ) : (
              <span className={cx(pill, "text-zinc-400")}>{label}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
