import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { BunServices } from "@effect/platform-bun"
import { SMTPServer } from "smtp-server"
import { Mailer, MailMessage, SmtpSettings } from "./mailer"
import { sendEmail } from "./send-email"

const verification = {
  options: { to: "player@example.invalid", subject: "Verify your GigList account" },
  template: "verify_email.mjml",
  variables: { token: "verification-code", verifyLink: "https://giglist.example/verify-email", username: "player", name: null },
}

describe("queued email delivery", () => {
  test("renders all account emails through the supplied Mailer", async () => {
    const delivered: MailMessage[] = []
    const capture = Layer.succeed(Mailer, { send: (message) => Effect.sync(() => { delivered.push(message) }) })
    const jobs = [
      verification,
      { options: verification.options, template: "password_reset.mjml", variables: { token: "reset-code", verifyLink: "https://giglist.example/reset" } },
      { options: verification.options, template: "delete_account.mjml", variables: { token: "delete-code", deleteAccountLink: "https://giglist.example/delete" } },
      { options: verification.options, template: "password_reset_unregistered.mjml", variables: { url: "https://giglist.example" } },
      { options: { ...verification.options, to: ["one@example.invalid", "two@example.invalid"] }, template: "account_activity.mjml", variables: { actionDescription: "You changed your password." } },
    ]
    await Effect.runPromise(Effect.forEach(jobs, sendEmail).pipe(
      Effect.provide(Layer.merge(capture, BunServices.layer)),
    ))
    expect(delivered).toHaveLength(5)
    expect(delivered[0]).toMatchObject({ to: ["player@example.invalid"], subject: "Verify your GigList account" })
    expect(delivered.map((mail) => mail.text)).toEqual([
      expect.stringContaining("verification-code"),
      expect.stringContaining("reset-code"),
      expect.stringContaining("delete-code"),
      expect.stringContaining("no account is registered"),
      expect.stringContaining("You changed your password."),
    ])
    expect(delivered[0]?.html).toContain('href="https://giglist.example/verify-email"')
    expect(delivered[4]?.to).toEqual(["one@example.invalid", "two@example.invalid"])
  })

  test("rejects an invalid queued payload before delivery", async () => {
    const delivered: MailMessage[] = []
    const capture = Layer.succeed(Mailer, { send: (message) => Effect.sync(() => { delivered.push(message) }) })
    const error = await Effect.runPromise(sendEmail({ ...verification, variables: { token: "missing-link" } }).pipe(
      Effect.provide(Layer.merge(capture, BunServices.layer)), Effect.flip,
    ))
    expect(error._tag).toBe("SchemaError")
    expect(delivered).toHaveLength(0)
  })

  test("sends a rendered message to SMTP and reports a recipient rejection", async () => {
    let received = ""
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS", "AUTH"],
      onRcptTo(address, _session, callback) {
        callback(address.address === "reject@example.invalid" ? new Error("Recipient rejected") : undefined)
      },
      onData(stream, _session, callback) {
        stream.setEncoding("utf8")
        stream.on("data", (chunk: string) => { received += chunk })
        stream.on("end", () => callback())
      },
    })
    const listener = server.listen(0, "127.0.0.1")
    await new Promise<void>((resolve, reject) => { listener.once("listening", resolve); listener.once("error", reject) })
    const address = listener.address()
    if (address === null || typeof address === "string") return expect.unreachable("SMTP server needs a TCP port")
    const layer = Mailer.smtp(new SmtpSettings({ host: "127.0.0.1", port: address.port, secure: false, credentials: Option.none() }), "GigList <sender@example.invalid>")
    await Effect.runPromise(Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => new Promise<void>((resolve) => server.close(resolve))))
      yield* sendEmail(verification)
      const error = yield* Effect.flip(sendEmail({ ...verification, options: { ...verification.options, to: "reject@example.invalid" } }))
      expect(error._tag).toBe("MailDeliveryError")
    }).pipe(Effect.provide(Layer.merge(layer, BunServices.layer)), Effect.scoped))
    expect(received).toContain("Subject: Verify your GigList account")
    expect(received).toContain("sender@example.invalid")
    expect(received).toContain("Content-Type: text/plain")
    expect(received).toContain("Content-Type: text/html")
    expect(received).toContain("verification-code")
  })
})
