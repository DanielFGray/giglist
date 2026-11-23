import { useEffect, useState } from "react"
import { ComboBox, Input, Label, ListBox, ListBoxItem, Popover, type Key } from "react-aria-components"
import { gigs } from "~/api/client"
import type { VenueSuggestion } from "~/api/gigs"
import { field } from "./ui/field"

type Suggestion = typeof VenueSuggestion.Type

/**
 * The venue input of the gig forms. As the user types, it offers the band's
 * past venues, then map finds. Picking one hands it to `onPick`, which sets
 * the venue and, when the suggestion has one, the address. A typed name that
 * matches nothing stays as typed.
 */
export function VenueField({
  bandId,
  value,
  onChange,
  onPick,
  error,
}: {
  bandId: string
  value: string
  onChange: (value: string) => void
  onPick: (suggestion: Suggestion) => void
  error?: string
}) {
  // Only typed text is searched: a saved venue shown on load, or a picked one, is not.
  const [typed, setTyped] = useState("")
  const { suggestions, status } = useVenueSuggestions(bandId, typed)
  const items = suggestions.map((suggestion, id) => ({ ...suggestion, id }))
  return (
    <ComboBox
      allowsCustomValue
      // Suggestions arrive after the typing pauses, and the list opens only on
      // typing, so it opens empty and says what it is waiting for.
      allowsEmptyCollection
      menuTrigger="input"
      inputValue={value}
      onInputChange={(text) => {
        setTyped(text)
        onChange(text)
      }}
      selectedKey={null}
      onSelectionChange={(key: Key | null) => {
        const picked = key === null ? undefined : items[Number(key)]
        if (picked) onPick(picked)
      }}
      items={items}
      className="block text-sm"
    >
      <Label className="block text-zinc-300 mb-1">Venue</Label>
      <Input data-pwid="gig-venue" placeholder="The Echo Room" className={field({ size: "lg", width: "full", focus: true })} />
      {error && <span data-pwid="gig-venue-error" className="mt-1 block text-xs text-red-400">{error}</span>}
      <Popover className="w-[var(--trigger-width)] rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-lg">
        <ListBox
          data-pwid="gig-venue-options"
          renderEmptyState={() => <p data-pwid="gig-venue-status" className="px-3 py-1.5 text-xs text-zinc-500">{statusText[status]}</p>}
          className="max-h-72 overflow-y-auto py-1 outline-none"
        >
          {(suggestion: (typeof items)[number]) => (
            <ListBoxItem
              id={suggestion.id}
              textValue={suggestion.venue}
              data-pwid="gig-venue-option"
              className="block px-3 py-1.5 cursor-pointer outline-none data-[focused]:bg-[var(--color-amber-accent)]/15"
            >
              <span className="flex justify-between gap-3">
                <span className="truncate text-zinc-200">{suggestion.venue}</span>
                {suggestion.source === "band" && <span className="shrink-0 text-xs text-zinc-500">Played here</span>}
              </span>
              <span className="block truncate text-xs text-zinc-500">{suggestion.address ?? "No address saved"}</span>
            </ListBoxItem>
          )}
        </ListBox>
        {/* OpenStreetMap's licence (ODbL) asks for this credit wherever its data shows. */}
        {items.some((suggestion) => suggestion.source === "map") && (
          <p className="border-t border-[var(--color-border-subtle)] px-3 py-1.5 text-[11px] text-zinc-600">
            Map results © OpenStreetMap contributors
          </p>
        )}
      </Popover>
    </ComboBox>
  )
}

const statusText = {
  short: "Type two letters to see suggestions",
  searching: "Searching…",
  done: "No matches. The venue is saved as typed.",
} as const

/**
 * The suggestions for the typed venue, asked for a quarter second after the
 * typing stops. Under two letters there are none; a failed request counts as
 * none, and an answer for older text never replaces a newer one.
 */
function useVenueSuggestions(bandId: string, text: string) {
  const query = text.trim()
  const [answer, setAnswer] = useState<{ query: string; suggestions: ReadonlyArray<Suggestion> }>({ query: "", suggestions: [] })
  useEffect(() => {
    if (query.length < 2) return
    let current = true
    const timer = setTimeout(() => {
      gigs.suggestVenues(bandId, query).then(
        (suggestions) => current && setAnswer({ query, suggestions }),
        () => current && setAnswer({ query, suggestions: [] }),
      )
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [bandId, query])
  if (query.length < 2) return { suggestions: [], status: "short" as const }
  return { suggestions: answer.suggestions, status: answer.query === query ? ("done" as const) : ("searching" as const) }
}
