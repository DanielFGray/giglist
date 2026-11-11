import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { auth } from "~/api/client"
import { LoginPayload } from "~/api/auth"
import { SubmitButton, TextField, errorMessage, fieldError } from "~/components/form"
import { safeRedirect } from "~/components/safe-redirect"

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const raw = typeof search.redirect === "string" ? search.redirect : ""
    // Omit when none was asked for, so Links to /login need no search prop.
    if (raw === "") return {}
    return { redirect: safeRedirect(raw) }
  },
  component: Login,
})

function Login() {
  const router = useRouter()
  const { redirect } = Route.useSearch()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { id: "", password: "" },
    validators: { onChange: S.toStandardSchemaV1(LoginPayload) },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        // The schema decodes the typed string into the Redacted password the
        // API takes; the form value itself stays the string the user typed.
        await auth.login(S.decodeSync(LoginPayload)(value))
        await router.invalidate()
        await router.navigate({ href: redirect ?? "/" })
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <div data-pwid="login-page" className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Welcome back to GigList
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
            <div data-pwid="login-error" className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
              {serverError}
            </div>
          )}

          <form.Field name="id">
            {(field) => (
              <TextField
                label="Username or email"
                pwid="login-id"
                value={field.state.value}
                onChange={field.handleChange}
                error={fieldError(field)}
                autoFocus
                autoComplete="username"
                placeholder="you@example.com"
                required
              />
            )}
          </form.Field>

          <form.Field name="password">
            {(field) => (
              <TextField
                label="Password"
                pwid="login-password"
                type="password"
                value={field.state.value}
                onChange={field.handleChange}
                error={fieldError(field)}
                autoComplete="current-password"
                required
              />
            )}
          </form.Field>

          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <SubmitButton
                pwid="login-submit"
                disabled={!canSubmit || isSubmitting}
                pending={isSubmitting}
                label="Sign in"
                pendingLabel="Signing in..."
                wide
              />
            )}
          </form.Subscribe>
        </form>

        <p className="text-center text-sm">
          <Link data-pwid="login-forgot-password" to="/forgot" className="text-[var(--color-amber-accent)] hover:underline">
            Forgot password?
          </Link>
        </p>

        <p className="text-center text-sm text-zinc-500">
          Don't have an account?{" "}
          <Link data-pwid="login-to-signup" to="/signup" className="text-[var(--color-amber-accent)] hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
