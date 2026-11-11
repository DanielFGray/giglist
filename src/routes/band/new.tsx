import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { bands } from "~/api/client"
import { CreateBandPayload } from "~/api/bands"
import { SubmitButton, TextField, errorMessage, fieldError } from "~/components/form"

export const Route = createFileRoute("/band/new")({
  component: NewBand,
})

/** The slug a band is addressed by: its name, lowercased and hyphenated. */
const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

function NewBand() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      setServerError(null)

      const name = value.name.trim()
      try {
        const band = await bands.create({ slug: slugify(name), name })
        await router.invalidate()
        await router.navigate({ to: "/band/$bandId", params: { bandId: band.id } })
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <div data-pwid="new-band-page" className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Create your band</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Get started by naming your band
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
            <div data-pwid="new-band-error" className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
              {serverError}
            </div>
          )}

          <form.Field name="name" validators={{ onChange: S.toStandardSchemaV1(CreateBandPayload.fields.name) }}>
            {(field) => (
              <TextField
                label="Band name"
                pwid="new-band-name"
                value={field.state.value}
                onChange={field.handleChange}
                error={fieldError(field)}
                autoFocus
                required
              />
            )}
          </form.Field>

          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <SubmitButton
                pwid="new-band-submit"
                disabled={!canSubmit || isSubmitting}
                pending={isSubmitting}
                label="Create band"
                pendingLabel="Creating…"
                wide
              />
            )}
          </form.Subscribe>
        </form>
      </div>
    </div>
  )
}
