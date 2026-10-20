import { useMemo } from "react"
import type { PublicBandProfileInfo } from "~/api/client"
import { bandScope, renderTheme } from "./band-theme"
import { DEFAULT_THEME } from "./starter-themes"
import { sanitizeThemeHtml } from "./theme-sanitize"

/**
 * A band's public page: its theme filled in with its data, in a sandboxed
 * frame (docs/adr/0010). The sandbox allows scripts only so the players in a
 * Markdown description (YouTube, Spotify, …) can run inside their own
 * frames; it still leaves out same-origin access and forms, and
 * `sanitizeThemeHtml` strips the theme's own scripts, handlers and frames
 * first, so the band's HTML can style the page and link out but cannot run
 * code, read the visitor's GigList session, or collect a password. Links may
 * open a new tab or, when clicked, replace the whole window.
 */
export function BandPage({ profile, className }: { profile: PublicBandProfileInfo; className?: string }) {
  const html = useMemo(
    () => sanitizeThemeHtml(renderTheme(profile.page_theme ?? DEFAULT_THEME, bandScope(profile), profile.page_options)),
    [profile],
  )
  return (
    <iframe
      data-pwid="public-band-page"
      title={profile.name}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
      referrerPolicy="no-referrer"
      srcDoc={html}
      className={`block w-full border-0 ${className ?? ""}`}
    />
  )
}
