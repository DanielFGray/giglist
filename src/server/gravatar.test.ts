import { describe, expect, test } from "bun:test"
import { gravatarUrl } from "./gravatar"

describe("gravatarUrl", () => {
  test("hashes the trimmed, lowercased email with SHA-256", () => {
    // Gravatar's documented example address, hashed per its image API.
    expect(gravatarUrl("  MyEmailAddress@example.com ")).toBe(
      "https://www.gravatar.com/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee?s=256&d=404&r=g",
    )
    expect(gravatarUrl("myemailaddress@example.com")).toBe(gravatarUrl("MyEmailAddress@Example.COM"))
  })

  test("different emails get different pictures", () => {
    expect(gravatarUrl("a@example.com")).not.toBe(gravatarUrl("b@example.com"))
  })
})
