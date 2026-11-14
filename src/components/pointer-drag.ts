import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react"

export type Point = { readonly x: number; readonly y: number }

/** A pointer must travel this far, in pixels, before a press on a handle is a drag and not a tap. */
const DRAG_DISTANCE = 5
/** While dragging, a pointer this close to the top or bottom of the window scrolls the page. */
const EDGE = 70
const SCROLL_STEP = 14

type Press = { readonly start: Point; point: Point; readonly pointer: number; readonly handle: HTMLElement; moved: boolean }

/**
 * Turns presses on a handle into drags, for mouse and touch alike: HTML5
 * drag-and-drop does not start on touch. The handle needs `touch-none`, or a
 * touch on it scrolls the page instead.
 *
 * A press becomes a drag once the pointer travels `DRAG_DISTANCE`. `onDrag`
 * then gets each pointer position, and `onDrop` gets the release point, or
 * null when the drag is cancelled (Escape, or the browser takes the pointer).
 * A touch drag cannot scroll the page itself, so a pointer held near the top
 * or bottom edge of the window scrolls it, even when the pointer is still;
 * `onDrag` hears the same point again after each step, because what lies
 * under it moved.
 *
 * `endedInDrag` answers once for the click that follows a press: true when
 * that press was a drag, so the click is not a tap.
 */
export function usePointerDrag({ onDrag, onDrop }: { onDrag: (point: Point) => void; onDrop: (point: Point | null) => void }) {
  const [dragging, setDragging] = useState(false)
  const press = useRef<Press | null>(null)
  const afterDrag = useRef(false)
  // The interval and the Escape listener outlive a render; they call the latest callbacks.
  const latest = useRef({ onDrag, onDrop })
  useLayoutEffect(() => {
    latest.current = { onDrag, onDrop }
  })

  const end = useRef((point: Point | null) => {
    const current = press.current
    press.current = null
    if (!current?.moved) return
    afterDrag.current = true
    setDragging(false)
    latest.current.onDrop(point)
  }).current

  useEffect(() => {
    if (!dragging) return
    const scroll = setInterval(() => {
      const point = press.current?.point
      if (!point) return
      if (point.y < EDGE) window.scrollBy(0, -SCROLL_STEP)
      else if (point.y > window.innerHeight - EDGE) window.scrollBy(0, SCROLL_STEP)
      else return
      latest.current.onDrag(point)
    }, 16)
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const current = press.current
      if (current) current.handle.releasePointerCapture(current.pointer)
      end(null)
    }
    document.addEventListener("keydown", cancel)
    return () => {
      clearInterval(scroll)
      document.removeEventListener("keydown", cancel)
    }
  }, [dragging, end])

  const handlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      afterDrag.current = false
      event.currentTarget.setPointerCapture(event.pointerId)
      const start = { x: event.clientX, y: event.clientY }
      press.current = { start, point: start, pointer: event.pointerId, handle: event.currentTarget, moved: false }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = press.current
      if (!current) return
      const point = { x: event.clientX, y: event.clientY }
      current.point = point
      if (!current.moved && Math.hypot(point.x - current.start.x, point.y - current.start.y) < DRAG_DISTANCE) return
      if (!current.moved) setDragging(true)
      current.moved = true
      latest.current.onDrag(point)
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => end({ x: event.clientX, y: event.clientY }),
    onPointerCancel: () => end(null),
  }

  const endedInDrag = () => {
    const was = afterDrag.current
    afterDrag.current = false
    return was
  }

  return { dragging, handlers, endedInDrag }
}
