/**
 * PROTOTYPE: throwaway. Lift the validated parts into the real module, then delete.
 *
 * Question: can a player's personal marks (ink, text, pasted stamps) stay attached
 * to chart content when the chart is transposed for a setlist, reflowed on a
 * different screen, or edited by a bandmate?
 *
 * Model: a mark is anchored to a range in one revision of a chart, never to page
 * coordinates. To show the mark on a later revision, the range is mapped through
 * the change set between the two revisions. The in-app editor records the change
 * set; a revision from outside the editor (re-import, paste-over) gets one from a
 * whole-text diff, and a mark where the diff could have aligned repeated content
 * either way is orphaned instead of guessed (see `withinSlide`).
 *
 * Chord charts are measured in characters of an anchor text derived from the
 * chart; tab is measured in beats of one voice. Both are strings to this module.
 *
 * Pure: no DOM. The page and the checks call into this module.
 */
import DiffMatchPatch from "diff-match-patch";
import { ChordLyricsPair, ChordProParser, Tag, type Song } from "chordsheetjs";
import type { model } from "@coderline/alphatab";

// ---------------------------------------------------------------------------
// Marks

/** A personal mark: a body placed relative to an anchor in the chart. */
export type Mark = { id: string; placement: Placement; body: MarkBody };

/** A saved body a player pastes into any chart. Pasting copies the body. */
export type Stamp = { id: string; name: string; body: MarkBody };

export type MarkBody = InkBody | TextBody;

/** Ink strokes in em units relative to the body's top-left. Points are [x, y, pressure]. */
export type InkBody = {
  kind: "ink";
  strokes: Array<Array<[number, number, number]>>;
  width: number;
  height: number;
};

export type TextBody = { kind: "text"; text: string };

/**
 * Where a mark sits. `inline` offsets are from the anchored item's top-left;
 * `margin` offsets are from the margin gutter at the anchored line's top, so a
 * margin note stays in the margin when the chart reflows.
 * Offsets and scale are in em, so they follow the chart's font size.
 */
export type Placement = {
  anchor: Anchor;
  side: "inline" | "margin";
  dx: number;
  dy: number;
  scale: number;
};

/** A range in one revision: characters of the anchor text, or beats of one voice. */
export type Anchor = { revision: string; scope: Scope; start: number; end: number };

export type Scope = { kind: "chart" } | { kind: "voice"; track: number; staff: number; voice: number };

export function pasteStamp(stamp: Stamp, id: string, placement: Placement): Mark {
  return { id, placement, body: structuredClone(stamp.body) };
}

// ---------------------------------------------------------------------------
// Following anchors across revisions

/**
 * One replacement between two revisions, in the earlier revision's offsets:
 * `[from, to)` was replaced by `insert` units. Sorted and non-overlapping.
 */
export type Change = { from: number; to: number; insert: number };

/**
 * Two consecutive revisions of one scope. `recorded` is the editor's change set,
 * or null when the later revision came from outside the editor.
 */
export type Step = { before: string; after: string; recorded: Array<Change> | null };

/**
 * `kept`: the marked content is unchanged.
 * `changed`: the marked content was edited (a chord, word, or fret); the page
 * shows the mark with a "changed" badge.
 * `orphaned`: the content was deleted, or a derived diff placed the mark where
 * the surrounding context no longer agrees (`uncertain`). The page shows the
 * mark in a tray instead of guessing a place.
 */
export type Resolution =
  | { state: "kept" | "changed"; start: number; end: number }
  | { state: "orphaned"; reason: "deleted" | "uncertain" };

export function follow(range: { start: number; end: number }, steps: Array<Step>): Resolution {
  let current: Resolution = { state: "kept", ...range };
  for (const step of steps) {
    if (current.state === "orphaned") return current;
    const next = followStep(current, step);
    current = next.state === "kept" && current.state === "changed" ? { ...next, state: "changed" } : next;
  }
  return current;
}

function followStep(range: { start: number; end: number }, step: Step): Resolution {
  const changes = step.recorded ?? changesBetween(step.before, step.after);
  const mapped = mapRange(range, changes);
  // Checked before "deleted": when one of two identical copies is removed, a
  // derived diff cannot say which, so the marked copy may still exist.
  if (step.recorded === null && withinSlide(range, mapped, changes, step)) {
    return { state: "orphaned", reason: "uncertain" };
  }
  if (!mapped) return { state: "orphaned", reason: "deleted" };
  const changed = step.before.slice(range.start, range.end) !== step.after.slice(mapped.start, mapped.end);
  return { state: changed ? "changed" : "kept", ...mapped };
}

/**
 * Derives the change set between two revisions with a whole-text diff (Myers,
 * via diff-match-patch). A diff aligns the entire song, so repeated choruses and
 * riffs confuse it far less than a search around the old position.
 */
export function changesBetween(before: string, after: string): Array<Change> {
  const diffs = new DiffMatchPatch().diff_main(before, after, false);
  const changes: Array<Change> = [];
  let offset = 0;
  for (const [op, text] of diffs) {
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      offset += text.length;
      continue;
    }
    let change = changes.at(-1);
    if (!change || change.to !== offset) {
      change = { from: offset, to: offset, insert: 0 };
      changes.push(change);
    }
    if (op === DiffMatchPatch.DIFF_DELETE) {
      change.to += text.length;
      offset += text.length;
    } else {
      change.insert += text.length;
    }
  }
  return changes;
}

/**
 * A derived diff picks one of several equally short alignments. Inside repeated
 * material a pure deletion or insertion can slide: deleting `before[from, to)`
 * gives the same result as deleting it shifted by k while the content repeats,
 * and the same holds for inserted content in the later revision. If a slid
 * position touches the mark, the diff cannot say whether the marked content was
 * the part deleted, or which copy the mark belongs to. Recorded change sets are
 * exact and skip this check.
 */
function withinSlide(
  range: { start: number; end: number },
  mapped: { start: number; end: number } | null,
  changes: Array<Change>,
  step: Step,
): boolean {
  let shift = 0;
  for (const change of changes) {
    const deleted = change.to - change.from;
    if (change.insert === 0 && overlaps(range, slideSpan(step.before, change.from, change.to))) return true;
    if (deleted === 0 && mapped) {
      const at = change.from + shift;
      if (touches(mapped, slideSpan(step.after, at, at + change.insert))) return true;
    }
    shift += change.insert - deleted;
  }
  return false;
}

/** The span `[from, to)` can cover when slid left and right through repeated content. */
function slideSpan(text: string, from: number, to: number): { start: number; end: number } {
  let left = from;
  while (left > 0 && text[left - 1] === text[left - 1 + (to - from)]) left--;
  let right = to;
  while (right < text.length && text[right] === text[right - (to - from)]) right++;
  return { start: left, end: right };
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start;
}

/** Overlapping or adjacent: a mark right next to slid inserted content may belong to either copy. */
function touches(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start <= b.end && a.end >= b.start;
}

/**
 * The change set one editor operation records: a single contiguous
 * replacement. The prototype's textarea stands in for the real editor, which
 * records each operation in anchor-text offsets as it happens. (Common
 * prefix/suffix is exact for one operation, except where the edit sits inside
 * repeated text; the real editor knows the position and has no such gap.)
 */
export function contiguousChange(before: string, after: string): Array<Change> {
  if (before === after) return [];
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  return [{ from: prefix, to: before.length - suffix, insert: after.length - suffix - prefix }];
}

/** Returns null when the changes deleted the whole range. */
export function mapRange(range: { start: number; end: number }, changes: Array<Change>): { start: number; end: number } | null {
  const start = mapPosition(range.start, changes, "start");
  const end = mapPosition(range.end, changes, "end");
  return end > start ? { start, end } : null;
}

/**
 * Content inserted exactly at a mark's start goes before the mark; content
 * inserted at its end stays outside it. A replacement that overlaps the mark
 * becomes part of it.
 */
function mapPosition(position: number, changes: Array<Change>, side: "start" | "end"): number {
  let shift = 0;
  for (const change of changes) {
    const delta = change.insert - (change.to - change.from);
    const before = change.to < position || (change.to === position && (change.from < position || side === "start"));
    if (before) {
      shift += delta;
      continue;
    }
    if (change.from >= position) break;
    return side === "start" ? change.from + shift : change.from + shift + change.insert;
  }
  return position + shift;
}

// ---------------------------------------------------------------------------
// Chord charts

/**
 * Turns pasted chords-over-lyrics text into the stored chart text (ChordPro).
 * Each chord goes into the lyric line under it at the column it was typed at.
 * The lyrics are kept exactly, except that `[ ] { }` become parentheses because
 * ChordPro reads them as chord and directive syntax. Header lines (`[Chorus]`,
 * `Verse 1:`) start sections.
 *
 * ChordSheetJS's own chords-over-words parsers are not used here: on real
 * pastes its Ultimate Guitar parser drops spaces from lyrics, and neither
 * parser turns `[Verse 1]` into a section (see checks/paste.ts).
 */
export function importPasted(text: string, writtenKey?: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const out: Array<string> = writtenKey ? [`{key: ${writtenKey}}`] : [];
  let open: string | null = null;
  const close = () => {
    if (open) out.push(`{end_of_${open}}`);
    open = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    const header = sectionHeader(line);
    if (header) {
      close();
      open = /chorus/i.test(header) && !/pre/i.test(header) ? "chorus" : "verse";
      out.push(`{start_of_${open}: ${header}}`);
      continue;
    }
    if (!isChordLine(line)) {
      out.push(escapeLyrics(line));
      continue;
    }
    const next = lines[i + 1]?.trimEnd() ?? "";
    const chords = [...line.matchAll(/\S+/g)].map((m) => ({ column: m.index!, chord: m[0] }));
    if (next.trim() !== "" && !isChordLine(next) && !sectionHeader(next)) {
      out.push(placeChords(next, chords));
      i++;
    } else {
      // A chord-only line (an intro or turnaround): keep the spacing as lyrics.
      out.push(placeChords(" ".repeat(line.length), chords).trimEnd());
    }
  }
  close();
  return out.join("\n");
}

function placeChords(lyrics: string, chords: Array<{ column: number; chord: string }>): string {
  let result = "";
  let at = 0;
  for (const { column, chord } of chords) {
    const offset = Math.min(column, lyrics.length);
    result += escapeLyrics(lyrics.slice(at, offset)) + `[${chord}]`;
    at = offset;
  }
  return result + escapeLyrics(lyrics.slice(at));
}

function sectionHeader(line: string): string | null {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line) ?? /^\s*([A-Za-z][A-Za-z -]*\d*)\s*:\s*$/.exec(line);
  return match && !isChordLine(match[1]!) ? match[1]!.trim() : null;
}

/** True when every token on the line is a chord or a chart symbol (bar lines, repeats, N.C.). */
function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  return line.trim() !== "" && tokens.every((token) => CHORD_TOKEN.test(token));
}

/** ChordPro reads `[` and `{` in a lyric as chord and directive syntax. */
function escapeLyrics(text: string): string {
  return text.replace(/[[\]{}]/g, (c) => ({ "[": "(", "]": ")", "{": "(", "}": ")" })[c]!);
}

const CHORD_TOKEN =
  /^(\(?[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?[0-9]*(sus[24]?|add[0-9]+|[#b][0-9]+)*(\/[A-G][#b]?)?\)?|\||\|\||-|\/|N\.?C\.?|\(?x\d+\)?)$/;

export function parseChart(source: string): Song {
  return new ChordProParser().parse(source);
}

/** One anchorable item: its line and item index in the song, and its range in the anchor text. */
export type ItemRange = { line: number; item: number; start: number; end: number };

export type AnchorText = { text: string; items: Array<ItemRange> };

/**
 * Derives the text that chord-chart anchors point into. It is built from the
 * stored (untransposed) chart, so display-time transposition never moves an
 * anchor: `Song.changeKey` maps every item one-to-one, and the page draws the
 * transposed item at the same line and item index.
 */
export function anchorText(song: Song): AnchorText {
  const items: Array<ItemRange> = [];
  let text = "";
  song.lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) text += "\n";
    line.items.forEach((item, itemIndex) => {
      const segment = itemSegment(item);
      if (segment.length === 0) return;
      items.push({ line: lineIndex, item: itemIndex, start: text.length, end: text.length + segment.length });
      text += segment;
    });
  });
  return { text, items };
}

/** The item that contains `offset`, used to place a mark on screen. */
export function itemAt(at: AnchorText, offset: number): ItemRange | undefined {
  return at.items.find((item) => offset >= item.start && offset < item.end);
}

function itemSegment(item: unknown): string {
  if (item instanceof ChordLyricsPair) {
    const chords = item.chords.trim();
    return (chords ? `[${chords}]` : "") + (item.lyrics ?? "");
  }
  if (item instanceof Tag) {
    if (item.isSectionStart()) return item.label || item.value;
    if (item.isComment()) return item.value;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Tab and notation (alphaTab scores)

/**
 * Every beat of one voice, in playing order. alphaTab's `Beat.id` comes from a
 * global counter set at load time, so a beat is identified by its position in
 * this list, never by id.
 */
export type VoiceBeats = Array<{ bar: number; beat: number; token: string }>;

export function voiceBeats(score: model.Score, track: number, staff: number, voice: number): VoiceBeats {
  const beats: VoiceBeats = [];
  for (const bar of score.tracks[track]?.staves[staff]?.bars ?? []) {
    (bar.voices[voice]?.beats ?? []).forEach((beat, beatIndex) =>
      beats.push({ bar: bar.index, beat: beatIndex, token: beatToken(beat) }),
    );
  }
  return beats;
}

/** Encodes two revisions of a voice as strings, one character per distinct beat token. */
export function beatStep(before: VoiceBeats, after: VoiceBeats, recorded: Array<Change> | null): Step {
  const codes = new Map<string, string>();
  const encode = (beats: VoiceBeats) => beats.map((beat) => internToken(codes, beat.token)).join("");
  return { before: encode(before), after: encode(after), recorded };
}

/**
 * A beat's content: duration, dots, rest flag, and its notes (string/fret for
 * fretted tracks, the drum's articulation id for percussion).
 */
export function beatToken(beat: model.Beat): string {
  // An empty beat only fills an empty bar; its duration means nothing and
  // exporters normalize it.
  if (beat.isEmpty) return "empty";
  // A percussion note stores an index into its track's articulation list when
  // the list exists (alphaTex imports), or the GP7 articulation id when it does
  // not (GP3-5 imports). The id identifies the drum either way.
  const articulations = beat.voice.bar.staff.track.percussionArticulations;
  const drum = (note: model.Note) => articulations[note.percussionArticulation]?.id ?? note.percussionArticulation;
  const notes = beat.notes
    .map((note) => (note.isPercussion ? `p${drum(note)}` : `${note.string}/${note.fret}`))
    .sort()
    .join(",");
  return `${beat.duration}${".".repeat(beat.dots)}${beat.isRest ? "r" : ""}:${notes}`;
}

function internToken(codes: Map<string, string>, token: string): string {
  let code = codes.get(token);
  if (code === undefined) {
    // Skip the UTF-16 surrogate block so every token is exactly one string unit.
    const point = FIRST_TOKEN_CODE + codes.size;
    code = String.fromCharCode(point >= 0xd800 ? point + 0x800 : point);
    codes.set(token, code);
  }
  return code;
}

const FIRST_TOKEN_CODE = 0x100;
