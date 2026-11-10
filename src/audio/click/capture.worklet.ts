/**
 * Runs on the audio thread. Sends the mic's first channel to the page in
 * blocks, each tagged with the context frame of its first sample, so the page
 * can time every sample on the AudioContext clock. A quantum with no input
 * (the mic not yet connected) is sent as silence, which keeps blocks contiguous.
 */

declare const currentFrame: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void

const BLOCK_FRAMES = 1024

class Capture extends AudioWorkletProcessor {
  private block = new Float32Array(BLOCK_FRAMES)
  private filled = 0
  private start = 0

  process(inputs: Array<Array<Float32Array>>, outputs: Array<Array<Float32Array>>): boolean {
    const quantum = outputs[0]?.[0]?.length ?? 128
    const channel = inputs[0]?.[0]
    if (this.filled === 0) this.start = currentFrame
    for (let i = 0; i < quantum; i++) {
      this.block[this.filled++] = channel?.[i] ?? 0
      if (this.filled === BLOCK_FRAMES) {
        this.port.postMessage({ start: this.start, samples: this.block }, [this.block.buffer])
        this.block = new Float32Array(BLOCK_FRAMES)
        this.filled = 0
        this.start = currentFrame + i + 1
      }
    }
    return true
  }
}

registerProcessor("capture", Capture)
