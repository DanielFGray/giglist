import { useState, useRef, useEffect } from "react"
import { Link } from "@tanstack/react-router"
import { useAuth } from "./AuthContext"

export function BandSwitcher() {
  const { bands, currentBand, setCurrentBandId } = useAuth()
  const [open, setOpen] = useState(false)
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

  if (!currentBand) {
    return (
      <Link
        to="/band/new"
        data-pwid="band-create-link"
        className="px-2.5 py-1.5 rounded-md text-sm font-medium text-[var(--color-amber-accent)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        Create a band
      </Link>
    )
  }

  return (
    <div ref={ref} className="relative" data-pwid="band-switcher">
      <button
        onClick={() => setOpen(!open)}
        data-pwid="band-switcher-toggle"
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
      >
        <span className="size-5 rounded bg-[var(--color-amber-accent)] flex items-center justify-center text-xs font-bold text-zinc-950">
          {currentBand.name[0]}
        </span>
        <span className="max-w-[120px] truncate">{currentBand.name}</span>
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
          {bands.map((band) => (
            <button
              key={band.id}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left text-zinc-300 hover:bg-[var(--color-surface-hover)] hover:text-zinc-100 transition-colors cursor-pointer"
              onClick={() => {
                setCurrentBandId(band.id)
                setOpen(false)
              }}
            >
              <span className="size-5 rounded bg-[var(--color-amber-accent)] flex items-center justify-center text-xs font-bold text-zinc-950 shrink-0">
                {band.name[0]}
              </span>
              <span className="truncate">{band.name}</span>
              {band.id === currentBand.id && (
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
            <Link
              to="/band/new"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
            >
              <span className="size-5 rounded border border-dashed border-zinc-600 flex items-center justify-center text-xs text-zinc-500">
                +
              </span>
              Create band
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
