import { useEffect, useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Option, Schema as S } from "effect"
import {
  Button,
  ComboBox,
  GridList,
  GridListItem,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  useDragAndDrop,
  type Key,
} from "react-aria-components"
import { gigs, setlists, type GigInfo, type SetlistInfo } from "~/api/client"
import { GigDetails } from "~/api/contracts"
import { SubmitButton, TextAreaField, TextField, errorMessage, fieldError } from "~/components/form"
import { useAuth } from "~/components/AuthContext"
import { gigLabel } from "~/components/gig-label"
import { useLive } from "~/components/live"
import { Viewers } from "~/components/Viewers"
import { moveTo, stepMove, type Move } from "~/components/arrangement"
import { NameForm, listLength } from "~/components/SetlistSummary"
import { formatGigDate, formatTimeOfDay, timeInputValue } from "~/components/time"

export const Route = createFileRoute("/band/$bandId/gigs/$gigId")({
  loader: async ({ params }) => {
    const [gig, bandSetlists] = await Promise.all([gigs.get(params.gigId), setlists.byBand(params.bandId)])
    return { gig, bandSetlists }
  },
  component: GigPage,
})

function GigPage() {
  const { bandId, gigId } = Route.useParams()
  const { gig, bandSetlists } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState<string | null>(null)
  const refresh = () => router.invalidate()

  // A write to the gig or to any setlist it plays reloads it here, and says who wrote.
  const me = useAuth().user?.username
  const [changedBy, setChangedBy] = useState<string | null>(null)
  const { client, viewers } = useLive({ kind: "gig", id: gigId }, { mode: "viewing", at: null }, (by) => {
    void refresh()
    if (by !== null && by !== me) setChangedBy(by)
  })
  useEffect(() => {
    if (changedBy === null) return
    const timer = setTimeout(() => setChangedBy(null), 6000)
    return () => clearTimeout(timer)
  }, [changedBy])

  const act = async (write: () => Promise<unknown>) => {
    setError(null)
    try {
      await write()
    } catch (e) {
      setError(errorMessage(e))
    }
    await refresh()
  }

  const songCount = gig.setlists.reduce((sum, setlist) => sum + setlist.song_count, 0)
  const seconds = gig.setlists.reduce((sum, setlist) => sum + setlist.duration_seconds, 0)

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 data-pwid="gig-label" className="text-2xl font-bold tracking-tight">{gigLabel(gig)}</h1>
          <p data-pwid="gig-summary" className="text-sm text-zinc-500 mt-1">
            {[
              gig.venue !== null && gig.gig_date !== null ? formatGigDate(gig.gig_date) : null,
              gig.load_in_time === null ? null : `Load-in ${formatTimeOfDay(gig.load_in_time)}`,
              gig.performance_time === null ? null : `Performance ${formatTimeOfDay(gig.performance_time)}`,
              listLength({ song_count: songCount, duration_seconds: seconds }),
            ]
              .flatMap((part) => (part === null ? [] : [part]))
              .join(" · ")}
          </p>
          {gig.address && <p data-pwid="gig-address" className="text-sm text-zinc-500 mt-0.5 whitespace-pre-line">{gig.address}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <Link
            to="/band/$bandId/gigs/$gigId/perform"
            params={{ bandId, gigId }}
            data-pwid="gig-perform"
            className="px-3 py-1.5 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-xs font-semibold"
          >
            Perform
          </Link>
          <Link
            to="/band/$bandId/gigs"
            params={{ bandId }}
            data-pwid="gig-back"
            className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300"
          >
            All gigs
          </Link>
        </div>
      </div>

      <Viewers viewers={viewers} me={client} />
      {changedBy !== null && (
        <div data-pwid="gig-changed" role="status" className="rounded-md border border-[var(--color-amber-accent)]/40 bg-[var(--color-amber-accent)]/10 px-3 py-2 text-sm text-zinc-200">
          {changedBy} changed this gig. You are looking at the latest version.
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Setlists</h2>
          <p className="text-sm text-zinc-500">The gig plays them top to bottom. Drag a handle, or use ↑ and ↓, to change the order.</p>
        </div>
        <GigSetlists bandId={bandId} gig={gig} act={act} onCopy={setCopying} />
        {gig.setlists
          .filter((setlist) => setlist.id === copying)
          .map((setlist) => (
            <CopyForGig
              key={setlist.id}
              gig={gig}
              setlist={setlist}
              onCopied={async () => {
                setCopying(null)
                await refresh()
              }}
              onCancel={() => setCopying(null)}
            />
          ))}
        <AddSetlist gig={gig} bandSetlists={bandSetlists} act={act} />
        {error && <div data-pwid="gig-error" className="text-sm text-red-400">{error}</div>}
      </section>

      <GigDetailsForm key={gig.updated_at.getTime()} bandId={bandId} gig={gig} onSaved={refresh} />
    </div>
  )
}

/**
 * The gig's setlists in play order; each one is reordered by drag, by keyboard
 * drag (Enter on the handle) or by its arrows. A setlist that other gigs also
 * play offers `onCopy`, which asks for a copy for this gig only.
 */
function GigSetlists({
  bandId,
  gig,
  act,
  onCopy,
}: {
  bandId: string
  gig: GigInfo
  act: (write: () => Promise<unknown>) => Promise<void>
  onCopy: (setlistId: string) => void
}) {
  const ids = gig.setlists.map((setlist) => setlist.id)
  const move = (found: Option.Option<Move>) =>
    Option.match(found, {
      onNone: () => undefined,
      onSome: (step) => void act(() => gigs.moveSetlist(gig.id, step)),
    })
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ "text/plain": String(key) })),
    onReorder: (event) => {
      const id = String([...event.keys][0])
      const others = ids.filter((other) => other !== id)
      const target = others.indexOf(String(event.target.key))
      move(moveTo(ids, id, event.target.dropPosition === "after" ? target + 1 : target))
    },
  })
  const button = "px-2 py-1 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-amber-accent)]"

  return (
    <GridList
      aria-label="Setlists this gig plays"
      data-pwid="gig-setlists"
      items={gig.setlists}
      dragAndDropHooks={dragAndDropHooks}
      renderEmptyState={() => (
        <p data-pwid="gig-setlists-empty" className="rounded-lg border border-dashed border-[var(--color-border-subtle)] p-6 text-center text-sm text-zinc-500">
          This gig plays no setlists yet. Add one below.
        </p>
      )}
      className="space-y-2 outline-none"
    >
      {(setlist) => {
        const index = ids.indexOf(setlist.id)
        return (
          <GridListItem
            id={setlist.id}
            textValue={setlist.name}
            data-pwid="gig-setlist"
            className="flex items-center gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-[var(--color-amber-accent)] data-[dragging]:opacity-50 data-[drop-target]:border-[var(--color-amber-accent)]"
          >
            <Button slot="drag" aria-label={`Drag ${setlist.name}`} className="cursor-grab text-zinc-600 outline-none focus-visible:text-[var(--color-amber-accent)]">⋮⋮</Button>
            <span className="text-xs text-zinc-500 w-12 shrink-0">Set {index + 1}</span>
            <div className="min-w-0 flex-1">
              <Link
                to="/band/$bandId/setlists/$setlistId"
                params={{ bandId, setlistId: setlist.id }}
                data-pwid="gig-setlist-name"
                className="font-medium truncate hover:underline"
              >
                {setlist.name}
              </Link>
              <div className="text-xs text-zinc-500">
                {listLength(setlist)}
                {setlist.gig_count > 1 && (
                  <span data-pwid="gig-setlist-shared"> · Also in {otherGigs(setlist.gig_count - 1)}</span>
                )}
              </div>
            </div>
            {setlist.gig_count > 1 && (
              <Button
                data-pwid="gig-setlist-copy"
                aria-label={`Copy ${setlist.name} for this gig only`}
                onPress={() => onCopy(setlist.id)}
                className={button}
              >
                Copy for this gig
              </Button>
            )}
            <Button data-pwid="gig-setlist-up" aria-label={`Move ${setlist.name} up`} isDisabled={index === 0} onPress={() => move(stepMove(ids, setlist.id, -1))} className={`${button} disabled:opacity-30`}>↑</Button>
            <Button data-pwid="gig-setlist-down" aria-label={`Move ${setlist.name} down`} isDisabled={index === ids.length - 1} onPress={() => move(stepMove(ids, setlist.id, 1))} className={`${button} disabled:opacity-30`}>↓</Button>
            <Button
              data-pwid="gig-setlist-remove"
              aria-label={`Take ${setlist.name} out of this gig`}
              onPress={() => void act(() => gigs.removeSetlist(gig.id, setlist.id))}
              className={`${button} !border-red-500/20 !text-red-400`}
            >
              Remove
            </Button>
          </GridListItem>
        )
      }}
    </GridList>
  )
}

/**
 * Names this gig's own copy of a shared setlist. The copy takes the setlist's
 * place in this gig; the other gigs keep playing the original.
 */
function CopyForGig({
  gig,
  setlist,
  onCopied,
  onCancel,
}: {
  gig: GigInfo
  setlist: GigInfo["setlists"][number]
  onCopied: () => Promise<void>
  onCancel: () => void
}) {
  return (
    <div data-pwid="gig-copy-panel" className="rounded-lg border border-[var(--color-amber-accent)]/40 p-3 space-y-2">
      <p className="text-sm text-zinc-300">
        {setlist.name} is also in {otherGigs(setlist.gig_count - 1)}. A copy changes only this gig; the others keep {setlist.name}.
      </p>
      <NameForm
        pwid="gig-copy"
        label="Name of the copy"
        placeholder="Name of the copy"
        submitLabel="Copy for this gig"
        initial={`${setlist.name} (${gigLabel(gig)})`}
        autoFocus
        onSubmit={async (name) => {
          await gigs.copySetlist(gig.id, setlist.id, name)
          await onCopied()
        }}
      />
      <button type="button" data-pwid="gig-copy-cancel" onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer">
        Cancel
      </button>
    </div>
  )
}

const otherGigs = (count: number) => (count === 1 ? "1 other gig" : `${count} other gigs`)

/**
 * Picking one of the band's setlists adds it to the gig; a new name and Enter
 * makes an empty setlist and adds that. A setlist the gig already plays is not offered.
 */
function AddSetlist({
  gig,
  bandSetlists,
  act,
}: {
  gig: GigInfo
  bandSetlists: ReadonlyArray<SetlistInfo>
  act: (write: () => Promise<unknown>) => Promise<void>
}) {
  const playing = new Set(gig.setlists.map((setlist) => setlist.id))
  const offered = bandSetlists.filter((setlist) => !playing.has(setlist.id))
  const [text, setText] = useState("")
  const name = text.trim()
  // A typed name that is already one of the band's setlists adds that one rather than a second of the same name.
  const named = offered.find((setlist) => setlist.name === name)

  const add = (setlistId: string | null) => {
    setText("")
    void act(async () => gigs.addSetlist(gig.id, setlistId ?? (await setlists.create({ band_id: gig.band_id, name })).id))
  }

  return (
    <form
      data-pwid="gig-add-setlist"
      onSubmit={(e) => {
        e.preventDefault()
        if (name !== "") add(named?.id ?? null)
      }}
      className="flex gap-2 items-start"
    >
      <ComboBox
        aria-label="Setlist to add"
        allowsCustomValue
        menuTrigger="focus"
        inputValue={text}
        onInputChange={setText}
        selectedKey={null}
        onSelectionChange={(key: Key | null) => {
          if (key !== null) add(String(key))
        }}
        items={offered}
        className="flex-1 min-w-0"
      >
        <Input
          data-pwid="gig-add-setlist-name"
          placeholder={offered.length > 0 ? "Pick a setlist, or type a name for a new one" : "Type a name for a new setlist"}
          className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm placeholder:text-zinc-600 outline-none focus:border-[var(--color-amber-accent)]"
        />
        <Popover className="w-[var(--trigger-width)] rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-lg">
          <ListBox data-pwid="gig-add-setlist-options" className="max-h-64 overflow-y-auto py-1 outline-none">
            {(setlist: SetlistInfo) => (
              <ListBoxItem
                id={setlist.id}
                textValue={setlist.name}
                data-pwid="gig-add-setlist-option"
                className="flex justify-between gap-3 px-3 py-1.5 text-sm cursor-pointer outline-none text-zinc-300 data-[focused]:bg-[var(--color-amber-accent)]/15 data-[focused]:text-zinc-100"
              >
                <span className="truncate">{setlist.name}</span>
                <span className="text-zinc-500 shrink-0">{listLength(setlist)}</span>
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>
      <button
        type="submit"
        data-pwid="gig-add-setlist-submit"
        disabled={name === ""}
        className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shrink-0"
      >
        {name === "" || named ? "Add" : "Create and add"}
      </button>
    </form>
  )
}

/** Where and when the gig is, and the band's notes. Delete is here because it is the end of the gig's details. */
function GigDetailsForm({ bandId, gig, onSaved }: { bandId: string; gig: GigInfo; onSaved: () => Promise<void> }) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [initial] = useState<(typeof GigDetails)["Encoded"]>(() => ({
    venue: gig.venue,
    gig_date: gig.gig_date,
    address: gig.address,
    load_in_time: gig.load_in_time === null ? null : timeInputValue(gig.load_in_time),
    performance_time: gig.performance_time === null ? null : timeInputValue(gig.performance_time),
    notes: gig.notes,
  }))

  const form = useForm({
    defaultValues: initial,
    validators: { onChange: S.toStandardSchemaV1(GigDetails) },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        await gigs.update(gig.id, value)
        await onSaved()
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  const remove = async () => {
    setServerError(null)
    try {
      await gigs.remove(gig.id)
      await router.navigate({ to: "/band/$bandId/gigs", params: { bandId } })
    } catch (e) {
      setServerError(errorMessage(e))
    }
  }

  const nullable = (value: string) => (value === "" ? null : value)

  return (
    <form
      data-pwid="gig-details"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-3"
    >
      <h2 className="text-sm font-semibold text-zinc-300">Gig details</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="venue">
          {(field) => (
            <TextField label="Venue" pwid="gig-venue" value={field.state.value ?? ""} onChange={(v) => field.handleChange(nullable(v))} error={fieldError(field)} placeholder="The Echo Room" />
          )}
        </form.Field>
        <form.Field name="gig_date">
          {(field) => (
            <TextField label="Date" pwid="gig-date" type="date" value={field.state.value ?? ""} onChange={(v) => field.handleChange(nullable(v))} error={fieldError(field)} />
          )}
        </form.Field>
        <form.Field name="load_in_time">
          {(field) => (
            <TextField label="Load-in time" pwid="gig-load-in" type="time" value={field.state.value ?? ""} onChange={(v) => field.handleChange(nullable(v))} error={fieldError(field)} />
          )}
        </form.Field>
        <form.Field name="performance_time">
          {(field) => (
            <TextField label="Performance time" pwid="gig-performance" type="time" value={field.state.value ?? ""} onChange={(v) => field.handleChange(nullable(v))} error={fieldError(field)} />
          )}
        </form.Field>
      </div>
      <form.Field name="address">
        {(field) => (
          <TextAreaField label="Address" pwid="gig-address-field" rows={2} value={field.state.value ?? ""} onChange={(v) => field.handleChange(nullable(v))} error={fieldError(field)} placeholder="123 Main St" />
        )}
      </form.Field>
      <form.Field name="notes">
        {(field) => (
          <TextAreaField
            label="Notes (only the band sees these)"
            pwid="gig-notes"
            rows={2}
            value={field.state.value ?? ""}
            onChange={(v) => field.handleChange(nullable(v))}
            error={fieldError(field)}
            placeholder="Parking round back; borrow the house kit"
          />
        )}
      </form.Field>

      {serverError && <div data-pwid="gig-details-error" className="text-sm text-red-400">{serverError}</div>}

      <div className="flex items-center justify-between gap-3">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <SubmitButton pwid="gig-save" disabled={!canSubmit || isSubmitting} pending={isSubmitting} label="Save details" pendingLabel="Saving…" />
          )}
        </form.Subscribe>
        <button type="button" data-pwid="gig-delete" onClick={remove} className="px-3 py-1.5 rounded-md border border-red-500/20 text-xs text-red-400 cursor-pointer">
          Delete gig
        </button>
      </div>
      <p className="text-xs text-zinc-500">Deleting the gig keeps its setlists.</p>
    </form>
  )
}
