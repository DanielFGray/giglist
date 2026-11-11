import { useState, type ReactNode } from "react"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { MusicalKeys, SongFields, type MusicalKeyType } from "~/api/songs"
import type { SongCreateData, SongInfo, SongUpdateData } from "~/api/client"
import {
  NumberField,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  errorMessage,
  fieldError,
} from "./form"
import { UNTITLED_SONG } from "~/charts/score-meta"
import { DURATION, formatDuration, parseDuration } from "./duration"
import { HANGING_CARD } from "./card"

/**
 * The song form's values: the contract's update payload with the duration held
 * as the `mm:ss` text the field edits, not the seconds the API takes.
 * Spreading `SongUpdate.fields` keeps every other field's constraint in the
 * contract rather than restating it here.
 */
const SongFormSchema = S.Struct({
  ...SongFields,
  duration_seconds: S.NullOr(S.String.pipe(S.check(S.isPattern(DURATION)))),
})

type SongFormValues = (typeof SongFormSchema)["Encoded"]

/** What "Add song" saves: a song needs a title, and the player renames it once they know it. */
export const BLANK_SONG: Omit<SongCreateData, "band_id"> = {
  title: UNTITLED_SONG,
  artist: null,
  key: null,
  tempo_bpm: null,
  duration_seconds: null,
  capo: null,
  notes: null,
}

/** The form values for an existing song. */
export const songValues = (song: SongInfo): SongFormValues => ({
  title: song.title,
  artist: song.artist,
  key: song.key,
  tempo_bpm: song.tempo_bpm,
  // An unknown duration is null, not "": the form's pattern rejects an empty string.
  duration_seconds: song.duration_seconds === null ? null : formatDuration(song.duration_seconds),
  capo: song.capo,
  notes: song.notes,
})

const keyOptions: ReadonlyArray<{ value: MusicalKeyType | ""; label: string }> = [
  { value: "", label: "No key" },
  ...MusicalKeys.map((key) => ({ value: key, label: key })),
]

/**
 * The form for a song's metadata. The caller supplies the initial values and
 * what to do with the built payload. Read-only, the fields are disabled and
 * no submit button is drawn; the children still render. On a narrow screen a
 * read-only form is hidden: the page shows a summary and an Edit button instead.
 */
export function SongForm({
  pwid,
  defaults,
  readOnly,
  submitLabel,
  pendingLabel,
  onSubmit,
  children,
}: {
  pwid: string
  defaults: SongFormValues
  readOnly: boolean
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
      className={`${HANGING_CARD} bg-[var(--color-surface-raised)] space-y-3 ${readOnly ? "max-lg:hidden" : ""}`}
    >
      <fieldset disabled={readOnly} className="space-y-3 min-w-0">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
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
      </fieldset>

      <div className="flex gap-2">
        {!readOnly && (
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
        )}
        {children}
      </div>
    </form>
  )
}
