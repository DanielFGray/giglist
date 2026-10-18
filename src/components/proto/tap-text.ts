// PROTOTYPE: throwaway. Text helpers for EditorText: the whole chart is one
// chords-over-lyrics string, so every edit is a string edit at a caret.
import { isChordLine } from "~/charts/lyrics";

export const PHRASE_START = /^\{\s*start_of_textblock\s*(?::\s*(.*?))?\s*\}$/;
export const PHRASE_END = /^\{\s*end_of_textblock\s*\}$/;

export type At = { line: number; column: number };

/** The caret's line and column in `text`. */
export function atCaret(text: string, caret: number): At {
  const before = text.slice(0, caret);
  const lines = before.split("\n");
  return { line: lines.length - 1, column: lines[lines.length - 1]!.length };
}

/** The offset of the start of `line`, for putting a caret back after an edit. */
export function lineStart(text: string, line: number): number {
  let at = 0;
  for (let i = 0; i < line; i++) at = text.indexOf("\n", at) + 1;
  return at;
}

export type Edit = { text: string; caret: number };

function caretAfter(text: string, line: number, column: number): number {
  return Math.min(lineStart(text, line) + column, text.length);
}

/**
 * The chord row for the caret: the row the caret is on when that row is chords,
 * otherwise the row above it, which holds the chords over those words. A caret
 * on a lyric line with no chord row above it gets one.
 */
export function insertChord(text: string, caret: number, chord: string): Edit {
  const { line, column } = atCaret(text, caret);
  const lines = text.split("\n");
  const row = isChordLine(lines[line] ?? "")
    ? line
    : isChordLine(lines[line - 1] ?? "")
      ? line - 1
      : -1;
  if (row < 0) {
    // No chord row for these words yet: one goes in above them.
    lines.splice(line, 0, chord);
    return {
      text: lines.join("\n"),
      caret: caretAfter(lines.join("\n"), line + 1, column),
    };
  }
  const existing = lines[row] ?? "";
  // Past the end of a short row is a gap, not an overwrite, so the row grows.
  const at = column;
  lines[row] =
    existing.slice(0, at).padEnd(at, " ") + chord + existing.slice(at);
  // The caret stays on the words the chord belongs to, so the next chord lands on the next word.
  return {
    text: lines.join("\n"),
    caret: caretAfter(lines.join("\n"), line, at),
  };
}

/** A `[Header]` line above the caret's line, with the caret left on the words it had. */
export function insertSection(
  text: string,
  caret: number,
  label: string,
): Edit {
  const { line } = atCaret(text, caret);
  const lines = text.split("\n");
  lines.splice(line, 0, `[${label}]`);
  return {
    text: lines.join("\n"),
    caret: caretAfter(text, line + 1, atCaret(text, caret).column),
  };
}

export type Block = { start: number; end: number; name: string; tex: string };

/** The phrase blocks in the text, as line ranges, in order. */
export function phraseBlocks(text: string): Array<Block> {
  const lines = text.split("\n");
  const out: Array<Block> = [];
  let start = -1;
  let name = "";
  lines.forEach((line, i) => {
    const open = PHRASE_START.exec(line);
    if (start < 0 && open) {
      start = i;
      name = open[1] ?? "";
    } else if (start >= 0 && PHRASE_END.test(line)) {
      out.push({
        start,
        end: i + 1,
        name,
        tex: lines
          .slice(start + 1, i)
          .map(stripIndent)
          .join("\n"),
      });
      start = -1;
    }
  });
  return out;
}

/** A phrase's notation lines, indented where a line would read as a directive. */
export function phraseLines(name: string, tex: string): Array<string> {
  const head = name.trim()
    ? `{start_of_textblock: ${name.trim()}}`
    : "{start_of_textblock}";
  return [
    head,
    ...tex
      .split("\n")
      .map((line) => (/^\{.*\}$/.test(line) ? ` ${line}` : line)),
    "{end_of_textblock}",
  ];
}

/** A phrase block at the caret, with the caret below it. */
export function insertPhrase(
  text: string,
  caret: number,
  name: string,
  tex: string,
): Edit & { block: Block } {
  const { line, column } = atCaret(text, caret);
  const lines = text.split("\n");
  lines.splice(line, 0, ...phraseLines(name, tex));
  const out = lines.join("\n");
  return {
    text: out,
    caret: caretAfter(out, line + phraseLines(name, tex).length, column),
    block: {
      start: line,
      end: line + phraseLines(name, tex).length,
      name,
      tex,
    },
  };
}

export function replacePhrase(
  text: string,
  block: Block,
  name: string,
  tex: string,
): string {
  const lines = text.split("\n");
  lines.splice(block.start, block.end - block.start, ...phraseLines(name, tex));
  return lines.join("\n");
}

export function removePhrase(text: string, block: Block): string {
  const lines = text.split("\n");
  lines.splice(block.start, block.end - block.start);
  return lines.join("\n");
}

const stripIndent = (line: string) =>
  /^ \{.*\}$/.test(line) ? line.slice(1) : line;

/** The chords already written in the text, in the order they appear. */
export function chordsInText(text: string): Array<string> {
  const found: Array<string> = [];
  for (const line of text.split("\n")) {
    if (!isChordLine(line)) continue;
    for (const token of line.match(/\S+/g) ?? [])
      if (/^[A-G]/.test(token) && !found.includes(token)) found.push(token);
  }
  return found;
}
