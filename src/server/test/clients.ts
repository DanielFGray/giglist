import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { baseUrl } from "./apiHarness"

export const testPassword = "TestUserPassword"

/** POST /auth/register with the test password and `<username>@example.com`. */
export const register = (client: HttpClient.HttpClient, username: string) =>
  HttpClientRequest.post(`${baseUrl}/auth/register`).pipe(
    HttpClientRequest.bodyJson({ username, email: `${username}@example.com`, password: testPassword }),
    Effect.flatMap(client.execute),
  )

/** POST /auth/login; `id` is a username or an email address. */
export const login = (client: HttpClient.HttpClient, id: string, password = testPassword) =>
  HttpClientRequest.post(`${baseUrl}/auth/login`).pipe(
    HttpClientRequest.bodyJson({ id, password }),
    Effect.flatMap(client.execute),
  )

/** POST `path` under the API with a JSON body. */
export const postJson = (client: HttpClient.HttpClient, path: string, body: unknown) =>
  HttpClientRequest.post(`${baseUrl}${path}`).pipe(
    HttpClientRequest.bodyJson(body),
    Effect.flatMap(client.execute),
  )
