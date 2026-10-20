import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react"
import { errorMessage } from "./form"
import { finishDirection, navigate, step, type Direction } from "./grid-keys"

/** One suggestion of a choice column: the value it saves, and what the list shows. */
export type Choice = { readonly value: string; readonly label: string; readonly hint?: string }

/**
 * How a column edits. Every editor saves a string; "" means the cell was
 * cleared, and the column's `save` decides what that means (inherit, unset,
 * or refuse with an error).
 */
export type ColumnEdit<R> = {
  /** The text an edit starts from. */
  readonly text: (row: R) => string
  /** Resolves once the page holds the saved row; until then the cell shows what was typed. */
  readonly save: (row: R, value: string) => Promise<void>
} & (
  | { readonly kind: "text"; readonly inputMode?: "text" | "numeric" | "decimal"; readonly placeholder?: string }
  | { readonly kind: "choice"; readonly choices: (query: string) => ReadonlyArray<Choice> }
)

export type GridColumn<R> = {
  readonly key: string
  readonly label: string
  readonly width?: string
  readonly align?: "left" | "right"
  readonly view: (row: R) => ReactNode
  /** Absent for a read-only column, which focus still visits. */
  readonly edit?: ColumnEdit<R>
}

/** The empty last row, where typing in `column` adds a row. `create` answers the new row's key. */
export type NewRow = {
  readonly column: string
  readonly placeholder: string
  /** Resolves to the new row's key once the page holds the row. */
  readonly create: (value: string) => Promise<string>
}

const NEW = "\u0000new"

/** The focused cell by row key, and the row's index when it was focused, for when that row leaves. */
type Active = { readonly row: string; readonly col: string; readonly index: number }
type Editing = { readonly text: string | null }

/**
 * A spreadsheet: arrows and Tab move between cells, typing edits, Enter saves
 * and moves down (see `grid-keys.ts` for the keys). Each saved cell calls its
 * column's `save`, and shows what was typed (marked `aria-busy`) until the
 * save settles. The rows are shown in the order given.
 */
export function Grid<R>({
  label,
  rows,
  rowKey,
  columns,
  newRow,
  onMoveRow,
  onDeleteRow,
  actions,
  pwid,
}: {
  label: string
  rows: ReadonlyArray<R>
  rowKey: (row: R) => string
  columns: ReadonlyArray<GridColumn<R>>
  newRow?: NewRow
  /** Puts a row at an index; turns on Alt+Up/Down and drag handles. */
  onMoveRow?: (key: string, index: number) => void
  /** Removes a row; turns on Ctrl+Delete. */
  onDeleteRow?: (key: string) => void
  /** Buttons at the end of each row, outside the keyboard grid. */
  actions?: (row: R) => ReactNode
  pwid: string
}) {
  const keys = [...rows.map(rowKey), ...(newRow ? [NEW] : [])]
  const size = { rows: keys.length, cols: columns.length }
  const [active, setActive] = useState<Active>({ row: keys[0] ?? NEW, col: columns[0]!.key, index: 0 })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [pending, setPending] = useState<ReadonlyMap<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const cells = useRef(new Map<string, HTMLTableCellElement>())
  const ownsFocus = useRef(false)
  const dragging = useRef<string | null>(null)

  // A row that left (deleted, or filtered out) gives its place to the row now there.
  const found = keys.indexOf(active.row)
  const rowIndex = found >= 0 ? found : active.index
  // A focused row that moved (Alt+arrows, or another person's edit) takes its new index with it.
  if (found >= 0 && found !== active.index) setActive({ ...active, index: found })
  const colIndex = Math.max(columns.findIndex((column) => column.key === active.col), 0)
  const current = { row: Math.min(rowIndex, size.rows - 1), col: colIndex }
  const activeId = cellId(keys[current.row] ?? NEW, columns[current.col]!.key)

  // Keyboard focus follows the active cell, but only once the person is working in the grid.
  useEffect(() => {
    if (editing === null && ownsFocus.current) cells.current.get(activeId)?.focus()
  }, [activeId, editing])

  const goTo = (cell: { row: number; col: number }) =>
    setActive({ row: keys[cell.row] ?? NEW, col: columns[cell.col]!.key, index: cell.row })

  const rowAt = (key: string) => rows.find((row) => rowKey(row) === key)

  /**
   * Saves one cell, shows the value until the save settles, then moves on. A
   * value equal to the stored one is not saved: the edit only moves.
   */
  const commit = (key: string, column: GridColumn<R>, value: string, shown: string, direction: Direction) => {
    setEditing(null)
    ownsFocus.current = true
    const from = { row: keys.indexOf(key), col: columns.indexOf(column) }
    const row = rowAt(key)
    const stored = row !== undefined && column.edit ? column.edit.text(row) : ""
    if (value === stored) return goTo(step(from, direction, size))
    const id = cellId(key, column.key)
    setPending((map) => new Map(map).set(id, shown))
    setError(null)
    const saving =
      key === NEW && newRow
        ? newRow.create(value)
        : row !== undefined && column.edit
          ? Promise.resolve(row).then((saved) => column.edit?.save(saved, value)).then(() => null)
          : Promise.resolve(null)
    // Enter in the new row stays there for the next one; Tab goes on along the row just made.
    if (key !== NEW || direction !== "next") goTo(step(from, direction, size))
    saving
      .then((created) => {
        if (created !== null && direction === "next") setActive({ row: created, col: columns[from.col + 1]?.key ?? column.key, index: from.row })
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() =>
        setPending((map) => {
          const next = new Map(map)
          next.delete(id)
          return next
        }),
      )
  }

  const editable = (key: string, column: GridColumn<R>) =>
    key === NEW ? newRow?.column === column.key : column.edit !== undefined

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    // Keys from an editor or a row button are theirs, not the grid's.
    if (editing !== null || event.target !== cells.current.get(activeId)) return
    const intent = navigate(current, event, size)
    const key = keys[current.row] ?? NEW
    const column = columns[current.col]!
    switch (intent.kind) {
      case "none":
        return
      case "move":
        // Tab at either end of the grid leaves it, so the keyboard is never trapped.
        if (event.key === "Tab" && intent.to.row === current.row && intent.to.col === current.col) return
        goTo(intent.to)
        break
      case "edit":
        if (!editable(key, column)) return
        setEditing({ text: intent.text })
        break
      case "clear":
        if (key === NEW || !column.edit) return
        commit(key, column, "", "", "stay")
        break
      case "moveRow":
        if (!onMoveRow || key === NEW) return
        onMoveRow(key, Math.min(Math.max(current.row + intent.delta, 0), rows.length - 1))
        break
      case "deleteRow":
        if (!onDeleteRow || key === NEW) return
        onDeleteRow(key)
        break
    }
    event.preventDefault()
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
        <table
          role="grid"
          aria-label={label}
          aria-rowcount={size.rows + 1}
          data-pwid={pwid}
          onKeyDown={onKeyDown}
          onFocus={() => {
            ownsFocus.current = true
          }}
          className="w-full border-collapse text-sm"
        >
          <thead>
            <tr role="row" className="text-left text-xs uppercase tracking-wide text-zinc-500">
              {onMoveRow && <th aria-hidden className="w-6" />}
              {columns.map((column) => (
                <th
                  key={column.key}
                  role="columnheader"
                  style={{ width: column.width }}
                  className={`px-3 py-2 font-medium border-b border-[var(--color-border-subtle)] ${column.align === "right" ? "text-right" : ""}`}
                >
                  {column.label}
                </th>
              ))}
              {actions && <th aria-hidden className="border-b border-[var(--color-border-subtle)]" />}
            </tr>
          </thead>
          <tbody>
            {keys.map((key, index) => {
              const row = rowAt(key)
              return (
                <tr
                  key={key}
                  role="row"
                  aria-rowindex={index + 2}
                  data-pwid={key === NEW ? "grid-new-row" : "grid-row"}
                  data-row-key={key === NEW ? undefined : key}
                  onDragOver={onMoveRow && key !== NEW ? (e) => e.preventDefault() : undefined}
                  onDrop={
                    onMoveRow && key !== NEW
                      ? (e) => {
                          e.preventDefault()
                          if (dragging.current !== null) onMoveRow(dragging.current, index)
                          dragging.current = null
                        }
                      : undefined
                  }
                  className="border-b border-[var(--color-border-subtle)] last:border-b-0"
                >
                  {onMoveRow && (
                    <td
                      aria-hidden
                      data-pwid="grid-drag"
                      draggable={key !== NEW}
                      onDragStart={() => {
                        dragging.current = key
                      }}
                      className={`text-center text-zinc-600 select-none ${key === NEW ? "" : "cursor-grab"}`}
                    >
                      {key === NEW ? "" : "⋮⋮"}
                    </td>
                  )}
                  {columns.map((column) => {
                    const id = cellId(key, column.key)
                    const isActive = id === activeId
                    const isEditing = isActive && editing !== null
                    const shown = pending.get(id)
                    return (
                      <td
                        key={column.key}
                        id={`${pwid}-${id}`}
                        role="gridcell"
                        tabIndex={isActive && !isEditing ? 0 : -1}
                        aria-readonly={!editable(key, column)}
                        aria-busy={shown !== undefined}
                        data-pwid={`cell-${column.key}`}
                        ref={(element) => {
                          if (element) cells.current.set(id, element)
                          else cells.current.delete(id)
                        }}
                        onMouseDown={() => {
                          ownsFocus.current = true
                        }}
                        onClick={() => {
                          if (isActive && !isEditing && editable(key, column)) setEditing({ text: null })
                          else setActive({ row: key, col: column.key, index })
                        }}
                        onDoubleClick={() => {
                          if (editable(key, column)) setEditing({ text: null })
                        }}
                        style={{ width: column.width }}
                        className={`relative px-3 py-1.5 h-9 outline-none whitespace-nowrap ${
                          column.align === "right" ? "text-right tabular-nums" : ""
                        } ${isActive ? "ring-2 ring-inset ring-[var(--color-amber-accent)]" : ""}`}
                      >
                        {isEditing ? (
                          <CellEditor
                            edit={key === NEW ? newRowEdit(columns, newRow) : column.edit}
                            initial={editing.text ?? (row !== undefined && column.edit ? column.edit.text(row) : "")}
                            caretAtEnd={editing.text !== null}
                            onFinish={(value, shownText, direction) => commit(key, column, value, shownText, direction)}
                            onCancel={() => {
                              ownsFocus.current = true
                              setEditing(null)
                            }}
                          />
                        ) : shown !== undefined ? (
                          <span className="text-zinc-400">{shown}</span>
                        ) : row !== undefined ? (
                          column.view(row)
                        ) : key === NEW && newRow?.column === column.key ? (
                          <span className="text-zinc-600">{newRow.placeholder}</span>
                        ) : null}
                      </td>
                    )
                  })}
                  {actions && <td className="px-2 text-right whitespace-nowrap">{row !== undefined && actions(row)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {error && (
        <div role="alert" data-pwid={`${pwid}-error`} className="text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}

const cellId = (row: string, col: string) => `${row}:${col}`

/** The new row's editor is its column's, with `save` unused (the grid calls `create`). */
const newRowEdit = <R,>(columns: ReadonlyArray<GridColumn<R>>, newRow: NewRow | undefined) =>
  columns.find((column) => column.key === newRow?.column)?.edit

/**
 * The input inside a cell being edited. Enter and Tab save and move, Escape
 * cancels, and leaving the cell (a click elsewhere) saves where it is. A
 * choice column lists its matches under the input, the best one marked:
 * arrows pick, and Enter or Tab saves the marked one.
 */
function CellEditor<R>({
  edit,
  initial,
  caretAtEnd,
  onFinish,
  onCancel,
}: {
  edit: ColumnEdit<R> | undefined
  initial: string
  caretAtEnd: boolean
  onFinish: (value: string, shown: string, direction: Direction) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const [marked, setMarked] = useState(0)
  const finished = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    element.focus()
    // Typing into a cell replaces its value, so the caret goes after the typed character; Enter selects the value to edit.
    if (caretAtEnd) element.setSelectionRange(element.value.length, element.value.length)
    else element.select()
  }, [caretAtEnd])

  const choices = edit?.kind === "choice" ? edit.choices(text) : []
  const markedChoice = choices[Math.min(marked, choices.length - 1)]

  const finish = (direction: Direction) => {
    if (finished.current) return
    if (edit?.kind === "choice") {
      // An emptied choice cell is cleared; text that matches nothing keeps the editor open.
      if (text.trim() === "") {
        finished.current = true
        onFinish("", "", direction)
      } else if (markedChoice) {
        finished.current = true
        onFinish(markedChoice.value, markedChoice.label, direction)
      }
      return
    }
    finished.current = true
    onFinish(text.trim(), text.trim(), direction)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      finished.current = true
      onCancel()
      return
    }
    if (edit?.kind === "choice" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault()
      const delta = event.key === "ArrowDown" ? 1 : -1
      setMarked((index) => Math.min(Math.max(index + delta, 0), Math.max(choices.length - 1, 0)))
      return
    }
    const direction = finishDirection(event)
    if (direction !== null) {
      event.preventDefault()
      finish(direction)
    }
  }

  const listId = useRef(`choices-${Math.random().toString(36).slice(2)}`).current
  return (
    <>
      <input
        ref={input}
        data-pwid="grid-editor"
        value={text}
        inputMode={edit?.kind === "text" ? edit.inputMode : undefined}
        placeholder={edit?.kind === "text" ? edit.placeholder : undefined}
        role={edit?.kind === "choice" ? "combobox" : undefined}
        aria-expanded={edit?.kind === "choice" ? choices.length > 0 : undefined}
        aria-controls={edit?.kind === "choice" ? listId : undefined}
        aria-activedescendant={markedChoice ? `${listId}-${markedChoice.value}` : undefined}
        onChange={(e) => {
          setText(e.target.value)
          setMarked(0)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => finish("stay")}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 w-full bg-[var(--color-surface)] px-3 text-sm outline-none ring-2 ring-inset ring-[var(--color-amber-accent)]"
      />
      {edit?.kind === "choice" && <ChoiceList id={listId} anchor={input} choices={choices} marked={markedChoice} text={text} onPick={(choice) => {
        finished.current = true
        onFinish(choice.value, choice.label, "stay")
      }} />}
    </>
  )
}

/**
 * The matches under a choice editor. It is placed with fixed coordinates
 * because the grid scrolls sideways, and a scrolling box would clip it.
 */
function ChoiceList({
  id,
  anchor,
  choices,
  marked,
  text,
  onPick,
}: {
  id: string
  anchor: RefObject<HTMLInputElement | null>
  choices: ReadonlyArray<Choice>
  marked: Choice | undefined
  text: string
  onPick: (choice: Choice) => void
}) {
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const rect = anchor.current?.getBoundingClientRect()
      if (rect) setPlace({ left: rect.left, top: rect.bottom, width: Math.max(rect.width, 240) })
    }
    measure()
    window.addEventListener("scroll", measure, true)
    window.addEventListener("resize", measure)
    return () => {
      window.removeEventListener("scroll", measure, true)
      window.removeEventListener("resize", measure)
    }
  }, [anchor])
  if (place === null || (choices.length === 0 && text.trim() === "")) return null
  return (
    <ul
      id={id}
      role="listbox"
      data-pwid="grid-choices"
      style={{ position: "fixed", left: place.left, top: place.top, width: place.width }}
      className="z-50 max-h-64 overflow-y-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] py-1 shadow-lg"
    >
      {choices.length === 0 ? (
        <li className="px-3 py-1.5 text-zinc-500">No match for “{text}”</li>
      ) : (
        choices.map((choice) => (
          <li
            key={choice.value}
            id={`${id}-${choice.value}`}
            role="option"
            aria-selected={choice === marked}
            data-pwid="grid-choice"
            // Keep focus in the input, so its blur does not save before the pick.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              onPick(choice)
            }}
            className={`flex justify-between gap-3 px-3 py-1.5 cursor-pointer ${
              choice === marked ? "bg-[var(--color-amber-accent)]/15 text-zinc-100" : "text-zinc-300"
            }`}
          >
            <span className="truncate">{choice.label}</span>
            {choice.hint && <span className="truncate text-zinc-500">{choice.hint}</span>}
          </li>
        ))
      )}
    </ul>
  )
}
