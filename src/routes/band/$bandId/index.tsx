import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import {
  bands,
  type BandInfo,
  type BandMember,
  type PendingInvitationInfo,
  type PublicBandProfileInfo,
} from "~/api/client"
import { Avatar } from "~/components/Avatar"
import { BandPage } from "~/components/BandPage"
import { themeOptions } from "~/components/band-theme"
import { ThemeOptionFields } from "~/components/ThemeOptionFields"
import { DEFAULT_THEME, STARTER_THEMES } from "~/components/starter-themes"
import { useAuth } from "~/components/AuthContext"
import {
  SubmitButton,
  TextField,
  TextAreaField,
  errorMessage,
  fieldError,
} from "~/components/form"

export const Route = createFileRoute("/band/$bandId/")({
  loader: async ({ params, context }) => {
    // The preview shows the lists as the public page last served them.
    const band = context.bands.find((b) => b.id === params.bandId)
    const [members, saved] = await Promise.all([
      bands.members(params.bandId),
      band?.is_public ? bands.publicProfile(band.slug) : null,
    ])
    const user = context.user
    const isOwner =
      user !== null && members.some((m) => m.user_id === user.id && m.is_owner)
    // Only the owner may call the pending list; a member would get DNIED.
    const pending = isOwner ? await bands.pendingInvitations(params.bandId) : []
    return { members, saved, pending, isOwner }
  },
  component: BandSettings,
})

function BandSettings() {
  const { bandId } = Route.useParams()
  const { members, saved, pending, isOwner } = Route.useLoaderData()
  const { bands: myBands } = useAuth()
  const band = myBands.find((b) => b.id === bandId)

  return (
    <div data-pwid="band-page" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{band?.name ?? "Band"}</h1>
          <p className="text-sm text-zinc-500 mt-1">Band settings and members</p>
        </div>
        {band?.is_public && (
          <Link
            to="/b/$slug"
            params={{ slug: band.slug }}
            data-pwid="band-public-profile-link"
            className="text-sm text-[var(--color-amber-accent)] hover:underline"
          >
            Public page
          </Link>
        )}
      </div>

      {band && isOwner && <PublicProfile band={band} saved={saved} />}
      <MembersList bandId={bandId} members={members} isOwner={isOwner} />
      {isOwner && <PendingInvitations bandId={bandId} invitations={pending} />}
      {isOwner && <InviteForm bandId={bandId} />}
    </div>
  )
}

/**
 * The owner's switch for the band's public page, and its editor while it is on.
 * The switch saves at once; turning the page off keeps its look and lists, so
 * turning it on again brings the same page back.
 */
function PublicProfile({ band, saved }: { band: BandInfo; saved: PublicBandProfileInfo | null }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setPublic = async (isPublic: boolean) => {
    setPending(true)
    setError(null)
    try {
      await bands.update(band.id, { is_public: isPublic })
      await router.invalidate()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      data-pwid="band-public-profile"
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-300">Public profile</h2>
          <p className="text-xs text-zinc-500 mt-1">
            {band.is_public
              ? `Anyone can open /b/${band.slug}. The name is always shown; choose what else to show and how it looks.`
              : "Give the band a page anyone can open, with the look and lists you choose."}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm cursor-pointer">
          <span>Enable public profile</span>
          <button
            type="button"
            role="switch"
            aria-checked={band.is_public}
            data-pwid="band-public-enable"
            disabled={pending}
            onClick={() => void setPublic(!band.is_public)}
            className="group relative h-6 w-11 shrink-0 rounded-full bg-zinc-600 transition-colors aria-checked:bg-[var(--color-amber-accent)] disabled:opacity-60 cursor-pointer"
          >
            <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform group-aria-checked:translate-x-5" />
          </button>
        </label>
      </div>
      {error && (
        <div data-pwid="band-public-enable-error" className="text-sm text-red-400">
          {error}
        </div>
      )}
      {band.is_public && <PublicPageSettings band={band} saved={saved} />}
    </section>
  )
}

function PublicPageSettings({
  band,
  saved: savedProfile,
}: {
  band: BandInfo
  saved: PublicBandProfileInfo | null
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const form = useForm({
    defaultValues: {
      description: band.description ?? "",
      show_members_publicly: band.show_members_publicly,
      show_gig_dates_publicly: band.show_gig_dates_publicly,
      show_songs_publicly: band.show_songs_publicly,
      page_theme: band.page_theme ?? DEFAULT_THEME,
      page_options: band.page_options,
    },
    onSubmit: async ({ value }) => {
      setServerError(null)
      setSaved(false)
      try {
        await bands.update(band.id, {
          ...value,
          description: trimmedOrNull(value.description),
          page_options: declaredOptions(value.page_theme, value.page_options),
        })
        await router.invalidate()
        setSaved(true)
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  const startFrom = (starter: (typeof STARTER_THEMES)[number]) => {
    const current = form.getFieldValue("page_theme")
    const edited = !STARTER_THEMES.some((t) => t.source === current)
    if (edited && !window.confirm(`Replace your theme with ${starter.label}? Your changes to the theme HTML will be lost.`)) {
      return
    }
    form.setFieldValue("page_theme", starter.source)
    form.setFieldValue("page_options", {})
    setSaved(false)
  }

  return (
    <div data-pwid="band-public-settings" className="grid gap-6 lg:grid-cols-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
        onChange={() => setSaved(false)}
        className="space-y-5 min-w-0"
      >
        <div className="space-y-1">
          <form.Field name="description">
            {(field) => (
              <TextAreaField
                label="Description (Markdown)"
                pwid="band-public-description"
                value={field.state.value}
                onChange={field.handleChange}
                error={fieldError(field)}
                placeholder={"**Loud** since 2019. New single out now:\n\nhttps://www.youtube.com/watch?v=…"}
                rows={8}
              />
            )}
          </form.Field>
          <p data-pwid="band-public-description-help" className="text-xs text-zinc-500">
            Markdown works: **bold**, links, lists, pictures. Put a YouTube, Spotify, Vimeo, TikTok or
            Instagram link on its own line — or paste its embed code — and it shows as a player.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-300 mb-2">Show</legend>
          {SHOWN_LISTS.map(({ name, pwid, label }) => (
            <form.Field key={name} name={name}>
              {(field) => (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    data-pwid={pwid}
                    type="checkbox"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                    className="rounded border-[var(--color-border-subtle)]"
                  />
                  <span>{label}</span>
                </label>
              )}
            </form.Field>
          ))}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-zinc-300 mb-2">Theme</legend>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-500">Start from</span>
            {STARTER_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.blurb}
                data-pwid={`band-public-starter-${t.id}`}
                onClick={() => startFrom(t)}
                className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1 hover:border-zinc-500 cursor-pointer"
              >
                {t.label}
              </button>
            ))}
          </div>

          <form.Subscribe selector={(state) => [state.values.page_theme, state.values.page_options] as const}>
            {([theme, chosen]) => (
              <ThemeOptionFields
                options={themeOptions(theme)}
                chosen={chosen}
                pwidPrefix="band-public-option-"
                onChange={(key, value) => {
                  form.setFieldValue("page_options", { ...chosen, [key]: value })
                  setSaved(false)
                }}
              />
            )}
          </form.Subscribe>

          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">Edit theme HTML</summary>
            <form.Field name="page_theme">
              {(field) => (
                <textarea
                  data-pwid="band-public-theme-source"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  spellCheck={false}
                  rows={18}
                  className="mt-2 w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2 font-mono text-xs leading-relaxed"
                />
              )}
            </form.Field>
          </details>

          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">Theme tags</summary>
            <dl className="mt-2 space-y-2 text-xs">
              {THEME_TAGS.map(([tags, meaning]) => (
                <div key={tags}>
                  <dt className="font-mono text-zinc-300">{tags}</dt>
                  <dd className="text-zinc-500">{meaning}</dd>
                </div>
              ))}
            </dl>
          </details>
        </fieldset>

        {serverError && (
          <div data-pwid="band-public-settings-error" className="text-sm text-red-400">
            {serverError}
          </div>
        )}
        {saved && (
          <div data-pwid="band-public-settings-saved" className="text-sm text-emerald-400">
            Public page saved
          </div>
        )}

        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <SubmitButton
              pwid="band-public-settings-submit"
              disabled={!canSubmit || isSubmitting}
              pending={isSubmitting}
              label="Save public page"
              pendingLabel="Saving…"
            />
          )}
        </form.Subscribe>
      </form>

      <div data-pwid="band-public-preview" className="space-y-2 lg:sticky lg:top-[var(--stick-top)] lg:self-start">
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <BandPage
              className="h-[34rem] rounded-md border border-[var(--color-border-subtle)]"
              profile={{
                slug: band.slug,
                name: band.name,
                description: trimmedOrNull(values.description),
                page_theme: values.page_theme,
                page_options: values.page_options,
                members: values.show_members_publicly ? (savedProfile?.members ?? []) : [],
                gigs: values.show_gig_dates_publicly ? (savedProfile?.gigs ?? []) : [],
                songs: values.show_songs_publicly ? (savedProfile?.songs ?? []) : [],
              }}
            />
          )}
        </form.Subscribe>
        <p className="text-xs text-zinc-500">
          Preview. A list you just turned on fills in once you save.
        </p>
      </div>
    </div>
  )
}

/** The band's values for the options the theme still declares; values for removed options are dropped. */
function declaredOptions(theme: string, chosen: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    themeOptions(theme).flatMap((o) => (chosen[o.key] === undefined ? [] : [[o.key, chosen[o.key]!]])),
  )
}

const SHOWN_LISTS = [
  { name: "show_gig_dates_publicly", pwid: "band-public-show-gigs", label: "Upcoming gig dates" },
  { name: "show_members_publicly", pwid: "band-public-show-members", label: "Members" },
  { name: "show_songs_publicly", pwid: "band-public-show-songs", label: "Songs (titles and artists)" },
] as const

/** The reference shown under "Theme tags"; `bandScope` in band-theme.ts is what fills them. */
const THEME_TAGS: ReadonlyArray<readonly [string, string]> = [
  ["{BandName} {Description} {DescriptionHTML}", "The band's name and description. {Description} is the Markdown as written; {DescriptionHTML} is it rendered — links and YouTube/Spotify/Vimeo/TikTok/Instagram players included. <block:Description>…</block:Description> shows only when there is one, and .description .embed styles the players (the starter themes show how)."],
  ["<block:Gigs> <block:Gig>", "Gigs shows once when there are upcoming gigs; Gig repeats for each: {GigVenue} {GigDate} {GigDayOfWeek} {GigMonth} {GigDayOfMonth} {GigYear} {GigISODate}."],
  ["<block:Members> <block:Member>", "Each member: {MemberName} {Username} {MemberInitial} {AvatarURL}; <block:Owner> for the owner. AvatarURL can point at a missing picture: <object data=\"{AvatarURL}\">{MemberInitial}</object> shows the initial then."],
  ["<block:Songs> <block:Song>", "Each song: {SongTitle} {SongArtist} {SongNumber}."],
  ["<block:NameWord> <block:NameLetter>", "The band's name word by word, then letter by letter: {Letter}."],
  ["<block:NotName>", "Shows when Name is empty, such as <block:NotAvatarURL> for a member with no picture."],
  ['<meta name="color:Accent" content="#f59e0b">', "Declares an option the band sets above; print it with {color:Accent}. Kinds: color, image (a link, also opens <block:IfAccentImage>), text, and if (<block:IfName> / <block:IfNotName>)."],
  ["Scripts and forms", "Do not run: the theme's own scripts and frames are removed before the page is shown, and forms cannot submit. The players in a description are the only frames. Styles, fonts, images and links work."],
]

function trimmedOrNull(text: string) {
  const trimmed = text.trim()
  return trimmed === "" ? null : trimmed
}

function MembersList({
  bandId,
  members,
  isOwner,
}: {
  bandId: string
  members: readonly BandMember[]
  isOwner: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const remove = async (m: BandMember) => {
    const label = m.name ?? m.username
    if (!window.confirm(`Remove ${label} from the band?`)) return
    setError(null)
    try {
      await bands.removeMember(bandId, m.user_id)
      await router.invalidate()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const makeOwner = async (m: BandMember) => {
    const label = m.name ?? m.username
    if (
      !window.confirm(
        `Make ${label} the owner? The owner role moves to them.`,
      )
    )
      return
    setError(null)
    try {
      await bands.transferOwnership(bandId, m.user_id)
      await router.invalidate()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div data-pwid="band-members" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] divide-y divide-[var(--color-border-subtle)]">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-300">Members</h2>
      </div>
      {members.map((m) => (
        <div key={m.id} className="px-4 py-3 flex items-center gap-3">
          <Avatar
            avatarUrl={m.avatar_url}
            name={m.name}
            username={m.username}
            className="size-8 rounded-full"
            fallbackClassName="bg-zinc-800 border border-[var(--color-border-subtle)] text-xs font-medium text-zinc-400"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{m.name ?? m.username}</div>
            <div className="text-xs text-zinc-500">@{m.username}</div>
          </div>
          {m.is_owner && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-amber-accent)]/10 text-[var(--color-amber-accent)] font-medium">
              Owner
            </span>
          )}
          {isOwner && !m.is_owner && (
            <>
              <button
                type="button"
                data-pwid={`band-member-make-owner-${m.user_id}`}
                className="px-2 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-700 cursor-pointer"
                onClick={() => void makeOwner(m)}
              >
                Make owner
              </button>
              <button
                type="button"
                data-pwid={`band-member-remove-${m.user_id}`}
                className="px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 cursor-pointer"
                onClick={() => void remove(m)}
              >
                Remove
              </button>
            </>
          )}
        </div>
      ))}
      {error && (
        <p data-pwid="band-members-error" className="px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

function PendingInvitations({
  bandId,
  invitations,
}: {
  bandId: string
  invitations: readonly PendingInvitationInfo[]
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  if (invitations.length === 0 && error === null) return null

  const cancel = async (invitation: PendingInvitationInfo) => {
    const label =
      invitation.username !== null
        ? `@${invitation.username}`
        : (invitation.email ?? "this invitation")
    if (!window.confirm(`Cancel the invitation to ${label}?`)) return
    setError(null)
    try {
      await bands.cancelInvitation(bandId, invitation.id)
      await router.invalidate()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div
      data-pwid="band-pending-invitations"
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] divide-y divide-[var(--color-border-subtle)]"
    >
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-300">Pending invitations</h2>
      </div>
      {invitations.map((invitation) => {
        const label =
          invitation.username !== null
            ? `@${invitation.username}`
            : (invitation.email ?? "Invitation")
        return (
          <div
            key={invitation.id}
            data-pwid={`band-pending-invitation-${invitation.id}`}
            className="px-4 py-3 flex items-center gap-3"
          >
            <div className="flex-1 min-w-0 text-sm font-medium truncate">{label}</div>
            <button
              type="button"
              data-pwid={`band-pending-cancel-${invitation.id}`}
              className="px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 cursor-pointer"
              onClick={() => void cancel(invitation)}
            >
              Cancel
            </button>
          </div>
        )
      })}
      {error && (
        <p data-pwid="band-pending-invitations-error" className="px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

const Invitee = S.toStandardSchemaV1(S.NonEmptyString)

function InviteForm({ bandId }: { bandId: string }) {
  const router = useRouter()
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
        await router.invalidate()
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <div
      data-pwid="band-invite-form"
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-3"
    >
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
