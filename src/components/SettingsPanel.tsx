import { useId, type ReactNode } from "react"

/**
 * A button that opens a panel sliding in from the right edge, holding view settings.
 * The panel is a non-modal popover: the page behind stays usable, so a player sees
 * a setting take effect on the chart. Escape or a click outside closes it.
 */
export function SettingsPanel({ pwid, title, children }: { pwid: string; title: string; children: ReactNode }) {
  const id = useId()
  return (
    <>
      <button
        data-pwid={`${pwid}-open`}
        type="button"
        popoverTarget={id}
        className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
      >
        {title}
      </button>
      <div
        id={id}
        data-pwid={pwid}
        popover="auto"
        aria-label={title}
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh w-80 max-w-full overflow-y-auto border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 text-inherit shadow-xl"
      >
        <div className="flex items-center justify-between gap-4 pb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            data-pwid={`${pwid}-close`}
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"
          >
            Close
          </button>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </>
  )
}
