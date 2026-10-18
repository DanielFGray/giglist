// PROTOTYPE: throwaway. Removed when an editing design is chosen (see the prototype task in prog).
import { useEffect, useState } from "react"

/** Reads and writes `?editor=` so a variant survives reload and can be shared. Dev only. */
export function useVariant(keys: ReadonlyArray<string>): [string, (key: string) => void] {
  const [current, setCurrent] = useState(keys[0]!)
  useEffect(() => {
    const read = () => {
      const value = new URLSearchParams(window.location.search).get("editor")
      setCurrent(value && keys.includes(value) ? value : keys[0]!)
    }
    read()
    window.addEventListener("popstate", read)
    return () => window.removeEventListener("popstate", read)
  }, [keys])
  const set = (key: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set("editor", key)
    window.history.replaceState(null, "", url)
    setCurrent(key)
  }
  return [current, set]
}

export function PrototypeSwitcher({
  names,
  current,
  onChange,
}: {
  names: Readonly<Record<string, string>>
  current: string
  onChange: (key: string) => void
}) {
  const keys = Object.keys(names)
  const step = (delta: number) => onChange(keys[(keys.indexOf(current) + delta + keys.length) % keys.length]!)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, [contenteditable]")) return
      if (event.key === "ArrowLeft") step(-1)
      if (event.key === "ArrowRight") step(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  if (import.meta.env.PROD) return null
  return (
    <div
      data-pwid="prototype-switcher"
      className="fixed bottom-3 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-white px-4 py-2 text-sm font-medium text-black shadow-lg"
    >
      <button type="button" aria-label="Previous variant" onClick={() => step(-1)}>
        ←
      </button>
      <span>
        {current} ({names[current]})
      </span>
      <button type="button" aria-label="Next variant" onClick={() => step(1)}>
        →
      </button>
    </div>
  )
}
