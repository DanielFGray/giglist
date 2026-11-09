import { clickBins } from "./click"
import { PowerSpectrum } from "./fft"
import { predictionError, predictor } from "./lpc"

/**
 * Finds note starts and click arrivals in a mic stream.
 *
 * Detection is SuperFlux (Böck & Widmer, DAFx-13): spectral flux against a
 * maximum-filtered earlier frame, so vibrato makes no onset. Placement by
 * linear-prediction error follows Glover, Lazzarini & Timoney (EURASIP 2011).
 * Both are in ATTRIBUTIONS.md.
 *
 * The spectrum is split into click bands and instrument bands (see click.ts).
 * A note is first detected, then placed:
 *
 * - Detection uses long windows (about 43 ms), fine enough in frequency to
 *   keep most partials of ringing notes apart; partials closer than that
 *   still beat, which the share-of-loudest rule below covers. A note
 *   start is a peak in the instrument bands' spectral flux: the summed rise
 *   of each bin's power on a log scale, log(1 + power / (1000 · floor)). The
 *   floor is the quietest median instrument-bin power in the last 2 s, so the
 *   flux does not change with the input gain: a quiet mic and a loud one
 *   detect the same notes. A peak counts only when it rises clear of the
 *   noise, of what a click alone leaks into these bands (clickLeak), and of a
 *   small share of the loudest recent note.
 * - Placement fits a linear predictor to the sound just before the note and
 *   follows the prediction error (see lpc.ts). Ringing notes are predictable
 *   and cancel out; the new note is not. The note starts where the error's
 *   instrument-band energy, in short windows (about 5 ms), crosses halfway
 *   from its floor to its peak.
 *
 * A click arrival is where the click-band energy added over the spectrum just
 * before it crosses half its peak. That carries a small fixed bias, which the
 * session measures on the clean click and removes.
 *
 * All times are context frames: sample indices on the AudioContext clock.
 */
export class Listener {
  readonly sampleRate: number
  private readonly fine: Resolution
  private readonly coarse: Resolution
  private readonly isClickBin: Uint8Array
  private readonly isCoarseClickBin: Uint8Array
  /** Fine power spectra, kept for placement, indexed by fine frame modulo their count. */
  private readonly spectra: Array<Float64Array>
  /** The last lag + 1 long-window power spectra, indexed by coarse frame modulo their count. */
  private readonly coarsePower: Array<Float64Array>
  /** Median instrument-bin power of the recent long windows, for the background floor; 0 is unfilled or silent. */
  private readonly levels: Float64Array
  private levelCount = 0
  private readonly binScratch: Float64Array
  private readonly ring: Float32Array
  private readonly mask: number
  private readonly peakRadius: number
  private readonly meanBefore: number
  private readonly minGap: number
  private readonly loudestWindow: number
  private origin = Number.NaN
  /** Context frame one past the last sample received. */
  private received = 0
  private readonly clickFlux = new Series()
  private readonly instrumentFlux = new Series()
  private readonly detection = new Series()
  private nextCandidate = 0
  private lastOnset = Number.NEGATIVE_INFINITY
  /**
   * The instrument-band flux that a click alone makes in this room, which the
   * session measures during the count-in. A note must rise above both the
   * noise (MIN_FLUX) and CLICK_LEAK_MARGIN times this; a speaker spreads some
   * of every click into the instrument bands, and in a quiet room that alone
   * would read as a note.
   */
  clickLeak = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    const size = 2 ** Math.ceil(Math.log2(sampleRate * FINE_WINDOW_SECONDS))
    this.fine = resolution(size, size / 8, 8)
    this.coarse = resolution(size * 8, size, 2)
    this.isClickBin = clickBins(this.fine.size, sampleRate)
    this.isCoarseClickBin = clickBins(this.coarse.size, sampleRate)
    const kept = Math.ceil((KEEP_SPECTRA_SECONDS * sampleRate) / this.fine.hop)
    this.spectra = Array.from({ length: kept }, () => new Float64Array(this.fine.spectrum.bins))
    this.coarsePower = Array.from({ length: this.coarse.lag + 1 }, () => new Float64Array(this.coarse.spectrum.bins))
    this.levels = new Float64Array(this.coarseFramesIn(FLOOR_SECONDS))
    this.binScratch = new Float64Array(this.isCoarseClickBin.reduce((count, isClick) => count + (isClick === 1 ? 0 : 1), 0))
    this.ring = new Float32Array(2 ** Math.ceil(Math.log2(sampleRate * RAW_KEEP_SECONDS)))
    this.mask = this.ring.length - 1
    this.peakRadius = this.coarseFramesIn(PEAK_RADIUS_SECONDS)
    this.meanBefore = this.coarseFramesIn(MEAN_BEFORE_SECONDS)
    this.minGap = this.coarseFramesIn(MIN_GAP_SECONDS)
    this.loudestWindow = this.coarseFramesIn(LOUDEST_SECONDS)
  }

  /**
   * Adds the next block of mic samples, which starts at context frame `start`,
   * and returns the context frames of the note starts it completes. A note is
   * reported about 60 ms after it starts, once the frames after it have arrived.
   */
  push(samples: Float32Array, start: number): Array<number> {
    if (Number.isNaN(this.origin)) {
      this.origin = start
      this.received = start
    }
    if (start !== this.received) throw new RangeError(`mic block starts at frame ${start}, expected ${this.received}`)
    // Each frame is analysed, and each onset placed, as soon as its last sample
    // arrives, so a block of any length reads only buffers that still hold its frames.
    const onsets: Array<number> = []
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.received & this.mask] = samples[i]!
      this.received++
      if (this.frameStart(this.fine, this.clickFlux.end) + this.fine.size <= this.received) this.analyseFine()
      if (this.frameStart(this.coarse, this.detection.end) + this.coarse.size <= this.received) {
        this.analyseCoarse()
        onsets.push(...this.pickOnsets())
      }
    }
    return onsets
  }

  /**
   * The context frame at which a click in [from, to) arrived, or undefined
   * when no click there stands clearly above the sound before it.
   */
  clickArrival(from: number, to: number): number | undefined {
    // placeClick reads the spectra from 2·lag frames before its peak; the oldest
    // held is frame 0 of this listener, or the ring's tail once it has wrapped.
    const oldest = Math.max(0, this.clickFlux.end - this.spectra.length)
    const first = Math.max(oldest + this.fine.lag * 2, Math.ceil(this.fineIndexAt(from)))
    const last = Math.min(this.clickFlux.end - 1 - this.fine.lag, Math.floor(this.fineIndexAt(to)))
    if (first > last) return undefined
    const rise = this.placeClick(argmax(this.clickFlux, first, last))
    return rise === undefined || rise.peak < rise.before * MIN_CLICK_RISE ? undefined : this.contextFrameAt(this.fine, rise.index)
  }

  /**
   * The largest detection flux within the peak radius of a click that arrived
   * at context frame `arrival`; undefined until the listener has analysed past it.
   */
  leakAt(arrival: number): number | undefined {
    const centre = Math.round((arrival - this.origin - this.coarse.size / 2) / this.coarse.hop)
    if (centre + this.peakRadius >= this.detection.end) return undefined
    let leak = 0
    for (let j = Math.max(this.detection.start, centre - this.peakRadius); j <= centre + this.peakRadius; j++) leak = Math.max(leak, this.detection.at(j))
    return leak
  }

  /** The context frame the next mic block must start at; NaN before the first block. */
  get expects(): number {
    return Number.isNaN(this.origin) ? Number.NaN : this.received
  }

  /** The last context frame that `clickArrival` can search up to. */
  get analysedUpTo(): number {
    return this.contextFrameAt(this.fine, this.clickFlux.end - 1 - this.fine.lag)
  }

  private analyseFine(): void {
    const k = this.clickFlux.end
    const power = this.spectra[k % this.spectra.length]!
    this.fine.spectrum.compute(this.reader(this.frameStart(this.fine, k)), power)
    normalise(power, this.fine.size)
    const before = k >= this.fine.lag ? this.spectra[(k - this.fine.lag) % this.spectra.length]! : undefined
    let click = 0
    let instrument = 0
    if (before !== undefined) {
      for (let b = 0; b < power.length; b++) {
        const rise = Math.max(0, power[b]! - before[b]!)
        if (this.isClickBin[b] === 1) click += rise
        else instrument += rise
      }
    }
    this.clickFlux.push(click)
    this.instrumentFlux.push(instrument)
    this.clickFlux.trim(KEEP_SERIES_FRAMES)
    this.instrumentFlux.trim(KEEP_SERIES_FRAMES)
  }

  private analyseCoarse(): void {
    const j = this.detection.end
    const { spectrum, size, lag } = this.coarse
    const power = this.coarsePower[j % (lag + 1)]!
    spectrum.compute(this.reader(this.frameStart(this.coarse, j)), power)
    normalise(power, size)
    const gain = this.compressionGain(power)
    let flux = 0
    if (j >= lag && gain > 0) {
      // Both spectra take the same gain, so a moving floor adds no flux of its own.
      const before = this.coarsePower[(j - lag) % (lag + 1)]!
      for (let b = 0; b < power.length; b++) {
        if (this.isCoarseClickBin[b] === 1) continue
        // Comparing against the loudest neighbour bin ignores small pitch wobble (vibrato, bends).
        const loudestBefore = Math.max(before[b]!, before[b - 1] ?? 0, before[b + 1] ?? 0)
        flux += Math.max(0, Math.log1p(gain * power[b]!) - Math.log1p(gain * loudestBefore))
      }
    }
    this.detection.push(flux)
    this.detection.trim(KEEP_SERIES_FRAMES)
    this.nextCandidate = Math.max(this.nextCandidate, this.detection.start)
  }

  /**
   * The gain before the log in the detection flux. The background floor is the
   * quietest median instrument-bin power over the last FLOOR_SECONDS: most bins
   * hold only background even while a note sounds. The log takes over
   * FLOOR_HEADROOM above that floor, so the flux, and every threshold on it,
   * does not change with the input gain. 0 until any sound has been heard;
   * windows of digital silence, which a missing input sends, do not count.
   */
  private compressionGain(power: Float64Array): number {
    let n = 0
    for (let b = 0; b < power.length; b++) if (this.isCoarseClickBin[b] === 0) this.binScratch[n++] = power[b]!
    this.levels[this.levelCount++ % this.levels.length] = this.binScratch.sort()[n >> 1]!
    let floor = Number.POSITIVE_INFINITY
    for (const level of this.levels) if (level > 0) floor = Math.min(floor, level)
    return floor === Number.POSITIVE_INFINITY ? 0 : 1 / (FLOOR_HEADROOM * floor)
  }

  private pickOnsets(): Array<number> {
    const onsets: Array<number> = []
    for (; this.nextCandidate + this.peakRadius < this.detection.end; this.nextCandidate++) {
      const j = this.nextCandidate
      if (j - this.lastOnset < this.minGap || !this.isDetectionPeak(j)) continue
      // The note started somewhere inside the long window that detected it.
      const centre = this.fineIndexAt(this.contextFrameAt(this.coarse, j))
      const reach = this.coarse.size / 2 / this.fine.hop
      const from = Math.max(this.instrumentFlux.start + this.fine.lag * 2, Math.ceil(centre - reach))
      const to = Math.min(this.instrumentFlux.end - 1 - this.fine.lag, Math.floor(centre + reach))
      if (from > to) continue
      const onset = this.placeNote(this.contextFrameAt(this.fine, argmax(this.instrumentFlux, from, to)))
      if (onset === undefined) continue
      this.lastOnset = j
      onsets.push(onset)
    }
    return onsets
  }

  private isDetectionPeak(j: number): boolean {
    const value = this.detection.at(j)
    if (value < Math.max(MIN_FLUX, CLICK_LEAK_MARGIN * this.clickLeak, LOUDEST_FRACTION * this.loudestBefore(j))) return false
    for (let i = Math.max(this.detection.start, j - this.peakRadius); i <= j + this.peakRadius; i++) {
      if (this.detection.at(i) > value) return false
    }
    let sum = 0
    const from = Math.max(this.detection.start, j - this.meanBefore)
    for (let i = from; i <= j + this.peakRadius; i++) sum += this.detection.at(i)
    return value >= (sum / (j + this.peakRadius - from + 1)) * MIN_PEAK_OVER_MEAN
  }

  /**
   * The largest flux in the LOUDEST_SECONDS before frame `j`, leaving out the
   * peak radius around `j` itself. Ringing notes beat where their partials meet,
   * and each beat is a small rise; against a quiet background those rises clear
   * MIN_FLUX, so a peak must also be a fair share of the notes just played.
   */
  private loudestBefore(j: number): number {
    let loudest = 0
    for (let i = Math.max(this.detection.start, j - this.loudestWindow); i < j - this.peakRadius; i++) loudest = Math.max(loudest, this.detection.at(i))
    return loudest
  }

  /**
   * Places a note that the flux puts near context frame `near`, which may be
   * up to about 10 ms after the real start. A predictor is fitted to the sound
   * before that, and the note starts where the instrument-band energy of the
   * prediction error crosses halfway from its floor to its peak.
   */
  private placeNote(near: number): number | undefined {
    const { size, hop, spectrum } = this.fine
    const trainEnd = Math.floor(near - TRAIN_GAP_WINDOWS * size)
    const trainStart = trainEnd - Math.round(TRAIN_SECONDS * this.sampleRate)
    if (trainStart - PREDICTOR_ORDER < Math.max(this.origin, this.received - this.ring.length)) return undefined
    const read = (frame: number) => this.ring[frame & this.mask]!
    const weights = predictor(
      Float64Array.from({ length: trainEnd - trainStart }, (_, i) => read(trainStart + i)),
      PREDICTOR_ORDER,
    )
    const end = Math.min(this.received, Math.ceil(near + 3 * size))
    const error = Float64Array.from({ length: end - trainEnd }, (_, i) => predictionError(weights, read, trainEnd + i))
    const power = new Float64Array(spectrum.bins)
    const energy: Array<number> = []
    for (let start = 0; start + size <= error.length; start += hop) {
      spectrum.compute((i) => error[start + i]!, power)
      let sum = 0
      for (let b = 0; b < power.length; b++) if (this.isClickBin[b] === 0) sum += power[b]!
      energy.push(sum)
    }
    const top = energy.indexOf(Math.max(...energy))
    if (top <= 0) return undefined
    const bottom = energy.lastIndexOf(Math.min(...energy.slice(0, top)), top)
    const half = (energy[bottom]! + energy[top]!) / 2
    let crossing = bottom + 1
    while (energy[crossing]! < half) crossing++
    const fraction = (half - energy[crossing - 1]!) / (energy[crossing]! - energy[crossing - 1]!)
    return trainEnd + (crossing - 1 + fraction) * hop + size / 2
  }

  /**
   * Places a click near fine frame `near`: the fractional fine frame where the
   * click-band energy added over the spectrum two windows earlier crosses half its peak.
   */
  private placeClick(near: number): Rise | undefined {
    const reference = this.spectra[(near - this.fine.lag * 2) % this.spectra.length]!
    let before = 0
    for (let b = 0; b < reference.length; b++) if (this.isClickBin[b] === 1) before += reference[b]!
    const added: Array<number> = []
    for (let k = near - this.fine.lag * 2 + 1; k <= near + this.fine.lag; k++) {
      const power = this.spectra[k % this.spectra.length]!
      let sum = 0
      for (let b = 0; b < power.length; b++) if (this.isClickBin[b] === 1) sum += Math.max(0, power[b]! - reference[b]!)
      added.push(sum)
    }
    const peak = Math.max(...added)
    if (peak <= 0) return undefined
    const crossing = added.findIndex((value) => value >= peak / 2)
    const prior = crossing === 0 ? 0 : added[crossing - 1]!
    const fraction = (peak / 2 - prior) / (added[crossing]! - prior)
    return { index: near - this.fine.lag * 2 + crossing + fraction, peak, before }
  }

  private reader(start: number): (i: number) => number {
    return (i) => this.ring[(start + i) & this.mask]!
  }

  private frameStart(resolution: Resolution, index: number): number {
    return this.origin + index * resolution.hop
  }

  /** The context frame at the centre of a frame, which may be fractional. */
  private contextFrameAt(resolution: Resolution, index: number): number {
    return this.origin + index * resolution.hop + resolution.size / 2
  }

  private fineIndexAt(contextFrame: number): number {
    return (contextFrame - this.origin - this.fine.size / 2) / this.fine.hop
  }

  private coarseFramesIn(seconds: number): number {
    return Math.max(1, Math.round((seconds * this.sampleRate) / this.coarse.hop))
  }
}

/** The short analysis window, about 5 ms: short enough to place an attack within a millisecond. */
const FINE_WINDOW_SECONDS = 0.005
/** The background floor is the quietest level over this long. */
const FLOOR_SECONDS = 2
/** How far above the background floor, as a power ratio, the detection flux turns from linear to logarithmic. */
const FLOOR_HEADROOM = 1000
/** A detection peak must be the largest within this distance on each side. */
const PEAK_RADIUS_SECONDS = 0.03
const MEAN_BEFORE_SECONDS = 0.1
const MIN_GAP_SECONDS = 0.05
/** Noise alone stays under about 0.4 at FLOOR_HEADROOM; a note 25 dB over the noise reaches about 4. */
const MIN_FLUX = 3
/** How far a note must rise above the flux of a click alone. */
const CLICK_LEAK_MARGIN = 2
/** A note's flux must be at least this share of the loudest flux in the last LOUDEST_SECONDS. A drum 30 dB under the loudest gives about 4%; a beat between ringing partials about 0.25%. */
const LOUDEST_FRACTION = 0.01
const LOUDEST_SECONDS = 2
const MIN_PEAK_OVER_MEAN = 1.5
/** A click must add this many times the click-band energy that came before it, about 10 dB. */
const MIN_CLICK_RISE = 10
const KEEP_SPECTRA_SECONDS = 1
/** Raw samples kept for note placement, which runs about 70 ms after a note starts. */
const RAW_KEEP_SECONDS = 0.3
/** The predictor learns from this much sound before a note. */
const TRAIN_SECONDS = 0.02
/** Short windows between the end of the predictor's sound and the flux's estimate of the note. */
const TRAIN_GAP_WINDOWS = 3
/** Enough weights to model a dozen ringing partials. */
const PREDICTOR_ORDER = 24
const KEEP_SERIES_FRAMES = 8192

interface Resolution {
  readonly size: number
  readonly hop: number
  /** Frames between the two spectra a flux compares. */
  readonly lag: number
  readonly spectrum: PowerSpectrum
}

const resolution = (size: number, hop: number, lag: number): Resolution => ({ size, hop, lag, spectrum: new PowerSpectrum(size) })

interface Rise {
  readonly index: number
  readonly peak: number
  /** Energy in the same bands just before the rise. */
  readonly before: number
}

/** Scales power so that a full-scale sine reads 1 in its bin. */
const normalise = (power: Float64Array, size: number): void => {
  const scale = (size / 4) ** 2
  for (let b = 0; b < power.length; b++) power[b] = power[b]! / scale
}

const argmax = (series: Series, from: number, to: number): number => {
  let best = from
  for (let k = from; k <= to; k++) if (series.at(k) > series.at(best)) best = k
  return best
}

/** A growing sequence of numbers indexed from a moving start, so old values can be dropped. */
class Series {
  private values: Array<number> = []
  private base = 0

  get start(): number {
    return this.base
  }

  get end(): number {
    return this.base + this.values.length
  }

  at(index: number): number {
    return this.values[index - this.base] ?? 0
  }

  push(value: number): void {
    this.values.push(value)
  }

  /** Keeps at most `keep` values, dropping the oldest in batches because each drop moves every kept value. */
  trim(keep: number): void {
    if (this.values.length < keep * 2) return
    const drop = this.values.length - keep
    this.values.splice(0, drop)
    this.base += drop
  }
}
