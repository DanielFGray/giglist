/**
 * A card whose text lines up with the page's text: the padding and the border hang
 * into the page margin, so the card's content starts where the heading above it
 * does. The outline is a shadow, which takes no space and cannot widen the page.
 * Below `sm` the card runs edge to edge with only its top and bottom borders.
 */
export const HANGING_CARD =
  "-mx-4 px-4 py-4 border-y border-[var(--color-border-subtle)] sm:rounded-lg sm:border-0 sm:shadow-[0_0_0_1px_var(--color-border-subtle)]"
