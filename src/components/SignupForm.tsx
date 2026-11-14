import { useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { auth } from "~/api/client"
import { RegisterPayload } from "~/api/auth"
import { SubmitButton, TextField, errorMessage, fieldError } from "./form"

/** An emailed invitation the new account joins: the link's id and code, and the address it went to. */
export type SignupInvitation = { readonly id: string; readonly code: string; readonly email: string }

/**
 * Creates an account and signs it in. From an emailed invitation the account
 * takes the invitation's address, which the server marks verified, and joins
 * the band; the form then opens the band instead of the home page.
 */
export function SignupForm({ invitation }: { invitation?: SignupInvitation }) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm({
    // Joining shows no email field: the account takes the invitation's address.
    defaultValues: { username: "", email: invitation?.email ?? "", password: "" },
    validators: { onChange: S.toStandardSchemaV1(RegisterPayload) },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        // The schema decodes the typed string into the Redacted password the
        // API takes; the form value itself stays the string the user typed.
        const account = S.decodeSync(RegisterPayload)(value)
        if (invitation) {
          const { bandId } = await auth.joinByInvitation(invitation.id, {
            username: account.username,
            password: account.password,
            code: invitation.code,
          })
          await router.invalidate()
          await router.navigate({ to: "/band/$bandId", params: { bandId } })
        } else {
          await auth.register(account)
          await router.invalidate()
          await router.navigate({ to: "/" })
        }
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
      className="space-y-4"
    >
      {serverError && (
        <div data-pwid="signup-error" className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
          {serverError}
        </div>
      )}

      <form.Field name="username">
        {(field) => (
          <TextField
            label="Username"
            pwid="signup-username"
            value={field.state.value}
            onChange={field.handleChange}
            error={fieldError(field)}
            autoFocus
            autoComplete="username"
            placeholder="hendrix42"
            required
          />
        )}
      </form.Field>

      {!invitation && (
        <form.Field name="email">
          {(field) => (
            <TextField
              label="Email"
              pwid="signup-email"
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
      )}

      <form.Field name="password">
        {(field) => (
          <TextField
            label="Password"
            pwid="signup-password"
            type="password"
            value={field.state.value}
            onChange={field.handleChange}
            error={fieldError(field)}
            autoComplete="new-password"
            required
          />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <SubmitButton
            pwid="signup-submit"
            disabled={!canSubmit || isSubmitting}
            pending={isSubmitting}
            label={invitation ? "Create account and join" : "Create account"}
            pendingLabel="Creating account..."
            wide
          />
        )}
      </form.Subscribe>
    </form>
  )
}
