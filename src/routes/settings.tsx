import { useState } from "react"
import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import {
  auth,
  bands,
  type AuthUser,
  type BandInfo,
  type BandMember,
  type UserEmailInfo,
} from "~/api/client"
import { UpdateProfilePayload, ChangePasswordPayload, AddEmailPayload } from "~/api/auth"
import {
  SubmitButton,
  TextField,
  TextAreaField,
  errorMessage,
  fieldError,
} from "~/components/form"
import { Markdown } from "~/components/Markdown"
import { UserPage } from "~/components/UserPage"
import { ThemeOptionFields } from "~/components/ThemeOptionFields"
import { themeOptions } from "~/components/band-theme"
import { DEFAULT_USER_THEME } from "~/components/user-theme"

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ context }) => {
    if (context.user === null) {
      throw redirect({ to: "/login" })
    }
  },
  loader: async ({ context }) => {
    const emails = await auth.listEmails()
    const memberships = await Promise.all(
      context.bands.map(async (band) => ({
        band,
        members: await bands.members(band.id),
      })),
    )
    return { emails, memberships }
  },
  component: SettingsPage,
})

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** The user's values for the options the theme still declares; values for removed options are dropped. */
function declaredOptions(theme: string, chosen: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    themeOptions(theme).flatMap((o) => (chosen[o.key] === undefined ? [] : [[o.key, chosen[o.key]!]])),
  )
}

/** The reference shown under "Theme tags"; `userScope` in band-theme.ts is what fills them. */
const USER_THEME_TAGS: ReadonlyArray<readonly [string, string]> = [
  ["{DisplayName} {Username} {Initial} {AvatarURL}", "Who you are. DisplayName is your display name, or your username until you set one. <block:AvatarURL>…</block:AvatarURL> shows only with a picture; <block:NotAvatarURL> shows without one."],
  ["{Bio} {BioHTML}", "Your bio. {Bio} is the Markdown as written; {BioHTML} is it rendered — links and YouTube/Spotify/Vimeo/TikTok/Instagram players included. <block:Bio>…</block:Bio> shows only when you have one, and .bio .embed styles the players (the default theme shows how)."],
  ["<block:Bands> <block:Band>", "Bands repeats for each of your bands whose public page is on: {BandName} {BandSlug} {BandURL}."],
  ["<block:NameWord> <block:NameLetter>", "Your display name word by word, then letter by letter: {Letter}."],
  ["<block:NotName>", "Shows when Name is empty, such as <block:NotAvatarURL> for no picture."],
  ['<meta name="color:Accent" content="#f59e0b">', "Declares an option you set above; print it with {color:Accent}. Kinds: color, image (a link, also opens <block:IfAccentImage>), text, and if (<block:IfName> / <block:IfNotName>)."],
  ["Scripts and forms", "Do not run: the theme's own scripts and frames are removed before the page is shown, and forms cannot submit. The players in a bio are the only frames. Styles, fonts, images and links work."],
]

function SettingsPage() {
  const { user } = Route.useRouteContext()
  const { emails, memberships } = Route.useLoaderData()
  // User is guaranteed by beforeLoad; keep a local name for the forms.
  if (user === null) return null

  return (
    <div data-pwid="settings-page" className="mx-auto max-w-lg space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account settings</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Your public profile, password, email addresses, and bands
        </p>
      </div>

      <ProfileSection
        user={user}
        publicBands={memberships
          .filter((m) => m.band.is_public)
          .map((m) => ({ slug: m.band.slug, name: m.band.name }))}
      />
      <PasswordSection />
      <EmailsSection emails={emails} />
      <BandsSection userId={user.id} memberships={memberships} />
      <DeleteAccountSection user={user} memberships={memberships} />
    </div>
  )
}

function ProfileSection({
  user,
  publicBands,
}: {
  user: AuthUser
  publicBands: ReadonlyArray<{ slug: string; name: string }>
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const form = useForm({
    defaultValues: {
      username: user.username,
      name: user.name ?? "",
      bio: user.bio ?? "",
      avatar_url: user.avatar_url ?? "",
      is_public: user.is_public,
      page_theme: user.page_theme ?? DEFAULT_USER_THEME,
      page_options: user.page_options,
    },
    onSubmit: async ({ value }) => {
      setServerError(null)
      setSaved(false)
      try {
        await auth.updateMe(
          S.decodeSync(UpdateProfilePayload)({
            username: value.username.trim(),
            name: blankToNull(value.name),
            bio: blankToNull(value.bio),
            avatar_url: blankToNull(value.avatar_url),
            is_public: value.is_public,
            page_theme: value.page_theme.trim() === "" ? null : value.page_theme,
            page_options: declaredOptions(
              value.page_theme.trim() === "" ? DEFAULT_USER_THEME : value.page_theme,
              value.page_options,
            ),
          }),
        )
        await router.invalidate()
        setSaved(true)
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <section data-pwid="settings-profile" className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
        className="space-y-4"
      >
        {serverError && (
          <div
            data-pwid="settings-profile-error"
            className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400"
          >
            {serverError}
          </div>
        )}
        {saved && (
          <div
            data-pwid="settings-profile-saved"
            className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-400"
          >
            Profile saved
          </div>
        )}

        <form.Field name="username">
          {(field) => (
            <TextField
              label="Username"
              pwid="settings-username"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              autoComplete="username"
              required
            />
          )}
        </form.Field>

        <form.Field name="name">
          {(field) => (
            <TextField
              label="Display name"
              pwid="settings-name"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              autoComplete="name"
              placeholder="Optional"
            />
          )}
        </form.Field>

        <div className="space-y-1">
          <form.Field name="bio">
            {(field) => (
              <TextAreaField
                label="Bio (Markdown)"
                pwid="settings-bio"
                value={field.state.value}
                onChange={field.handleChange}
                error={fieldError(field)}
                placeholder={"**Drums** in two bands. Latest set:\n\nhttps://www.youtube.com/watch?v=…"}
                rows={6}
              />
            )}
          </form.Field>
          <p data-pwid="settings-bio-help" className="text-xs text-zinc-500">
            Markdown works: **bold**, links, lists, pictures. Put a YouTube, Spotify, Vimeo, TikTok or
            Instagram link on its own line — or paste its embed code — and it shows as a player.
          </p>
          <form.Subscribe selector={(state) => state.values.bio}>
            {(bio) =>
              bio.trim() !== "" ? (
                <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2">
                  <Markdown pwid="settings-bio-preview" source={bio} className="text-sm text-zinc-300" />
                </div>
              ) : null
            }
          </form.Subscribe>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-sm text-zinc-300">Public profile</span>
            <p className="text-xs text-zinc-500 mt-1">
              {user.is_public
                ? "Anyone can open your profile at "
                : "Give yourself a page anyone can open, with your name, picture and bio."}
              {user.is_public && (
                <Link
                  to="/u/$username"
                  params={{ username: user.username }}
                  data-pwid="settings-profile-public-link"
                  className="text-[var(--color-amber-accent)] hover:underline"
                >
                  /u/{user.username}
                </Link>
              )}
            </p>
          </div>
          <form.Field name="is_public">
            {(field) => (
              <button
                type="button"
                role="switch"
                aria-checked={field.state.value}
                aria-label="Public profile"
                data-pwid="settings-profile-public"
                onClick={() => field.handleChange(!field.state.value)}
                className="group relative h-6 w-11 shrink-0 rounded-full bg-zinc-600 transition-colors aria-checked:bg-[var(--color-amber-accent)] cursor-pointer"
              >
                <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform group-aria-checked:translate-x-5" />
              </button>
            )}
          </form.Field>
        </div>

        <form.Field name="avatar_url">
          {(field) => (
            <TextField
              label="Avatar URL"
              pwid="settings-avatar-url"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              placeholder="https://…"
            />
          )}
        </form.Field>
        <p className="text-xs text-zinc-500">
          New accounts start with the Gravatar for their signup email. Replace
          it with any picture URL, or clear it to show your initial instead.
        </p>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-zinc-300">Profile theme</legend>
          <p className="text-xs text-zinc-500">
            Your profile is a page you theme yourself: one HTML document with theme tags.
            There are no ready-made themes to pick from; write your own, or restore the default.
          </p>

          <form.Subscribe selector={(state) => [state.values.page_theme, state.values.page_options] as const}>
            {([theme, chosen]) => (
              <ThemeOptionFields
                options={themeOptions(theme)}
                chosen={chosen}
                pwidPrefix="settings-theme-option-"
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
                  data-pwid="settings-theme-source"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  spellCheck={false}
                  rows={18}
                  className="mt-2 w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2 font-mono text-xs leading-relaxed"
                />
              )}
            </form.Field>
            <button
              type="button"
              data-pwid="settings-theme-reset"
              onClick={() => {
                form.setFieldValue("page_theme", DEFAULT_USER_THEME)
                form.setFieldValue("page_options", {})
                setSaved(false)
              }}
              className="mt-2 rounded-md border border-[var(--color-border-subtle)] px-3 py-1 text-sm hover:border-zinc-500 cursor-pointer"
            >
              Restore default theme
            </button>
          </details>

          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">Theme tags</summary>
            <dl className="mt-2 space-y-2 text-xs">
              {USER_THEME_TAGS.map(([tags, meaning]) => (
                <div key={tags}>
                  <dt className="font-mono text-zinc-300">{tags}</dt>
                  <dd className="text-zinc-500">{meaning}</dd>
                </div>
              ))}
            </dl>
          </details>

          <div data-pwid="settings-theme-preview" className="space-y-1">
            <form.Subscribe selector={(state) => state.values}>
              {(values) => (
                <UserPage
                  className="h-[30rem] rounded-md border border-[var(--color-border-subtle)]"
                  profile={{
                    username: values.username.trim() || user.username,
                    name: blankToNull(values.name),
                    bio: blankToNull(values.bio),
                    avatar_url: blankToNull(values.avatar_url),
                    page_theme: values.page_theme.trim() === "" ? null : values.page_theme,
                    page_options: values.page_options,
                    bands: publicBands,
                  }}
                />
              )}
            </form.Subscribe>
            <p className="text-xs text-zinc-500">Preview. It shows on your profile once you save.</p>
          </div>
        </fieldset>

        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <SubmitButton
              pwid="settings-profile-submit"
              disabled={!canSubmit || isSubmitting}
              pending={isSubmitting}
              label="Save profile"
              pendingLabel="Saving…"
            />
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}

function PasswordSection() {
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmError, setConfirmError] = useState<string | undefined>()

  const form = useForm({
    defaultValues: {
      old_password: "",
      new_password: "",
      confirm_password: "",
    },
    onSubmit: async ({ value }) => {
      setServerError(null)
      setSaved(false)
      setConfirmError(undefined)
      if (value.new_password !== value.confirm_password) {
        setConfirmError("Passwords do not match")
        return
      }
      try {
        await auth.changePassword(
          S.decodeSync(ChangePasswordPayload)({
            old_password: value.old_password,
            new_password: value.new_password,
          }),
        )
        form.reset()
        setSaved(true)
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <section data-pwid="settings-password" className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Password</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
        className="space-y-4"
      >
        {serverError && (
          <div
            data-pwid="settings-password-error"
            className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400"
          >
            {serverError}
          </div>
        )}
        {saved && (
          <div
            data-pwid="settings-password-saved"
            className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-400"
          >
            Password updated
          </div>
        )}

        <form.Field name="old_password">
          {(field) => (
            <TextField
              label="Current password"
              pwid="settings-old-password"
              type="password"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              autoComplete="current-password"
              required
            />
          )}
        </form.Field>

        <form.Field name="new_password">
          {(field) => (
            <TextField
              label="New password"
              pwid="settings-new-password"
              type="password"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              autoComplete="new-password"
              required
            />
          )}
        </form.Field>

        <form.Field name="confirm_password">
          {(field) => (
            <TextField
              label="Confirm new password"
              pwid="settings-confirm-password"
              type="password"
              value={field.state.value}
              onChange={field.handleChange}
              error={confirmError ?? fieldError(field)}
              autoComplete="new-password"
              required
            />
          )}
        </form.Field>

        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <SubmitButton
              pwid="settings-password-submit"
              disabled={!canSubmit || isSubmitting}
              pending={isSubmitting}
              label="Change password"
              pendingLabel="Updating…"
            />
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}

function EmailsSection({ emails: initial }: { emails: readonly UserEmailInfo[] }) {
  const router = useRouter()
  const [list, setList] = useState(initial)
  const [actionError, setActionError] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  const refresh = async () => {
    const next = await auth.listEmails()
    setList(next)
    await router.invalidate()
  }

  const form = useForm({
    defaultValues: { email: "" },
    validators: { onChange: S.toStandardSchemaV1(AddEmailPayload) },
    onSubmit: async ({ value }) => {
      setAddError(null)
      setActionError(null)
      try {
        await auth.addEmail(S.decodeSync(AddEmailPayload)({ email: value.email.trim() }))
        form.reset()
        await refresh()
      } catch (e) {
        setAddError(errorMessage(e))
      }
    },
  })

  return (
    <section data-pwid="settings-emails" className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Email addresses</h2>
      <p className="text-sm text-zinc-500">
        Your primary email is where we send account notices. Add a new address
        and verify it before making it primary.
      </p>

      {actionError && (
        <div
          data-pwid="settings-emails-error"
          className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400"
        >
          {actionError}
        </div>
      )}

      <ul data-pwid="settings-email-list" className="space-y-2">
        {list.map((email) => (
          <li
            key={email.id}
            data-pwid={`settings-email-${email.id}`}
            className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border-subtle)] px-3 py-2"
          >
            <span className="text-sm font-medium flex-1 min-w-0 break-all">
              {email.email}
            </span>
            {email.is_primary && (
              <span
                data-pwid="settings-email-primary-badge"
                className="text-xs font-medium text-[var(--color-amber-accent)]"
              >
                Primary
              </span>
            )}
            {email.is_verified ? (
              <span className="text-xs text-zinc-500">Verified</span>
            ) : (
              <span className="text-xs text-zinc-500">Unverified</span>
            )}
            <div className="flex flex-wrap gap-1.5 w-full sm:w-auto sm:ml-auto">
              {!email.is_verified && (
                <button
                  type="button"
                  data-pwid={`settings-email-resend-${email.id}`}
                  className="px-2 py-1 rounded text-xs text-zinc-300 hover:bg-[var(--color-surface-hover)] cursor-pointer"
                  onClick={() => {
                    setActionError(null)
                    void auth
                      .resendEmailVerification(email.id)
                      .then(() => refresh())
                      .catch((e) => setActionError(errorMessage(e)))
                  }}
                >
                  Resend
                </button>
              )}
              {email.is_verified && !email.is_primary && (
                <button
                  type="button"
                  data-pwid={`settings-email-primary-${email.id}`}
                  className="px-2 py-1 rounded text-xs text-zinc-300 hover:bg-[var(--color-surface-hover)] cursor-pointer"
                  onClick={() => {
                    setActionError(null)
                    void auth
                      .makeEmailPrimary(email.id)
                      .then(() => refresh())
                      .catch((e) => setActionError(errorMessage(e)))
                  }}
                >
                  Make primary
                </button>
              )}
              <button
                type="button"
                data-pwid={`settings-email-remove-${email.id}`}
                className="px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 cursor-pointer"
                onClick={() => {
                  setActionError(null)
                  void auth
                    .removeEmail(email.id)
                    .then(() => refresh())
                    .catch((e) => setActionError(errorMessage(e)))
                }}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
        className="space-y-3"
      >
        {addError && (
          <div
            data-pwid="settings-add-email-error"
            className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400"
          >
            {addError}
          </div>
        )}
        <form.Field name="email">
          {(field) => (
            <TextField
              label="Add email"
              pwid="settings-add-email"
              type="email"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <SubmitButton
              pwid="settings-add-email-submit"
              disabled={!canSubmit || isSubmitting}
              pending={isSubmitting}
              label="Add email"
              pendingLabel="Adding…"
            />
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}

type BandMembership = {
  band: BandInfo
  members: readonly BandMember[]
}

function BandsSection({
  userId,
  memberships: initial,
}: {
  userId: string
  memberships: readonly BandMembership[]
}) {
  const [list, setList] = useState(initial)

  if (list.length === 0) {
    return (
      <section data-pwid="settings-bands" className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Bands</h2>
        <p className="text-sm text-zinc-500">You are not in any bands yet.</p>
      </section>
    )
  }

  return (
    <section data-pwid="settings-bands" className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Bands</h2>
      <p className="text-sm text-zinc-500">
        Leave a band, or if you own it alone, delete it and all of its songs and
        setlists.
      </p>
      <ul className="space-y-3">
        {list.map((membership) => (
          <BandLeaveCard
            key={membership.band.id}
            userId={userId}
            membership={membership}
            onLeft={() =>
              setList((current) =>
                current.filter((row) => row.band.id !== membership.band.id),
              )
            }
          />
        ))}
      </ul>
    </section>
  )
}

function BandLeaveCard({
  userId,
  membership,
  onLeft,
}: {
  userId: string
  membership: BandMembership
  onLeft: () => void
}) {
  const router = useRouter()
  const { band, members } = membership
  const mine = members.find((m) => m.user_id === userId)
  const others = members.filter((m) => m.user_id !== userId)
  const isOwner = mine?.is_owner === true
  const soleOwner = isOwner && others.length === 0

  const [successor, setSuccessor] = useState<string | null>(others[0]?.user_id ?? null)
  const [confirmName, setConfirmName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const afterLeave = async () => {
    onLeft()
    await router.invalidate()
  }

  const leaveAsMember = async () => {
    setError(null)
    setPending(true)
    try {
      await bands.leave(band.id)
      await afterLeave()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  const leaveAsOwner = async () => {
    if (successor === null) {
      setError("Choose a member to take ownership")
      return
    }
    setError(null)
    setPending(true)
    try {
      await bands.leave(band.id, { transfer_to: successor })
      await afterLeave()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  const deleteSole = async () => {
    if (confirmName.trim() !== band.name) {
      setError(`Type “${band.name}” to confirm`)
      return
    }
    setError(null)
    setPending(true)
    try {
      await bands.delete(band.id)
      await afterLeave()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <li
      data-pwid={`settings-band-${band.id}`}
      className="rounded-md border border-[var(--color-border-subtle)] px-3 py-3 space-y-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{band.name}</div>
          <div className="text-xs text-zinc-500">
            {members.length} member{members.length === 1 ? "" : "s"}
            {isOwner ? " · you own this band" : ""}
          </div>
        </div>
      </div>

      {error && (
        <div
          data-pwid={`settings-band-error-${band.id}`}
          className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400"
        >
          {error}
        </div>
      )}

      {!isOwner && (
        <button
          type="button"
          data-pwid={`settings-band-leave-${band.id}`}
          disabled={pending}
          onClick={() => void leaveAsMember()}
          className="px-3 py-1.5 rounded-md text-sm text-red-400 hover:bg-red-500/10 border border-red-500/20 cursor-pointer disabled:opacity-50"
        >
          {pending ? "Leaving…" : "Leave band"}
        </button>
      )}

      {isOwner && !soleOwner && (
        <div className="space-y-2">
          <label className="block text-sm">
            <span className="block text-zinc-300 mb-1">Transfer ownership to</span>
            <select
              data-pwid={`settings-band-successor-${band.id}`}
              value={successor ?? ""}
              onChange={(e) => setSuccessor(e.target.value || null)}
              className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm"
            >
              {others.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name ?? m.username}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-pwid={`settings-band-transfer-leave-${band.id}`}
            disabled={pending || successor === null}
            onClick={() => void leaveAsOwner()}
            className="px-3 py-1.5 rounded-md text-sm text-red-400 hover:bg-red-500/10 border border-red-500/20 cursor-pointer disabled:opacity-50"
          >
            {pending ? "Leaving…" : "Transfer ownership and leave"}
          </button>
        </div>
      )}

      {soleOwner && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">
            You are the only member. Deleting the band removes its songs,
            setlists, and charts permanently.
          </p>
          <TextField
            label={`Type “${band.name}” to confirm`}
            pwid={`settings-band-confirm-${band.id}`}
            value={confirmName}
            onChange={setConfirmName}
            placeholder={band.name}
          />
          <button
            type="button"
            data-pwid={`settings-band-delete-${band.id}`}
            disabled={pending || confirmName.trim() !== band.name}
            onClick={() => void deleteSole()}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 cursor-pointer disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Delete band and all its data"}
          </button>
        </div>
      )}
    </li>
  )
}

function ownsAnyBand(userId: string, memberships: readonly BandMembership[]) {
  return memberships.some((row) =>
    row.members.some((m) => m.user_id === userId && m.is_owner),
  )
}

function DeleteAccountSection({
  user,
  memberships,
}: {
  user: AuthUser
  memberships: readonly BandMembership[]
}) {
  const router = useRouter()
  const blocked = ownsAnyBand(user.id, memberships)
  const [confirmName, setConfirmName] = useState("")
  const [token, setToken] = useState("")
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (blocked) {
    return (
      <section data-pwid="settings-delete-account-blocked" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Delete account</h2>
        <p className="text-sm text-zinc-500">
          Transfer ownership or delete every band you own before you can delete
          your account.
        </p>
      </section>
    )
  }

  const requestDeletion = async () => {
    if (confirmName.trim() !== user.username) {
      setError(`Type “${user.username}” to confirm`)
      return
    }
    setError(null)
    setPending(true)
    try {
      await auth.requestAccountDeletion()
      setRequested(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  const confirmDeletion = async () => {
    if (token.trim().length === 0) {
      setError("Enter the confirmation code from your email")
      return
    }
    setError(null)
    setPending(true)
    try {
      await auth.confirmAccountDeletion(token.trim())
      await router.invalidate()
      await router.navigate({ to: "/" })
    } catch (e) {
      setError(errorMessage(e))
      setPending(false)
    }
  }

  return (
    <section data-pwid="settings-delete-account" className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Delete account</h2>
      <p className="text-sm text-zinc-500">
        Permanently delete your account and personal data. This cannot be undone.
      </p>

      {error && (
        <div
          data-pwid="settings-delete-error"
          className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400"
        >
          {error}
        </div>
      )}

      {!requested ? (
        <div className="space-y-3">
          <TextField
            label={`Type “${user.username}” to continue`}
            pwid="settings-delete-username"
            value={confirmName}
            onChange={setConfirmName}
            autoComplete="username"
            placeholder={user.username}
          />
          <button
            type="button"
            data-pwid="settings-delete-request"
            disabled={pending || confirmName.trim() !== user.username}
            onClick={() => void requestDeletion()}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 cursor-pointer disabled:opacity-50"
          >
            {pending ? "Sending…" : "Email me a confirmation code"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p
            data-pwid="settings-delete-requested"
            className="text-sm text-zinc-400"
          >
            We sent a confirmation code to your email. Enter it below to finish
            deleting your account.
          </p>
          <TextField
            label="Confirmation code"
            pwid="settings-delete-token"
            value={token}
            onChange={setToken}
            autoComplete="one-time-code"
          />
          <button
            type="button"
            data-pwid="settings-delete-confirm"
            disabled={pending || token.trim().length === 0}
            onClick={() => void confirmDeletion()}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 cursor-pointer disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      )}
    </section>
  )
}
