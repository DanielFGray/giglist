import { Context, Layer, Ref } from "effect"
import { Cookies, FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { HttpApiLive } from "../runtime"
import { RateLimiterMemory } from "../services/rateLimiter"

/**
 * In-process API harness: the server's HttpApiLive with no TCP listener.
 * FetchHttpClient sends each request straight to the handler, so clients with
 * a cookie jar (`HttpClient.withCookiesRef`) keep a session as a browser does.
 * No worker runs and no health route is mounted: queued jobs stay in the
 * database.
 */
const web = HttpRouter.toWebHandler(
  HttpApiLive.pipe(
    Layer.provide(RateLimiterMemory),
    Layer.provide(HttpServer.layerServices),
  ),
  { disableLogger: true },
)

const inProcessFetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    web.handler(new Request(input, init), Context.empty()),
  { preconnect: () => {} },
)

export const TestHttpClientLive = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, inProcessFetch)),
)

export const baseUrl = "http://localhost/api"

/** An empty cookie jar for `HttpClient.withCookiesRef`. */
export const makeCookieJar = Ref.make<ReadonlyArray<Cookies.Cookie>>([])
