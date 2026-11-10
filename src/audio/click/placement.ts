import { PowerSpectrum } from "./fft"
import { predictionError, predictor } from "./lpc"

/**
 * Where a detected note starts, and the measures that placed it.
 *
 * All positions are context frames. The short windows start at `trainStart`,
 * one every `hop` frames; window w covers [trainStart + w·hop, + size).
 */
export interface Placement {
  /** The note start, or undefined when nothing in the search span rises above the sound before it. */
  readonly frame: number | undefined
  /** The training sound is [trainStart, searchStart); the note starts in [searchStart, searchEnd). */
  readonly trainStart: number
  readonly searchStart: number
  readonly searchEnd: number
  readonly size: number
  readonly hop: number
  /** Windows that lie wholly in the training sound. */
  readonly trainedWindows: number
  /** The prediction error's rise over the training sound. */
  readonly error: Rise
  /** The samples' own rise over the training sound. */
  readonly sound: Rise
}

/**
 * How a signal rises over the training sound, per short window, in the
 * instrument bins. Each bin is compared with its loudest in the training
 * windows, so in those windows both measures are 0.
 */
export interface Rise {
  /** The mean over the bins of the dB each rises, or 0 where it does not. */
  readonly db: Float64Array
  /** The power the bins add over their loudest. */
  readonly added: Float64Array
}

/**
 * Places a note in a span of mic samples where a detector found it, from the
 * sound just before the span (the training sound).
 *
 * Two signals rise when a note starts. The samples themselves rise when the
 * note adds power. The prediction error of a linear predictor fitted to the
 * training sound (lpc.ts) rises when the note brings a spectrum the training
 * sound did not have, such as a legato bass note at the old note's level. This
 * follows Glover, Lazzarini & Timoney (EURASIP 2011), who detect onsets by
 * linear-prediction error. Neither covers every note: the predictor treats a
 * new note in the old note's register as it treats the old note, so in room
 * noise only the samples show it.
 *
 * Each window takes the larger dB rise of the two (Rise.db). The note's rise is
 * the first window to reach half the largest, which finds the first note of a
 * strum, not the loudest. The dB scale finds the rise; it does not time it, as
 * high bins gain many dB as soon as a window touches the attack. The added
 * power does: when power steps up, a window's added power is half the level
 * after when the window's centre is on the step. So the note starts at the
 * centre of the window where the added power of the rising signal first
 * reaches half its first peak.
 */
export class NotePlacer {
  readonly size: number
  readonly hop: number
  /** Frames of training sound. */
  readonly trainFrames: number
  private readonly spectrum: PowerSpectrum
  private readonly isClickBin: Uint8Array
  private readonly instrumentBins: number
  /** Bin power that counts as silence: SILENCE_DB under a full-scale sine, which reads (size / 4)² in its bin. */
  private readonly silence: number

  /** `isClickBin` marks the click's bins in a spectrum of `size`, which the measures leave out. */
  constructor(sampleRate: number, size: number, hop: number, isClickBin: Uint8Array) {
    this.size = size
    this.hop = hop
    this.trainFrames = Math.round(TRAIN_SECONDS * sampleRate)
    this.spectrum = new PowerSpectrum(size)
    this.isClickBin = isClickBin
    this.instrumentBins = isClickBin.reduce((count, isClick) => count + (isClick === 0 ? 1 : 0), 0)
    this.silence = (size / 4) ** 2 * 10 ** (SILENCE_DB / 10)
  }

  /** Frames before `searchStart` that `place` reads. */
  get history(): number {
    return this.trainFrames + PREDICTOR_ORDER
  }

  /** Places the note that started in [searchStart, searchEnd). `read` must hold the frames from `searchStart - history`. */
  place(read: (frame: number) => number, searchStart: number, searchEnd: number): Placement {
    const { size, hop } = this
    const trainStart = searchStart - this.trainFrames
    const weights = predictor(
      Float64Array.from({ length: this.trainFrames }, (_, i) => read(trainStart + i)),
      PREDICTOR_ORDER,
    )
    const errors = Float64Array.from({ length: searchEnd - trainStart }, (_, i) => predictionError(weights, read, trainStart + i))
    const windows = Math.floor((errors.length - size) / hop) + 1
    const trainedWindows = Math.floor((this.trainFrames - size) / hop) + 1
    const error = this.rise(windows, trainedWindows, (w, i) => errors[w * hop + i]!)
    const sound = this.rise(windows, trainedWindows, (w, i) => read(trainStart + w * hop + i))
    const crossing = noteCrossing(error, sound, trainedWindows)
    return {
      frame: crossing === undefined ? undefined : trainStart + crossing * hop + size / 2,
      trainStart,
      searchStart,
      searchEnd,
      size,
      hop,
      trainedWindows,
      error,
      sound,
    }
  }

  /**
   * Compares each bin with its loudest in the first `trained` windows. The
   * loudest absorbs a low note's ripple, which a window shorter than its period
   * sees as power rising and falling with each cycle. Averaging dB over the bins
   * lets a broadband attack count in every bin, and keeps the loud low bins from
   * outweighing the rest (SuperFlux, Böck & Widmer, DAFx-13, compares bands the
   * same way).
   */
  private rise(windows: number, trained: number, sample: (w: number, i: number) => number): Rise {
    const spectra = Array.from({ length: windows }, (_, w) => {
      const power = new Float64Array(this.spectrum.bins)
      this.spectrum.compute((i) => sample(w, i), power)
      return power
    })
    const loudest = new Float64Array(this.spectrum.bins).fill(this.silence)
    for (let w = 0; w < trained; w++) spectra[w]!.forEach((p, b) => (loudest[b] = Math.max(loudest[b]!, p)))
    const db = new Float64Array(windows)
    const added = new Float64Array(windows)
    spectra.forEach((power, w) => {
      for (let b = 0; b < power.length; b++) {
        if (this.isClickBin[b] === 1 || power[b]! <= loudest[b]!) continue
        db[w] += (10 * Math.log10(power[b]! / loudest[b]!)) / this.instrumentBins
        added[w] += power[b]! - loudest[b]!
      }
    })
    return { db, added }
  }
}

/** The fractional window at the note's start, as NotePlacer describes; undefined when nothing rises. */
const noteCrossing = (error: Rise, sound: Rise, trained: number): number | undefined => {
  const db = error.db.map((errorDb, w) => Math.max(errorDb, sound.db[w]!))
  const top = Math.max(...db.subarray(trained))
  if (!(top > 0)) return undefined
  let rise = trained
  while (db[rise]! < top / 2) rise++
  const { added } = error.db[rise]! >= sound.db[rise]! ? error : sound
  let peak = rise
  while (peak + 1 < added.length && added[peak + 1]! >= added[peak]!) peak++
  // Training windows add nothing, so half the peak lies between them and the peak.
  const half = added[peak]! / 2
  let crossing = rise
  while (added[crossing]! < half) crossing++
  while (added[crossing - 1]! >= half) crossing--
  return crossing - 1 + (half - added[crossing - 1]!) / (added[crossing]! - added[crossing - 1]!)
}

/** Training sound before a note: enough to hold a full period of a low E on bass (24 ms), so its ripple is absorbed. */
const TRAIN_SECONDS = 0.04
/** Enough weights to model a dozen ringing partials. */
const PREDICTOR_ORDER = 24
/** A training window quieter than this counts as this, so a note after digital silence still rises above it. */
const SILENCE_DB = -120
