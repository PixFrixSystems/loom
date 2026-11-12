/**
 * The last `max` characters of a stream of output (a server's log, a terminal's replay). Chunks
 * are kept as they arrive and joined only when a window asks for the whole text, instead of
 * copying up to half a megabyte of string on every chunk.
 */
export class OutputTail {
  private chunks: string[] = []
  private size = 0
  private readonly max: number

  constructor(max: number) {
    this.max = max
  }

  get length(): number {
    return this.size
  }

  push(text: string): void {
    if (!text) return
    this.chunks.push(text)
    this.size += text.length
    if (this.size <= this.max) return
    // Whole chunks fall off the front, then the first one left is cut to fit.
    while (this.size - this.chunks[0].length >= this.max) this.size -= this.chunks.shift()!.length
    const extra = this.size - this.max
    if (extra > 0) {
      this.chunks[0] = this.chunks[0].slice(extra)
      this.size = this.max
    }
  }

  endsWith(suffix: string): boolean {
    const last = this.chunks[this.chunks.length - 1] ?? ''
    return last.length >= suffix.length ? last.endsWith(suffix) : this.text().endsWith(suffix)
  }

  text(): string {
    // Joined once and kept that way, so reading it again costs nothing.
    if (this.chunks.length > 1) this.chunks = [this.chunks.join('')]
    return this.chunks[0] ?? ''
  }
}
