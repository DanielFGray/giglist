import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { Dialog, Modal, ModalOverlay } from "react-aria-components"
import { FeedbackCategory } from "~/api/feedback"
import { feedback } from "~/api/client"
import { SelectField, SubmitButton, TextAreaField, TextField, errorMessage, fieldError } from "./form"

const categoryOptions = [
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idea" },
  { value: "other", label: "Something else" },
] satisfies ReadonlyArray<{ value: FeedbackCategory; label: string }>

/**
 * The feedback dialog, mounted once in the Nav and opened by its links: a
 * note goes to the server as one feedback record, with the page URL and app
 * version attached. The hidden `website` input is the honeypot (OWASP's bot
 * trap, see ATTRIBUTIONS.md): a reader never reaches it, and the server
 * refuses any submission that fills it.
 */
export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [honeypot, setHoneypot] = useState("")

  const form = useForm({
    defaultValues: {
      category: "bug" as FeedbackCategory,
      message: "",
      contact: "",
    },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        // The browser attaches where the note was written and which build it
        // wrote from; the server adds the signed-in user. The optional
        // contact is left out entirely: the contract reads an absent key as
        // "none", and a present undefined fails the client-side decode.
        const contact = value.contact.trim()
        await feedback.submit({
          message: value.message,
          category: value.category,
          ...(contact === "" ? {} : { contact }),
          page_url: window.location.href,
          app_version: __APP_VERSION__,
          website: honeypot,
        })
        setSubmitted(true)
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  const reset = () => {
    setSubmitted(false)
    setServerError(null)
    setHoneypot("")
    form.reset()
  }

  if (!open) return null

  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh]"
    >
      <Modal className="w-full max-w-md rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5 shadow-xl outline-none">
        <Dialog className="outline-none">
          {({ close }) => (
            <div>
              <h2 className="text-lg font-semibold">Send feedback</h2>
              {submitted ? (
                <div data-pwid="feedback-success" className="mt-4 space-y-4">
                  <p className="text-sm text-zinc-300">Thanks — your note is in.</p>
                  <button
                    type="button"
                    data-pwid="feedback-close"
                    onClick={() => {
                      reset()
                      close()
                    }}
                    className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm font-medium hover:bg-[var(--color-surface-hover)] transition cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void form.handleSubmit()
                  }}
                  className="mt-4 space-y-4"
                >
                  {serverError && (
                    <p role="alert" data-pwid="feedback-error" className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
                      {serverError}
                    </p>
                  )}

                  <form.Field name="category">
                    {(field) => (
                      <SelectField
                        label="Category"
                        pwid="feedback-category"
                        value={field.state.value}
                        onChange={(category) => field.handleChange(category ?? "bug")}
                        error={fieldError(field)}
                        options={categoryOptions}
                      />
                    )}
                  </form.Field>

                  <form.Field name="message">
                    {(field) => (
                      <TextAreaField
                        label="Message"
                        pwid="feedback-message"
                        value={field.state.value}
                        onChange={field.handleChange}
                        error={fieldError(field)}
                        placeholder="What happened, or what would you like to see?"
                        rows={4}
                        autoFocus
                        required
                      />
                    )}
                  </form.Field>

                  <form.Field name="contact">
                    {(field) => (
                      <TextField
                        label="Email (optional)"
                        pwid="feedback-contact"
                        type="email"
                        value={field.state.value}
                        onChange={field.handleChange}
                        error={fieldError(field)}
                        autoComplete="email"
                        placeholder="you@example.com"
                      />
                    )}
                  </form.Field>

                  {/* The honeypot sits off the page where only a bot fills it. */}
                  <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
                    <label>
                      Website
                      <input
                        type="text"
                        name="website"
                        value={honeypot}
                        onChange={(e) => setHoneypot(e.target.value)}
                        tabIndex={-1}
                        autoComplete="off"
                      />
                    </label>
                  </div>

                  <div className="flex justify-end">
                    <SubmitButton
                      pwid="feedback-submit"
                      disabled={!form.state.canSubmit || form.state.isSubmitting}
                      pending={form.state.isSubmitting}
                      label="Send"
                      pendingLabel="Sending..."
                    />
                  </div>
                </form>
              )}
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
