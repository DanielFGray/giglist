/**
 * The classes for the element a score draws into. alphaTab puts its cursor and
 * selection layers at z-index 1000; `isolate` keeps them inside the score, so a
 * panel that opens over it (the click's timing panel) stays on top.
 */
export const scoreHost = "isolate"
