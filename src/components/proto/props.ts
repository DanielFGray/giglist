// PROTOTYPE: throwaway.
import type { ChartInfo } from "~/api/client"

/** The props every editor variant takes; the same as the editor it stands in for. */
export type ProtoEditorProps = {
  chart: ChartInfo & { source: string }
  /** The song's tempo, which phrases play at. */
  tempo: number | null
  onSaved: () => Promise<void>
  onCancel: () => void
}
