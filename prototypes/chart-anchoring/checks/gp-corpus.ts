/**
 * PROTOTYPE check over a real Guitar Pro corpus (default: ~/Guitar Pro Tabs).
 *
 * 1. Import: every file loads in alphaTab.
 * 2. Token stability: loading a file twice gives the same beat tokens, although
 *    alphaTab's Beat.id differs between loads.
 * 3. Round trips: export (AlphaTex text, Guitar Pro 7 file) and import again keeps
 *    every beat's duration and notes. This decides what an edited score is stored as.
 * 4. Anchor survival: marks on real voices, with real repetition, after simulated
 *    edits, by two paths. `recorded`: the editor recorded the change set.
 *    `diffed`: the change set is derived by diffing the old and new revisions,
 *    as for a re-imported file.
 *    Pass is "correct"; "lost" (orphaned but should resolve) is a nuisance;
 *    "wrong" (placed somewhere else) is the failure that matters.
 *
 * Usage: bun checks/gp-corpus.ts [dir]
 */
import { exporter, importer, model } from "@coderline/alphatab";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { beatStep, follow, voiceBeats, type Change, type Resolution, type VoiceBeats } from "../anchoring.ts";

const dir = process.argv[2] ?? path.join(homedir(), "Guitar Pro Tabs");
const files = readdirSync(dir)
  .filter((name) => /\.(gp|gp3|gp4|gp5|gpx)$/i.test(name))
  .sort();

type EditKind = "insert-bar-before" | "delete-bar-before" | "change-marked-beat" | "delete-marked-bar";
type Outcome = "correct" | "lost" | "wrong" | "indistinguishable";
type Path = "recorded" | "diffed";

const report = {
  files: files.length,
  importFailures: [] as Array<{ file: string; error: string }>,
  tokenUnstable: [] as Array<string>,
  roundTrips: { alphaTex: roundTripTally(), gp7: roundTripTally() },
  anchors: { recorded: {}, diffed: {} } as Record<Path, Record<string, Record<Outcome, number>>>,
  wrongSamples: [] as Array<{ file: string; path: Path; edit: EditKind; expected: string; got: string }>,
};
const edits = ["insert-bar-before", "delete-bar-before", "change-marked-beat", "delete-marked-bar"] as const;
for (const path of ["recorded", "diffed"] as const) {
  for (const edit of edits) report.anchors[path][edit] = { correct: 0, lost: 0, wrong: 0, indistinguishable: 0 };
}

const random = mulberry32(20261015);

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(path.join(dir, file)));
  let score: model.Score;
  try {
    score = importer.ScoreLoader.loadScoreFromBytes(bytes);
  } catch (error) {
    report.importFailures.push({ file, error: String(error).slice(0, 160) });
    continue;
  }

  const voices = listVoices(score);
  const again = importer.ScoreLoader.loadScoreFromBytes(bytes);
  if (voices.some((v) => tokens(voiceBeats(again, v.track, v.staff, v.voice)) !== tokens(voiceBeats(score, v.track, v.staff, v.voice)))) {
    report.tokenUnstable.push(file);
  }

  checkRoundTrip("alphaTex", file, score, voices, () =>
    importer.ScoreLoader.loadAlphaTex(new exporter.AlphaTexExporter().exportToString(score)),
  );
  checkRoundTrip("gp7", file, score, voices, () =>
    importer.ScoreLoader.loadScoreFromBytes(new exporter.Gp7Exporter().export(score)),
  );

  for (const where of voices) {
    const beats = voiceBeats(score, where.track, where.staff, where.voice);
    if (beats.length < 40 || beats.every((b) => b.token.includes("r:"))) continue;
    for (let n = 0; n < 4; n++) {
      const index = 8 + Math.floor(random() * (beats.length - 16));
      if (beats[index]!.token.includes("r:")) continue;
      const marked = { start: index, end: index + 1 };
      for (const edit of edits) {
        const result = applyEdit(beats, index, edit);
        if (!result) continue;
        const resolutions: Record<Path, Resolution> = {
          recorded: follow(marked, [beatStep(beats, result.beats, [result.change])]),
          diffed: follow(marked, [beatStep(beats, result.beats, null)]),
        };
        for (const path of ["recorded", "diffed"] as const) {
          const outcome = classify(resolutions[path], result.expected, result.beats, beats, index);
          report.anchors[path][edit]![outcome]++;
          if (outcome === "wrong" && report.wrongSamples.length < 15) {
            report.wrongSamples.push({ file, path, edit, expected: String(result.expected), got: JSON.stringify(resolutions[path]) });
          }
        }
      }
    }
  }
}

mkdirSync(path.join(import.meta.dir, "out"), { recursive: true });
writeFileSync(path.join(import.meta.dir, "out", "gp-report.json"), JSON.stringify(report, null, 2));
printSummary();

function checkRoundTrip(
  format: keyof typeof report.roundTrips,
  file: string,
  score: model.Score,
  voices: Array<Where>,
  roundTrip: () => model.Score,
) {
  const tally = report.roundTrips[format];
  let after: model.Score;
  try {
    after = roundTrip();
  } catch (error) {
    tally.failed.push({ file, error: String(error).split("\n")[0]!.slice(0, 120) });
    return;
  }
  for (const v of voices) {
    const before = voiceBeats(score, v.track, v.staff, v.voice);
    const got = voiceBeats(after, v.track, v.staff, v.voice);
    const at = before.findIndex((beat, i) => beat.token !== got[i]?.token);
    if (at >= 0 || before.length !== got.length) {
      const i = at >= 0 ? at : Math.min(before.length, got.length);
      tally.lossy.push({
        file,
        firstDiff: `track ${v.track} voice ${v.voice} beat ${i} (bar ${before[i]?.bar}): ${before[i]?.token} -> ${got[i]?.token}`,
      });
      return;
    }
  }
  tally.lossless++;
}

function roundTripTally() {
  return { lossless: 0, lossy: [] as Array<{ file: string; firstDiff: string }>, failed: [] as Array<{ file: string; error: string }> };
}

/**
 * Applies one simulated edit to a voice. `expected` is where the marked beat
 * now is, or null when it was deleted and the mark should be orphaned.
 */
function applyEdit(
  beats: VoiceBeats,
  index: number,
  edit: EditKind,
): { beats: VoiceBeats; change: Change; expected: number | null } | null {
  const markedBar = beats[index]!.bar;
  const barRange = (bar: number) => {
    const start = beats.findIndex((b) => b.bar === bar);
    let end = start;
    while (end < beats.length && beats[end]!.bar === bar) end++;
    return { start, end };
  };
  switch (edit) {
    case "insert-bar-before": {
      const first = barRange(beats[0]!.bar);
      const inserted = beats.slice(first.start, first.end);
      return { beats: [...inserted, ...beats], change: { from: 0, to: 0, insert: inserted.length }, expected: index + inserted.length };
    }
    case "delete-bar-before": {
      const earlier = beats.find((b) => b.bar < markedBar - 2)?.bar;
      if (earlier === undefined) return null;
      const range = barRange(earlier);
      return {
        beats: [...beats.slice(0, range.start), ...beats.slice(range.end)],
        change: { from: range.start, to: range.end, insert: 0 },
        expected: index - (range.end - range.start),
      };
    }
    case "change-marked-beat": {
      const changed = [...beats];
      changed[index] = { ...beats[index]!, token: `${beats[index]!.token}+edited` };
      return { beats: changed, change: { from: index, to: index + 1, insert: 1 }, expected: index };
    }
    case "delete-marked-bar": {
      const range = barRange(markedBar);
      return {
        beats: [...beats.slice(0, range.start), ...beats.slice(range.end)],
        change: { from: range.start, to: range.end, insert: 0 },
        expected: null,
      };
    }
  }
}

/**
 * `indistinguishable`: the mark landed off target on a beat whose content and
 * eight beats of context on each side equal the target's, as in a repeated
 * riff. No content-based anchor can tell these apart.
 */
function classify(resolution: Resolution, expected: number | null, after: VoiceBeats, before: VoiceBeats, index: number): Outcome {
  if (resolution.state === "orphaned") return expected === null ? "correct" : "lost";
  if (resolution.start === expected) return "correct";
  const window = (beats: VoiceBeats, i: number) => tokens(beats.slice(Math.max(0, i - 8), i + 9));
  const target = expected === null ? window(before, index) : window(after, expected);
  return window(after, resolution.start) === target ? "indistinguishable" : "wrong";
}

type Where = { track: number; staff: number; voice: number };

function listVoices(score: model.Score): Array<Where> {
  const voices: Array<Where> = [];
  for (const track of score.tracks) {
    track.staves.forEach((staff, staffIndex) => {
      const voiceCount = Math.max(0, ...staff.bars.map((bar) => bar.voices.length));
      for (let voice = 0; voice < voiceCount; voice++) {
        const hasNotes = staff.bars.some((bar) => bar.voices[voice]?.beats.some((beat) => beat.notes.length > 0));
        if (hasNotes) voices.push({ track: track.index, staff: staffIndex, voice });
      }
    });
  }
  return voices;
}

function tokens(beats: VoiceBeats): string {
  return beats.map((b) => b.token).join(" ");
}

function printSummary() {
  const imported = report.files - report.importFailures.length;
  console.log(`files: ${report.files}, imported: ${imported}, import failures: ${report.importFailures.length}`);
  for (const f of report.importFailures) console.log(`  import FAIL ${f.file}: ${f.error}`);
  console.log(`token stability across reloads: ${imported - report.tokenUnstable.length}/${imported} stable`);
  for (const [format, tally] of Object.entries(report.roundTrips)) {
    console.log(`${format} round trip: ${tally.lossless} lossless, ${tally.lossy.length} lossy, ${tally.failed.length} failed to re-import`);
    for (const l of tally.lossy.slice(0, 5)) console.log(`  lossy ${l.file}: ${l.firstDiff}`);
    for (const l of tally.failed.slice(0, 5)) console.log(`  failed ${l.file}: ${l.error}`);
  }
  console.log("anchor survival (marks on real voices):");
  for (const [path, byEdit] of Object.entries(report.anchors)) {
    for (const [edit, counts] of Object.entries(byEdit)) {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      console.log(`  ${path.padEnd(6)} ${edit.padEnd(20)} n=${String(total).padStart(5)}  ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join("  ")}`);
    }
  }
  for (const w of report.wrongSamples.slice(0, 8)) console.log(`  wrong: ${w.file} ${w.path} ${w.edit} expected ${w.expected} got ${w.got}`);
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
