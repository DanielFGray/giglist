import type { NumeralDisplay } from "gigbag.js/charts/numeral"
import type { ChordDiagrams } from "./ChordShapes"
import { flag, oneOf } from "./stored-setting"

// How a lyrics chart reads. The song page and the stage share these, so a
// choice made on one shows on the other.

export const CHORD_DIAGRAMS = oneOf<ChordDiagrams>("setlist:chord-diagrams", ["guitar", "staff", "piano", "off"], "guitar")

export const SHOW_CHORDS_ABOVE = flag("setlist:show-chords-above", false)

export const NUMERAL_DISPLAY = oneOf<NumeralDisplay>("setlist:numeral-display", ["names", "numerals", "both"], "both")
