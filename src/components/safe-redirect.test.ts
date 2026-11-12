import { describe, expect, test } from "vitest"
import { safeRedirect } from "./safe-redirect"

describe("safeRedirect", () => {
  test("keeps a plain path", () => {
    expect(safeRedirect("/invitations/accept")).toBe("/invitations/accept")
  })

  test("keeps a path with a query", () => {
    expect(safeRedirect("/invitations/accept?id=1&code=abc")).toBe(
      "/invitations/accept?id=1&code=abc",
    )
  })

  test("rejects a protocol-relative URL", () => {
    expect(safeRedirect("//evil.example")).toBe("/")
  })

  test("rejects a backslash-escaped host", () => {
    expect(safeRedirect("/\\evil.example")).toBe("/")
  })

  test("rejects an absolute URL", () => {
    expect(safeRedirect("https://evil.example/phish")).toBe("/")
  })

  test("rejects an empty value", () => {
    expect(safeRedirect("")).toBe("/")
  })
})
