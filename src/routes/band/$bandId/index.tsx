import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { bands, type BandInfo, type BandMember } from "~/api/client"
import { useAuth } from "~/components/AuthContext"
import {
  SubmitButton,
  TextField,
  TextAreaField,
  errorMessage,
  fieldError,
} from "~/components/form"

export const Route = createFileRoute("/band/$bandId/")({
  loader: async ({ params }) => ({ members: await bands.members(params.bandId) }),
  component: BandPage,
})

function BandPage() {
  const { bandId } = Route.useParams()
  const { members } = Route.useLoaderData()
  const { user, bands: myBands } = useAuth()
  const band = myBands.find((b) => b.id === bandId)
  const isOwner =
    user !== null && members.some((m) => m.user_id === user.id && m.is_owner)

  return (
    <div data-pwid="band-page" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{band?.name ?? "Band"}</h1>
          <p className="text-sm text-zinc-500 mt-1">Band settings and members</p>
        </div>
        {band && (
          <Link
            to="/b/$slug"
            params={{ slug: band.slug }}
            data-pwid="band-public-profile-link"
            className="text-sm text-[var(--color-amber-accent)] hover:underline"
          >
            Public profile
          </Link>
        )}
      </div>

      {band && isOwner && <PublicProfileSettings band={band} />}
      <MembersList members={members} />
      <InviteForm bandId={bandId} />
    </div>
  )
}

function PublicProfileSettings({ band }: { band: BandInfo }) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const form = useForm({
    defaultValues: {
      description: band.description ?? "",
      show_members_publicly: band.show_members_publicly,
      show_gig_dates_publicly: band.show_gig_dates_publicly,
    },
    onSubmit: async ({ value }) => {
      setServerError(null)
      setSaved(false)
      try {
        await bands.update(band.id, {
          description: value.description.trim() === "" ? null : value.description.trim(),
          show_members_publicly: value.show_members_publicly,
          show_gig_dates_publicly: value.show_gig_dates_publicly,
        })
        await router.invalidate()
        setSaved(true)
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <section
      data-pwid="band-public-settings"
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-zinc-300">Public profile</h2>
        <p className="text-xs text-zinc-500 mt-1">
          Anyone can open /b/{band.slug}. Name is always public; choose what else
          to show.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
        className="space-y-4"
      >
        {serverError && (
          <div
            data-pwid="band-public-settings-error"
            className="text-sm text-red-400"
          >
            {serverError}
          </div>
        )}
        {saved && (
          <div
            data-pwid="band-public-settings-saved"
            className="text-sm text-emerald-400"
          >
            Public profile saved
          </div>
        )}

        <form.Field name="description">
          {(field) => (
            <TextAreaField
              label="Description"
              pwid="band-public-description"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              placeholder="A short public blurb about the band"
              rows={3}
            />
          )}
        </form.Field>

        <form.Field name="show_members_publicly">
          {(field) => (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                data-pwid="band-public-show-members"
                type="checkbox"
                checked={field.state.value}
                onChange={(e) => field.handleChange(e.target.checked)}
                className="rounded border-[var(--color-border-subtle)]"
              />
              <span>Show members on the public page</span>
            </label>
          )}
        </form.Field>

        <form.Field name="show_gig_dates_publicly">
          {(field) => (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                data-pwid="band-public-show-gigs"
                type="checkbox"
                checked={field.state.value}
                onChange={(e) => field.handleChange(e.target.checked)}
                className="rounded border-[var(--color-border-subtle)]"
              />
              <span>Show setlist gig dates on the public page</span>
            </label>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <SubmitButton
              pwid="band-public-settings-submit"
              disabled={!canSubmit || isSubmitting}
              pending={isSubmitting}
              label="Save public profile"
              pendingLabel="Saving…"
            />
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}

function MembersList({ members }: { members: readonly BandMember[] }) {
  return (
    <div data-pwid="band-members" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] divide-y divide-[var(--color-border-subtle)]">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-300">Members</h2>
      </div>
      {members.map((m) => (
        <div key={m.id} className="px-4 py-3 flex items-center gap-3">
          <div className="size-8 rounded-full bg-zinc-800 border border-[var(--color-border-subtle)] flex items-center justify-center text-xs font-medium text-zinc-400">
            {(m.name ?? m.username)[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{m.name ?? m.username}</div>
            <div className="text-xs text-zinc-500">@{m.username}</div>
          </div>
          {m.is_owner && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-amber-accent)]/10 text-[var(--color-amber-accent)] font-medium">
              Owner
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

const Invitee = S.toStandardSchemaV1(S.NonEmptyString)

function InviteForm({ bandId }: { bandId: string }) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const form = useForm({
    defaultValues: { invitee: "" },
    onSubmit: async ({ value }) => {
      setServerError(null)
      setSent(false)

      const invitee = value.invitee.trim()
      try {
        await bands.invite(
          bandId,
          invitee.includes("@") ? { email: invitee } : { username: invitee },
        )
        form.reset()
        setSent(true)
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-3">
      <h2 className="text-sm font-semibold text-zinc-300">Invite a member</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
        className="flex gap-2 items-start"
      >
        <div className="flex-1">
          <form.Field name="invitee" validators={{ onChange: Invitee }}>
            {(field) => (
              <TextField
                label="Username or email"
                pwid="band-invite-input"
                value={field.state.value}
                onChange={field.handleChange}
                error={fieldError(field)}
                required
              />
            )}
          </form.Field>
        </div>
        <div className="pt-6">
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <SubmitButton
                pwid="band-invite-submit"
                disabled={!canSubmit || isSubmitting}
                pending={isSubmitting}
                label="Invite"
                pendingLabel="Inviting…"
              />
            )}
          </form.Subscribe>
        </div>
      </form>
      {serverError && (
        <div data-pwid="band-invite-error" className="text-sm text-red-400">{serverError}</div>
      )}
      {sent && (
        <div data-pwid="band-invite-success" className="text-sm text-green-400">Invitation sent!</div>
      )}
    </div>
  )
}
