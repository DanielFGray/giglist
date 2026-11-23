import { useMemo, useState } from "react"
import { NotationElement, type model, type Settings } from "@coderline/alphatab"
import { readPhrase, type PhraseProblem } from "gigbag.js/charts/phrase"
import { IconButton } from "gigbag.js/player/icon-button"
import { CountInIcon, LoadingSpinner, PlayIcon, StopIcon } from "gigbag.js/player/icons"
import { SpeedInput } from "gigbag.js/player/speed-input"
import { useScorePlayer, type UseScorePlayer } from "gigbag.js/player/use-score-player"
import { button } from "./ui/button"
import { field } from "./ui/field"
import { hoverBar } from "./ui/hover-bar"

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
        <PhraseControls state={state} actions={actions} disabled={disabled} />
        <div ref={host} data-pwid="phrase-render" />
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

/** The bar over a phrase (`hoverBar`): play or stop, loop, count-in and speed. */
function PhraseControls({ state, actions, disabled }: Pick<UseScorePlayer, "state" | "actions"> & { disabled: boolean }) {
  return (
    <div className={hoverBar}>
      <IconButton
        label={state.playing ? "Stop" : "Play"}
        disabled={disabled}
        onClick={state.playing ? actions.stop : actions.play}
        parts={{ button: { className: button({ size: "iconSm", pressed: "data" }), "data-pwid": "phrase-play" } }}
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
        parts={{ button: { className: button({ size: "iconSm", pressed: "data" }), "data-pwid": "phrase-count-in" } }}
      >
        <CountInIcon />
      </IconButton>
      <SpeedInput
        speed={state.speed}
        onSpeed={actions.setSpeed}
        parts={{ root: { className: "flex items-center gap-1" }, input: { className: `${field({ size: "xs" })} w-14 text-right`, "data-pwid": "phrase-speed" } }}
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
