/**
 * PROTOTYPE check: display-time transposition against music theory.
 *
 * Source and target keys are every value of `app_public.musical_key`
 * (migrations/current/0200-songs.sql). For each source key, a chart of its seven
 * diatonic chords, spelled from the scale, is transposed with ChordSheetJS's
 * `Song.changeKey` to every target key of the same mode. (A major-to-minor
 * change is a reharmonization, not a transposition: `changeKey` moves chords by
 * the distance between tonics and keeps the mode.)
 *
 * The oracle is the scale spelled by letter name, not ChordSheetJS: each degree
 * takes the next letter, and its accidental is whatever makes the pitch right.
 * So F major has Bb (never A#) and E major has G# (never Ab).
 *
 * Pass: every chord root matches the target scale's spelling, and transposing
 * back to the source key restores the chart exactly.
 *
 * Usage: bun checks/transpose.ts
 */
import { ChordLyricsPair, ChordProParser, type Song } from "chordsheetjs";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(path.join(import.meta.dir, "../../../migrations/current/0200-songs.sql"), "utf8");
const domainKeys = [...migration.slice(migration.indexOf("value in ("), migration.indexOf(")\n);")).matchAll(/'([^']+)'/g)].map(
  (m) => m[1]!,
);

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PITCH = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_QUALITY = ["", "m", "m", "", "", "m", "dim"];
const MINOR_QUALITY = ["m", "dim", "", "m", "m", "", ""];

type Spelled = { letter: number; accidental: number };

const results = { pass: 0, wrongSpelling: [] as Array<string>, unspellable: new Set<string>(), roundTripFail: [] as Array<string> };

for (const source of domainKeys) {
  const chart = diatonicChart(source);
  if (!chart) continue;
  const song = new ChordProParser().parse(chart);
  for (const target of domainKeys.filter((k) => k.endsWith("m") === source.endsWith("m"))) {
    const transposed = song.changeKey(target);
    const expected = diatonicChords(target);
    if (!expected) {
      results.unspellable.add(target);
      continue;
    }
    const got = chords(transposed);
    const mismatches = got.flatMap((chord, i) => (chord === expected[i] ? [] : [`${expected[i]}->${chord}`]));
    if (mismatches.length > 0) {
      results.wrongSpelling.push(`${source} -> ${target}: ${mismatches.join(" ")}`);
    } else {
      results.pass++;
    }
    const back = chords(transposed.changeKey(source));
    if (back.join(" ") !== chords(song).join(" ")) {
      results.roundTripFail.push(`${source} -> ${target} -> ${source}: ${back.join(" ")}`);
    }
  }
}

const total = results.pass + results.wrongSpelling.length;
console.log(`keys in domain: ${domainKeys.length} (${domainKeys.join(" ")})`);
console.log(`keys needing double sharps/flats (no practical spelling): ${[...results.unspellable].join(" ") || "none"}`);
console.log(`spelling: ${results.pass}/${total} transpositions spelled every root correctly`);
const byTarget = new Map<string, number>();
for (const line of results.wrongSpelling) {
  const target = line.split(" -> ")[1]!.split(":")[0]!;
  byTarget.set(target, (byTarget.get(target) ?? 0) + 1);
}
console.log(`  wrong spellings by target key: ${[...byTarget].map(([k, n]) => `${k}:${n}`).join(" ")}`);
for (const line of results.wrongSpelling.filter((_, i) => i % 40 === 0).slice(0, 10)) console.log(`  e.g. ${line}`);
console.log(`round trip: ${total - results.roundTripFail.length}/${total} restored the chart exactly`);
for (const line of results.roundTripFail.slice(0, 5)) console.log(`  FAIL ${line}`);

function diatonicChart(key: string): string | null {
  const roots = diatonicChords(key);
  return roots ? `{key: ${key}}\n${roots.map((chord) => `[${chord}]la `).join("")}\n` : null;
}

/** The seven diatonic triads of a key, spelled by letter; null if a degree needs a double accidental. */
function diatonicChords(key: string): Array<string> | null {
  const minor = key.endsWith("m");
  const tonic = parseNote(minor ? key.slice(0, -1) : key);
  const steps = minor ? MINOR_STEPS : MAJOR_STEPS;
  const qualities = minor ? MINOR_QUALITY : MAJOR_QUALITY;
  const tonicPitch = LETTER_PITCH[tonic.letter]! + tonic.accidental;
  const chords: Array<string> = [];
  for (let degree = 0; degree < 7; degree++) {
    const letter = (tonic.letter + degree) % 7;
    const pitch = (tonicPitch + steps[degree]!) % 12;
    let accidental = (pitch - LETTER_PITCH[letter]! + 12) % 12;
    if (accidental > 6) accidental -= 12;
    if (Math.abs(accidental) > 1) return null;
    chords.push(`${LETTERS[letter]}${accidental === 1 ? "#" : accidental === -1 ? "b" : ""}${qualities[degree]}`);
  }
  return chords;
}

function parseNote(name: string): Spelled {
  return { letter: LETTERS.indexOf(name[0]!), accidental: name.slice(1) === "#" ? 1 : name.slice(1) === "b" ? -1 : 0 };
}

function chords(song: Song): Array<string> {
  return song.lines.flatMap((line) =>
    line.items.flatMap((item) => (item instanceof ChordLyricsPair && item.chords.trim() ? [item.chords.trim()] : [])),
  );
}
