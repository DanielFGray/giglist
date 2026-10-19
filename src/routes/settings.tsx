import { useState } from "react"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import {
  auth,
  type AuthUser,
  type UserEmailInfo,
} from "~/api/client"
import {
  UpdateProfilePayload,
  ChangePasswordPayload,
  AddEmailPayload,
} from "~/api/contracts"
import {
  SubmitButton,
  TextField,
  TextAreaField,
  errorMessage,
  fieldError,
} from "~/components/form"

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ context }) => {
    if (context.user === null) {
      throw redirect({ to: "/login" })
    }
  },
  loader: async () => ({ emails: await auth.listEmails() }),
  component: SettingsPage,
})

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function SettingsPage() {
  const { user } = Route.useRouteContext()
  const { emails } = Route.useLoaderData()
  // User is guaranteed by beforeLoad; keep a local name for the forms.
  if (user === null) return null

  return (
    <div data-pwid="settings-page" className="mx-auto max-w-lg space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account settings</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Your public profile, password, and email addresses
        </p>
      </div>

      <ProfileSection user={user} />
      <PasswordSection />
      <EmailsSection emails={emails} />
    </div>
  )
}

function ProfileSection({ user }: { user: AuthUser }) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const form = useForm({
    defaultValues: {
      username: user.username,
      name: user.name ?? "",
      bio: user.bio ?? "",
      avatar_url: user.avatar_url ?? "",
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

        <form.Field name="bio">
          {(field) => (
            <TextAreaField
              label="Bio"
              pwid="settings-bio"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              placeholder="A short note about you"
              rows={3}
            />
          )}
        </form.Field>

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
