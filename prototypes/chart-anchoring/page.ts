/**
 * PROTOTYPE page: the DOM half of the anchoring prototype. All anchoring
 * decisions live in anchoring.ts; this file draws charts and marks, and turns
 * pointer input into marks.
 */
import { AlphaTabApi, importer, type model } from "@coderline/alphatab";
import { ChordLyricsPair, Tag, type Song } from "chordsheetjs";
import { getStroke } from "perfect-freehand";
import {
  anchorText,
  beatStep,
  contiguousChange,
  follow,
  importPasted,
  itemAt,
  parseChart,
  pasteStamp,
  voiceBeats,
  type Anchor,
  type AnchorText,
  type Change,
  type Mark,
  type MarkBody,
  type Placement,
  type Resolution,
  type Stamp,
  type Step,
} from "./anchoring.ts";
import fixture from "./fixtures/amazing-grace.txt" with { type: "text" };

type ChartRevision = { id: string; song: Song; anchor: AnchorText; recorded: Array<Change> | null };
type ScoreRevision = { id: string; name: string; score: model.Score };
type Tool = "move" | "ink" | "text" | "stamp";

const MAJOR_KEYS = ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"];
const MINOR_KEYS = ["Cm", "C#m", "Dm", "D#m", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Abm", "Am", "A#m", "Bbm", "Bm"];
/** Score marks have no chart font to follow; they use this em size. */
const SCORE_EM = 16;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const frame = $<HTMLDivElement>("chart-frame");
const chart = $<HTMLDivElement>("chart");
const gutter = $<HTMLDivElement>("gutter");
const marksLayer = $<HTMLDivElement>("marks");
const inkPreview = document.getElementById("ink-preview") as unknown as SVGSVGElement;
const source = $<HTMLTextAreaElement>("source");
const writtenKey = $<HTMLSelectElement>("written-key");
const keySelect = $<HTMLSelectElement>("key-select");
const stampSelect = $<HTMLSelectElement>("stamp-select");
const scoreEl = $<HTMLDivElement>("score");
const scoreMarksLayer = $<HTMLDivElement>("score-marks");
const trackSelect = $<HTMLSelectElement>("track-select");

let chartRevisions: Array<ChartRevision> = [];
let scoreRevisions: Array<ScoreRevision> = [];
let marks: Array<Mark> = [];
const stamps: Array<Stamp> = [];
let selectedId: string | null = null;
let idCounter = 0;
const nextId = (prefix: string) => `${prefix}${++idCounter}`;

// ---------------------------------------------------------------------------
// Wiring

source.value = fixture;
fillOptions(writtenKey, [...MAJOR_KEYS, ...MINOR_KEYS], "G");
startChart();

$("import").addEventListener("click", startChart);
$("save-edit").addEventListener("click", () => addChartRevision(true));
$("paste-over").addEventListener("click", () => addChartRevision(false));
keySelect.addEventListener("change", renderAll);
document.querySelectorAll<HTMLInputElement>('input[name="tool"]').forEach((radio) =>
  radio.addEventListener("change", () => {
    inkDraft = null;
  }),
);
$("save-stamp").addEventListener("click", saveStamp);
$("delete-mark").addEventListener("click", () => {
  marks = marks.filter((mark) => mark.id !== selectedId);
  selectedId = null;
  renderMarks();
});
new ResizeObserver(() => renderMarks()).observe(frame);
frame.addEventListener("pointerdown", onChartPointerDown);

const api = new AlphaTabApi(scoreEl, {
  core: { engine: "svg", scriptFile: `${location.origin}/alphatab/alphaTab.js`, fontDirectory: `${location.origin}/alphatab/font/` },
  player: { enablePlayer: true, enableCursor: true, soundFont: "/alphatab/soundfont/sonivox.sf2" },
});
api.renderStarted.on(() => delete $("score-frame").dataset.renderedVersion);
api.postRenderFinished.on(() => {
  // Beat clicks and beat positions need the finished render's bounds lookup.
  $("score-frame").dataset.renderedVersion = String(scoreRevisions.length);
  renderMarks();
});
api.playerReady.on(() => ($<HTMLButtonElement>("play").disabled = false));
api.beatMouseDown.on(onBeatClicked);
$("play").addEventListener("click", () => api.playPause());
$<HTMLInputElement>("metronome").addEventListener("change", (event) => {
  api.metronomeVolume = (event.target as HTMLInputElement).checked ? 1 : 0;
});
$<HTMLInputElement>("gp-file").addEventListener("change", (event) => loadScoreFile(event, true));
$<HTMLInputElement>("gp-revision").addEventListener("change", (event) => loadScoreFile(event, false));
trackSelect.addEventListener("change", renderScore);

// ---------------------------------------------------------------------------
// Chart revisions

function startChart() {
  chartRevisions = [chartRevision()];
  marks = marks.filter((mark) => mark.placement.anchor.scope.kind !== "chart");
  const key = currentChart().song.key ?? writtenKey.value;
  fillOptions(keySelect, key.endsWith("m") ? MINOR_KEYS : MAJOR_KEYS, key);
  renderAll();
}

/**
 * `recordedByEditor`: the in-app editor recorded this edit's change set. Without
 * it the new version came from outside the app, and the change set is derived.
 */
function addChartRevision(recordedByEditor: boolean) {
  const previous = currentChart();
  const next = chartRevision();
  chartRevisions.push({ ...next, recorded: recordedByEditor ? contiguousChange(previous.anchor.text, next.anchor.text) : null });
  renderAll();
}

function chartRevision(): ChartRevision {
  const song = parseChart(importPasted(source.value, writtenKey.value));
  return { id: nextId("chart-r"), song, anchor: anchorText(song), recorded: null };
}

function currentChart(): ChartRevision {
  return chartRevisions.at(-1)!;
}

function resolveChartMark(anchor: Anchor): Resolution {
  const from = chartRevisions.findIndex((revision) => revision.id === anchor.revision);
  if (from < 0) return { state: "orphaned", reason: "deleted" };
  const steps: Array<Step> = chartRevisions.slice(from + 1).map((revision, i) => ({
    before: chartRevisions[from + i]!.anchor.text,
    after: revision.anchor.text,
    recorded: revision.recorded,
  }));
  return follow(anchor, steps);
}

// ---------------------------------------------------------------------------
// Drawing the chart and its marks

function renderAll() {
  renderChart();
  renderMarks();
}

/**
 * Draws the stored chart transposed to the chosen key. Every item keeps its
 * line and item index from the stored chart, which is what anchors point at.
 */
function renderChart() {
  const revision = currentChart();
  const stored = revision.song;
  const shown = stored.key && keySelect.value && keySelect.value !== stored.key ? stored.changeKey(keySelect.value) : stored;
  chart.replaceChildren(
    ...shown.lines.map((line, lineIndex) => {
      const row = element("div", "line");
      line.items.forEach((item, itemIndex) => {
        const node = itemElement(item);
        if (!node) return;
        node.dataset.line = String(lineIndex);
        node.dataset.item = String(itemIndex);
        row.append(node);
      });
      return row;
    }),
  );
  $("revision-label").textContent = `revision ${chartRevisions.length} of ${chartRevisions.length}, stored in ${stored.key ?? "?"}`;
}

function itemElement(item: unknown): HTMLElement | null {
  if (item instanceof ChordLyricsPair) {
    if (!item.chords.trim() && !item.lyrics) return null;
    const node = element("span", "item");
    node.append(element("span", "chord", item.chords.trim()), element("span", "lyric", item.lyrics ?? ""));
    return node;
  }
  if (item instanceof Tag && item.isSectionStart()) return element("span", "item section-label", item.label || item.value);
  if (item instanceof Tag && item.isComment()) return element("span", "item comment", item.value);
  return null;
}

function renderMarks() {
  const em = chartEm();
  const tray = $<HTMLUListElement>("tray");
  marksLayer.replaceChildren();
  scoreMarksLayer.replaceChildren();
  tray.replaceChildren();
  const stateLines: Array<string> = [];
  for (const mark of marks) {
    const { anchor } = mark.placement;
    const resolution = anchor.scope.kind === "chart" ? resolveChartMark(anchor) : resolveScoreMark(anchor);
    stateLines.push(describe(mark, resolution));
    if (resolution.state === "orphaned") {
      const entry = element("li", "", `${bodySummary(mark.body)}: ${resolution.reason === "deleted" ? "its content was deleted" : "its place is uncertain after a paste-over"}`);
      entry.dataset.markId = mark.id;
      tray.append(entry);
      continue;
    }
    if (anchor.scope.kind === "chart") {
      const target = chartItemAt(resolution.start);
      if (!target) continue;
      const box = relativeBox(target, frame);
      const x = mark.placement.side === "margin" ? relativeBox(gutter, frame).x : box.x;
      marksLayer.append(markElement(mark, resolution, x + mark.placement.dx * em, box.y + mark.placement.dy * em, em, target));
    } else {
      const bounds = beatBounds(anchor, resolution.start);
      if (!bounds) continue;
      scoreMarksLayer.append(
        markElement(mark, resolution, bounds.x + mark.placement.dx * SCORE_EM, bounds.y + mark.placement.dy * SCORE_EM, SCORE_EM, null),
      );
    }
  }
  $("state").textContent = [
    `chart revisions: ${chartRevisions.map((r) => `${r.id} (${r.recorded ? "recorded" : r === chartRevisions[0] ? "start" : "diffed"})`).join(" → ")}`,
    `score revisions: ${scoreRevisions.map((r) => r.id).join(" → ") || "none"}`,
    `stamps: ${stamps.map((s) => s.name).join(", ") || "none"}`,
    "",
    ...stateLines,
  ].join("\n");
}

function markElement(mark: Mark, resolution: Resolution & { start: number }, x: number, y: number, em: number, target: HTMLElement | null): HTMLElement {
  const node = element("div", `mark ${mark.body.kind}${mark.id === selectedId ? " selected" : ""}`);
  node.dataset.markId = mark.id;
  node.dataset.state = resolution.state;
  if (target) node.dataset.target = `${target.dataset.line}:${target.dataset.item}`;
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.transform = `scale(${mark.placement.scale})`;
  if (mark.body.kind === "text") {
    node.style.fontSize = `${em}px`;
    node.textContent = mark.body.text;
  } else {
    node.append(inkSvg(mark.body.strokes, mark.body.width, mark.body.height, em));
  }
  if (mark.id === selectedId) node.append(element("span", "resize"));
  return node;
}

/** perfect-freehand tunes its smoothing for pixel input, so strokes are outlined in px, not em. */
function inkSvg(strokes: Array<Array<[number, number, number]>>, width: number, height: number, em: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(width * em));
  svg.setAttribute("height", String(height * em));
  for (const stroke of strokes) svg.append(inkSvgPx(stroke.map(([x, y, p]) => [x * em, y * em, p]), em));
  return svg;
}

function outlinePath(points: Array<Array<number>>): string {
  if (points.length === 0) return "";
  return `M ${points.map(([x, y]) => `${x!.toFixed(3)} ${y!.toFixed(3)}`).join(" L ")} Z`;
}

/** The on-screen element of the item that contains `offset` in the current revision's anchor text. */
function chartItemAt(offset: number): HTMLElement | null {
  const range = itemAt(currentChart().anchor, offset);
  return range ? chart.querySelector<HTMLElement>(`.item[data-line="${range.line}"][data-item="${range.item}"]`) : null;
}

// ---------------------------------------------------------------------------
// Pointer input on the chart

let inkDraft: { markId: string; strokes: Array<Array<[number, number, number]>> } | null = null;

function onChartPointerDown(event: PointerEvent) {
  // Without this, a mouse drag over chart text starts a text selection or a
  // native drag, and the browser cancels the pointer stream mid-gesture.
  event.preventDefault();
  const tool = currentTool();
  const point = framePoint(event);
  const markNode = (event.target as HTMLElement).closest<HTMLElement>(".mark");
  if (tool === "move") {
    if (!markNode) {
      selectedId = null;
      renderMarks();
      return;
    }
    selectedId = markNode.dataset.markId!;
    renderMarks();
    const resizing = (event.target as HTMLElement).classList.contains("resize");
    dragMark(event, selectedId, point, resizing);
    return;
  }
  if (tool === "ink") {
    drawStroke(event);
    return;
  }
  const body: MarkBody | null =
    tool === "text" ? { kind: "text", text: $<HTMLInputElement>("text-input").value } : (selectedStamp()?.body ?? null);
  if (!body) return;
  const placement = placementAt(point, point, 1);
  if (!placement) return;
  const id = nextId("mark");
  marks.push(tool === "stamp" ? pasteStamp(selectedStamp()!, id, placement) : { id, placement, body });
  renderMarks();
}

/**
 * Moves or resizes a mark. On release the mark is anchored again to the item
 * under its new center (or to the margin beside that item's line).
 */
function dragMark(event: PointerEvent, id: string, start: { x: number; y: number }, resizing: boolean) {
  const mark = marks.find((m) => m.id === id)!;
  const node = marksLayer.querySelector<HTMLElement>(`[data-mark-id="${id}"]`)!;
  const origin = { x: parseFloat(node.style.left), y: parseFloat(node.style.top) };
  const width = node.getBoundingClientRect().width;
  frame.setPointerCapture(event.pointerId);
  const onMove = (move: PointerEvent) => {
    const point = framePoint(move);
    if (resizing) {
      node.style.transform = `scale(${Math.max(0.3, mark.placement.scale * ((width + point.x - start.x) / width))})`;
    } else {
      node.style.left = `${origin.x + point.x - start.x}px`;
      node.style.top = `${origin.y + point.y - start.y}px`;
    }
  };
  const onUp = (up: PointerEvent) => {
    frame.removeEventListener("pointermove", onMove);
    frame.removeEventListener("pointerup", onUp);
    frame.removeEventListener("pointercancel", onUp);
    const point = framePoint(up);
    if (resizing) {
      mark.placement = { ...mark.placement, scale: Math.max(0.3, mark.placement.scale * ((width + point.x - start.x) / width)) };
    } else {
      const box = relativeBox(node, frame);
      const corner = { x: origin.x + point.x - start.x, y: origin.y + point.y - start.y };
      const placement = placementAt(corner, { x: corner.x + box.w / 2, y: corner.y + box.h / 2 }, mark.placement.scale);
      if (placement) mark.placement = placement;
    }
    renderMarks();
  };
  frame.addEventListener("pointermove", onMove);
  frame.addEventListener("pointerup", onUp);
  frame.addEventListener("pointercancel", onUp);
}

/**
 * Draws one stroke. Strokes drawn close together while the ink tool stays
 * selected join one mark, so a multi-stroke figure moves and pastes as a unit.
 */
function drawStroke(event: PointerEvent) {
  const em = chartEm();
  const points: Array<[number, number, number]> = [];
  const add = (e: PointerEvent) => {
    const p = framePoint(e);
    points.push([p.x, p.y, e.pressure || 0.5]);
    inkPreview.replaceChildren(inkSvgPx(points, em));
  };
  frame.setPointerCapture(event.pointerId);
  add(event);
  const onUp = () => {
    frame.removeEventListener("pointermove", add);
    frame.removeEventListener("pointerup", onUp);
    frame.removeEventListener("pointercancel", onUp);
    inkPreview.replaceChildren();
    const draft = inkDraft && marks.find((m) => m.id === inkDraft!.markId) ? inkDraft : null;
    const strokes = draft && near(boundsOf(draft.strokes), boundsOf([points]), em) ? [...draft.strokes, points] : [points];
    const id = strokes.length > 1 ? draft!.markId : nextId("mark");
    const bounds = boundsOf(strokes);
    const pad = em * 0.2;
    const placement = placementAt({ x: bounds.x - pad, y: bounds.y - pad }, { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }, 1);
    if (!placement) return;
    const mark: Mark = {
      id,
      placement,
      body: {
        kind: "ink",
        strokes: strokes.map((stroke) => stroke.map(([x, y, p]) => [(x - bounds.x + pad) / em, (y - bounds.y + pad) / em, p])),
        width: (bounds.w + 2 * pad) / em,
        height: (bounds.h + 2 * pad) / em,
      },
    };
    marks = [...marks.filter((m) => m.id !== id), mark];
    inkDraft = { markId: id, strokes };
    renderMarks();
  };
  frame.addEventListener("pointermove", add);
  frame.addEventListener("pointerup", onUp);
  frame.addEventListener("pointercancel", onUp);
}

function inkSvgPx(points: Array<[number, number, number]>, em: number): SVGPathElement {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", outlinePath(getStroke(points, { size: 0.16 * em, thinning: 0.6, smoothing: 0.5, streamline: 0.4 })));
  return path;
}

/**
 * Anchors a mark whose top-left is `corner`. The item is the one nearest
 * `probe` (the mark's center, or the click point for a click-placed mark); in
 * the margin it is the item nearest the probe's height. The corner's offset
 * from that item is stored in em.
 */
function placementAt(corner: { x: number; y: number }, probe: { x: number; y: number }, scale: number): Placement | null {
  const em = chartEm();
  const margin = relativeBox(gutter, frame);
  const inMargin = probe.x >= margin.x;
  const { x, y } = probe;
  let best: { node: HTMLElement; box: Box; distance: number } | null = null;
  for (const node of chart.querySelectorAll<HTMLElement>(".item")) {
    const box = relativeBox(node, frame);
    const dy = Math.max(box.y - y, 0, y - (box.y + box.h));
    const dx = inMargin ? 0 : Math.max(box.x - x, 0, x - (box.x + box.w));
    const distance = dy * 4 + dx;
    if (!best || distance < best.distance) best = { node, box, distance };
  }
  if (!best) return null;
  const range = currentChart().anchor.items.find(
    (item) => item.line === Number(best.node.dataset.line) && item.item === Number(best.node.dataset.item),
  )!;
  return {
    anchor: { revision: currentChart().id, scope: { kind: "chart" }, start: range.start, end: range.end },
    side: inMargin ? "margin" : "inline",
    dx: (corner.x - (inMargin ? margin.x : best.box.x)) / em,
    dy: (corner.y - best.box.y) / em,
    scale,
  };
}

// ---------------------------------------------------------------------------
// Stamps

function saveStamp() {
  const mark = marks.find((m) => m.id === selectedId);
  if (!mark) return;
  const stamp: Stamp = { id: nextId("stamp"), name: $<HTMLInputElement>("stamp-name").value || "stamp", body: structuredClone(mark.body) };
  stamps.push(stamp);
  stampSelect.append(new Option(stamp.name, stamp.id, true, true));
  renderMarks();
}

function selectedStamp(): Stamp | undefined {
  return stamps.find((stamp) => stamp.id === stampSelect.value);
}

// ---------------------------------------------------------------------------
// Guitar Pro scores

async function loadScoreFile(event: Event, fresh: boolean) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(await file.arrayBuffer()), api.settings);
  const revision = { id: nextId("score-r"), name: file.name, score };
  if (fresh) {
    scoreRevisions = [revision];
    marks = marks.filter((mark) => mark.placement.anchor.scope.kind !== "voice");
    fillOptions(
      trackSelect,
      score.tracks.map((track) => String(track.index)),
      "0",
      score.tracks.map((track) => track.name),
    );
  } else {
    scoreRevisions.push(revision);
  }
  input.value = "";
  renderScore();
}

function renderScore() {
  const revision = scoreRevisions.at(-1);
  if (!revision) return;
  $("score-label").textContent = `${revision.name}, version ${scoreRevisions.length}`;
  api.renderScore(revision.score, [Number(trackSelect.value)]);
}

function onBeatClicked(beat: model.Beat) {
  const tool = currentTool();
  if (tool !== "text" && tool !== "stamp") return;
  const revision = scoreRevisions.at(-1)!;
  const bar = beat.voice.bar;
  const scope = { kind: "voice" as const, track: bar.staff.track.index, staff: bar.staff.index, voice: beat.voice.index };
  const index = voiceBeats(revision.score, scope.track, scope.staff, scope.voice).findIndex(
    (b) => b.bar === bar.index && b.beat === beat.index,
  );
  const placement: Placement = {
    anchor: { revision: revision.id, scope, start: index, end: index + 1 },
    side: "inline",
    dx: 0,
    dy: -1.5,
    scale: 1,
  };
  const id = nextId("mark");
  if (tool === "stamp") {
    const stamp = selectedStamp();
    if (stamp) marks.push(pasteStamp(stamp, id, placement));
  } else {
    marks.push({ id, placement, body: { kind: "text", text: $<HTMLInputElement>("text-input").value } });
  }
  renderMarks();
}

/** Score revisions come from files, so every step's change set is derived. */
function resolveScoreMark(anchor: Anchor): Resolution {
  if (anchor.scope.kind !== "voice") throw new Error("not a score anchor");
  const { track, staff, voice } = anchor.scope;
  const from = scoreRevisions.findIndex((revision) => revision.id === anchor.revision);
  if (from < 0) return { state: "orphaned", reason: "deleted" };
  const beats = scoreRevisions.map((revision) => voiceBeats(revision.score, track, staff, voice));
  const steps = beats.slice(from + 1).map((after, i) => beatStep(beats[from + i]!, after, null));
  return follow(anchor, steps);
}

/** A beat's box in the score frame, or null when its track is not on screen. */
function beatBounds(anchor: Anchor, index: number): Box | null {
  if (anchor.scope.kind !== "voice" || anchor.scope.track !== Number(trackSelect.value)) return null;
  const { track, staff, voice } = anchor.scope;
  const score = scoreRevisions.at(-1)!.score;
  const position = voiceBeats(score, track, staff, voice)[index];
  if (!position) return null;
  const beat = score.tracks[track]!.staves[staff]!.bars[position.bar]!.voices[voice]!.beats[position.beat]!;
  const bounds = api.boundsLookup?.findBeat(beat)?.visualBounds;
  if (!bounds) return null;
  const surface = scoreEl.querySelector<HTMLElement>(".at-surface") ?? scoreEl;
  const origin = relativeBox(surface, $("score-frame"));
  return { x: origin.x + bounds.x, y: origin.y + bounds.y, w: bounds.w, h: bounds.h };
}

// ---------------------------------------------------------------------------
// Small helpers

type Box = { x: number; y: number; w: number; h: number };

function currentTool(): Tool {
  return document.querySelector<HTMLInputElement>('input[name="tool"]:checked')!.value as Tool;
}

function chartEm(): number {
  return parseFloat(getComputedStyle(frame).fontSize);
}

function framePoint(event: PointerEvent): { x: number; y: number } {
  const box = frame.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

function relativeBox(node: Element, container: Element): Box {
  const a = node.getBoundingClientRect();
  const b = container.getBoundingClientRect();
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
}

function boundsOf(strokes: Array<Array<[number, number, number]>>): Box {
  const xs = strokes.flat().map((p) => p[0]);
  const ys = strokes.flat().map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function near(a: Box, b: Box, em: number): boolean {
  return b.x < a.x + a.w + em && b.x + b.w > a.x - em && b.y < a.y + a.h + em && b.y + b.h > a.y - em;
}

function describe(mark: Mark, resolution: Resolution): string {
  const { anchor } = mark.placement;
  const where =
    anchor.scope.kind === "chart"
      ? JSON.stringify(chartRevisions.find((r) => r.id === anchor.revision)?.anchor.text.slice(anchor.start, anchor.end))
      : `beat ${anchor.start} of track ${anchor.scope.track}`;
  const now =
    resolution.state === "orphaned"
      ? `orphaned (${resolution.reason})`
      : `${resolution.state}${anchor.scope.kind === "chart" ? ` on ${JSON.stringify(currentChart().anchor.text.slice(resolution.start, resolution.end))}` : ` at beat ${resolution.start}`}`;
  return `${mark.id} ${bodySummary(mark.body)} [${mark.placement.side}] anchored in ${anchor.revision} to ${where} → ${now}`;
}

function bodySummary(body: MarkBody): string {
  return body.kind === "text" ? `text "${body.text}"` : `ink (${body.strokes.length} strokes)`;
}

function fillOptions(select: HTMLSelectElement, values: Array<string>, selected: string, labels = values) {
  select.replaceChildren(...values.map((value, i) => new Option(labels[i], value, false, value === selected)));
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
