import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components"
import { useActiveBandId, useAuth } from "./AuthContext"

const bandItemClass =
  "flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left text-zinc-300 cursor-pointer outline-none transition-colors data-[focused]:bg-[var(--color-surface-hover)] data-[focused]:text-zinc-100 data-[hovered]:bg-[var(--color-surface-hover)] data-[hovered]:text-zinc-100"

const createBandItemClass =
  "flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-500 cursor-pointer outline-none transition-colors data-[focused]:text-zinc-300 data-[focused]:bg-[var(--color-surface-hover)] data-[hovered]:text-zinc-300 data-[hovered]:bg-[var(--color-surface-hover)]"

export function BandSwitcher() {
  const { bands } = useAuth()
  const activeBandId = useActiveBandId()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const navigate = useNavigate()

  const currentBand = bands.find((band) => band.id === activeBandId) ?? null

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

  // Switching keeps the section the user is in, so browsing songs and switching
  // bands lands on the other band's songs rather than its settings.
  const inSongs = pathname.startsWith(`/band/${currentBand.id}/songs`)

  const switchTo = (bandId: string) => {
    if (inSongs) {
      void navigate({ to: "/band/$bandId/songs", params: { bandId } })
    } else {
      void navigate({ to: "/band/$bandId", params: { bandId } })
    }
  }

  return (
    <div data-pwid="band-switcher">
      <MenuTrigger>
        <Button
          data-pwid="band-switcher-toggle"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-[var(--color-amber-accent)] [&[data-pressed]>svg]:rotate-180"
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
            className="transition-transform"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Button>
        <Popover
          placement="bottom start"
          offset={4}
          className="w-56 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-xl shadow-black/30 py-1 z-50 outline-none"
        >
          <Menu className="outline-none">
            {bands.map((band) => (
              <MenuItem
                key={band.id}
                textValue={band.name}
                onAction={() => switchTo(band.id)}
                className={bandItemClass}
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
              </MenuItem>
            ))}
            <Separator className="mt-1 border-t border-[var(--color-border-subtle)]" />
            <MenuItem
              textValue="Create band"
              onAction={() => navigate({ to: "/band/new" })}
              className={createBandItemClass}
            >
              <span className="size-5 rounded border border-dashed border-zinc-600 flex items-center justify-center text-xs text-zinc-500">
                +
              </span>
              Create band
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  )
}
