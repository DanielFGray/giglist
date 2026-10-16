/**
 * PROTOTYPE check: does importing pasted chords-over-lyrics text keep it intact?
 *
 * The pasted text is the ground truth. For every lyric line under a chord line:
 * - lyrics: the parsed line's lyrics, joined, equal the pasted lyric line exactly;
 * - chords: each chord sits at the lyric column it was typed above
 *   (a chord past the end of the lyrics is placed at the end).
 * And stability: for ChordSheetJS's parsers, format back to chords-over-lyrics
 * and parse again; for the prototype importer, whose stored form is ChordPro,
 * format and parse the ChordPro again. Nothing may change.
 *
 * Usage: bun checks/paste.ts [files...]   (default: fixtures/*.txt)
 */
import {
  ChordLyricsPair,
  ChordProFormatter,
  ChordProParser,
  ChordsOverWordsFormatter,
  ChordsOverWordsParser,
  UltimateGuitarParser,
  type Song,
} from "chordsheetjs";
import { importPasted } from "../anchoring.ts";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync(path.join(import.meta.dir, "../fixtures")).filter((f) => f.endsWith(".txt")).map((f) => path.join(import.meta.dir, "../fixtures", f));

/** The prototype's importer: pasted text to ChordPro, read back with ChordSheetJS's lossless ChordPro parser. */
class PrototypeImporter {
  parse(text: string): Song {
    return new ChordProParser().parse(importPasted(text));
  }
}

const parsers = { UltimateGuitarParser, ChordsOverWordsParser, PrototypeImporter };

for (const file of files) {
  const pasted = readFileSync(file, "utf8");
  const truth = groundTruth(pasted);
  console.log(`${path.basename(file)}: ${truth.length} lyric lines with chords`);
  for (const [name, Parser] of Object.entries(parsers)) {
    const song = new Parser().parse(pasted);
    const lines = parsedLines(song);
    let lyricErrors = 0;
    let chordErrors = 0;
    const samples: Array<string> = [];
    truth.forEach((expected, i) => {
      const got = lines.find((line) => line.lyrics.trimEnd() === expected.lyrics.trimEnd()) ?? lines[i];
      if (!got || got.lyrics.trimEnd() !== expected.lyrics.trimEnd()) {
        lyricErrors++;
        if (samples.length < 3) samples.push(`lyrics ${JSON.stringify(expected.lyrics)} -> ${JSON.stringify(got?.lyrics)}`);
        return;
      }
      const want = expected.chords.map((c) => `${Math.min(c.column, expected.lyrics.length)}:${c.chord}`).join(" ");
      const have = got.chords.map((c) => `${c.column}:${c.chord}`).join(" ");
      if (want !== have) {
        chordErrors++;
        if (samples.length < 3) samples.push(`chords on ${JSON.stringify(expected.lyrics.slice(0, 30))}: want ${want} got ${have}`);
      }
    });
    const shown = new ChordsOverWordsFormatter().format(song);
    const stable =
      Parser === PrototypeImporter
        ? new ChordProFormatter().format(new ChordProParser().parse(new ChordProFormatter().format(song))) ===
          new ChordProFormatter().format(song)
        : new ChordsOverWordsFormatter().format(new Parser().parse(shown)) === shown;
    const sections = song.lines.flatMap((l) => l.items).filter((item) => "isSectionStart" in item && (item as { isSectionStart(): boolean }).isSectionStart()).length;
    console.log(
      `  ${name.padEnd(22)} lyrics intact ${truth.length - lyricErrors}/${truth.length}, chords placed ${truth.length - lyricErrors - chordErrors}/${truth.length - lyricErrors}, sections ${sections}, re-edit stable ${stable}`,
    );
    for (const sample of samples) console.log(`    ${sample}`);
  }
}

type TruthLine = { lyrics: string; chords: Array<{ column: number; chord: string }> };

/** Chord lines are lines whose every token parses as a chord-like symbol. */
function groundTruth(text: string): Array<TruthLine> {
  const lines = text.split("\n");
  const truth: Array<TruthLine> = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!;
    if (!isChordLine(line) || lines[i + 1]!.trim() === "" || isChordLine(lines[i + 1]!) || /^\[.*\]$/.test(lines[i + 1]!.trim())) continue;
    const chords = [...line.matchAll(/\S+/g)].map((m) => ({ column: m.index!, chord: m[0] }));
    truth.push({ lyrics: lines[i + 1]!, chords });
  }
  return truth;
}

function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  return line.trim() !== "" && tokens.every((t) => /^[A-G][#b]?(m|maj|min|dim|aug|sus)?[0-9]*(\/[A-G][#b]?)?$/.test(t));
}

/** Each parsed line's lyrics and the lyric column of each chord. */
function parsedLines(song: Song): Array<TruthLine> {
  return song.lines.flatMap((line) => {
    const pairs = line.items.filter((item): item is ChordLyricsPair => item instanceof ChordLyricsPair);
    if (pairs.length === 0) return [];
    let column = 0;
    const chords: TruthLine["chords"] = [];
    for (const pair of pairs) {
      if (pair.chords.trim()) chords.push({ column, chord: pair.chords.trim() });
      column += (pair.lyrics ?? "").length;
    }
    return [{ lyrics: pairs.map((p) => p.lyrics ?? "").join(""), chords }];
  });
}
