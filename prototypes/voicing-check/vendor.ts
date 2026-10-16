/**
 * The two reference libraries are loaded by absolute path, so the scripts read
 * the exact copies the project has. Neither ships type declarations at the file,
 * so the specifier is held in a variable and the result is given the shape these
 * scripts use.
 */

/** The alphaTab pieces this check needs: the score loader and its settings. */
export type AlphaTab = {
  importer: {
    ScoreLoader: {
      loadScoreFromBytes(data: Uint8Array, settings?: unknown): {
        title: string
        tracks: Array<{
          staves: Array<{
            tuning: number[]
            capo: number
            chords: Map<string, Chord> | null
          }>
        }>
      }
    }
  }
  Settings: new () => unknown
}

/** One chord diagram, as alphaTab holds it: frets highest string first, -1 muted. */
export type Chord = {
  name: string
  firstFret: number
  strings: number[]
  barreFrets: number[]
}

const ALPHATAB = "/home/dan/build/setlist/node_modules/@coderline/alphatab/dist/alphaTab.mjs"
const CHORDSHEETJS = "/home/dan/build/setlist/node_modules/chordsheetjs/lib/module.js"

export const alphaTab = (await import(ALPHATAB)) as unknown as AlphaTab
export const { ChordProParser } = (await import(CHORDSHEETJS)) as unknown as {
  ChordProParser: new () => { parse(input: string): unknown }
}