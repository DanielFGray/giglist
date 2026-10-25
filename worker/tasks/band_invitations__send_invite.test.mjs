import { describe, expect, test } from "bun:test"
import sendInvite from "./band_invitations__send_invite.mjs"

const INVITATION_ID = "22222222-2222-2222-2222-222222222222"

/** Runs the task against one invitation row (or none) and returns the jobs it queued. */
const run = async (row) => {
  const previousRootUrl = process.env.VITE_ROOT_URL
  process.env.VITE_ROOT_URL = "https://giglist.example"
  const jobs = []
  try {
    await sendInvite(
      { id: INVITATION_ID },
      {
        addJob: async (name, payload) => {
          jobs.push({ name, payload })
        },
        withPgClient: async (fn) =>
          fn({
            query: async () => ({ rows: row ? [row] : [] }),
          }),
      },
    )
  } finally {
    if (previousRootUrl === undefined) delete process.env.VITE_ROOT_URL
    else process.env.VITE_ROOT_URL = previousRootUrl
  }
  return jobs
}

describe("band_invitations__send_invite", () => {
  test("emails an address invitation with a link that carries its code", async () => {
    const jobs = await run({
      band_name: "Test: Invitations",
      code: "a1b2c3",
      email: "newcomer@example.invalid",
    })

    expect(jobs).toHaveLength(1)
    expect(jobs[0].name).toBe("send_email")
    expect(jobs[0].payload).toMatchObject({
      options: {
        to: "newcomer@example.invalid",
        subject: "You have been invited to Test: Invitations",
      },
      template: "band_invite.mjml",
      variables: {
        bandName: "Test: Invitations",
        link: `https://giglist.example/invitations/accept?id=${INVITATION_ID}&code=a1b2c3`,
      },
    })
  })

  test("emails an account invitation to the user's primary email, with no code in the link", async () => {
    const jobs = await run({
      band_name: "The Setlisters",
      code: null,
      email: "member@example.invalid",
    })

    expect(jobs).toHaveLength(1)
    expect(jobs[0].payload).toMatchObject({
      options: { to: "member@example.invalid" },
      variables: {
        link: `https://giglist.example/invitations/accept?id=${INVITATION_ID}`,
      },
    })
  })

  test("queues nothing when the invitation is gone, for example after it was declined", async () => {
    expect(await run(null)).toEqual([])
  })

  test("queues nothing when the user has no primary email to send to", async () => {
    expect(
      await run({ band_name: "The Setlisters", code: null, email: null }),
    ).toEqual([])
  })
})
