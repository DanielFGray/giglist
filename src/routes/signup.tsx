import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { auth } from "~/api/client"
import { RegisterPayload } from "~/api/contracts"
import { SubmitButton, TextField, errorMessage, fieldError } from "~/components/form"

export const Route = createFileRoute("/signup")({
  component: Signup,
})

function Signup() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { username: "", email: "", password: "" },
    validators: { onChange: S.toStandardSchemaV1(RegisterPayload) },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        // The schema decodes the typed string into the Redacted password the
        // API takes; the form value itself stays the string the user typed.
        await auth.register(S.decodeSync(RegisterPayload)(value))
        await router.invalidate()
        await router.navigate({ to: "/" })
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <div data-pwid="signup-page" className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Create account</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Get your band on GigList
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
                label="Create account"
                pendingLabel="Creating account..."
                wide
              />
            )}
          </form.Subscribe>
        </form>

        <p className="text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link data-pwid="signup-to-login" to="/login" className="text-[var(--color-amber-accent)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
