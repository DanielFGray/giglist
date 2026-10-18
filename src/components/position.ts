/** Sortable, base-62 position keys. ASCII order matches this alphabet. */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const BASE = DIGITS.length

/**
 * Return a key strictly between the two keys. Null means unbounded. Walks both
 * keys digit by digit: where a free digit lies between the two, take it; where
 * not, copy the lower digit, and once the copy is below the upper key the upper
 * bound no longer matters.
 */
export function between(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) throw new Error("Position bounds are not ordered")
  let upper = after
  let result = ""
  for (let index = 0; ; index += 1) {
    const low = before === null || index >= before.length ? -1 : DIGITS.indexOf(before[index]!)
    const high = upper === null || index >= upper.length ? BASE : DIGITS.indexOf(upper[index]!)
    // A key ending in the lowest digit would leave no room before it, so that digit is only ever a prefix.
    if (high - low > 1 && high > 1) return result + DIGITS[Math.max(1, Math.floor((low + high) / 2))]
    if (low < 0 && high === 0 && upper !== null && index === upper.length - 1) throw new Error("No position key exists between these neighbours")
    const digit = Math.max(low, 0)
    result += DIGITS[digit]
    if (digit < high) upper = null
  }
}

/** Give sorted siblings fresh, evenly spaced keys. */
export function rebalance(count: number): Array<string> {
  if (count < 0 || !Number.isInteger(count)) throw new Error("Count must be a non-negative integer")
  const width = Math.max(2, Math.ceil(Math.log(count + 1) / Math.log(BASE)) + 1)
  const step = Math.floor(BASE ** width / (count + 1))
  return Array.from({ length: count }, (_, index) => {
    let value = (index + 1) * step
    let key = ""
    for (let digitIndex = width - 1; digitIndex >= 0; digitIndex -= 1) {
      const place = BASE ** digitIndex
      const next = Math.floor(value / place)
      key += DIGITS[next]
      value -= next * place
    }
    // The closing mid digit keeps every key off the lowest digit, which would leave no room before it.
    return key + DIGITS[Math.floor(BASE / 2)]
  })
}
