/**
 * Where alphaTab finds its own files, served by `scripts/alphaTabAssetsPlugin`.
 * The render worker and the synthesizer worker load the script by URL with
 * importScripts, so it must be the UMD build at an absolute URL.
 */
export function alphaTabAssets() {
  return {
    scriptFile: `${location.origin}/alphatab/alphaTab.js`,
    fontDirectory: `${location.origin}/alphatab/font/`,
    soundFont: `${location.origin}/alphatab/soundfont/sonivox.sf2`,
  }
}
