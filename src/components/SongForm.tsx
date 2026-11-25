import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { SongFields } from "~/api/songs"
import { MUSICAL_KEYS, type MusicalKey } from "gigbag.js/charts/key"
import type { SongCreateData, SongInfo, SongUpdateData } from "~/api/client"
import {
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  fieldError,
} from "./form"
import { UNTITLED_SONG } from "./song-from-score"
import { DURATION, formatDuration, parseDuration } from "./duration"
import { HANGING_CARD } from "./ui/card"

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

const keyOptions: ReadonlyArray<{ value: MusicalKey | ""; label: string }> = [
  { value: "", label: "No key" },
  ...MUSICAL_KEYS.map((key) => ({ value: key, label: key })),
]

/**
 * The song details form's state. Its defaults follow `song`: while no field has
 * been touched, a song saved elsewhere (or by Save) shows its new values, and
 * once one has, the player's edits stay until `reset`. `onSubmit` gets the
 * payload the API takes, and runs only when every field is valid.
 */
export function useSongForm(song: SongInfo, onSubmit: (payload: SongUpdateData) => Promise<void>) {
  return useForm({
    defaultValues: songValues(song),
    validators: { onChange: S.toStandardSchemaV1(SongFormSchema) },
    onSubmit: ({ value }) => onSubmit({ ...value, duration_seconds: parseDuration(value.duration_seconds) }),
  })
}

export type SongFormApi = ReturnType<typeof useSongForm>

/**
 * The fields for a song's details. Read-only, the fields are disabled; on a
 * narrow screen a read-only form is hidden, and the page shows a summary
 * instead. The page's edit bar submits it.
 */
export function SongForm({ form, pwid, readOnly, error }: { form: SongFormApi; pwid: string; readOnly: boolean; error: string | null }) {
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

        {error && (
          <div data-pwid="song-form-error" className="text-sm text-red-400">{error}</div>
        )}
      </fieldset>
    </form>
  )
}
