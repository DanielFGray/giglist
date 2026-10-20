import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2"
import { createTestAccount, createTransport, getTestMessageUrl } from "nodemailer"

export class MailMessage extends Schema.Class<MailMessage, { readonly brand: unique symbol }>("MailMessage")({
  to: Schema.NonEmptyArray(Schema.NonEmptyString),
  subject: Schema.String,
  html: Schema.String,
  text: Schema.String,
}) {}

export class MailDeliveryError extends Schema.TaggedError<MailDeliveryError, { readonly brand: unique symbol }>()("MailDeliveryError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class SmtpSettings extends Schema.Class<SmtpSettings, { readonly brand: unique symbol }>("SmtpSettings")({
  host: Schema.String,
  port: Schema.Int,
  secure: Schema.Boolean,
  credentials: Schema.Option(Schema.Struct({ user: Schema.String, pass: Schema.Redacted(Schema.String) })),
}) {}

/** Jobs depend on delivery, while the worker supplies the selected provider. */
export class Mailer extends Context.Service<Mailer, {
  readonly send: (message: MailMessage) => Effect.Effect<void, MailDeliveryError>
}>()("giglist/Mailer", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem
    const filename = yield* Config.NonEmptyString("ETHEREAL_ACCOUNT_FILE").pipe(
      Config.withDefault(`${import.meta.dir}/../.ethereal`),
    )
    const exists = yield* fs.exists(filename)
    const account = yield* (exists
      ? fs.readFileString(filename).pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(EtherealAccount))))
      : Effect.gen(function* () {
        const created = yield* Effect.tryPromise({
          try: () => createTestAccount(),
          catch: (cause) => new MailDeliveryError({ message: "Could not create the development email account", cause }),
        })
        const account = yield* Schema.decodeEffect(EtherealAccount)(created)
        const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(EtherealAccount))(account)
        yield* fs.writeFileString(filename, encoded, { mode: 0o600 })
        return account
      }))
    const from = yield* Config.NonEmptyString("EMAIL_FROM").pipe(Config.withDefault("GigList <noreply@localhost>"))
    return yield* makeSmtp(new SmtpSettings({
      host: "smtp.ethereal.email", port: 587, secure: false,
      credentials: Option.some(account),
    }), from)
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)

  static readonly ses = Layer.effect(this, Effect.gen(function* () {
    const from = yield* Config.NonEmptyString("EMAIL_FROM")
    const region = yield* Config.NonEmptyString("AWS_REGION")
    const client = yield* Effect.acquireRelease(
      Effect.try({
        try: () => new SESv2Client({ region }),
        catch: (cause) => new MailDeliveryError({ message: "Could not initialize SES", cause }),
      }),
      (client) => Effect.sync(() => client.destroy()),
    )
    return {
      send: Effect.fn("Mailer.send")(function* (message: MailMessage) {
        yield* Effect.tryPromise({
          try: (abortSignal) => client.send(new SendEmailCommand({
            FromEmailAddress: from,
            Destination: { ToAddresses: [...message.to] },
            Content: { Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: { Html: { Data: message.html, Charset: "UTF-8" }, Text: { Data: message.text, Charset: "UTF-8" } },
            } },
          }), { abortSignal }),
          catch: (cause) => new MailDeliveryError({ message: "SES did not accept the email", cause }),
        })
      }),
    }
  }))

  // Cloudflare's authenticated SMTP submission uses api_token as the username.
  // Source: Cloudflare Email Service SMTP documentation, in ATTRIBUTIONS.md.
  static readonly cloudflare = Layer.effect(this, Effect.gen(function* () {
    const token = yield* Config.Redacted("CLOUDFLARE_EMAIL_API_TOKEN")
    const from = yield* Config.NonEmptyString("EMAIL_FROM")
    return yield* makeSmtp(new SmtpSettings({
      host: "smtp.mx.cloudflare.net", port: 465, secure: true,
      credentials: Option.some({ user: "api_token", pass: token }),
    }), from)
  }))

  static smtp(settings: SmtpSettings, from: string) {
    return Layer.effect(this, makeSmtp(settings, from))
  }
}

const EtherealAccount = Schema.Struct({ user: Schema.String, pass: Schema.RedactedFromValue(Schema.String) })

const makeSmtp = Effect.fnUntraced(function* (settings: SmtpSettings, from: string) {
  const transport = yield* Effect.acquireRelease(
    Effect.try({ try: () => createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: Option.getOrUndefined(Option.map(settings.credentials, (credentials) => ({
        user: credentials.user, pass: Redacted.value(credentials.pass),
      }))),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    }), catch: (cause) => new MailDeliveryError({ message: "Could not initialize SMTP", cause }) }),
    (transport) => Effect.sync(() => transport.close()),
  )
  return {
    send: Effect.fn("Mailer.send")(function* (message: MailMessage) {
      const result = yield* Effect.tryPromise({
        try: () => transport.sendMail({ from, to: [...message.to], subject: message.subject, html: message.html, text: message.text }),
        catch: (cause) => new MailDeliveryError({ message: "SMTP did not accept the email", cause }),
      })
      if (result.rejected.length > 0) {
        return yield* new MailDeliveryError({ message: "SMTP rejected one or more recipients", cause: result.response })
      }
      const preview = getTestMessageUrl(result)
      if (preview !== false) yield* Effect.logInfo("Development email preview", { url: preview })
    }),
  }
})
