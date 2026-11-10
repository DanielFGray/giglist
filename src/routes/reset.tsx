import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { auth } from "~/api/client"
import { ResetPasswordPayload } from "~/api/auth"
import { SubmitButton, TextField, errorMessage, fieldError } from "~/components/form"

export const Route = createFileRoute("/reset")({
  validateSearch: (search: Record<string, unknown>) => ({
    userId: typeof search.userId === "string" ? search.userId : "",
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: ResetPassword,
})

function ResetPassword() {
  const { userId, token } = Route.useSearch()
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { password: "" },
    validators: {
      onChange: S.toStandardSchemaV1(S.Struct({ password: ResetPasswordPayload.fields.password })),
    },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        await auth.resetPassword(S.decodeSync(ResetPasswordPayload)({ userId, token, ...value }))
        await router.invalidate()
        await router.navigate({ to: "/" })
      } catch (error) {
        setServerError(errorMessage(error))
      }
    },
  })

  return (
    <div data-pwid="reset-page" className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Set a new password</h1>
          <p className="text-sm text-zinc-500 mt-1">Choose a password with at least 8 characters.</p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
          className="space-y-4"
        >
          {serverError && (
            <div data-pwid="reset-error" className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
              {serverError}
            </div>
          )}

          <form.Field name="password">
            {(field) => (
              <TextField
                label="New password"
                pwid="reset-password"
                type="password"
                value={field.state.value}
                onChange={field.handleChange}
                error={fieldError(field)}
                autoComplete="new-password"
                autoFocus
                required
              />
            )}
          </form.Field>

          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <SubmitButton
                pwid="reset-submit"
                disabled={!canSubmit || isSubmitting}
                pending={isSubmitting}
                label="Reset password"
                pendingLabel="Resetting password..."
                wide
              />
            )}
          </form.Subscribe>
        </form>

        <p className="text-center text-sm text-zinc-500">
          <Link to="/login" className="text-[var(--color-amber-accent)] hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
