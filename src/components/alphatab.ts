import { model, type Settings } from "@coderline/alphatab"

/** Draws in `css`, the text color around the phrase, with staff lines and bar lines fainter. */
export function inkFrom(settings: Settings, css: string) {
  const [r, g, b] = rgbOf(css)
  const ink = new model.Color(r, g, b)
  const faint = new model.Color(r, g, b, 110)
  const resources = settings.display.resources
  resources.mainGlyphColor = ink
  resources.scoreInfoColor = ink
  resources.secondaryGlyphColor = faint
  resources.barNumberColor = faint
  resources.staffLineColor = faint
  resources.barSeparatorColor = faint
}

/**
 * A CSS color as red, green and blue. The app's colors compute to `oklch()`,
 * which alphaTab cannot read, so the color is drawn and its pixel read back.
 */
function rgbOf(css: string): readonly [number, number, number] {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!context) return [0, 0, 0]
  context.fillStyle = css
  context.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}
