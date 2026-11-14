import { Effect, Layer } from "effect"
import { DevTools } from "effect/devtools"
import { FetchHttpClient, HttpMiddleware } from "effect/http"
import { Otlp, OtlpSerialization } from "effect/observability"
import { nodeEnv } from "./config"

/**
 * Exports the spans, logs and metrics that Effect creates to an OTLP
 * collector. Each signal exports only when the collector is set
 * (`OTEL_EXPORTER_OTLP_ENDPOINT`) and that signal's exporter list names otlp:
 * `OTEL_TRACES_EXPORTER=otlp`, `OTEL_LOGS_EXPORTER=otlp`,
 * `OTEL_METRICS_EXPORTER=otlp`. The endpoint alone exports nothing.
 *
 * The service name is fixed here, not left to each deployment, because it is
 * what telemetry lists group by.
 */
const OtlpLive = Otlp.layerFromConfig({
  resource: { serviceName: "giglist" },
}).pipe(
  Layer.provide(OtlpSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer),
)

const DevToolsLive = Layer.unwrap(
  Effect.gen(function* () {
    if ((yield* nodeEnv) === "production") return Layer.empty
    return DevTools.layer()
  }),
)

/**
 * The tracer for the whole process: OTLP export, and outside production the
 * DevTools too. The DevTools tracer wraps the tracer current where it is
 * built and replaces it, so it is built on the OTLP layer; built beside it,
 * it would wrap the native tracer and drop OTLP.
 */
export const TracingLayer = DevToolsLive.pipe(Layer.provideMerge(OtlpLive))

/**
 * The request headers the HTTP server's span records, as
 * `http.request.header.<name>`: the UI action and feature that sent the
 * request, so a trace shows which action a request came from. No other header
 * is recorded (cookies and tokens stay out of traces).
 */
export const RequestSpanHeaders = Layer.succeed(
  HttpMiddleware.TracerHeaderFilter,
  (name, phase) => phase === "request" && uiHeaders.has(name),
)

const uiHeaders: ReadonlySet<string> = new Set(["x-ui-action", "x-ui-feature"])
