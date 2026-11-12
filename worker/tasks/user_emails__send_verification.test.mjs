import { describe, expect, test } from "vitest"
import sendVerification from "./user_emails__send_verification.mjs"

describe("user_emails__send_verification", () => {
  test("emails a link to the verify-email page with the id and token", async () => {
    const previousRootUrl = process.env.VITE_ROOT_URL
    process.env.VITE_ROOT_URL = "https://giglist.example"
    const jobs = []
    const queries = []
    try {
      await sendVerification(
        { id: "11111111-1111-1111-1111-111111111111" },
        {
          addJob: async (name, payload) => {
            jobs.push({ name, payload })
          },
          withPgClient: async (fn) =>
            fn({
              query: async (sql, params) => {
                queries.push({ sql, params })
                return sql.trimStart().startsWith("select")
                  ? {
                      rows: [
                        {
                          id: "11111111-1111-1111-1111-111111111111",
                          email: "player@example.invalid",
                          verification_token: "tok en/+",
                          username: "player",
                          name: null,
                          seconds_since_verification_sent: null,
                        },
                      ],
                    }
                  : { rows: [] }
              },
            }),
        },
      )
    } finally {
      if (previousRootUrl === undefined) delete process.env.VITE_ROOT_URL
      else process.env.VITE_ROOT_URL = previousRootUrl
    }

    expect(jobs).toHaveLength(1)
    expect(jobs[0].name).toBe("send_email")
    expect(jobs[0].payload).toMatchObject({
      options: { to: "player@example.invalid" },
      template: "verify_email.mjml",
      variables: {
        token: "tok en/+",
        verifyLink:
          "https://giglist.example/verify-email?id=11111111-1111-1111-1111-111111111111&token=tok%20en%2F%2B",
      },
    })
    // The resend throttle timestamp is stamped after queueing.
    expect(queries.at(-1).sql).toContain("verification_email_sent_at = now()")
  })
})
