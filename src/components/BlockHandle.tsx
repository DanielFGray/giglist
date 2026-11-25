import { useEffect, useRef, useState } from "react"
import { Menu, MenuItem, Popover, Separator } from "react-aria-components"
import { usePointerDrag, type Point } from "./pointer-drag"

/**
 * The grip in the left margin of a block (a line, a phrase or a section). Dragging
 * it reports the pointer to the editor, which finds the place to drop; Escape
 * cancels the drag. Tapping it opens a menu, which is the way to move a block
 * without dragging, and which lists the block's own `actions` first.
 */
/** One entry of a handle's menu that belongs to its block, such as "Edit words" on a line. */
export type BlockAction = { readonly pwid: string; readonly label: string; readonly onSelect: () => void }

export function BlockHandle({
  label,
  actions,
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
  actions: ReadonlyArray<BlockAction>
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
  const grip = useRef<HTMLButtonElement>(null)
  // The popover makes the rest of the page inert while it is open, so a field an action opens could not take focus.
  // The chosen action waits here and runs once the popover has closed.
  const chosen = useRef<(() => void) | null>(null)
  const choose = (action: () => void) => () => {
    chosen.current = action
  }
  useEffect(() => {
    if (open) return
    const action = chosen.current
    chosen.current = null
    action?.()
  }, [open])
  const drag = usePointerDrag({
    onDrag: (point) => {
      setOpen(false)
      onDrag(point)
    },
    onDrop,
  })

  return (
    <div className="absolute left-0 top-0 z-10">
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
      {/* A popover draws in a layer of its own, so the chart's monospace font and the grips of later lines stay out of the menu. */}
      <Popover
        triggerRef={grip}
        isOpen={open}
        onOpenChange={setOpen}
        placement="bottom start"
        offset={4}
        className="w-52 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] py-1 font-sans text-sm shadow-lg outline-none"
      >
        <Menu aria-label={`Actions for ${label}`} data-pwid="block-menu" autoFocus="first" onClose={() => setOpen(false)} className="outline-none">
          {actions.map((action) => (
            <MenuItem key={action.pwid} id={action.pwid} data-pwid={action.pwid} onAction={choose(action.onSelect)} className={itemClass}>
              {action.label}
            </MenuItem>
          ))}
          {actions.length > 0 && <Separator className="my-1 border-t border-[var(--color-border-subtle)]" />}
          <MenuItem id="block-move-up" data-pwid="block-move-up" isDisabled={!canMove(-1)} onAction={choose(() => onMove(-1))} className={itemClass}>
            Move up
          </MenuItem>
          <MenuItem id="block-move-down" data-pwid="block-move-down" isDisabled={!canMove(1)} onAction={choose(() => onMove(1))} className={itemClass}>
            Move down
          </MenuItem>
          <MenuItem id="block-duplicate" data-pwid="block-duplicate" onAction={choose(onDuplicate)} className={itemClass}>
            Duplicate
          </MenuItem>
          <MenuItem id="block-delete" data-pwid="block-delete" onAction={choose(onDelete)} className={itemClass}>
            {deleteLabel}
          </MenuItem>
        </Menu>
      </Popover>
    </div>
  )
}

const itemClass =
  "block w-full cursor-pointer px-3 py-2 text-left text-zinc-200 outline-none data-[focused]:bg-white/10 data-[hovered]:bg-white/10 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40"
