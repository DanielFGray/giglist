import { isValidOptionValue, type ThemeOption } from "./band-theme"

/** A field for each option a theme declares, so its owner changes the look without touching HTML. */
export function ThemeOptionFields({
  options,
  chosen,
  onChange,
  pwidPrefix,
}: {
  options: ReadonlyArray<ThemeOption>
  chosen: Readonly<Record<string, string>>
  onChange: (key: string, value: string) => void
  /** Band settings say `band-public-option-…`; account settings say `settings-theme-option-…`. */
  pwidPrefix: string
}) {
  if (options.length === 0) return null
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const value = chosen[option.key] ?? option.default
        const pwid = `${pwidPrefix}${option.kind}-${option.name.replaceAll(" ", "")}`
        const invalid = value !== option.default && !isValidOptionValue(option.kind, value)
        return (
          <label key={option.key} className={`text-sm space-y-1 ${option.kind === "image" ? "sm:col-span-2" : ""}`}>
            {option.kind === "color" && (
              <span className="flex items-center gap-2 cursor-pointer">
                <input
                  data-pwid={pwid}
                  type="color"
                  value={value}
                  onChange={(e) => onChange(option.key, e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-[var(--color-border-subtle)] bg-transparent"
                />
                {option.name}
              </span>
            )}
            {option.kind === "if" && (
              <span className="flex items-center gap-2 cursor-pointer">
                <input
                  data-pwid={pwid}
                  type="checkbox"
                  checked={value === "true"}
                  onChange={(e) => onChange(option.key, String(e.target.checked))}
                  className="rounded border-[var(--color-border-subtle)]"
                />
                {option.name}
              </span>
            )}
            {(option.kind === "image" || option.kind === "text") && (
              <>
                <span className="block text-zinc-300">
                  {option.name}
                  {option.kind === "image" && <span className="text-zinc-500"> (image link)</span>}
                </span>
                <input
                  data-pwid={pwid}
                  type={option.kind === "image" ? "url" : "text"}
                  value={value}
                  placeholder={option.kind === "image" ? "https://…" : undefined}
                  onChange={(e) => onChange(option.key, e.target.value)}
                  className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1"
                />
                {invalid && (
                  <span className="block text-xs text-amber-400">
                    Use an http or https link without quotes, spaces or brackets; the page shows no image until then.
                  </span>
                )}
              </>
            )}
          </label>
        )
      })}
    </div>
  )
}
