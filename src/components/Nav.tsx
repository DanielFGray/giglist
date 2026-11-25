import { useState } from "react"
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components"
import { useHideOnScroll } from "./useHideOnScroll"
import {
  Link,
  useRouter,
  useRouterState,
  type LinkComponentProps,
} from "@tanstack/react-router"
import { BandSwitcher } from "./BandSwitcher"
import { FeedbackDialog } from "./FeedbackDialog"
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

const menuItemClass =
  "block w-full text-left px-3 py-2 text-sm text-zinc-300 cursor-pointer outline-none data-[focused]:bg-[var(--color-surface-hover)] data-[focused]:text-zinc-100 data-[hovered]:bg-[var(--color-surface-hover)] data-[hovered]:text-zinc-100"

function UserMenu() {
  const { user } = useAuth()
  const router = useRouter()
  const [signOutError, setSignOutError] = useState<string | null>(null)

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

  const signOut = () => {
    setSignOutError(null)
    void auth.logout().then(
      () => router.invalidate(),
      (e) => setSignOutError(errorMessage(e)),
    )
  }

  return (
    <div className="relative ml-1">
      <MenuTrigger>
        <Button
          data-pwid="nav-user-avatar"
          aria-label={user.username}
          className="size-8 rounded-full overflow-hidden hover:brightness-110 transition cursor-pointer outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-[var(--color-amber-accent)]"
        >
          <Avatar
            avatarUrl={user.avatar_url}
            name={user.name}
            username={user.username}
            className="size-8 rounded-full"
            fallbackClassName="bg-[var(--color-amber-accent)] text-xs font-bold text-zinc-950"
          />
        </Button>
        <Popover
          placement="bottom end"
          className="w-44 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] py-1 shadow-lg z-50 outline-none"
        >
          <Menu data-pwid="nav-user-menu" className="outline-none">
            <MenuItem
              data-pwid="nav-settings"
              onAction={() => router.navigate({ to: "/settings" })}
              className={menuItemClass}
            >
              Settings
            </MenuItem>
            <MenuItem data-pwid="nav-signout" onAction={signOut} className={menuItemClass}>
              Sign out
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      {/* Rendered outside the Menu so the alert stays visible after it closes. */}
      {signOutError && (
        <p
          role="alert"
          data-pwid="nav-signout-error"
          className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-xs text-red-400 shadow-lg"
        >
          {signOutError}
        </p>
      )}
    </div>
  )
}

export function Nav() {
  const { user } = useAuth()
  const bandId = useActiveBandId()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const slidOut = useHideOnScroll(mobileOpen)
  const router = useRouter()

  const feedbackLink = "px-2 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"

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
            <button type="button" data-pwid="nav-feedback" onClick={() => setFeedbackOpen(true)} className={feedbackLink}>
              Feedback
            </button>
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
              <button
                type="button"
                data-pwid="nav-mobile-feedback"
                onClick={() => {
                  setMobileOpen(false)
                  setFeedbackOpen(true)
                }}
                className="block w-full text-left px-3 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[var(--color-surface-hover)] cursor-pointer"
              >
                Feedback
              </button>
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
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  )
}
