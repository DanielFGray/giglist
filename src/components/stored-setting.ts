import { useSyncExternalStore } from "react"

/**
 * A setting this browser keeps, as [value, set]. Every component that reads a
 * setting follows a change made by another one, and by another tab. When the
 * browser refuses storage (a private window, blocked site data), a change
 * lasts until the page reloads.
 */
export function useStoredSetting<T extends Stored>(setting: StoredSetting<T>): readonly [T, (value: T) => void] {
  const value = useSyncExternalStore(subscribe, () => setting.read(storedText(setting.key)))
  return [value, (next: T) => write(setting.key, next)] as const
}

/** A setting's storage key, and how its stored text (null when there is none) reads as a value. */
export interface StoredSetting<T extends Stored> {
  readonly key: string
  readonly read: (text: string | null) => T
}

/** A setting that is one of `values`; anything else reads as `fallback`. */
export const oneOf = <T extends string>(key: string, values: ReadonlyArray<T>, fallback: T): StoredSetting<T> => ({
  key,
  read: (text) => values.find((value) => value === text) ?? fallback,
})

/** An on or off setting. */
export const flag = (key: string, fallback: boolean): StoredSetting<boolean> => ({
  key,
  read: (text) => (text === "true" ? true : text === "false" ? false : fallback),
})

/** Values are primitives, so a read that finds the same text gives a value React sees as unchanged. */
type Stored = string | number | boolean | null

const listeners = new Set<() => void>()
/** What storage refused to keep, by key. */
const unstored = new Map<string, string | null>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function storedText(key: string): string | null {
  if (unstored.has(key)) return unstored.get(key) ?? null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: Stored) {
  const text = value === null ? null : String(value)
  try {
    if (text === null) localStorage.removeItem(key)
    else localStorage.setItem(key, text)
    unstored.delete(key)
  } catch {
    unstored.set(key, text)
  }
  for (const listener of listeners) listener()
}
