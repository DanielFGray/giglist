import { createHash } from "node:crypto"

/**
 * A new account's default avatar: the Gravatar for its signup email.
 *
 * Gravatar image requests (https://docs.gravatar.com/api/avatars/images/)
 * address a picture by the SHA-256 hash of the trimmed, lowercased email.
 * `d=404` makes Gravatar answer 404 instead of a generic silhouette when
 * the email has no picture, so `Avatar` can fall back to the initial;
 * `s=256` serves a square large enough for the circles it fills.
 * See ATTRIBUTIONS.md.
 */
export function gravatarUrl(email: string): string {
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex")
  return `https://www.gravatar.com/avatar/${hash}?s=256&d=404&r=g`
}
