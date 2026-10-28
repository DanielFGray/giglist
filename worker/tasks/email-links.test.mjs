import { describe, expect, test } from "bun:test"
import sendDeleteAccountEmail from "./user__send_delete_account_email.mjs"
import forgotPassword from "./user__forgot_password.mjs"

/** Runs a task with VITE_ROOT_URL set and returns the jobs it queued. */
const queued = async (task, payload, helpers = {}) => {
  const previousRootUrl = process.env.VITE_ROOT_URL
  process.env.VITE_ROOT_URL = "https://giglist.example"
  const jobs = []
  try {
    await task(payload, {
      addJob: async (name, jobPayload) => {
        jobs.push({ name, payload: jobPayload })
      },
      ...helpers,
    })
  } finally {
    if (previousRootUrl === undefined) delete process.env.VITE_ROOT_URL
    else process.env.VITE_ROOT_URL = previousRootUrl
  }
  return jobs
}

describe("user__send_delete_account_email", () => {
  test("emails a link to the delete-account page with the token", async () => {
    const jobs = await queued(sendDeleteAccountEmail, {
      email: "player@example.invalid",
      token: "tok en/+",
    })

    expect(jobs).toHaveLength(1)
    expect(jobs[0].payload).toMatchObject({
      options: { to: "player@example.invalid" },
      template: "delete_account.mjml",
      variables: { deleteAccountLink: "https://giglist.example/delete-account?token=tok%20en%2F%2B" },
    })
  })
})

describe("user__forgot_password", () => {
  test("emails a link to the reset page with the user id and token", async () => {
    const id = "11111111-1111-1111-1111-111111111111"
    const jobs = await queued(
      forgotPassword,
      { id, email: "player@example.invalid", token: "tok en/+" },
      { withPgClient: async (fn) => fn({ query: async () => ({ rows: [{ id }] }) }) },
    )

    expect(jobs).toHaveLength(1)
    expect(jobs[0].payload).toMatchObject({
      template: "password_reset.mjml",
      variables: { verifyLink: `https://giglist.example/reset?userId=${id}&token=tok%20en%2F%2B` },
    })
  })
})
