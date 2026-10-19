import { useState } from "react"
import { useHideOnScroll } from "./useHideOnScroll"
import {
  Link,
  useRouter,
  useRouterState,
  type LinkComponentProps,
} from "@tanstack/react-router"
import { BandSwitcher } from "./BandSwitcher"
import { ThemeToggle } from "./ThemeToggle"
import { useActiveBandId, useAuth } from "./AuthContext"
import { auth } from "~/api/client"

type NavItemProps = LinkComponentProps & {
  label: string
  pwid: string
  active: boolean
  onNavigate?: () => void
}

function NavItem({ label, pwid, active, onNavigate, ...link }: NavItemProps) {
  return (
    <Link
      {...link}
      data-pwid={pwid}
      onClick={onNavigate}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? "text-[var(--color-amber-accent)] bg-[var(--color-surface-hover)]"
          : "text-zinc-400 hover:text-zinc-200 hover:bg-[var(--color-surface-hover)]"
      }`}
    >
      {label}
    </Link>
  )
}

/** The band-scoped links, or the create-band form when the user belongs to no
 *  band yet — the paths carry the band id, so there is nothing to link to. */
function NavLinks({
  bandId,
  onNavigate,
}: {
  bandId: string | null
  onNavigate?: () => void
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  if (!bandId) {
    return (
      <NavItem to="/" label="Home" pwid="nav-home" active={pathname === "/"} onNavigate={onNavigate} />
    )
  }

  return (
    <>
      <NavItem to="/" label="Home" pwid="nav-home" active={pathname === "/"} onNavigate={onNavigate} />
      <NavItem
        to="/band/$bandId/setlists"
        params={{ bandId }}
        label="Setlists"
        pwid="nav-setlists"
        active={pathname.startsWith(`/band/${bandId}/setlists`)}
        onNavigate={onNavigate}
      />
      <NavItem
        to="/band/$bandId/songs"
        params={{ bandId }}
        label="Songs"
        pwid="nav-songs"
        active={pathname.startsWith(`/band/${bandId}/songs`)}
        onNavigate={onNavigate}
      />
      <NavItem
        to="/band/$bandId"
        params={{ bandId }}
        label="Band"
        pwid="nav-band"
        active={pathname === `/band/${bandId}` || pathname === `/band/${bandId}/`}
        onNavigate={onNavigate}
      />
    </>
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
      onClick={() => auth.logout().then(() => router.invalidate())}
      className="size-8 rounded-full bg-[var(--color-amber-accent)] flex items-center justify-center text-xs font-bold text-zinc-950 hover:brightness-110 transition cursor-pointer ml-1"
      title={user.username}
    >
      {user.username[0]?.toUpperCase()}
    </button>
  )
}

export function Nav() {
  const { user } = useAuth()
  const bandId = useActiveBandId()
  const [mobileOpen, setMobileOpen] = useState(false)
  const slidOut = useHideOnScroll(mobileOpen)

  return (
    <>
      <nav data-pwid="nav" className={`sticky top-0 z-40 transition-transform duration-300 ${slidOut ? "-translate-y-full" : ""} border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]/80 backdrop-blur-xl`}>
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
              <NavLinks bandId={bandId} />
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
              <div className="space-y-1">
                <NavLinks bandId={bandId} onNavigate={() => setMobileOpen(false)} />
              </div>
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
