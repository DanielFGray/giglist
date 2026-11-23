import { useEffect } from "react"
import { type StoredSetting, useStoredSetting } from "./stored-setting"

export function ThemeToggle() {
  const [theme, setTheme] = useStoredSetting(THEME)

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove("dark", "light")
    root.classList.add(theme)
  }, [theme])

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="relative size-8 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}

/**
 * Light or dark; the system's choice until the player picks one. The script in
 * index.html reads the same key before the first paint, so keep the two alike.
 */
const THEME: StoredSetting<"dark" | "light"> = {
  key: "setlist-theme",
  read: (text) => (text === "dark" || text === "light" ? text : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"),
}
