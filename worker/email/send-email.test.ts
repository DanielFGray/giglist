import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { BunServices } from "@effect/platform-bun"
import { SMTPServer } from "smtp-server"
import { RateLimiterError, RateLimiterStore, RateLimitStoreError, layer as rateLimiterLayer, layerStoreMemory } from "effect/persistence/RateLimiter"
import { Mailer, MailMessage, SmtpSettings } from "./mailer"
import { sendEmail } from "./send-email"

const verification = {
  options: { to: "player@example.invalid", subject: "Verify your GigList account" },
  template: "verify_email.mjml",
  variables: { token: "verification-code", verifyLink: "https://giglist.example/verify-email", username: "player", name: null },
}

// A fresh in-memory limiter per use, so counts never carry between tests.
const memoryLimiter = rateLimiterLayer.pipe(Layer.provide(layerStoreMemory))

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
      Effect.provide(Layer.mergeAll(capture, BunServices.layer, memoryLimiter)),
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
      Effect.provide(Layer.mergeAll(capture, BunServices.layer, memoryLimiter)), Effect.flip,
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
    }).pipe(Effect.provide(Layer.mergeAll(layer, BunServices.layer, memoryLimiter)), Effect.scoped))
    expect(received).toContain("Subject: Verify your GigList account")
    expect(received).toContain("sender@example.invalid")
    expect(received).toContain("Content-Type: text/plain")
    expect(received).toContain("Content-Type: text/html")
    expect(received).toContain("verification-code")
  })

  test("drops mail to an address over its hourly cap and still completes the job", async () => {
    const delivered: MailMessage[] = []
    const capture = Layer.succeed(Mailer, { send: (message) => Effect.sync(() => { delivered.push(message) }) })
    const reset = { options: verification.options, template: "password_reset_unregistered.mjml", variables: { url: "https://giglist.example" } }
    // The cap counts the address without regard to case.
    const shouted = { ...reset, options: { ...reset.options, to: "PLAYER@example.invalid" } }
    const other = { ...reset, options: { ...reset.options, to: "other@example.invalid" } }
    await Effect.runPromise(Effect.forEach([reset, reset, reset, shouted, reset, reset, shouted, other], sendEmail).pipe(
      Effect.provide(Layer.mergeAll(capture, BunServices.layer, memoryLimiter)),
    ))
    expect(delivered.map((mail) => mail.to)).toEqual([
      ["player@example.invalid"], ["player@example.invalid"], ["player@example.invalid"], ["PLAYER@example.invalid"], ["player@example.invalid"],
      ["other@example.invalid"],
    ])
  })

  test("always sends security notices, even to an address over its cap", async () => {
    const delivered: MailMessage[] = []
    const capture = Layer.succeed(Mailer, { send: (message) => Effect.sync(() => { delivered.push(message) }) })
    const reset = { options: verification.options, template: "password_reset_unregistered.mjml", variables: { url: "https://giglist.example" } }
    const notice = { options: verification.options, template: "account_activity.mjml", variables: { actionDescription: "You changed your password." } }
    await Effect.runPromise(Effect.forEach([reset, reset, reset, reset, reset, reset, notice], sendEmail).pipe(
      Effect.provide(Layer.mergeAll(capture, BunServices.layer, memoryLimiter)),
    ))
    expect(delivered).toHaveLength(6)
    expect(delivered[5]?.text).toContain("You changed your password.")
  })

  test("fails the job when the cap cannot be checked, so graphile-worker retries it", async () => {
    const delivered: MailMessage[] = []
    const capture = Layer.succeed(Mailer, { send: (message) => Effect.sync(() => { delivered.push(message) }) })
    const down = Effect.fail(new RateLimiterError({ reason: new RateLimitStoreError({ message: "Valkey is down" }) }))
    const storeDown = rateLimiterLayer.pipe(Layer.provide(Layer.succeed(RateLimiterStore, {
      fixedWindow: () => down, tokenBucket: () => down, adaptiveConsume: () => down, adaptiveFeedback: () => down,
    })))
    const error = await Effect.runPromise(sendEmail(verification).pipe(
      Effect.provide(Layer.mergeAll(capture, BunServices.layer, storeDown)), Effect.flip,
    ))
    expect(error._tag).toBe("RateLimiterError")
    expect(delivered).toHaveLength(0)
  })
})
