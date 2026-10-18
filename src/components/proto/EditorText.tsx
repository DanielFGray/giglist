// PROTOTYPE: throwaway. Variant: Text area with a toolbar.
import { useEffect, useMemo, useRef, useState } from "react";
import { charts } from "~/api/client";
import { exportChords, importPasted, suggestedChords } from "~/charts/lyrics";
import { errorMessage } from "../form";
import { PhraseForm } from "../PhraseForm";
import type { ProtoEditorProps } from "./props";
import {
  chordsInText,
  insertChord,
  insertPhrase,
  insertSection,
  phraseBlocks,
  removePhrase,
  replacePhrase,
  type Block,
} from "./tap-text";

const SECTIONS = ["Intro", "Verse", "Chorus", "Bridge", "Outro"] as const;

const button =
  "px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * The chart as one block of chords-over-lyrics text, with a toolbar that sticks
 * to the bottom of the screen: chord keys, a section header and a phrase, each
 * inserted at the caret. Save re-reads the text as a chart, so the revision has
 * no change set to compose.
 */
export function EditorText({
  chart,
  tempo,
  onSaved,
  onCancel,
}: ProtoEditorProps) {
  const [initial] = useState(() =>
    exportChords(chart.source, chart.written_key),
  );
  const [text, setText] = useState(initial);
  const [sections, setSections] = useState(false);
  const [editing, setEditing] = useState<{
    block: Block;
    fresh: boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);

  useEffect(() => {
    if (caret.current === null) return;
    area.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);

  const blocks = useMemo(() => phraseBlocks(text), [text]);
  const keys = useMemo(() => {
    const suggested = chart.written_key
      ? suggestedChords(chart.written_key)
      : [];
    return [...new Set([...suggested, ...chordsInText(text)])];
  }, [chart.written_key, text]);

  const apply = (edit: { text: string; caret: number }) => {
    caret.current = edit.caret;
    setText(edit.text);
  };
  const caretAt = () => area.current?.selectionStart ?? text.length;

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await charts.saveRevision(chart.id, {
        parent_id: chart.revision_id,
        source: importPasted(text, chart.written_key),
        changes: null,
      });
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div data-pwid="proto-editor-text" className="space-y-2 pb-40">
      <div className="flex items-center gap-2">
        <button
          data-pwid="editor-save"
          type="button"
          onClick={save}
          disabled={text === initial || pending}
          className="min-h-11 flex-1 rounded-md bg-[var(--color-amber-accent)] px-4 py-2 text-sm font-semibold text-zinc-950 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          data-pwid="editor-cancel"
          type="button"
          onClick={onCancel}
          className={`${button} min-h-11 px-4`}
        >
          {text === initial ? "Close" : "Discard changes"}
        </button>
      </div>
      {error && (
        <div data-pwid="editor-error" className="text-sm text-red-400">
          {error}
        </div>
      )}

      {blocks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {blocks.map((block, i) => (
            <button
              key={i}
              data-pwid="phrase-edit"
              type="button"
              onClick={() => setEditing({ block, fresh: false })}
              className={`${button} min-h-11`}
            >
              Edit notation: {block.name || "phrase"}
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={area}
        data-pwid="text-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={14}
        aria-label="Chart as chords over lyrics"
        className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2 font-mono text-sm leading-tight"
      />

      {editing && (
        <PhraseForm
          name={editing.block.name}
          tex={editing.block.tex}
          tempo={tempo}
          onCancel={() => {
            if (editing.fresh) setText(removePhrase(text, editing.block));
            setEditing(null);
          }}
          onSave={(name, tex) => {
            setText(replacePhrase(text, editing.block, name, tex));
            setEditing(null);
          }}
        />
      )}

      {/* Fixed to the screen, so the soft keyboard pushes it up instead of hiding it. */}
      <div className="fixed inset-x-0 bottom-0 z-[90] space-y-1 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-2 pb-16">
        {sections && (
          <div data-pwid="section-list" className="flex flex-wrap gap-1">
            {SECTIONS.map((label) => (
              <button
                key={label}
                data-pwid="section-option"
                type="button"
                onClick={() => {
                  apply(insertSection(text, caretAt(), label));
                  setSections(false);
                  area.current?.focus();
                }}
                className={`${button} min-h-11 px-4 text-sm`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <button
            data-pwid="section-button"
            type="button"
            onClick={() => setSections(!sections)}
            className={`${button} min-h-11 flex-1 text-sm`}
          >
            Section
          </button>
          <button
            data-pwid="phrase-button"
            type="button"
            onClick={() => {
              const edit = insertPhrase(text, caretAt(), "", "");
              apply(edit);
              setEditing({ block: edit.block, fresh: true });
            }}
            className={`${button} min-h-11 flex-1 text-sm`}
          >
            Phrase
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {keys.map((chord) => (
            <button
              key={chord}
              data-pwid="chord-key"
              type="button"
              onClick={() => {
                apply(insertChord(text, caretAt(), chord));
                area.current?.focus();
              }}
              className="min-h-11 shrink-0 rounded-md border border-[var(--color-border-subtle)] px-3 text-sm font-semibold text-[var(--color-amber-accent)] cursor-pointer"
            >
              {chord}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
