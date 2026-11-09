/**
 * The metronome click is a short tone at one pitch. The mic hears it through
 * the speakers, so the listener splits the spectrum in two: the click bands
 * show where the click arrived, and every other band shows the instrument.
 *
 * The click bands are the tone and the harmonics a distorting speaker adds:
 * the 2nd and 3rd above it, and the low thump below it (even-order distortion
 * turns the click's envelope into a pulse under 100 Hz).
 *
 * The envelope is a Gaussian, because a Gaussian keeps the tone's energy
 * within about ±150 Hz of its pitch. A sharper attack would be easier to hear
 * as a point in time, but it spreads energy into the instrument bands, where
 * every click would then read as a note.
 */
export const CLICK_PITCH_HZ = 2000
/** Half the width of each tone band. It holds the tone's spread and the analysis window's leakage. */
export const CLICK_BAND_HALF_WIDTH_HZ = 500
/** The top of the thump band. Low notes keep their fundamentals above it. */
const THUMP_TOP_HZ = 150
const CLICK_HARMONICS = 3
/** The envelope's standard deviation. */
const SIGMA_SECONDS = 0.003
/** The waveform runs this many standard deviations each side of its peak; the envelope is below -100 dB at its ends. */
const HALF_LENGTH_SIGMAS = 5

/**
 * Seconds from the waveform's first sample to the moment the click sounds:
 * where its power reaches half its peak. A note is placed by the same rule
 * (listener.ts), so a note played with the click reads 0 ms.
 */
export const CLICK_ONSET_SECONDS = (HALF_LENGTH_SIGMAS - Math.sqrt(Math.LN2)) * SIGMA_SECONDS

/** Songs have no time signature, so a bar is four beats; the first of each is accented. */
export const BEATS_PER_BAR = 4
/** Two bars: the session needs at least four clicks to measure the speaker-to-mic delay. */
export const COUNT_IN_BEATS = 2 * BEATS_PER_BAR
export const ACCENT_GAIN = 1
export const BEAT_GAIN = 0.55

/** The click waveform at peak 1: a tone under a Gaussian envelope. */
export const clickWaveform = (sampleRate: number): Float32Array => {
  const sigma = SIGMA_SECONDS * sampleRate
  const half = Math.round(HALF_LENGTH_SIGMAS * sigma)
  return Float32Array.from(
    { length: 2 * half },
    (_, i) => Math.exp(-(((i - half) / sigma) ** 2) / 2) * Math.sin((2 * Math.PI * CLICK_PITCH_HZ * i) / sampleRate),
  )
}

/** Marks each bin of an FFT of `size` that lies in a click band. */
export const clickBins = (size: number, sampleRate: number): Uint8Array => {
  const bins = size / 2 + 1
  const binHz = sampleRate / size
  const marks = new Uint8Array(bins)
  const mark = (lowHz: number, highHz: number) => {
    for (let k = Math.max(0, Math.floor(lowHz / binHz)); k <= Math.min(bins - 1, Math.ceil(highHz / binHz)); k++) marks[k] = 1
  }
  mark(0, THUMP_TOP_HZ)
  for (let harmonic = 1; harmonic <= CLICK_HARMONICS; harmonic++) {
    mark(harmonic * CLICK_PITCH_HZ - CLICK_BAND_HALF_WIDTH_HZ, harmonic * CLICK_PITCH_HZ + CLICK_BAND_HALF_WIDTH_HZ)
  }
  return marks
}
