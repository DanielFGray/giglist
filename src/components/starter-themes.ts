import classic from "./themes/classic.html?raw"
import poster from "./themes/poster.html?raw"
import zine from "./themes/zine.html?raw"

/**
 * Themes a band can start from. Picking one copies its source into the band's
 * own theme, which the band then edits; a band that never picks one shows
 * Classic.
 */
export const STARTER_THEMES = [
  { id: "classic", label: "Classic", blurb: "Clean sections, easy to read", source: classic },
  { id: "poster", label: "Gig poster", blurb: "Huge type, framed like a flyer", source: poster },
  { id: "zine", label: "Zine", blurb: "Cut-and-paste letters, typewriter text", source: zine },
] as const

/** The theme a band shows until it saves one of its own. */
export const DEFAULT_THEME: string = classic
