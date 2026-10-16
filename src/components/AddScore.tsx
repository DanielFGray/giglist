import { useState } from "react"
import { scores } from "~/api/client"
import { MAX_SCORE_BYTES, chartNameFromFile, scoreFormat } from "~/charts/score-file"
import { SubmitButton, TextField, errorMessage } from "./form"

/**
 * Upload a Guitar Pro file as a new score chart. The server stores the file's
 * bytes unchanged as the chart's first revision.
 */
export function AddScore({
  songId,
  onDone,
  onCancel,
}: {
  songId: string
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async (picked: File | undefined) => {
    setError(null)
    setFile(null)
    if (!picked) return
    if (picked.size > MAX_SCORE_BYTES) return setError("That file is too large for a score")
    const bytes = new Uint8Array(await picked.arrayBuffer())
    if (scoreFormat(bytes) === null) return setError("That is not a Guitar Pro file (.gp, .gp3, .gp4, .gp5 or .gpx)")
    setFile({ name: picked.name, bytes })
    setName((current) => current || chartNameFromFile(picked.name))
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) return
    setPending(true)
    setError(null)
    try {
      await scores.upload({ song_id: songId, name, file_name: file.name, bytes: file.bytes })
      await onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      data-pwid="score-form"
      onSubmit={submit}
      className="rounded-lg border border-[var(--color-border-subtle)] p-4 space-y-3"
    >
      <label className="block space-y-1">
        <span className="text-sm text-zinc-300">Guitar Pro file</span>
        <input
          data-pwid="score-form-file"
          type="file"
          accept=".gp,.gp3,.gp4,.gp5,.gpx"
          onChange={(e) => void choose(e.target.files?.[0])}
          className="block text-sm text-zinc-300"
        />
      </label>
      <TextField label="Name" pwid="score-form-name" value={name} onChange={setName} />
      {error && <div data-pwid="score-form-error" className="text-sm text-red-400">{error}</div>}
      <div className="flex gap-2">
        <SubmitButton
          pwid="score-form-submit"
          disabled={file === null || name.trim() === ""}
          pending={pending}
          label="Add score"
          pendingLabel="Uploading…"
        />
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
