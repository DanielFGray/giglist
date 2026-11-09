/**
 * Power spectra of fixed-size real frames, by an in-place radix-2 FFT.
 * One instance owns its scratch buffers, so a call allocates nothing.
 */
export class PowerSpectrum {
  readonly size: number
  readonly bins: number
  private readonly window: Float64Array
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly reversed: Uint32Array

  constructor(size: number) {
    if (!Number.isInteger(Math.log2(size))) throw new RangeError(`FFT size ${size} is not a power of two`)
    this.size = size
    this.bins = size / 2 + 1
    this.window = hann(size)
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)
    this.cos = new Float64Array(size / 2)
    this.sin = new Float64Array(size / 2)
    for (let k = 0; k < size / 2; k++) {
      this.cos[k] = Math.cos((-2 * Math.PI * k) / size)
      this.sin[k] = Math.sin((-2 * Math.PI * k) / size)
    }
    this.reversed = bitReversal(size)
  }

  /**
   * Writes the power of each bin of the Hann-windowed frame into `out`.
   * `read(i)` returns sample i of the frame, so the caller can read a ring buffer.
   */
  compute(read: (i: number) => number, out: Float64Array): void {
    const { size, re, im, window, reversed } = this
    for (let i = 0; i < size; i++) {
      const j = reversed[i]!
      re[j] = read(i) * window[i]!
      im[j] = 0
    }
    for (let half = 1; half < size; half *= 2) {
      const step = size / (2 * half)
      for (let start = 0; start < size; start += 2 * half) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step]!
          const s = this.sin[k * step]!
          const a = start + k
          const b = a + half
          const tr = re[b]! * c - im[b]! * s
          const ti = re[b]! * s + im[b]! * c
          re[b] = re[a]! - tr
          im[b] = im[a]! - ti
          re[a] = re[a]! + tr
          im[a] = im[a]! + ti
        }
      }
    }
    for (let k = 0; k < this.bins; k++) out[k] = re[k]! * re[k]! + im[k]! * im[k]!
  }
}

const hann = (size: number): Float64Array => {
  const window = new Float64Array(size)
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
  return window
}

const bitReversal = (size: number): Uint32Array => {
  const bits = Math.log2(size)
  const table = new Uint32Array(size)
  for (let i = 0; i < size; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1)
    table[i] = r
  }
  return table
}
