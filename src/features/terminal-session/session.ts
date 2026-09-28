import { killTerminalTree, type NativeTerminalProcess, spawnTerminal } from "../../shared/terminal/native"
import { TerminalOutput } from "../../shared/terminal/output"
import type { TerminalInfo, TerminalLaunchOptions } from "../../shared/terminal/types"

export class ManagedTerminal {
  readonly output: TerminalOutput
  readonly proc: NativeTerminalProcess
  readonly info: TerminalInfo
  lastUsed = Date.now()
  private readonly listeners = new Set<() => void>()
  constructor(owner: string, options: TerminalLaunchOptions, bufferBytes: number) {
    this.output = new TerminalOutput(bufferBytes, options.cols ?? 80, options.rows ?? 24)
    try {
      this.proc = spawnTerminal(options, (text) => {
        this.output.append(text)
        this.lastUsed = Date.now()
        this.notify()
        if (this.output.overloaded) { killTerminalTree(this.proc); this.info.state = "failed" }
      })
    } catch (error) { this.output.dispose(); throw error }
    this.info = {
      id: crypto.randomUUID(), owner, title: options.title ?? options.executable,
      cwd: options.cwd ?? process.cwd(), backend: process.platform === "win32" ? "conpty" : "pty",
      state: "running", pid: this.proc.pid, exitCode: null,
      cols: options.cols ?? 80, rows: options.rows ?? 24,
    }
    void this.proc.exited.then(async (code) => {
      await this.output.flush()
      this.info.exitCode = code
      if (this.info.state !== "failed") this.info.state = "exited"
      this.notify()
    })
  }
  private notify(): void { for (const listener of this.listeners) listener() }
  wait(predicate: () => boolean, timeout: number): Promise<void> {
    if (predicate()) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const done = () => { if (predicate()) { clearTimeout(timer); this.listeners.delete(done); resolve() } }
      const timer = setTimeout(() => { this.listeners.delete(done); reject(new Error("Terminal wait timed out")) }, timeout)
      this.listeners.add(done)
      done()
    })
  }
  closeSync(): void {
    killTerminalTree(this.proc)
    this.proc.terminal?.close()
  }
  async close(): Promise<void> {
    if (this.info.state === "running") this.info.state = "closing"
    this.closeSync()
    await this.proc.exited
    await this.output.flush()
  }
}
