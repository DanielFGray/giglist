import { useState } from "react"
import { Link, useRouter, useRouterState } from "@tanstack/react-router"
import { BandSwitcher } from "./BandSwitcher"
import { ThemeToggle } from "./ThemeToggle"
import { useAuth } from "./AuthContext"
import { logoutFn } from "~/server/auth.fn"

const NAV_ITEMS = [
  { to: "/", label: "Setlists", pwid: "nav-setlists" },
  { to: "/songs", label: "Songs", pwid: "nav-songs" },
  { to: "/band", label: "Band", pwid: "nav-band" },
] as const

function NavLink({ to, label, pwid }: { to: string; label: string; pwid: string }) {
  const router = useRouterState()
  const isActive =
    to === "/" ? router.location.pathname === "/" : router.location.pathname.startsWith(to)

  return (
    <Link
      to={to}
      data-pwid={pwid}
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

function UserMenu() {
  const { user } = useAuth()
  const router = useRouter()

  if (!user) {
    return (
      <Link
        to="/login"
        data-pwid="nav-signin"
        className="px-3 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        Sign in
      </Link>
    )
  }

  return (
    <button
      data-pwid="nav-user-avatar"
      onClick={() => logoutFn().then(() => router.invalidate())}
      className="size-8 rounded-full bg-[var(--color-amber-accent)] flex items-center justify-center text-xs font-bold text-zinc-950 hover:brightness-110 transition cursor-pointer ml-1"
      title={user.username}
    >
      {user.username[0]?.toUpperCase()}
    </button>
  )
}

export function Nav() {
  const { user } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <nav data-pwid="nav" className="sticky top-0 z-40 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-1">
          <Link
            to="/"
            data-pwid="nav-logo"
            className="flex items-center gap-2 mr-4 shrink-0"
          >
            <span className="text-[var(--color-amber-accent)] font-bold text-lg tracking-tight">
              SetList
            </span>
          </Link>

          {user && (
            <div data-pwid="nav-links" className="hidden md:flex items-center gap-0.5">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} {...item} />
              ))}
            </div>
          )}

          <div className="flex-1" />

          <div className="hidden md:flex items-center gap-1.5">
            {user && <BandSwitcher />}
            <ThemeToggle />
            <UserMenu />
          </div>

          <div className="flex md:hidden items-center gap-1.5">
            <ThemeToggle />
            <button
              data-pwid="nav-hamburger"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="size-8 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              aria-label="Toggle menu"
            >
              {mobileOpen ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div data-pwid="nav-mobile-menu" className="md:hidden border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            <div className="px-4 py-3 space-y-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  data-pwid={`mobile-${item.pwid}`}
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
