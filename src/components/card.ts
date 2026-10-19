/**
 * A card whose text lines up with the page's text: the padding and the border hang
 * into the page margin, so the card's content starts where the heading above it
 * does. The outline is a shadow, which takes no space and cannot widen the page.
 * Below `sm` the card runs edge to edge with only its top and bottom borders. Its
 * corners are round only when the card stands clear of the window edge, that is
 * wider than the root layout's 72rem and not in full width; at the edge a rounded
 * corner would show a notch.
 */
export const HANGING_CARD =
  "-mx-4 px-4 py-4 border-y border-[var(--color-border-subtle)] sm:border-0 sm:shadow-[0_0_0_1px_var(--color-border-subtle)] min-[72.01rem]:[main:not(:has([data-wide]))_&]:rounded-lg"
