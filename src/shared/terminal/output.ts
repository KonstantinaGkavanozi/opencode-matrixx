import headless from "@xterm/headless"

/** Byte cursors are independent of the bounded VT screen and scrollback. */
export class TerminalOutput {
  private bytes = Buffer.alloc(0)
  private end = 0
  private readonly screen: headless.Terminal
  private pending: Promise<void> = Promise.resolve()
  private queuedBytes = 0
  constructor(private readonly limit: number, cols: number, rows: number) {
    this.screen = new headless.Terminal({ cols, rows, scrollback: 200, allowProposedApi: true })
  }
  append(data: string): void {
    const chunk = Buffer.from(data)
    this.end += chunk.length
    this.bytes = Buffer.concat([this.bytes, chunk])
    if (this.bytes.length > this.limit) {
      let start = this.bytes.length - this.limit
      while (start < this.bytes.length && (this.bytes[start] & 0xc0) === 0x80) start++
      this.bytes = Buffer.from(this.bytes.subarray(start))
    }
    this.queuedBytes += chunk.length
    // Flow control belongs to the session: do not silently corrupt VT state by dropping parser input.
    this.pending = new Promise<void>((resolve) => this.screen.write(data, () => {
      this.queuedBytes -= chunk.length
      resolve()
    }))
  }
  get overloaded(): boolean { return this.queuedBytes > 4 * 1024 * 1024 }
  read(cursor = 0): { data: string; cursor: number; truncated: boolean } {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.end) throw new Error("Invalid output cursor")
    const start = this.end - this.bytes.length
    let offset = Math.max(0, cursor - start)
    while (offset < this.bytes.length && (this.bytes[offset] & 0xc0) === 0x80) offset++
    return { data: this.bytes.subarray(offset).toString(), cursor: this.end, truncated: cursor < start }
  }
  flush(): Promise<void> { return this.pending }
  resize(cols: number, rows: number): void { this.screen.resize(cols, rows) }
  snapshot(): { text: string; cursorX: number; cursorY: number; cols: number; rows: number } {
    const buffer = this.screen.buffer.active
    const lines = Array.from({ length: this.screen.rows }, (_, i) => buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? "")
    return { text: lines.join("\r\n"), cursorX: buffer.cursorX, cursorY: buffer.cursorY, cols: this.screen.cols, rows: this.screen.rows }
  }
  dispose(): void { this.screen.dispose() }
}
