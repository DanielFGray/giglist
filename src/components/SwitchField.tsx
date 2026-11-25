import { Switch } from "react-aria-components"

/**
 * An on/off control with its label inside it. RAC Switch renders a label
 * around a hidden checkbox with the switch role. Click the label or press
 * Space on the focused switch to toggle it. The label text names the switch.
 * The track and knob style themselves from the label's `data-selected`.
 */
export function SwitchField({
  pwid,
  label,
  isSelected,
  onChange,
  isDisabled = false,
}: {
  pwid: string
  label: string
  isSelected: boolean
  onChange: (isSelected: boolean) => void
  isDisabled?: boolean
}) {
  return (
    <Switch
      data-pwid={pwid}
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}
      className="group flex shrink-0 cursor-pointer items-center gap-2 text-sm text-zinc-300 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
    >
      <span>{label}</span>
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-zinc-600 transition-colors group-data-[selected]:bg-[var(--color-amber-accent)] group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-[var(--color-amber-accent)]">
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform group-data-[selected]:translate-x-5" />
      </span>
    </Switch>
  )
}
