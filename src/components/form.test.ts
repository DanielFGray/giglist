import { Schema as S } from "effect"
import { describe, expect, it, test } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { InternalError } from "@danielfgray/stompbox/http"
import { errorMessage, NumberField, SelectField, TextAreaField, TextField } from "~/components/form"

describe("errorMessage", () => {
  test("shows the message of an error", () => {
    expect(errorMessage(new Error("Song not found"))).toBe("Song not found")
  })

  test("shows a string as it is", () => {
    expect(errorMessage("Pick a key")).toBe("Pick a key")
  })

  test("adds the trace id to an InternalError", () => {
    const error = new InternalError({ message: "Something went wrong", traceId: "abc123" })
    expect(errorMessage(error)).toBe("Something went wrong (reference: abc123)")
  })

  test("adds the trace id to an InternalError decoded from a response body", () => {
    // The client decodes a 500 body with the contract's schema, so the helper
    // must recognise the decoded value, not only a value built with `new`.
    const decoded = S.decodeSync(InternalError)({
      _tag: "InternalError",
      message: "Something went wrong",
      traceId: "abc123",
    })
    expect(decoded).toBeInstanceOf(InternalError)
    expect(errorMessage(decoded)).toBe("Something went wrong (reference: abc123)")
  })

  test("shows fixed text for a value that is not an error with a message", () => {
    expect(errorMessage(42)).toBe("The request could not be completed. Try again.")
    expect(errorMessage(null)).toBe("The request could not be completed. Try again.")
  })
})

/** The opening tag of the element carrying the data-pwid, e.g. `<input …>`. */
function tagOf(html: string, pwid: string): string {
  const match = html.match(new RegExp(`<\\w+[^>]*data-pwid="${pwid}"[^>]*>`))
  if (!match) throw new Error(`no element with data-pwid="${pwid}" in ${html}`)
  return match[0]
}

/** The value of an attribute on a tag, undefined when the tag lacks it. The
 *  lookbehind pins the name exactly: a bare `id="` would also match the `id=`
 *  inside `data-pwid="…"` or the `lid="true"` inside `aria-invalid="true"`. */
function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`(?<![-\\w])${name}="([^"]*)"`))?.[1]
}

/**
 * RAC wires the error through aria: the control gets aria-invalid and an
 * aria-describedby whose token is the id of the element showing the error,
 * which carries data-pwid `<pwid>-error`. SSR renders a slot id that hydration
 * later drops, so the proof is that the error element's id is one of the
 * described-by tokens, not that the list equals one id.
 */
function expectErrorWiring(html: string, pwid: string) {
  const errorId = attr(tagOf(html, `${pwid}-error`), "id")
  expect(errorId, "the error element must have an id to point at").toBeTruthy()
  expect(attr(tagOf(html, pwid), "aria-invalid")).toBe("true")
  const describedby = attr(tagOf(html, pwid), "aria-describedby") ?? ""
  expect(describedby.split(" ")).toContain(errorId)
}

function render(...children: ReturnType<typeof createElement>[]): string {
  return renderToStaticMarkup(createElement("div", null, ...children))
}

describe("form fields", () => {
  it("TextField with an error is invalid and described by its error element", () => {
    const html = render(
      createElement(TextField, {
        label: "Title",
        pwid: "song-title",
        value: "x",
        onChange: () => {},
        error: "Title is required",
      }),
    )
    expectErrorWiring(html, "song-title")
    expect(html).toContain("Title is required")
  })

  it("TextField without an error is not invalid and names no error element", () => {
    const html = render(
      createElement(TextField, { label: "Title", pwid: "song-title", value: "x", onChange: () => {} }),
    )
    expect(attr(tagOf(html, "song-title"), "aria-invalid")).toBeUndefined()
    expect(html).not.toContain("song-title-error")
  })

  it("TextAreaField with an error is invalid and described by its error element", () => {
    const html = render(
      createElement(TextAreaField, {
        label: "Notes",
        pwid: "song-notes",
        value: "x",
        onChange: () => {},
        error: "Notes are required",
      }),
    )
    expectErrorWiring(html, "song-notes")
  })

  it("NumberField with an error is invalid and described by its error element", () => {
    const html = render(
      createElement(NumberField, {
        label: "Tempo (BPM)",
        pwid: "song-tempo",
        value: null,
        onChange: () => {},
        error: "Tempo is required",
      }),
    )
    expectErrorWiring(html, "song-tempo")
  })

  it("SelectField with an error is invalid and described by its error element", () => {
    const html = render(
      createElement(SelectField, {
        label: "Key",
        pwid: "song-key",
        value: null,
        onChange: () => {},
        error: "Key is required",
        options: [{ value: "C", label: "C" }],
      }),
    )
    expectErrorWiring(html, "song-key")
    expect(html).toContain("Key is required")
  })

  it("SelectField without an error is not invalid and names no error element", () => {
    const html = render(
      createElement(SelectField, {
        label: "Key",
        pwid: "song-key",
        value: "C",
        onChange: () => {},
        options: [{ value: "C", label: "C" }],
      }),
    )
    expect(attr(tagOf(html, "song-key"), "aria-invalid")).toBeUndefined()
    expect(attr(tagOf(html, "song-key"), "aria-describedby")).toBeUndefined()
    expect(html).not.toContain("song-key-error")
  })

  it("the TextField label names the input", () => {
    const html = render(
      createElement(TextField, { label: "Title", pwid: "song-title", value: "x", onChange: () => {} }),
    )
    expect(attr(tagOf(html, "song-title"), "id")).toBeTruthy()
    expect(attr(html.match(/<label[^>]*>/)![0], "for")).toBe(attr(tagOf(html, "song-title"), "id"))
  })
})
