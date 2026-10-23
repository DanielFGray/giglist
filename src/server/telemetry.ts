import { Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Otlp, OtlpSerialization } from "effect/observability"

/**
 * Exports the logs and spans that Effect creates to an OTLP collector, when
 * one is configured.
 *
 * The endpoint and exporters come from the OpenTelemetry environment
 * variables: `OTEL_EXPORTER_OTLP_ENDPOINT` or a signal-specific endpoint,
 * together with `OTEL_TRACES_EXPORTER=otlp` and/or `OTEL_LOGS_EXPORTER=otlp`.
 * With no exporter configured, the runtime keeps its default logger and tracer.
 *
 * The service name is fixed here, not left to each deployment, because it is
 * what telemetry lists group by.
 */
export const TelemetryLive = Otlp.layerFromConfig({
  resource: { serviceName: "giglist" },
}).pipe(
  Layer.provide(OtlpSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer),
)
