import { useMemo } from "react"
import type { PublicUserProfileInfo } from "~/api/client"
import { renderTheme, userScope } from "./band-theme"
import { DEFAULT_USER_THEME } from "./user-theme"
import { sanitizeThemeHtml } from "./theme-sanitize"

/**
 * A user's public profile: their theme filled in with their data, in the
 * same sandboxed frame as a band's page (docs/adr/0012). The sandbox allows
 * scripts only so the players in a Markdown bio can run inside their own
 * frames; `sanitizeThemeHtml` strips the theme's own scripts, handlers and
 * frames first, so the user's HTML can style the page and link out but
 * cannot run code or read the visitor's GigList session.
 */
export function UserPage({ profile, className }: { profile: PublicUserProfileInfo; className?: string }) {
  const html = useMemo(
    () => sanitizeThemeHtml(renderTheme(profile.page_theme ?? DEFAULT_USER_THEME, userScope(profile), profile.page_options)),
    [profile],
  )
  return (
    <iframe
      data-pwid="public-user-page"
      title={profile.name ?? profile.username}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
      referrerPolicy="no-referrer"
      srcDoc={html}
      className={`block w-full border-0 ${className ?? ""}`}
    />
  )
}
