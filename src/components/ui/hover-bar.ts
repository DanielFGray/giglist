/**
 * The control bar over a phrase or a score excerpt. The parent must be `group relative`.
 *
 * With a mouse the bar floats over the notation's top right corner and shows while the parent is hovered or the
 * bar has focus. A touch screen has no hover (Tailwind's hover variants need `(hover: hover)`), so a tap could
 * never show the bar; there it always shows, in the flow above the notation. So the bar must come before the
 * notation in the DOM.
 */
export const hoverBar = [
  "pointer-events-none absolute top-0 right-0 z-10 flex flex-wrap items-center gap-3 rounded-md px-2 py-1",
  "bg-[var(--color-surface)]/80 font-sans text-xs text-zinc-500 opacity-0 backdrop-blur-sm transition-opacity",
  "group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
  "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:static [@media(hover:none)]:opacity-100",
  "[@media(hover:none)]:bg-transparent [@media(hover:none)]:px-0",
].join(" ")
