import { useEffect, type RefObject } from "react"
import type { AlphaTabApi } from "@coderline/alphatab"
import { inkFrom } from "./alphatab"

/**
 * Keeps alphaTab's ink the color of the text around `host`, and redraws when the
 * page's theme toggles. The app marks its theme with a class on the root
 * element, so a change to that class is the signal.
 */
export function useThemeInk(view: RefObject<AlphaTabApi | null>, host: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const apply = () => {
      const api = view.current
      const element = host.current
      if (!api || !element) return
      inkFrom(api.settings, getComputedStyle(element).color)
      api.updateSettings()
      api.render()
    }
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [view, host])
}
