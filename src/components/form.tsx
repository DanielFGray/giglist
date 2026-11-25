import { useId } from "react"
import { cx } from "tailwind-variants/lite"
import {
  Input,
  Label,
  NumberField as RACNumberField,
  Text,
  TextArea,
  TextField as RACTextField,
} from "react-aria-components"

import { errorMessage as apiErrorMessage } from "@danielfgray/stompbox/http/client"
import { button } from "./ui/button"
import { field } from "./ui/field"

/**
 * The one line that shows a failure to the user. A plain function validator
 * reports a string, which is shown as it is; everything else (an API error, a
 * Standard Schema issue with a `message`, a transport failure) goes to
 * stompbox, which adds the trace id of an InternalError.
 */
export function errorMessage(error: unknown): string {
  return typeof error === "string" ? error : apiErrorMessage(error)
}

type FieldLike = { state: { meta: { errors: ReadonlyArray<unknown> } } }

/** Every problem on a field, joined for display; undefined when it is valid. */
export function fieldError(field: FieldLike): string | undefined {
  const messages = field.state.meta.errors.filter((error) => error !== undefined && error !== null).map(errorMessage)
  return messages.length > 0 ? messages.join(", ") : undefined
}

const inputClass = field({ size: "lg", width: "full", focus: true })
const labelClass = "block text-zinc-300 mb-1"
const errorClass = "mt-1 block text-xs text-red-400"

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
    <RACTextField
      className="block text-sm"
      value={value}
      onChange={onChange}
      isInvalid={error !== undefined}
      type={type}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      isRequired={required}
    >
      <Label className={labelClass}>{label}</Label>
      <Input data-pwid={pwid} placeholder={placeholder} className={inputClass} />
      {error && (
        <Text slot="errorMessage" data-pwid={`${pwid}-error`} className={errorClass}>
          {error}
        </Text>
      )}
    </RACTextField>
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
  autoFocus,
  required,
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
  autoFocus?: boolean
  required?: boolean
}) {
  return (
    <RACTextField
      className="block text-sm"
      value={value}
      onChange={onChange}
      isInvalid={error !== undefined}
      autoFocus={autoFocus}
      isRequired={required}
    >
      <Label className={labelClass}>{label}</Label>
      <TextArea
        data-pwid={pwid}
        placeholder={placeholder}
        rows={rows}
        className={monospace ? cx(inputClass, "font-mono whitespace-pre") : inputClass}
      />
      {error && (
        <Text slot="errorMessage" data-pwid={`${pwid}-error`} className={errorClass}>
          {error}
        </Text>
      )}
    </RACTextField>
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
    <RACNumberField
      className="block text-sm"
      // RAC reads an empty field as NaN; the caller still reads null.
      value={value ?? NaN}
      onChange={(number) => onChange(Number.isNaN(number) ? null : number)}
      isInvalid={error !== undefined}
      minValue={min}
      maxValue={max}
    >
      <Label className={labelClass}>{label}</Label>
      <Input data-pwid={pwid} className={inputClass} />
      {error && (
        <Text slot="errorMessage" data-pwid={`${pwid}-error`} className={errorClass}>
          {error}
        </Text>
      )}
    </RACNumberField>
  )
}

/** A select whose options are the only values it can report, so a form field
 *  never needs a cast to narrow the string back to its union. A native select,
 *  not an RAC Select: it is already accessible, it keeps the phone's native
 *  picker, and it wires its own label, invalid and described-by attributes. */
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
  const errorId = useId()
  return (
    <label className="block text-sm">
      <span className="block text-zinc-300 mb-1">{label}</span>
      <select
        data-pwid={pwid}
        value={value ?? ""}
        onChange={(e) => {
          const next = options.find((option) => option.value === e.target.value)
          onChange(next === undefined ? null : next.value)
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={inputClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <span id={errorId} data-pwid={`${pwid}-error`} className="mt-1 block text-xs text-red-400">
          {error}
        </span>
      )}
    </label>
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
      className={cx(button({ tone: "accent", size: "lg" }), wide && "w-full")}
    >
      {pending ? pendingLabel : label}
    </button>
  )
}
