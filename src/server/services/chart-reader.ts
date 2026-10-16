import { Context, Effect, Layer, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import * as BunServices from "@effect/platform-bun/BunServices"
import { ChartInvalid } from "../../api/contracts"
import { MAX_SCAN_BYTES, MAX_SCAN_PAGES, scanFormat, textFromWords, wordsFromPdf, wordsFromTesseract } from "../../charts/scanned"

/** Longer than any one page takes; a program still running then is stuck. */
const TOOL_TIMEOUT = "60 seconds"

/**
 * Reads the chords and lyrics of an uploaded PDF or image, as the chords over
 * lyrics text a player would paste. Nothing is stored: the player corrects the
 * text before it becomes a chart.
 *
 * Both a PDF's text layer (`pdftotext -bbox`) and Tesseract give word boxes,
 * and `textFromWords` lays them out. A PDF with no text layer (a scan) is drawn
 * to images with `pdftoppm` first. The server needs poppler and tesseract with English
 * data installed; a missing program is a defect, not the player's error.
 */
export class ChartReader extends Context.Service<ChartReader, {
  readonly read: (bytes: Uint8Array) => Effect.Effect<string, ChartInvalid>
}>()("setlist/ChartReader") {
  static Live = Layer.effect(this, Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fs = yield* FileSystem
    const path = yield* Path

    /** The standard output of a program; a non-zero exit means it could not read the file. */
    const output = (command: string, args: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(ChildProcess.make(command, args, { stderr: "ignore" }))
        const [text, exitCode] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
          { concurrency: "unbounded" },
        )
        if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
          return yield* new ChartInvalid({ message: "That file could not be read" })
        }
        return text
      }).pipe(
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: TOOL_TIMEOUT,
          orElse: () => Effect.fail(new ChartInvalid({ message: "Reading that file took too long" })),
        }),
        Effect.catchTag("PlatformError", Effect.die),
      )

    const ocr = (image: string) =>
      output("tesseract", [image, "-", "--psm", "6", "tsv"]).pipe(Effect.map((tsv) => textFromWords(wordsFromTesseract(tsv))))

    const readPdf = Effect.fnUntraced(function* (dir: string, file: string) {
      const layer = wordsFromPdf(yield* output("pdftotext", ["-bbox", "-l", `${MAX_SCAN_PAGES}`, file, "-"]))
      if (layer.length > 0) return textFromWords(layer)
      yield* output("pdftoppm", ["-r", "300", "-gray", "-png", "-l", `${MAX_SCAN_PAGES}`, file, path.join(dir, "page")])
      // pdftoppm pads page numbers to the same width, so the names sort in page order.
      const pages = (yield* fs.readDirectory(dir).pipe(Effect.orDie)).filter((name) => name.startsWith("page")).toSorted()
      const texts = yield* Effect.forEach(pages, (page) => ocr(path.join(dir, page)))
      return texts.join("\n\n")
    })

    const read = Effect.fn("ChartReader.read")(function* (bytes: Uint8Array) {
      if (bytes.length > MAX_SCAN_BYTES) return yield* new ChartInvalid({ message: "That file is too large" })
      const format = scanFormat(bytes)
      if (format === null) return yield* new ChartInvalid({ message: "That is not a PDF or an image" })
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "setlist-scan-" }).pipe(Effect.orDie)
      const file = path.join(dir, format === "pdf" ? "upload.pdf" : "upload")
      yield* fs.writeFile(file, bytes).pipe(Effect.orDie)
      const text = format === "pdf" ? yield* readPdf(dir, file) : yield* ocr(file)
      if (!/\p{L}/u.test(text)) return yield* new ChartInvalid({ message: "No chords or lyrics were found in that file" })
      return text.trimEnd()
    }, Effect.scoped)

    return ChartReader.of({ read })
  })).pipe(Layer.provide(BunServices.layer))
}
