import source from "./user-theme.html?raw"

/**
 * The theme a profile shows until the user saves one of their own
 * (docs/adr/0012). Profiles have no starter themes to pick from: this default
 * is the only built-in, and "Restore default theme" in the settings returns
 * to it.
 */
export const DEFAULT_USER_THEME: string = source
