import { Cause, Effect, Logger, References } from "effect"

/** One line the probe logged. `traceId` is the log annotation the boundary sets. */
export type LogLine = {
  readonly level: string
  readonly message: unknown
  readonly cause: string
  readonly traceId: unknown
}

/** The part of a web handler the probe uses. */
export type WebHandler = {
  readonly handler: (request: Request) => Promise<Response>
  readonly dispose: () => Promise<void>
}

/**
 * A logger layer that appends every line the server logs to `lines`. Build the
 * web handler with it, so the HTTP logger's response line is among them.
 */
export const collectLogs = (lines: Array<LogLine>) =>
  Logger.layer([
    Logger.make((options) => {
      lines.push({
        level: options.logLevel,
        message: options.message,
        cause: Cause.pretty(options.cause),
        traceId: options.fiber.getRef(References.CurrentLogAnnotations).traceId,
      })
    }),
  ])

/** Sends one request to `web` and returns the response with every line logged while it was answered. */
export const answerRequest = (
  web: WebHandler,
  lines: ReadonlyArray<LogLine>,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) =>
  Effect.promise(async () => {
    const init: RequestInit = body === undefined
      ? { method }
      : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    const response = await web.handler(new Request(`http://localhost${path}`, init))
    return { status: response.status, body: await response.text(), lines }
  })
