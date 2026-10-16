/**
 * Reading a phrase: a short piece of real notation in a lyrics chart, written
 * in alphaTex (docs/adr/0003). The browser draws and plays the score this
 * gives; it needs no DOM, so tests read phrases directly.
 */
import { importer, model, Settings } from "@coderline/alphatab"

/** A place in the alphaTex where alphaTab stopped reading, 1-based. */
export type PhraseProblem = { readonly line: number; readonly column: number; readonly message: string }

export type ReadPhrase = { readonly score: model.Score } | { readonly problems: ReadonlyArray<PhraseProblem> }

/**
 * The score of a phrase. With a `tempo` (the song's, or its setlist entry's),
 * the phrase starts at that tempo whatever its own text says, so it plays at
 * the speed the band plays the song.
 */
export function readPhrase(tex: string, tempo: number | null, settings: Settings = new Settings()): ReadPhrase {
  const reader = new importer.AlphaTexImporter()
  reader.initFromString(tex, settings)
  let score: model.Score
  try {
    score = reader.readScore()
  } catch (e) {
    return { problems: problemsOf(e) }
  }
  if (tempo) startAt(score, tempo)
  return { score }
}

/** `score.tempo` is read from the first bar's tempo marking, so the marking is what changes. */
function startAt(score: model.Score, tempo: number) {
  const first = score.masterBars[0]
  if (!first) return
  const existing = first.tempoAutomations[0]
  if (existing && existing.ratioPosition === 0) existing.value = tempo
  else first.tempoAutomations.unshift(model.Automation.buildTempoAutomation(false, 0, tempo, 2))
}

function problemsOf(error: unknown): ReadonlyArray<PhraseProblem> {
  // alphaTab wraps the error that holds the diagnostics.
  const withDiagnostics = error instanceof Error && error.cause instanceof importer.AlphaTexErrorWithDiagnostics ? error.cause : error
  if (!(withDiagnostics instanceof importer.AlphaTexErrorWithDiagnostics)) {
    return [{ line: 1, column: 1, message: error instanceof Error ? error.message : String(error) }]
  }
  return [...withDiagnostics.iterateDiagnostics()]
    .filter((d) => d.severity === importer.alphaTex.AlphaTexDiagnosticsSeverity.Error)
    .map((d) => ({ line: d.start?.line ?? 1, column: d.start?.col ?? 1, message: d.message }))
}
