import { cva } from "cva"

/**
 * Inputs, textareas and selects, as a cva recipe (cva.style); see button.ts
 * for the `base:` override pattern.
 */
export const field = cva({
  base:
    "base:rounded-md base:border base:border-[var(--color-border-subtle)] base:bg-[var(--color-surface-raised)] base:text-zinc-200",
  variants: {
    size: {
      xs: "base:px-1 base:py-0.5 base:text-xs",
      sm: "base:px-2 base:py-1 base:text-xs",
      md: "base:px-2 base:py-1 base:text-sm",
      lg: "base:px-3 base:py-2 base:text-sm",
    },
    width: { auto: "", full: "base:w-full" },
    mono: { true: "base:font-mono" },
    focus: {
      true: "transition-colors focus:outline-none focus:border-[var(--color-amber-accent)] placeholder:text-zinc-600",
    },
  },
  defaultVariants: { size: "sm", width: "auto", mono: false, focus: false },
})
