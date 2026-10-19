import { useCallback, useEffect, useRef, useState } from "react"
import { AlphaTabApi, PlayerMode, synth } from "@coderline/alphatab"

export const SPEEDS = [0.5, 0.75, 0.9, 1] as const

/**
 * The player of an alphaTab view, and the state its controls show. The
 * synthesizer and sound font load on Play. A view can enable external-media
 * mode for selection without starting audio.
 */
export function usePlayback() {
  const viewRef = useRef<AlphaTabApi | null>(null)
  // The view was armed, so its player is loading or loaded; it is armed once.
  const armed = useRef(false)
  // Play was pressed before the player was ready: it plays once it is.
  const playWhenReady = useRef(false)
  const [status, setStatus] = useState<"off" | "loading" | "ready">("off")
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [countIn, setCountIn] = useState(false)
  const [speed, setSpeed] = useState(1)

  // alphaTab keeps these until its player exists.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.isLooping = loop
    view.countInVolume = countIn ? 1 : 0
    view.playbackSpeed = speed
  }, [loop, countIn, speed])

  /** Binds a view. `onReady` runs once the player exists, before a pending Play starts. */
  const attach = useCallback((view: AlphaTabApi, onReady: () => void) => {
    viewRef.current = view
    view.playerReady.on(() => {
      if (!armed.current) return
      setStatus("ready")
      onReady()
      if (!playWhenReady.current) return
      playWhenReady.current = false
      view.play()
    })
    view.playerStateChanged.on((event) => setPlaying(event.state === synth.PlayerState.Playing))
  }, [])

  const detach = useCallback(() => {
    viewRef.current = null
    armed.current = false
    playWhenReady.current = false
    setStatus("off")
    setPlaying(false)
  }, [])

  const arm = useCallback(() => {
    const view = viewRef.current
    if (!view || armed.current) return
    armed.current = true
    setStatus("loading")
    view.settings.player.playerMode = PlayerMode.EnabledSynthesizer
    view.updateSettings()
  }, [])

  const playOrStop = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    if (playing) return view.stop()
    if (status === "ready") return view.play()
    if (status === "loading") return
    playWhenReady.current = true
    arm()
  }, [playing, status, arm])

  return { attach, detach, arm, playOrStop, status, playing, loop, setLoop, countIn, setCountIn, speed, setSpeed }
}

export type Playback = ReturnType<typeof usePlayback>
