import { useEffect, useState } from "react"

/**
 * True while a sticky header should be slid out of view: it hides when the page
 * scrolls down, and returns once the player scrolls up by `FAR` pixels in one
 * direction, flicks up faster than `FAST` pixels per event, or reaches the top.
 * `pinned` keeps it shown (an open menu). The state is also written to the root
 * element as `data-nav="hidden"`, so a sticky bar below can move up into its place.
 */
export function useHideOnScroll(pinned: boolean): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let last = window.scrollY
    let up = 0
    const onScroll = () => {
      const y = window.scrollY
      const delta = y - last
      last = y
      if (y <= TOP) return setHidden(false)
      if (delta > 0) {
        up = 0
        setHidden(true)
        return
      }
      up -= delta
      if (up >= FAR || -delta >= FAST) setHidden(false)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const slidOut = hidden && !pinned
  useEffect(() => {
    document.documentElement.dataset.nav = slidOut ? "hidden" : "shown"
    return () => void delete document.documentElement.dataset.nav
  }, [slidOut])
  return slidOut
}

const TOP = 56 // within the header's own height of the top, it always shows
const FAR = 120
const FAST = 40
