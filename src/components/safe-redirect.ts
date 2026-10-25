/**
 * A same-site path only: starts with "/" and is not a protocol-relative or
 * backslash URL. Anything else returns home, so a forged redirect cannot leave the site.
 */
export function safeRedirect(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) {
    return value
  }
  return "/"
}
