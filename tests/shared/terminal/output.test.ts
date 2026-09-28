import { describe, expect, it } from "bun:test"
import { TerminalOutput } from "../../../src/shared/terminal/output"

describe("terminal output", () => {
  it("bounds UTF-8 output and reports cursor gaps", async () => {
    //#given a small buffer
    const output = new TerminalOutput(8, 30, 5)
    //#when output exceeds its byte budget
    output.append("abcdefghλ🙂")
    await output.flush()
    //#then reads expose truncation and a monotonic byte cursor
    const read = output.read(0)
    expect(read.truncated).toBe(true)
    expect(Buffer.byteLength(read.data)).toBeLessThanOrEqual(8)
    expect(read.data).not.toContain("�")
    expect(read.cursor).toBe(Buffer.byteLength("abcdefghλ🙂"))
    expect(output.read(read.cursor).data).toBe("")
    output.dispose()
  })

  it("interprets cursor movement and erasure for screen snapshots", async () => {
    //#given an actual VT parser
    const output = new TerminalOutput(4096, 30, 5)
    //#when a TUI repaints a line
    output.append("old text\r\u001b[2Knew text")
    await output.flush()
    //#then snapshot represents the screen, not stripped escape sequences
    expect(output.snapshot().text).toContain("new text")
    expect(output.snapshot().text).not.toContain("old text")
    output.dispose()
  })
})
