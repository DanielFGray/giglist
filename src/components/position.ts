import { Option } from "effect"

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

/** A row ordered by its key, as the server reads it. */
export type KeyedRow = { readonly id: string; readonly position_key: string }

/** Keys longer than this make the whole group renumber, so keys stay short. */
const LONGEST_KEY = 32

/**
 * The key writes that put `movedId` right after `previousId` (first when it is
 * null). `siblings` are the other rows of the group, in order. Usually one
 * write: a key between the new neighbours. When that key would be too long,
 * every row of the group gets a fresh key. None when `previousId` is not a
 * sibling, so a move can only name a neighbour in the same group.
 */
export function placeAfter(
  siblings: ReadonlyArray<KeyedRow>,
  movedId: string,
  previousId: string | null,
): Option.Option<Array<KeyedRow>> {
  const index = previousId === null ? 0 : siblings.findIndex((row) => row.id === previousId) + 1
  if (index === 0 && previousId !== null) return Option.none()
  const key = between(siblings[index - 1]?.position_key ?? null, siblings[index]?.position_key ?? null)
  if (key.length <= LONGEST_KEY) return Option.some([{ id: movedId, position_key: key }])
  const ids = [...siblings.slice(0, index).map((row) => row.id), movedId, ...siblings.slice(index).map((row) => row.id)]
  const keys = rebalance(ids.length)
  return Option.some(ids.map((id, at) => ({ id, position_key: keys[at]! })))
}
