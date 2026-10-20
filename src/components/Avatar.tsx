import { useState } from "react"

/**
 * A person's picture in a shape the caller sizes with `className` (e.g.
 * `size-8 rounded-full`). Shows `avatarUrl` — for a new account, the
 * Gravatar stored as its default — and falls back to the first initial of
 * the display name or username when there is no picture or it fails to
 * load (a Gravatar URL answers 404 for an email with no picture).
 */
export function Avatar({
  avatarUrl,
  name,
  username,
  className = "",
  fallbackClassName = "",
}: {
  avatarUrl?: string | null
  name?: string | null
  username?: string | null
  className?: string
  fallbackClassName?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (avatarUrl && failedUrl !== avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        onError={() => setFailedUrl(avatarUrl)}
        className={`object-cover ${className}`}
      />
    )
  }
  const initial = (name?.trim() || username || "?")[0]?.toUpperCase() ?? "?"
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center ${fallbackClassName} ${className}`}
    >
      {initial}
    </span>
  )
}
