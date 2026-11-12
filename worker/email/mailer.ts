import { Config, Context, Effect, Layer, Match, Option, Redacted, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2"
import { createTestAccount, createTransport, getTestMessageUrl } from "nodemailer"
import { nodeEnv } from "../../src/server/config"

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

/**
 * Delivers mail through the provider `MAIL_PROVIDER` names. Without it, a
 * production server uses SES and any other mode uses the development account;
 * a test run must name one, so it cannot reach a mail server by accident.
 */
export class Mailer extends Context.Service<Mailer, {
  readonly send: (message: MailMessage) => Effect.Effect<void, MailDeliveryError>
}>()("giglist/mailer", {
  make: Effect.gen(function* () {
    const mode = yield* nodeEnv
    const configured = Config.Literals(["development", "ses", "cloudflare"], "MAIL_PROVIDER")
    const provider = yield* (mode === "test" ? configured : configured.pipe(
      Config.withDefault(mode === "production" ? "ses" : "development"),
    ))
    return yield* Match.value(provider).pipe(
      Match.when("development", () => etherealMailer),
      Match.when("ses", () => sesMailer),
      Match.when("cloudflare", () => cloudflareMailer),
      Match.exhaustive,
    )
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)

  static readonly layerSmtp = (settings: SmtpSettings, from: string) => Layer.effect(this, smtpMailer(settings, from))
}

const EtherealAccount = Schema.Struct({ user: Schema.String, pass: Schema.RedactedFromValue(Schema.String) })

/** Ethereal's SMTP, with a development account kept in `ETHEREAL_ACCOUNT_FILE`. The first run creates the account and writes that file. */
const etherealMailer = Effect.gen(function* () {
  const fs = yield* FileSystem
  const path = yield* Path
  const defaultFile = yield* path.fromFileUrl(new URL("../.ethereal", import.meta.url))
  const filename = yield* Config.NonEmptyString("ETHEREAL_ACCOUNT_FILE").pipe(
    Config.withDefault(defaultFile),
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
  return yield* smtpMailer(new SmtpSettings({
    host: "smtp.ethereal.email", port: 587, secure: false,
    credentials: Option.some(account),
  }), from)
})

const sesMailer = Effect.gen(function* () {
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
})

// Cloudflare's authenticated SMTP submission uses api_token as the username.
// Source: Cloudflare Email Service SMTP documentation, in ATTRIBUTIONS.md.
const cloudflareMailer = Effect.gen(function* () {
  const token = yield* Config.Redacted("CLOUDFLARE_EMAIL_API_TOKEN")
  const from = yield* Config.NonEmptyString("EMAIL_FROM")
  return yield* smtpMailer(new SmtpSettings({
    host: "smtp.mx.cloudflare.net", port: 465, secure: true,
    credentials: Option.some({ user: "api_token", pass: token }),
  }), from)
})

/** SMTP to `settings`, with `from` as the sender. The transport closes with the scope. */
const smtpMailer = Effect.fnUntraced(function* (settings: SmtpSettings, from: string) {
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
