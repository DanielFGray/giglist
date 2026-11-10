/**
 * Linear prediction: models each sample as a weighted sum of the samples
 * before it. Fitted to a stretch of steady sound (ringing notes, noise), the
 * model predicts that sound well, so the prediction error stays small until
 * something the model has not seen, such as a new note, begins.
 */

/** Prediction weights of the given order for `samples`, by autocorrelation and Levinson-Durbin. */
export const predictor = (samples: ArrayLike<number>, order: number): Float64Array => {
  const n = samples.length
  const windowed = new Float64Array(n)
  for (let i = 0; i < n; i++) windowed[i] = samples[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n))
  const r = new Float64Array(order + 1)
  for (let lag = 0; lag <= order; lag++) {
    let sum = 0
    for (let i = lag; i < n; i++) sum += windowed[i]! * windowed[i - lag]!
    r[lag] = sum
  }
  // A tiny lift of the diagonal keeps the recursion stable on silence or pure tones.
  r[0] = r[0]! * (1 + 1e-9) + 1e-20
  const a = new Float64Array(order + 1)
  const previous = new Float64Array(order + 1)
  let error = r[0]!
  for (let i = 1; i <= order; i++) {
    let acc = r[i]!
    for (let j = 1; j < i; j++) acc -= a[j]! * r[i - j]!
    const reflection = acc / error
    previous.set(a)
    a[i] = reflection
    for (let j = 1; j < i; j++) a[j] = previous[j]! - reflection * previous[i - j]!
    error *= 1 - reflection * reflection
  }
  return a.subarray(1)
}

/** The prediction error of sample `at` of a signal read through `read`. */
export const predictionError = (weights: Float64Array, read: (i: number) => number, at: number): number => {
  let prediction = 0
  for (let j = 0; j < weights.length; j++) prediction += weights[j]! * read(at - 1 - j)
  return read(at) - prediction
}
