import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { auth } from "~/api/client"
import { ForgotPasswordPayload } from "~/api/contracts"
import { SubmitButton, TextField, errorMessage, fieldError } from "~/components/form"

export const Route = createFileRoute("/forgot")({
  component: ForgotPassword,
})

function ForgotPassword() {
  const [serverError, setServerError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const form = useForm({
    defaultValues: { email: "" },
    validators: { onChange: S.toStandardSchemaV1(ForgotPasswordPayload) },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        await auth.forgotPassword(S.decodeSync(ForgotPasswordPayload)(value))
        setSent(true)
      } catch (error) {
        setServerError(errorMessage(error))
      }
    },
  })

  return (
    <div data-pwid="forgot-page" className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Forgot password</h1>
          <p className="text-sm text-zinc-500 mt-1">Enter the email address on your account.</p>
        </div>

        {sent ? (
          <p data-pwid="forgot-sent" className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-300">
            If that address has an account, we sent a link.
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
            className="space-y-4"
          >
            {serverError && (
              <div data-pwid="forgot-error" className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
                {serverError}
              </div>
            )}

            <form.Field name="email">
              {(field) => (
                <TextField
                  label="Email"
                  pwid="forgot-email"
                  type="email"
                  value={field.state.value}
                  onChange={field.handleChange}
                  error={fieldError(field)}
                  autoComplete="email"
                  autoFocus
                  required
                />
              )}
            </form.Field>

            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <SubmitButton
                  pwid="forgot-submit"
                  disabled={!canSubmit || isSubmitting}
                  pending={isSubmitting}
                  label="Send reset link"
                  pendingLabel="Sending link..."
                  wide
                />
              )}
            </form.Subscribe>
          </form>
        )}

        <p className="text-center text-sm text-zinc-500">
          <Link to="/login" className="text-[var(--color-amber-accent)] hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
