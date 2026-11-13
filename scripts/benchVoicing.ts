import { spell } from "alphatab-kit/charts/spelling"
import { voicings } from "../src/charts/voicing"

const roots = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
const suffixes = [
  "", "m", "7", "maj7", "m7", "m7b5", "dim7", "aug", "sus2", "sus4", "7sus4", "5", "6", "m6", "6/9", "9", "m9",
  "maj9", "11", "m11", "13", "m13", "13b9", "7#9", "7b9", "maj7#11", "add9", "madd9", "m7add11", "m(maj7)",
]
const names = roots.flatMap((root, index) => [
  ...suffixes.map((suffix) => root + suffix),
  `${root}/${roots[(index + 4) % 12]}`,
  `${root}/${roots[(index + 7) % 12]}`,
])

const elapsed = names.map((name) => {
  const chord = spell(name)!
  const start = performance.now()
  voicings(chord)
  return { name, milliseconds: performance.now() - start }
})
const slowest = elapsed.reduce((slow, current) => current.milliseconds > slow.milliseconds ? current : slow)
console.log(`slowest: ${slowest.name} (${slowest.milliseconds.toFixed(2)} ms)`)
if (slowest.milliseconds >= 50) {
  throw new Error(`voicing exceeded the 50 ms interactive budget: ${slowest.name} took ${slowest.milliseconds.toFixed(2)} ms`)
}
