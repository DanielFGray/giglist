import { useEffect, useRef, useState } from "react"
import { useHideOnScroll } from "./useHideOnScroll"
import {
  Link,
  useRouter,
  useRouterState,
  type LinkComponentProps,
} from "@tanstack/react-router"
import { BandSwitcher } from "./BandSwitcher"
import { ThemeToggle } from "./ThemeToggle"
import { Avatar } from "./Avatar"
import { useActiveBandId, useAuth } from "./AuthContext"
import { auth } from "~/api/client"
import { errorMessage } from "./form"

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
        to="/band/$bandId/gigs"
        params={{ bandId }}
        label="Gigs"
        pwid="nav-gigs"
        active={pathname.startsWith(`/band/${bandId}/gigs`)}
        onNavigate={onNavigate}
      />
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
  const [open, setOpen] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

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
    <div ref={rootRef} className="relative ml-1">
      <button
        type="button"
        data-pwid="nav-user-avatar"
        onClick={() => setOpen((value) => !value)}
        className="size-8 rounded-full overflow-hidden hover:brightness-110 transition cursor-pointer"
        title={user.username}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Avatar
          avatarUrl={user.avatar_url}
          name={user.name}
          username={user.username}
          className="size-8 rounded-full"
          fallbackClassName="bg-[var(--color-amber-accent)] text-xs font-bold text-zinc-950"
        />
      </button>
      {open && (
        <div
          data-pwid="nav-user-menu"
          className="absolute right-0 mt-2 w-44 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] py-1 shadow-lg z-50"
        >
          <Link
            to="/settings"
            data-pwid="nav-settings"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-zinc-300 hover:bg-[var(--color-surface-hover)] hover:text-zinc-100"
          >
            Settings
          </Link>
          <button
            type="button"
            data-pwid="nav-signout"
            className="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:bg-[var(--color-surface-hover)] hover:text-zinc-100 cursor-pointer"
            onClick={() => {
              setSignOutError(null)
              void auth.logout().then(
                () => {
                  setOpen(false)
                  return router.invalidate()
                },
                (e) => setSignOutError(errorMessage(e)),
              )
            }}
          >
            Sign out
          </button>
          {signOutError && (
            <p role="alert" data-pwid="nav-signout-error" className="px-3 py-2 text-xs text-red-400">
              {signOutError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function Nav() {
  const { user } = useAuth()
  const bandId = useActiveBandId()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const slidOut = useHideOnScroll(mobileOpen)
  const router = useRouter()

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
              GigList
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
              {user && (
                <div className="pt-2 border-t border-[var(--color-border-subtle)] mt-2 space-y-1">
                  <BandSwitcher />
                  <Link
                    to="/settings"
                    data-pwid="nav-mobile-settings"
                    onClick={() => setMobileOpen(false)}
                    className="block px-3 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[var(--color-surface-hover)]"
                  >
                    Settings
                  </Link>
                  <button
                    type="button"
                    data-pwid="nav-mobile-signout"
                    className="w-full text-left px-3 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[var(--color-surface-hover)] cursor-pointer"
                    onClick={() => {
                      setSignOutError(null)
                      void auth.logout().then(
                        () => {
                          setMobileOpen(false)
                          return router.invalidate()
                        },
                        (e) => setSignOutError(errorMessage(e)),
                      )
                    }}
                  >
                    Sign out
                  </button>
                  {signOutError && (
                    <p role="alert" data-pwid="nav-mobile-signout-error" className="px-3 py-1.5 text-xs text-red-400">
                      {signOutError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </nav>
    </>
  )
}
