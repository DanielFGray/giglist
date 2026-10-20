import { useMemo } from "react"
import { renderDescription } from "./description"

/**
 * Markdown prose (a bio, in the settings preview and on `/u/:username`)
 * rendered in the app itself, styled by `.markdown` in app.css.
 *
 * The HTML is safe to set: `renderDescription` escapes every tag the author
 * typed, so the only markup here is its own — links, pictures, and the
 * provider players, each in its own sandboxed frame.
 */
export function Markdown({ source, pwid, className }: { source: string; pwid?: string; className?: string }) {
  const html = useMemo(() => renderDescription(source), [source])
  return (
    <div
      data-pwid={pwid}
      className={`markdown ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
