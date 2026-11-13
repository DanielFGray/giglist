import { useMemo, useState } from "react"
import { NotationElement, type model, type Settings } from "@coderline/alphatab"
import { readPhrase, type PhraseProblem } from "alphatab-kit/charts/phrase"
import { IconButton } from "alphatab-kit/player/icon-button"
import { CountInIcon, LoadingSpinner, PlayIcon, StopIcon } from "alphatab-kit/player/icons"
import { SpeedInput } from "alphatab-kit/player/speed-input"
import { useScorePlayer, type UseScorePlayer } from "alphatab-kit/player/use-score-player"

/**
 * A phrase drawn by alphaTab, with play, loop, count-in and speed. Systems wrap
 * at the bars that fit the chart's width, so the phrase never scrolls sideways.
 * It starts at `tempo`, the song's tempo, when there is one.
 *
 * `useScorePlayer` runs the player. Drawing runs on the page's thread: a chart
 * can hold several phrases, and each would otherwise start a render worker.
 * The player's sound font (1 MB) loads on the first Play, for the same reason.
 * The notation takes the color of the text around it, so it reads on the light
 * page and on the dark stage view.
 *
 * Notation alphaTab cannot read shows its problems, and the phrase keeps the
 * last notation that read.
 */
export function Phrase({ tex, tempo }: { tex: string; tempo: number | null }) {
  // One parse per text and tempo: the player rebuilds when the score object changes. `readPhrase` starts the
  // phrase at the song's tempo whatever its own text says.
  const read = useMemo(() => readPhrase(tex, tempo), [tex, tempo])
  const problems = "problems" in read ? read.problems : []
  const [readable, setReadable] = useState<model.Score | null>(null)
  if ("score" in read && readable !== read.score) setReadable(read.score)

  if (readable === null) {
    return (
      <div data-pwid="phrase" data-rendered={false} className="space-y-1">
        <Problems problems={problems} />
      </div>
    )
  }
  return <PhrasePlayer score={readable} problems={problems} />
}

function PhrasePlayer({ score, problems }: { score: model.Score; problems: ReadonlyArray<PhraseProblem> }) {
  const { host, state, actions } = useScorePlayer({ source: { score }, zoom: PHRASE_ZOOM, configure: configurePhrase })
  const disabled = problems.length > 0 || state.status !== "ready"
  return (
    <div data-pwid="phrase" data-rendered={state.rendered} className="group relative space-y-1">
      <div className="relative">
        <div ref={host} data-pwid="phrase-render" />
        <PhraseControls state={state} actions={actions} disabled={disabled} />
      </div>
      {state.error && (
        <p role="alert" className="font-sans text-xs text-red-400">
          {state.error}
        </p>
      )}
      <Problems problems={problems} />
    </div>
  )
}

/** The hover bar over a phrase: play or stop, loop, count-in and speed. The parent must be `group relative`; the bar shows while it is hovered or focused. */
function PhraseControls({ state, actions, disabled }: Pick<UseScorePlayer, "state" | "actions"> & { disabled: boolean }) {
  const control = "rounded-full p-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed data-[pressed=true]:bg-[var(--color-amber-accent)] data-[pressed=true]:text-zinc-950 data-[pressed=false]:border data-[pressed=false]:border-[var(--color-border-subtle)]"
  const field = "rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-1 py-0.5 text-xs text-zinc-200"
  return (
    <div className="pointer-events-none absolute top-0 right-0 z-10 flex flex-wrap items-center gap-3 rounded-md bg-[var(--color-surface)]/80 px-2 py-1 font-sans text-xs text-zinc-500 opacity-0 backdrop-blur-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
      <IconButton
        label={state.playing ? "Stop" : "Play"}
        disabled={disabled}
        onClick={state.playing ? actions.stop : actions.play}
        parts={{ button: { className: control, "data-pwid": "phrase-play" } }}
      >
        {state.playing ? <StopIcon /> : state.sound === "loading" ? <LoadingSpinner className="animate-spin" /> : <PlayIcon />}
      </IconButton>
      <label className="flex items-center gap-1">
        <input data-pwid="phrase-loop" type="checkbox" checked={state.trainer.loop} onChange={(e) => actions.setLoop(e.target.checked)} />
        Loop
      </label>
      <IconButton
        label="Count in"
        pressed={state.countIn}
        onClick={() => actions.setCountIn(!state.countIn)}
        parts={{ button: { className: control, "data-pwid": "phrase-count-in" } }}
      >
        <CountInIcon />
      </IconButton>
      <SpeedInput
        speed={state.speed}
        onSpeed={actions.setSpeed}
        parts={{ root: { className: "flex items-center gap-1" }, input: { className: `${field} w-14 text-right`, "data-pwid": "phrase-speed" } }}
      />
      {state.tempo !== null && (
        <span data-pwid="phrase-tempo" className="tabular-nums">
          {state.tempo} bpm
        </span>
      )}
    </div>
  )
}

function Problems({ problems }: { problems: ReadonlyArray<PhraseProblem> }) {
  if (problems.length === 0) return null
  return (
    <ul data-pwid="phrase-problems" role="alert" className="font-sans text-xs text-red-400">
      {problems.map((p, i) => (
        <li key={i}>
          Line {p.line}, column {p.column}: {p.message}
        </li>
      ))}
    </ul>
  )
}

/** A phrase draws smaller than a score: the kit's zoom on top of the width's own base scale. */
const PHRASE_ZOOM = 0.8

/** Page-thread drawing and the notation a phrase leaves out. The kit has set the engine, player and ink. */
function configurePhrase(settings: Settings) {
  settings.core.useWorkers = false
  for (const hidden of HIDDEN) settings.notation.elements.set(hidden, false)
}

/** A phrase sits inside a song: the score's title, credits, tuning and track names would repeat the page. */
const HIDDEN = [
  NotationElement.ScoreTitle,
  NotationElement.ScoreSubTitle,
  NotationElement.ScoreArtist,
  NotationElement.ScoreAlbum,
  NotationElement.ScoreWords,
  NotationElement.ScoreMusic,
  NotationElement.ScoreWordsAndMusic,
  NotationElement.ScoreCopyright,
  NotationElement.GuitarTuning,
  NotationElement.TrackNames,
  // A lick needs neither a loudness mark nor numbered bars.
  NotationElement.EffectDynamics,
  NotationElement.BarNumber,
]
