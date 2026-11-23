import { tv } from "tailwind-variants/lite"

/**
 * Buttons and button-like controls, as a tailwind-variants recipe (the lite
 * entry, which does no class merging). Recipe defaults carry the `base:`
 * variant (defined in `src/styles/app.css`), so a call site appends a plain
 * utility to override a default through the CSS cascade. A recipe class
 * without `base:` cannot be overridden that way. Anything that would otherwise
 * need merging between call sites is a variant here.
 */
export const button = tv({
  base: "cursor-pointer transition-colors disabled:cursor-not-allowed",
  variants: {
    tone: {
      neutral: "base:border base:border-[var(--color-border-subtle)] base:text-zinc-300 disabled:opacity-40",
      raised: "base:border base:border-zinc-700 base:text-zinc-200 disabled:opacity-40",
      danger: "base:border base:border-red-500/20 base:text-red-400 disabled:opacity-40",
      accent:
        "base:bg-[var(--color-amber-accent)] base:text-zinc-950 base:font-semibold hover:brightness-110 disabled:opacity-50",
    },
    size: {
      xs: "base:rounded-md base:px-2 base:py-1 base:text-xs",
      sm: "base:rounded-md base:px-3 base:py-1.5 base:text-xs",
      md: "base:rounded-md base:px-3 base:py-2 base:text-sm",
      lg: "base:rounded-md base:px-4 base:py-2 base:text-sm",
      pill: "base:rounded-full base:px-2.5 base:py-1",
      iconSm: "base:rounded-full base:p-1.5",
      icon: "base:rounded-full base:p-2 shrink-0",
    },
    pressed: {
      none: "",
      aria: "aria-pressed:bg-[var(--color-amber-accent)] aria-pressed:text-zinc-950",
      data: "data-[pressed=true]:bg-[var(--color-amber-accent)] data-[pressed=true]:text-zinc-950 data-[pressed=false]:border data-[pressed=false]:border-[var(--color-border-subtle)] data-[pressed=false]:text-zinc-300",
    },
    focus: {
      none: "",
      ring: "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-amber-accent)]",
    },
  },
  defaultVariants: { tone: "neutral", size: "sm", pressed: "none", focus: "none" },
})
