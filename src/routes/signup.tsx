import { Link, createFileRoute } from "@tanstack/react-router"
import { SignupForm } from "~/components/SignupForm"

export const Route = createFileRoute("/signup")({
  component: Signup,
})

function Signup() {
  return (
    <div data-pwid="signup-page" className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Create account</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Get your band on GigList
          </p>
        </div>

        <SignupForm />

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
