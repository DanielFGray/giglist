import { useState } from "react"
import { charts } from "~/api/client"
import { MAX_SCAN_BYTES } from "~/charts/scanned"
import { errorMessage } from "./form"

/** A file the player chose, and the chords and lyrics the server read from it. */
export type ReadChart = { readonly text: string; readonly file: File }

/**
 * Pick a PDF or a photo of a chart; the server reads its chords and lyrics
 * (`ChartReader`) and `onRead` gets them as chords over lyrics text, for the
 * player to correct before the chart is made.
 */
export function ReadChartFile({ onRead }: { onRead: (read: ReadChart) => void }) {
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async (file: File | undefined) => {
    setError(null)
    if (!file) return
    if (file.size > MAX_SCAN_BYTES) return setError("That file is too large")
    setReading(true)
    try {
      const { text } = await charts.readFile(await uploadBytes(file))
      onRead({ text, file })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-sm text-zinc-300">Read from a PDF or a photo</span>
        <input
          data-pwid="chart-form-file"
          type="file"
          accept="application/pdf,image/*"
          disabled={reading}
          onChange={(e) => void choose(e.target.files?.[0])}
          className="block text-sm text-zinc-300"
        />
      </label>
      {reading && <p data-pwid="chart-form-reading" className="text-sm text-zinc-500">Reading the chart…</p>}
      {error && <p data-pwid="chart-form-file-error" className="text-sm text-red-400">{error}</p>}
    </div>
  )
}

/**
 * The long side every image is scaled to, up or down: about 270 dpi for a
 * letter page. Tesseract misreads small text, and a chord is often one letter
 * with no word around it to help; a 900 pixel page lost a third of its chords.
 */
const IMAGE_SIDE = 3000

/**
 * The bytes to send for `file`. A PDF goes as it is. A photo is redrawn as a
 * JPEG: browsers turn a photo upright from its EXIF orientation when they
 * decode it and Tesseract does not, so drawing it bakes the rotation in. This
 * also decodes formats Tesseract cannot open (HEIC on Safari) and sets the
 * image's size (`IMAGE_SIDE`).
 */
async function uploadBytes(file: File): Promise<Uint8Array> {
  if (file.type === "application/pdf") return new Uint8Array(await file.arrayBuffer())
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("That is not a PDF or an image")
  })
  const scale = IMAGE_SIDE / Math.max(bitmap.width, bitmap.height)
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 })
  return new Uint8Array(await blob.arrayBuffer())
}
