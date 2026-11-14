import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { usePointerDrag, type Point } from "./pointer-drag"

/**
 * The grip in the left margin of a block (a line, a phrase or a section). Dragging
 * it reports the pointer to the editor, which finds the place to drop; Escape
 * cancels the drag. Tapping it opens a menu, which is the way to move a block
 * without dragging.
 */
export function BlockHandle({
  label,
  deleteLabel,
  canMove,
  onMove,
  onDuplicate,
  onDelete,
  onDrag,
  onDrop,
}: {
  /** What the handle moves, in words: `line "Amazing grace"`. */
  label: string
  deleteLabel: string
  canMove: (delta: -1 | 1) => boolean
  onMove: (delta: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
  /** The pointer moved while dragging. */
  onDrag: (point: Point) => void
  /** The drag ended: where the pointer was released, or null when it was cancelled. */
  onDrop: (point: Point | null) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const grip = useRef<HTMLButtonElement>(null)
  const drag = usePointerDrag({
    onDrag: (point) => {
      setOpen(false)
      onDrag(point)
    },
    onDrop,
  })

  const items = () => [...(root.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? [])]

  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [open])

  const close = () => {
    setOpen(false)
    grip.current?.focus()
  }

  const choose = (action: () => void) => () => {
    close()
    action()
  }

  const navigate = (event: KeyboardEvent) => {
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLElement)
    const target = { ArrowDown: all[(at + 1) % all.length], ArrowUp: all[(at - 1 + all.length) % all.length], Home: all[0], End: all.at(-1) }[event.key]
    if (target) {
      event.preventDefault()
      target.focus()
    } else if (event.key === "Escape") {
      event.preventDefault()
      close()
    } else if (event.key === "Tab") setOpen(false)
  }

  return (
    <div ref={root} className="absolute left-0 top-0 z-10">
      <button
        ref={grip}
        data-pwid="block-handle"
        type="button"
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        {...drag.handlers}
        onClick={() => {
          if (!drag.endedInDrag()) setOpen(!open)
        }}
        className="flex h-7 w-6 cursor-grab touch-none select-none items-center justify-center rounded-md text-zinc-500 hover:text-zinc-200 focus-visible:text-zinc-200"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ⠿
        </span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${label}`}
          data-pwid="block-menu"
          onKeyDown={navigate}
          className="absolute left-0 top-full mt-1 flex w-44 flex-col rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] py-1 text-sm shadow-lg"
        >
          <MenuItem pwid="block-move-up" disabled={!canMove(-1)} onSelect={choose(() => onMove(-1))}>
            Move up
          </MenuItem>
          <MenuItem pwid="block-move-down" disabled={!canMove(1)} onSelect={choose(() => onMove(1))}>
            Move down
          </MenuItem>
          <MenuItem pwid="block-duplicate" onSelect={choose(onDuplicate)}>
            Duplicate
          </MenuItem>
          <MenuItem pwid="block-delete" onSelect={choose(onDelete)}>
            {deleteLabel}
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  pwid,
  disabled,
  onSelect,
  children,
}: {
  pwid: string
  disabled?: boolean
  onSelect: () => void
  children: string
}) {
  return (
    <button
      data-pwid={pwid}
      role="menuitem"
      type="button"
      tabIndex={-1}
      disabled={disabled}
      onClick={onSelect}
      className="px-3 py-2 text-left text-zinc-200 hover:bg-white/10 focus-visible:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
