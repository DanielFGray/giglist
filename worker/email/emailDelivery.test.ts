import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Schema } from "effect"
import { BunServices } from "@effect/platform-bun"
import { SMTPServer } from "smtp-server"
import { RateLimiterError, RateLimiterStore, RateLimitStoreError, type RateLimiter } from "effect/persistence/RateLimiter"
import { RateLimiterMemory, rateLimiterWithStore } from "../../src/server/services/rateLimiter"
import { Mailer, MailDeliveryError, MailMessage, SmtpSettings } from "./mailer"
import { EmailDelivery, QueuedEmail } from "./emailDelivery"

const verification: QueuedEmail = {
  options: { to: "player@example.invalid", subject: "Verify your GigList account" },
  template: "verify_email.mjml",
  variables: { token: "verification-code", verifyLink: "https://giglist.example/verify-email", username: "player", name: null },
}

/** A Mailer that keeps each message it is given in `delivered`. */
const recording = (delivered: MailMessage[]) => Layer.succeed(Mailer, { send: (message) => Effect.sync(() => { delivered.push(message) }) })

/** EmailDelivery with the given Mailer and rate-limit store, for one test. */
const deliveryWith = (mailer: Layer.Layer<Mailer, MailDeliveryError>, limiter: Layer.Layer<RateLimiter>) =>
  EmailDelivery.layerNoDeps.pipe(Layer.provide(Layer.mergeAll(mailer, BunServices.layer, limiter)))

describe("queued email delivery", () => {
  it.effect("renders all account emails through the supplied Mailer", () => {
    const delivered: MailMessage[] = []
    const jobs: ReadonlyArray<QueuedEmail> = [
      verification,
      { options: verification.options, template: "password_reset.mjml", variables: { token: "reset-code", verifyLink: "https://giglist.example/reset" } },
      { options: verification.options, template: "delete_account.mjml", variables: { token: "delete-code", deleteAccountLink: "https://giglist.example/delete" } },
      { options: verification.options, template: "password_reset_unregistered.mjml", variables: { url: "https://giglist.example" } },
      { options: { ...verification.options, to: ["one@example.invalid", "two@example.invalid"] }, template: "account_activity.mjml", variables: { actionDescription: "You changed your password." } },
    ]
    return Effect.gen(function* () {
      const delivery = yield* EmailDelivery
      yield* Effect.forEach(jobs, delivery.send)
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
    }).pipe(Effect.provide(deliveryWith(recording(delivered), RateLimiterMemory)))
  })

  it.effect("renders a band invitation with its link in both the HTML and the text", () => {
    const delivered: MailMessage[] = []
    const link = "https://giglist.example/invitations/accept?id=abc&code=a1b2"
    return Effect.gen(function* () {
      const delivery = yield* EmailDelivery
      yield* delivery.send({
        options: { to: "newcomer@example.invalid", subject: "You have been invited to The Setlisters" },
        template: "band_invite.mjml",
        variables: { bandName: "The <Setlisters>", link },
      })
      expect(delivered).toHaveLength(1)
      expect(delivered[0]?.html).toContain(`href="${link.replaceAll("&", "&amp;")}"`)
      expect(delivered[0]?.html).toContain("The &lt;Setlisters&gt;")
      expect(delivered[0]?.text).toContain(link)
    }).pipe(Effect.provide(deliveryWith(recording(delivered), RateLimiterMemory)))
  })

  it.effect("rejects an invalid queued payload before delivery", () => {
    const delivered: MailMessage[] = []
    return Effect.gen(function* () {
      // The worker decodes each payload with QueuedEmail before EmailDelivery.send runs.
      const error = yield* Effect.flip(Schema.decodeUnknownEffect(QueuedEmail)({ ...verification, variables: { token: "missing-link" } }))
      expect(error._tag).toBe("SchemaError")
      expect(delivered).toHaveLength(0)
    })
  })

  it.live("sends a rendered message to SMTP and reports a recipient rejection", () => {
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
    return Effect.gen(function* () {
      const listener = server.listen(0, "127.0.0.1")
      yield* Effect.promise(() => new Promise<void>((resolve, reject) => { listener.once("listening", resolve); listener.once("error", reject) }))
      yield* Effect.addFinalizer(() => Effect.promise(() => new Promise<void>((resolve) => server.close(resolve))))
      const address = listener.address()
      if (address === null || typeof address === "string") return expect.unreachable("SMTP server needs a TCP port")
      const smtp = Mailer.layerSmtp(new SmtpSettings({ host: "127.0.0.1", port: address.port, secure: false, credentials: Option.none() }), "GigList <sender@example.invalid>")
      yield* Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        yield* delivery.send(verification)
        const error = yield* Effect.flip(delivery.send({ ...verification, options: { ...verification.options, to: "reject@example.invalid" } }))
        expect(error._tag).toBe("MailDeliveryError")
      }).pipe(Effect.provide(deliveryWith(smtp, RateLimiterMemory)))
      expect(received).toContain("Subject: Verify your GigList account")
      expect(received).toContain("sender@example.invalid")
      expect(received).toContain("Content-Type: text/plain")
      expect(received).toContain("Content-Type: text/html")
      expect(received).toContain("verification-code")
    }).pipe(Effect.scoped)
  })

  it.effect("drops mail to an address over its hourly cap and still completes the job", () => {
    const delivered: MailMessage[] = []
    const reset: QueuedEmail = { options: verification.options, template: "password_reset_unregistered.mjml", variables: { url: "https://giglist.example" } }
    // The cap counts the address without regard to case.
    const shouted: QueuedEmail = { ...reset, options: { ...reset.options, to: "PLAYER@example.invalid" } }
    const other: QueuedEmail = { ...reset, options: { ...reset.options, to: "other@example.invalid" } }
    return Effect.gen(function* () {
      const delivery = yield* EmailDelivery
      yield* Effect.forEach([reset, reset, reset, shouted, reset, reset, shouted, other], delivery.send)
      expect(delivered.map((mail) => mail.to)).toEqual([
        ["player@example.invalid"], ["player@example.invalid"], ["player@example.invalid"], ["PLAYER@example.invalid"], ["player@example.invalid"],
        ["other@example.invalid"],
      ])
    }).pipe(Effect.provide(deliveryWith(recording(delivered), RateLimiterMemory)))
  })

  it.effect("always sends security notices, even to an address over its cap", () => {
    const delivered: MailMessage[] = []
    const reset: QueuedEmail = { options: verification.options, template: "password_reset_unregistered.mjml", variables: { url: "https://giglist.example" } }
    const notice: QueuedEmail = { options: verification.options, template: "account_activity.mjml", variables: { actionDescription: "You changed your password." } }
    return Effect.gen(function* () {
      const delivery = yield* EmailDelivery
      yield* Effect.forEach([reset, reset, reset, reset, reset, reset, notice], delivery.send)
      expect(delivered).toHaveLength(6)
      expect(delivered[5]?.text).toContain("You changed your password.")
    }).pipe(Effect.provide(deliveryWith(recording(delivered), RateLimiterMemory)))
  })

  it.effect("fails the job when the cap cannot be checked, so graphile-worker retries it", () => {
    const delivered: MailMessage[] = []
    const down = Effect.fail(new RateLimiterError({ reason: new RateLimitStoreError({ message: "Valkey is down" }) }))
    const storeDown = rateLimiterWithStore(Layer.succeed(RateLimiterStore, {
      fixedWindow: () => down, tokenBucket: () => down, adaptiveConsume: () => down, adaptiveFeedback: () => down,
    }))
    return Effect.gen(function* () {
      const delivery = yield* EmailDelivery
      const error = yield* Effect.flip(delivery.send(verification))
      expect(error._tag).toBe("RateLimiterError")
      expect(delivered).toHaveLength(0)
    }).pipe(Effect.provide(deliveryWith(recording(delivered), storeDown)))
  })
})
