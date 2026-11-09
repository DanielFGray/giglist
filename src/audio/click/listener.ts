import { clickBins, clickToneBins } from "./click"
import { PowerSpectrum } from "./fft"
import { predictionError, predictor } from "./lpc"

/**
 * Finds note starts and click arrivals in a mic stream.
 *
 * The spectrum is split into click bands and instrument bands (see click.ts).
 * A note is first detected, then placed:
 *
 * - Detection is SuperFlux (Böck & Widmer, DAFx-13), as its reference
 *   implementation SuperFlux.py runs offline: long windows (about 43 ms), the
 *   magnitude spectrum pooled into 24 bands per octave and compressed as
 *   log10(1 + magnitude), and the summed rise of each band over the loudest of
 *   its three neighbours two frames earlier, so vibrato makes no onset. A
 *   peak is a note when it is the largest from 10 ms before to 70 ms after it,
 *   and rises DELTA over twice the median of the 150 ms before it (Böck,
 *   Krebs & Schedl, ISMIR 2012, with the median of Bello et al. 2005). Only
 *   the instrument bands count, and in a room where the mic hears the click,
 *   a peak must also clear what a click alone leaks into them (clickLeak).
 *
 *   The reference reads files at a normal recording level, and its
 *   thresholds assume that level. A mic has any gain, so before the log each
 *   window is scaled so that the loudest band of the last few seconds reads
 *   LOUDEST_BAND. The flux is then the same at any input gain.
 * - Placement fits a linear predictor to the sound just before the note and
 *   follows the prediction error (see lpc.ts). Ringing notes are predictable
 *   and cancel out; the new note is not. The note starts where the error's
 *   instrument-band energy, in short windows (about 5 ms), crosses halfway
 *   from its floor to its peak. This follows Glover, Lazzarini & Timoney
 *   (EURASIP 2011), who detect onsets by linear-prediction error.
 *
 * The papers are in ATTRIBUTIONS.md.
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
  /** Where the click's arrival is looked for (clickToneBins). */
  private readonly toneBins: ReturnType<typeof clickToneBins>
  /** Fine power spectra, kept for placement, indexed by fine frame modulo their count. */
  private readonly spectra: Array<Float64Array>
  /** Instrument bands of the long windows (see logBands). */
  private readonly bands: ReadonlyArray<Band>
  /** The band magnitudes of the last lag + 1 long windows, indexed by coarse frame modulo their count. */
  private readonly bandSpectra: Array<Float64Array>
  /** Each long window's loudest band magnitude over the last LEVEL_SECONDS, indexed by coarse frame modulo their count. */
  private readonly loudestBands: Float64Array
  private readonly coarsePower: Float64Array
  private readonly ring: Float32Array
  private readonly mask: number
  private readonly peakBefore: number
  private readonly merge: number
  private readonly medianBefore: number
  private readonly recent: Float64Array
  private readonly leakRadius: number
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
   * session measures during the count-in. A note must rise to
   * CLICK_LEAK_MARGIN times this: a speaker spreads some of every click into
   * the instrument bands, and in a quiet room that alone would read as a note.
   */
  clickLeak = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    const size = 2 ** Math.ceil(Math.log2(sampleRate * FINE_WINDOW_SECONDS))
    this.fine = resolution(size, size / 8, 8)
    this.coarse = resolution(size * 8, size, 2)
    this.isClickBin = clickBins(this.fine.size, sampleRate)
    this.toneBins = clickToneBins(this.fine.size, sampleRate)
    const kept = Math.ceil((KEEP_SPECTRA_SECONDS * sampleRate) / this.fine.hop)
    this.spectra = Array.from({ length: kept }, () => new Float64Array(this.fine.spectrum.bins))
    this.bands = logBands(this.coarse.size, sampleRate, clickBins(this.coarse.size, sampleRate))
    this.bandSpectra = Array.from({ length: this.coarse.lag + 1 }, () => new Float64Array(this.bands.length))
    this.loudestBands = new Float64Array(this.coarseFramesIn(LEVEL_SECONDS))
    this.coarsePower = new Float64Array(this.coarse.spectrum.bins)
    this.ring = new Float32Array(2 ** Math.ceil(Math.log2(sampleRate * RAW_KEEP_SECONDS)))
    this.mask = this.ring.length - 1
    this.peakBefore = this.coarseFramesIn(PEAK_BEFORE_SECONDS)
    this.merge = this.coarseFramesIn(MERGE_SECONDS)
    this.medianBefore = this.coarseFramesIn(MEDIAN_BEFORE_SECONDS)
    this.recent = new Float64Array(this.medianBefore + 1)
    this.leakRadius = this.coarseFramesIn(LEAK_RADIUS_SECONDS)
  }

  /**
   * Adds the next block of mic samples, which starts at context frame `start`,
   * and returns the context frames of the note starts it completes. A note is
   * reported about 100 ms after it starts, once the frames after it have arrived.
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
    if (centre + this.leakRadius >= this.detection.end) return undefined
    let leak = 0
    for (let j = Math.max(this.detection.start, centre - this.leakRadius); j <= centre + this.leakRadius; j++) leak = Math.max(leak, this.detection.at(j))
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
    let instrument = 0
    if (before !== undefined) for (let b = 0; b < power.length; b++) if (this.isClickBin[b] === 0) instrument += Math.max(0, power[b]! - before[b]!)
    this.clickFlux.push(before === undefined ? 0 : this.toneRise(power, before))
    this.instrumentFlux.push(instrument)
    this.clickFlux.trim(KEEP_SERIES_FRAMES)
    this.instrumentFlux.trim(KEEP_SERIES_FRAMES)
  }

  private analyseCoarse(): void {
    const j = this.detection.end
    const { spectrum, lag } = this.coarse
    // The power is unscaled, as SuperFlux takes the magnitude: a full-scale sine reads size / 4 in its bin.
    spectrum.compute(this.reader(this.frameStart(this.coarse, j)), this.coarsePower)
    const magnitudes = this.bandSpectra[j % (lag + 1)]!
    let loudestBand = 0
    this.bands.forEach((band, i) => {
      let magnitude = 0
      band.weights.forEach((weight, k) => (magnitude += weight * Math.sqrt(this.coarsePower[band.first + k]!)))
      magnitudes[i] = magnitude
      loudestBand = Math.max(loudestBand, magnitude)
    })
    this.loudestBands[j % this.loudestBands.length] = loudestBand
    // Both windows take the same scale, so a change of level adds no flux of its own.
    // Digital silence, which a missing input sends, gives a scale of 0 and so no flux.
    const level = Math.max(...this.loudestBands)
    const lambda = level > 0 ? LOUDEST_BAND / level : 0
    let flux = 0
    if (j >= lag) {
      const before = this.bandSpectra[(j - lag) % (lag + 1)]!
      for (let i = 0; i < magnitudes.length; i++) {
        // Comparing against the loudest neighbour band ignores small pitch wobble (vibrato, bends).
        const loudestBefore = Math.max(before[i]!, before[i - 1] ?? 0, before[i + 1] ?? 0)
        flux += Math.max(0, Math.log10(1 + lambda * magnitudes[i]!) - Math.log10(1 + lambda * loudestBefore))
      }
    }
    this.detection.push(flux)
    this.detection.trim(KEEP_SERIES_FRAMES)
    this.nextCandidate = Math.max(this.nextCandidate, this.detection.start)
  }

  private pickOnsets(): Array<number> {
    const onsets: Array<number> = []
    for (; this.nextCandidate + this.merge < this.detection.end; this.nextCandidate++) {
      const j = this.nextCandidate
      if (j - this.lastOnset <= this.merge || !this.isDetectionPeak(j)) continue
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

  /**
   * SuperFlux's peak picking: the largest flux from PEAK_BEFORE_SECONDS before
   * to MERGE_SECONDS after, and DELTA over MEDIAN_WEIGHT times the median of
   * the MEDIAN_BEFORE_SECONDS up to it. Looking ahead lets the loudest of two
   * close rises win, such as a note just after the noise of the last one
   * being stopped.
   */
  private isDetectionPeak(j: number): boolean {
    const value = this.detection.at(j)
    if (value < CLICK_LEAK_MARGIN * this.clickLeak) return false
    for (let i = j - this.peakBefore; i <= j + this.merge; i++) if (this.detection.at(i) > value) return false
    // The reference counts flux before the first frame as zero, which suits a
    // file that starts in silence. A mic opens mid-sound, so the median takes
    // only the flux measured so far (the first frame with flux is `lag`).
    const from = Math.max(this.coarse.lag, j - this.medianBefore)
    const recent = this.recent.subarray(0, j - from + 1)
    for (let i = from; i <= j; i++) recent[i - from] = this.detection.at(i)
    const median = recent.sort()[recent.length >> 1]!
    return value >= DELTA + MEDIAN_WEIGHT * median
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
    for (const b of this.toneBins.tone) before += reference[b]!
    const added: Array<number> = []
    for (let k = near - this.fine.lag * 2 + 1; k <= near + this.fine.lag; k++) {
      added.push(this.toneRise(this.spectra[k % this.spectra.length]!, reference))
    }
    const peak = Math.max(...added)
    if (peak <= 0) return undefined
    const crossing = added.findIndex((value) => value >= peak / 2)
    const prior = crossing === 0 ? 0 : added[crossing - 1]!
    const fraction = (peak / 2 - prior) / (added[crossing]! - prior)
    return { index: near - this.fine.lag * 2 + crossing + fraction, peak, before }
  }


  /**
   * The power `power` adds over `reference` in the click's tone band, less
   * what it adds in the bands beside it (clickToneBins). A click shows here;
   * a sound that rises across the spectrum, such as a drum, cancels out.
   */
  private toneRise(power: Float64Array, reference: Float64Array): number {
    const { tone, sides } = this.toneBins
    let toneRise = 0
    for (const b of tone) toneRise += Math.max(0, power[b]! - reference[b]!)
    let sideRise = 0
    for (const b of sides) sideRise += Math.max(0, power[b]! - reference[b]!)
    return Math.max(0, toneRise - (sideRise * tone.length) / sides.length)
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
/** SuperFlux's offline defaults: 24 bands per octave from 30 Hz to 17 kHz, and its peak picking, except MERGE_SECONDS and MEDIAN_WEIGHT. */
const BANDS_PER_OCTAVE = 24
const MIN_BAND_HZ = 30
const MAX_BAND_HZ = 17000
const PEAK_BEFORE_SECONDS = 0.01
const MEDIAN_BEFORE_SECONDS = 0.15
const DELTA = 1.1
/**
 * The reference adds DELTA to the mean flux. Here the threshold follows the
 * median instead (Bello et al., IEEE TSAP 2005), scaled so that loud steady
 * noise, such as a cymbal wash, does not reach it by chance. The median also
 * ignores the one large peak of the note before.
 */
const MEDIAN_WEIGHT = 2
/**
 * A note is the largest rise from PEAK_BEFORE_SECONDS before it to this long
 * after it, and a rise this soon after a note is part of that note. A strum or
 * a slow attack rises for up to about 60 ms; 16th notes at 200 BPM are 75 ms
 * apart. The reference looks 50 ms ahead and merges 30 ms, which splits a strum
 * into two notes.
 */
const MERGE_SECONDS = 0.07
/**
 * Before the log, the loudest band of the last LEVEL_SECONDS is scaled to this
 * magnitude. Between about 20 and 100 the same notes are found. Much lower,
 * quiet notes stay in the linear part of the log and are lost; much higher,
 * steady noise with nothing played is scaled up until its own rises read as notes.
 */
const LOUDEST_BAND = 50
/** The level follows the loudest sound of this long, so one loud hit does not set the scale for the rest of the take. */
const LEVEL_SECONDS = 4
/** How far a note must rise above the flux of a click alone. */
const CLICK_LEAK_MARGIN = 2
/** The click's leak is the largest flux this close to its arrival. */
const LEAK_RADIUS_SECONDS = 0.03
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

/** A triangular filter over the FFT bins from `first` on. */
interface Band {
  readonly first: number
  readonly weights: Float64Array
}

/**
 * SuperFlux's filterbank for an FFT of `size`: triangles of height 1 whose
 * edges and peaks lie BANDS_PER_OCTAVE to the octave, tuned to A 440 and
 * rounded to bins, with repeated bins merged. The click bins get no weight,
 * and a band left with none is dropped.
 */
const logBands = (size: number, sampleRate: number, isClickBin: Uint8Array): Array<Band> => {
  const bins = size / 2
  const factor = 2 ** (1 / BANDS_PER_OCTAVE)
  const top = Math.min(MAX_BAND_HZ, sampleRate / 2)
  // Each list runs one step past its limit, which serves as the outer band's outer edge.
  const hz = [440]
  for (let f = 440; f <= top; ) hz.push((f *= factor))
  for (let f = 440; f >= MIN_BAND_HZ; ) hz.push((f /= factor))
  const edges = [...new Set(hz.map((f) => Math.round(f / (sampleRate / 2 / bins))))].filter((bin) => bin < bins).sort((a, b) => a - b)
  const bands: Array<Band> = []
  for (let i = 0; i + 2 < edges.length; i++) {
    const [start, mid, stop] = [edges[i]!, edges[i + 1]!, edges[i + 2]!]
    const weights = Float64Array.from({ length: stop - start }, (_, k) =>
      isClickBin[start + k] === 1 ? 0 : k < mid - start ? k / (mid - start) : 1 - (k - (mid - start)) / (stop - mid),
    )
    if (weights.some((weight) => weight > 0)) bands.push({ first: start, weights })
  }
  return bands
}

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
