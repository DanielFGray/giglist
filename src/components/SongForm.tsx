import { useState, type ReactNode } from "react"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { MusicalKeys, SongUpdate, type MusicalKeyType } from "~/api/contracts"
import type { SongInfo, SongUpdateData } from "~/api/client"
import {
  NumberField,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  errorMessage,
  fieldError,
} from "./form"
import { DURATION, formatDuration, parseDuration } from "./duration"

/**
 * The song form's values: the contract's update payload with the duration held
 * as the `mm:ss` text the field edits, not the seconds the API takes.
 * Spreading `SongUpdate.fields` keeps every other field's constraint in the
 * contract rather than restating it here.
 */
const SongFormSchema = S.Struct({
  ...SongUpdate.fields,
  duration_seconds: S.NullOr(S.String.pipe(S.check(S.isPattern(DURATION)))),
})

type SongFormValues = (typeof SongFormSchema)["Encoded"]

/** The form values for a song that does not exist yet. */
export const emptySong = (): SongFormValues => ({
  title: "",
  artist: null,
  key: null,
  tempo_bpm: null,
  duration_seconds: null,
  capo: null,
  notes: null,
})

/** The form values for an existing song. */
export const songValues = (song: SongInfo): SongFormValues => ({
  title: song.title,
  artist: song.artist,
  key: song.key,
  tempo_bpm: song.tempo_bpm,
  duration_seconds: formatDuration(song.duration_seconds),
  capo: song.capo,
  notes: song.notes,
})

const keyOptions: ReadonlyArray<{ value: MusicalKeyType | ""; label: string }> = [
  { value: "", label: "No key" },
  ...MusicalKeys.map((key) => ({ value: key, label: key })),
]

/**
 * One form for creating and editing a song, so both pages validate and lay out
 * the same seven metadata fields. The caller supplies the initial values and
 * what to do with the built payload.
 */
export function SongForm({
  pwid,
  defaults,
  submitLabel,
  pendingLabel,
  onSubmit,
  children,
}: {
  pwid: string
  defaults: SongFormValues
  submitLabel: string
  pendingLabel: string
  onSubmit: (payload: SongUpdateData) => Promise<void>
  children?: ReactNode
}) {
  const [serverError, setServerError] = useState<string | null>(null)
  // Freeze the initial values: a fresh object on every render would otherwise
  // read as a changed `defaultValues` and reset the form mid-edit.
  const [initial] = useState(defaults)

  const form = useForm({
    defaultValues: initial,
    validators: { onChange: S.toStandardSchemaV1(SongFormSchema) },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        await onSubmit({
          ...value,
          duration_seconds: parseDuration(value.duration_seconds),
        })
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <form
      data-pwid={pwid}
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="title">
          {(field) => (
            <TextField
              label="Title"
              pwid="song-title"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              required
            />
          )}
        </form.Field>

        <form.Field name="artist">
          {(field) => (
            <TextField
              label="Artist"
              pwid="song-artist"
              value={field.state.value ?? ""}
              onChange={(value) => field.handleChange(value === "" ? null : value)}
              error={fieldError(field)}
            />
          )}
        </form.Field>

        <form.Field name="key">
          {(field) => (
            <SelectField
              label="Key"
              pwid="song-key"
              value={field.state.value}
              onChange={(value) => field.handleChange(value === "" ? null : value)}
              options={keyOptions}
              error={fieldError(field)}
            />
          )}
        </form.Field>

        <form.Field name="tempo_bpm">
          {(field) => (
            <NumberField
              label="Tempo (BPM)"
              pwid="song-tempo"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              min={0}
              max={999}
            />
          )}
        </form.Field>

        <form.Field name="duration_seconds">
          {(field) => (
            <TextField
              label="Duration (mm:ss)"
              pwid="song-duration"
              value={field.state.value ?? ""}
              onChange={(value) => field.handleChange(value === "" ? null : value)}
              error={fieldError(field)}
              placeholder="3:45"
            />
          )}
        </form.Field>

        <form.Field name="capo">
          {(field) => (
            <NumberField
              label="Capo"
              pwid="song-capo"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              min={0}
              max={12}
            />
          )}
        </form.Field>
      </div>

      <form.Field name="notes">
        {(field) => (
          <TextAreaField
            label="Notes"
            pwid="song-notes"
            value={field.state.value ?? ""}
            onChange={(value) => field.handleChange(value === "" ? null : value)}
            error={fieldError(field)}
            placeholder="Arrangement, intro, tuning…"
          />
        )}
      </form.Field>

      {serverError && (
        <div data-pwid="song-form-error" className="text-sm text-red-400">{serverError}</div>
      )}

      <div className="flex gap-2">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <SubmitButton
              pwid="song-submit"
              disabled={!canSubmit || isSubmitting}
              pending={isSubmitting}
              label={submitLabel}
              pendingLabel={pendingLabel}
            />
          )}
        </form.Subscribe>
        {children}
      </div>
    </form>
  )
}
