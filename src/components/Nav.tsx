import { useState } from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { BandSwitcher } from "./BandSwitcher"
import { ThemeToggle } from "./ThemeToggle"

const NAV_ITEMS = [
  { to: "/", label: "Setlists" },
  { to: "/songs", label: "Songs" },
  { to: "/band", label: "Band" },
] as const

function NavLink({ to, label }: { to: string; label: string }) {
  const router = useRouterState()
  const isActive =
    to === "/" ? router.location.pathname === "/" : router.location.pathname.startsWith(to)

  return (
    <Link
      to={to}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        isActive
          ? "text-[var(--color-amber-accent)] bg-[var(--color-surface-hover)]"
          : "text-zinc-400 hover:text-zinc-200 hover:bg-[var(--color-surface-hover)]"
      }`}
    >
      {label}
    </Link>
  )
}

export function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <nav className="sticky top-0 z-40 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-1">
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center gap-2 mr-4 shrink-0"
          >
            <span className="text-[var(--color-amber-accent)] font-bold text-lg tracking-tight">
              SetList
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-0.5">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} {...item} />
            ))}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right side */}
          <div className="hidden md:flex items-center gap-1.5">
            <BandSwitcher />
            <ThemeToggle />
            {/* User avatar placeholder */}
            <button className="size-8 rounded-full bg-zinc-800 border border-[var(--color-border-subtle)] flex items-center justify-center text-xs font-medium text-zinc-400 hover:border-[var(--color-border-active)] transition-colors cursor-pointer ml-1">
              ?
            </button>
          </div>

          {/* Mobile hamburger */}
          <div className="flex md:hidden items-center gap-1.5">
            <ThemeToggle />
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="size-8 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              aria-label="Toggle menu"
            >
              {mobileOpen ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu panel */}
        {mobileOpen && (
          <div className="md:hidden border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            <div className="px-4 py-3 space-y-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2.5 rounded-md text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  {item.label}
                </Link>
              ))}
              <div className="pt-2 border-t border-[var(--color-border-subtle)] mt-2">
                <BandSwitcher />
              </div>
            </div>
          </div>
        )}
      </nav>
    </>
  )
}
