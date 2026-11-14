import type { ReactNode } from "react"
import { InternalError } from "~/api/errors"

/**
 * The one line that shows a failure to the user. A Standard Schema validator
 * reports an object with a `message`; a plain function validator reports a
 * string. An InternalError also carries the trace id the server logged the
 * cause under, so the line includes it for the user to quote in a report.
 */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof InternalError) {
    return `${error.message} (reference: ${error.traceId})`
  }
  if (error !== null && typeof error === "object" && "message" in error) {
    return String(error.message)
  }
  return String(error)
}

type FieldLike = { state: { meta: { errors: ReadonlyArray<unknown> } } }

/** Every problem on a field, joined for display; undefined when it is valid. */
export function fieldError(field: FieldLike): string | undefined {
  const messages = field.state.meta.errors
    .filter((error) => error !== undefined && error !== null)
    .map(errorMessage)
  return messages.length > 0 ? messages.join(", ") : undefined
}

const inputClass =
  "w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"

const submitClass =
  "rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"

/** A label, its control, and the messages the contract schema reported. */
function FieldShell({
  label,
  pwid,
  error,
  children,
}: {
  label: string
  pwid: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="block text-sm">
      <span className="block text-zinc-300 mb-1">{label}</span>
      {children}
      {error && (
        <span data-pwid={`${pwid}-error`} className="mt-1 block text-xs text-red-400">
          {error}
        </span>
      )}
    </label>
  )
}

export function TextField({
  label,
  pwid,
  value,
  onChange,
  error,
  type = "text",
  autoFocus,
  autoComplete,
  placeholder,
  required,
}: {
  label: string
  pwid: string
  value: string
  onChange: (value: string) => void
  error?: string
  type?: string
  autoFocus?: boolean
  autoComplete?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <FieldShell label={label} pwid={pwid} error={error}>
      <input
        data-pwid={pwid}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        className={inputClass}
      />
    </FieldShell>
  )
}

export function TextAreaField({
  label,
  pwid,
  value,
  onChange,
  error,
  placeholder,
  rows = 3,
  monospace = false,
}: {
  label: string
  pwid: string
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
  rows?: number
  /** For text laid out in columns, such as chords over lyrics. */
  monospace?: boolean
}) {
  return (
    <FieldShell label={label} pwid={pwid} error={error}>
      <textarea
        data-pwid={pwid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={monospace ? `${inputClass} font-mono whitespace-pre` : inputClass}
      />
    </FieldShell>
  )
}

export function NumberField({
  label,
  pwid,
  value,
  onChange,
  error,
  min,
  max,
}: {
  label: string
  pwid: string
  value: number | null
  onChange: (value: number | null) => void
  error?: string
  min?: number
  max?: number
}) {
  return (
    <FieldShell label={label} pwid={pwid} error={error}>
      <input
        data-pwid={pwid}
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        min={min}
        max={max}
        className={inputClass}
      />
    </FieldShell>
  )
}

/** A select whose options are the only values it can report, so a form field
 *  never needs a cast to narrow the string back to its union. */
export function SelectField<T extends string>({
  label,
  pwid,
  value,
  onChange,
  error,
  options,
}: {
  label: string
  pwid: string
  value: T | null
  onChange: (value: T | null) => void
  error?: string
  options: ReadonlyArray<{ value: T; label: string }>
}) {
  return (
    <FieldShell label={label} pwid={pwid} error={error}>
      <select
        data-pwid={pwid}
        value={value ?? ""}
        onChange={(e) => {
          const next = options.find((option) => option.value === e.target.value)
          onChange(next === undefined ? null : next.value)
        }}
        className={inputClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

export function SubmitButton({
  pwid,
  disabled,
  pending,
  label,
  pendingLabel,
  wide = false,
}: {
  pwid: string
  disabled: boolean
  pending: boolean
  label: string
  pendingLabel: string
  wide?: boolean
}) {
  return (
    <button
      data-pwid={pwid}
      type="submit"
      disabled={disabled}
      className={`${wide ? "w-full py-2" : "px-4 py-2"} ${submitClass}`}
    >
      {pending ? pendingLabel : label}
    </button>
  )
}
