import { Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { OtlpSerialization, OtlpTracer } from "effect/observability"

/**
 * Exports the spans that `Effect.fn` names to an OTLP collector, when one is
 * configured.
 *
 * The endpoint and the exporter come from the OpenTelemetry environment
 * variables: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (or the general
 * `OTEL_EXPORTER_OTLP_ENDPOINT`) together with `OTEL_TRACES_EXPORTER=otlp`.
 * With none of them set the layer provides only the exporter's flusher, the
 * runtime keeps its no-op tracer, and a named span costs a name and a struct.
 *
 * The service name is fixed here, not left to each deployment, because it is
 * what a trace list groups by.
 */
export const TracingLive = OtlpTracer.layerFromConfig({
  resource: { serviceName: "giglist" },
}).pipe(
  Layer.provide(OtlpSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer),
)
