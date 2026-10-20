import { Clock, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import template from "lodash.template"
import mjml from "mjml"
import { convert } from "html-to-text"
import { Mailer, MailMessage } from "./mailer"
import { projectName } from "../../package.json"

const options = Schema.Struct({
  to: Schema.Union([Schema.NonEmptyString, Schema.NonEmptyArray(Schema.NonEmptyString)]),
  subject: Schema.String,
})

export const QueuedEmail = Schema.Union([
  Schema.Struct({ options, template: Schema.Literal("verify_email.mjml"), variables: Schema.Struct({
    token: Schema.String, verifyLink: Schema.String, username: Schema.String, name: Schema.NullOr(Schema.String),
  }) }),
  Schema.Struct({ options, template: Schema.Literal("password_reset.mjml"), variables: Schema.Struct({
    token: Schema.String, verifyLink: Schema.String,
  }) }),
  Schema.Struct({ options, template: Schema.Literal("delete_account.mjml"), variables: Schema.Struct({
    token: Schema.String, deleteAccountLink: Schema.String,
  }) }),
  Schema.Struct({ options, template: Schema.Literal("password_reset_unregistered.mjml"), variables: Schema.Struct({ url: Schema.String }) }),
  Schema.Struct({ options, template: Schema.Literal("account_activity.mjml"), variables: Schema.Struct({ actionDescription: Schema.String }) }),
])
export type QueuedEmail = typeof QueuedEmail.Type

export class EmailRenderError extends Schema.TaggedError<EmailRenderError, { readonly brand: unique symbol }>()("EmailRenderError", {
  template: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Decode one queued job, render its template, and require delivery from Mailer. */
export const sendEmail = Effect.fn("sendEmail")(function* (input: unknown) {
  const job = yield* Schema.decodeUnknownEffect(QueuedEmail)(input)
  const fs = yield* FileSystem
  const source = yield* fs.readFileString(`${import.meta.dir}/../templates/${job.template}`)
  const now = yield* Clock.currentTimeMillis
  const { html, text } = yield* Effect.try({
    try: () => {
      const render = template(source, { escape: /\[\[([\s\S]+?)\]\]/g })
      const document = render({ projectName, legalText: `(C) ${new Date(now).getUTCFullYear()} ${projectName}`, ...job.variables })
      const { html } = mjml(document, { validationLevel: "strict" })
      return { html, text: convert(html.replace(/(<\/?)div/g, "$1p"), { wordwrap: 120 }).replace(/\n\s+\n/g, "\n\n") }
    },
    catch: (cause) => new EmailRenderError({ template: job.template, cause }),
  })
  const mailer = yield* Mailer
  yield* mailer.send(new MailMessage({
    to: typeof job.options.to === "string" ? [job.options.to] : job.options.to,
    subject: job.options.subject,
    html,
    text,
  }))
})
