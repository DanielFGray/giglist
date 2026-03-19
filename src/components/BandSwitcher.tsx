import { useState, useRef, useEffect } from "react"

// Placeholder — will be wired to real band data from auth context
const PLACEHOLDER_BANDS = [
  { id: "1", name: "The Placeholders" },
]

export function BandSwitcher() {
  const [open, setOpen] = useState(false)
  const [current] = useState(PLACEHOLDER_BANDS[0])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
      >
        <span className="size-5 rounded bg-[var(--color-amber-accent)] flex items-center justify-center text-xs font-bold text-zinc-950">
          {current.name[0]}
        </span>
        <span className="max-w-[120px] truncate">{current.name}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-xl shadow-black/30 py-1 z-50">
          {PLACEHOLDER_BANDS.map((band) => (
            <button
              key={band.id}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left text-zinc-300 hover:bg-[var(--color-surface-hover)] hover:text-zinc-100 transition-colors cursor-pointer"
              onClick={() => setOpen(false)}
            >
              <span className="size-5 rounded bg-[var(--color-amber-accent)] flex items-center justify-center text-xs font-bold text-zinc-950 shrink-0">
                {band.name[0]}
              </span>
              <span className="truncate">{band.name}</span>
              {band.id === current.id && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="ml-auto text-[var(--color-amber-accent)] shrink-0"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
          <div className="border-t border-[var(--color-border-subtle)] mt-1 pt-1">
            <button className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer">
              <span className="size-5 rounded border border-dashed border-zinc-600 flex items-center justify-center text-xs text-zinc-500">
                +
              </span>
              Create band
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
