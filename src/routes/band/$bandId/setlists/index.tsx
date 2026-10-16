import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { setlists, type SetlistInfo } from "~/api/client"
import { SetlistInsert, type SetlistStatusType } from "~/api/contracts"
import { SelectField, SubmitButton, TextField, errorMessage, fieldError } from "~/components/form"

export const Route = createFileRoute("/band/$bandId/setlists/")({
  loader: async ({ params }) => ({ setlists: await setlists.byBand(params.bandId) }),
  component: SetlistList,
})

const statusOptions: ReadonlyArray<{ value: SetlistStatusType; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "rehearsal", label: "Rehearsal" },
  { value: "final", label: "Final" },
]

const STATUS_BADGE: Record<SetlistStatusType, string> = {
  draft: "bg-zinc-500/10 text-zinc-400",
  rehearsal: "bg-[var(--color-amber-accent)]/10 text-[var(--color-amber-accent)]",
  final: "bg-green-500/10 text-green-400",
}

/** The create payload's shape; `band_id` comes from the route. */
const emptySetlist = (bandId: string): (typeof SetlistInsert)["Encoded"] => ({
  band_id: bandId,
  name: "",
  description: null,
  gig_date: null,
  status: "draft",
})

function SetlistList() {
  const { bandId } = Route.useParams()
  const { setlists: list } = Route.useLoaderData()
  const router = useRouter()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Setlists</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Build a running order for a gig or rehearsal.
        </p>
      </div>

      <NewSetlist
        bandId={bandId}
        onCreated={async () => {
          await router.invalidate()
        }}
      />

      {list.length === 0 ? (
        <div data-pwid="setlists-empty" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center">
          <p className="text-zinc-500 text-sm">No setlists yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((setlist) => (
            <SetlistRow key={setlist.id} bandId={bandId} setlist={setlist} />
          ))}
        </div>
      )}
    </div>
  )
}

function SetlistRow({ bandId, setlist }: { bandId: string; setlist: SetlistInfo }) {
  return (
    <Link
      to="/band/$bandId/setlists/$setlistId"
      params={{ bandId, setlistId: setlist.id }}
      data-pwid="setlist-row"
      className="block rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 hover:border-[var(--color-amber-accent)]/40 transition-colors"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div data-pwid="setlist-row-name" className="font-medium truncate">{setlist.name}</div>
          <div className="text-sm text-zinc-500 mt-0.5">
            {setlist.gig_date ?? "no date"}
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_BADGE[setlist.status]}`}>
          {setlist.status}
        </span>
      </div>
    </Link>
  )
}

function NewSetlist({ bandId, onCreated }: { bandId: string; onCreated: () => Promise<void> }) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [initial] = useState(() => emptySetlist(bandId))

  const form = useForm({
    defaultValues: initial,
    validators: { onChange: S.toStandardSchemaV1(SetlistInsert) },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        await setlists.create(value)
        form.reset()
        await onCreated()
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <form
      data-pwid="setlist-form"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-3"
    >
      <h2 className="text-sm font-semibold text-zinc-300">New setlist</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <form.Field name="name">
          {(field) => (
            <TextField
              label="Name"
              pwid="setlist-name"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              placeholder="Friday gig"
              required
            />
          )}
        </form.Field>

        <form.Field name="gig_date">
          {(field) => (
            <TextField
              label="Gig date"
              pwid="setlist-date"
              type="date"
              value={field.state.value ?? ""}
              onChange={(value) => field.handleChange(value === "" ? null : value)}
              error={fieldError(field)}
            />
          )}
        </form.Field>

        <form.Field name="status">
          {(field) => (
            <SelectField
              label="Status"
              pwid="setlist-status"
              value={field.state.value}
              onChange={(value) => {
                if (value !== null) field.handleChange(value)
              }}
              options={statusOptions}
              error={fieldError(field)}
            />
          )}
        </form.Field>
      </div>

      {serverError && (
        <div data-pwid="setlist-form-error" className="text-sm text-red-400">{serverError}</div>
      )}

      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <SubmitButton
            pwid="setlist-submit"
            disabled={!canSubmit || isSubmitting}
            pending={isSubmitting}
            label="Create setlist"
            pendingLabel="Creating…"
          />
        )}
      </form.Subscribe>
    </form>
  )
}
