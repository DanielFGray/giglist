import { useEffect, useRef, useState } from "react"
import { beatsBetween, isCountIn } from "~/charts/click"

/** How far ahead of the clock clicks are handed to the audio engine, and how often that is topped up. */
const LOOKAHEAD_SECONDS = 0.2
const TICK_MS = 50
/** Silence between pressing Start and the first click, so the audio engine is awake. */
const LEAD_SECONDS = 0.1

/**
 * A button that plays a click at `bpm`: one bar of count-in with a higher
 * tone, then a steady click with the first beat of each bar accented. It
 * stops when pressed again, when the tempo changes, or when the page leaves.
 */
export function ClickTrack({ bpm, className, pwid = "click" }: { bpm: number; className: string; pwid?: string }) {
  const [playing, setPlaying] = useState(false)
  const [beat, setBeat] = useState<number | null>(null)
  const audio = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!playing) return
    const context = (audio.current ??= new AudioContext())
    void context.resume()
    const start = context.currentTime + LEAD_SECONDS
    // Everything before this time is already with the audio engine.
    let scheduledUpTo = start
    const timer = setInterval(() => {
      const now = context.currentTime
      const until = now + LOOKAHEAD_SECONDS
      for (const b of beatsBetween(bpm, start, scheduledUpTo, until)) click(context, b.time, b.accent, isCountIn(b))
      scheduledUpTo = Math.max(scheduledUpTo, until)
      // The beat on screen is the latest one whose time has come.
      setBeat(now < start ? null : Math.floor((now - start) / (60 / bpm)))
    }, TICK_MS)
    return () => {
      clearInterval(timer)
      setBeat(null)
    }
  }, [playing, bpm])

  useEffect(() => () => void audio.current?.close(), [])

  return (
    <button
      data-pwid={pwid}
      data-beat={beat ?? undefined}
      type="button"
      aria-pressed={playing}
      onClick={() => setPlaying(!playing)}
      className={className}
    >
      {playing ? `Click ${bpm}${beat !== null ? ` · ${(beat % 4) + 1}` : ""}` : "Click"}
    </button>
  )
}

/** One short tone: highest for the count-in's accent, high for a bar's first beat, low for the others. */
function click(context: AudioContext, time: number, accent: boolean, countIn: boolean) {
  const osc = context.createOscillator()
  const gain = context.createGain()
  osc.frequency.value = accent ? (countIn ? 1760 : 1320) : 880
  gain.gain.setValueAtTime(0.0001, time)
  gain.gain.exponentialRampToValueAtTime(0.5, time + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05)
  osc.connect(gain).connect(context.destination)
  osc.start(time)
  osc.stop(time + 0.06)
}
