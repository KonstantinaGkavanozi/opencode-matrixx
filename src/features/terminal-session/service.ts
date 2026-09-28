import { isAbsolute, resolve } from "node:path"
import { type TerminalConfig, TerminalConfigSchema } from "../../config/schema/terminal"
import type { TerminalLaunchOptions } from "../../shared/terminal/types"
import { ManagedTerminal } from "./session"

export class TerminalService {
  readonly config: TerminalConfig
  private readonly sessions = new Map<string, ManagedTerminal>()
  private disposed = false
  private readonly timer: ReturnType<typeof setInterval>
  private readonly exitHandler = () => { for (const session of this.sessions.values()) session.closeSync() }
  constructor(readonly directory: string, config: Partial<TerminalConfig> = {}) {
    this.config = TerminalConfigSchema.parse(config)
    this.timer = setInterval(() => {
      for (const session of this.sessions.values()) {
        if (Date.now() - session.lastUsed > this.config.idle_timeout_ms) {
          void this.close(session.info.owner, session.info.id).catch(() => { session.info.state = "failed" })
        }
      }
    }, Math.min(this.config.idle_timeout_ms, 30000))
    this.timer.unref()
    process.on("exit", this.exitHandler)
  }
  async create(owner: string, options: TerminalLaunchOptions) {
    if (this.disposed || !this.config.enabled) throw new Error("Terminal support is disabled")
    const backend = process.platform === "win32" ? "conpty" : "pty"
    if (this.config.backend !== "auto" && this.config.backend !== backend) throw new Error(`Backend ${this.config.backend} is unavailable on ${process.platform}`)
    if (!options.executable || options.executable.includes("\0")) throw new Error("Invalid executable")
    const cwd = options.cwd ?? this.directory
    if (!isAbsolute(cwd)) throw new Error("Terminal cwd must be absolute")
    this.dimensions(options.cols ?? 80, options.rows ?? 24)
    // Retain exited records for reads until capacity is needed.
    if (this.sessions.size >= this.config.max_sessions) {
      for (const [id, old] of this.sessions) {
        if (old.info.state === "exited") { old.proc.terminal?.close(); old.output.dispose(); this.sessions.delete(id); break }
      }
    }
    if (this.sessions.size >= this.config.max_sessions) throw new Error("Terminal session limit reached")
    const session = new ManagedTerminal(owner, { ...options, cwd: resolve(cwd) }, this.config.output_buffer_bytes)
    this.sessions.set(session.info.id, session)
    return { ...session.info }
  }
  private get(owner: string, id: string): ManagedTerminal {
    const session = this.sessions.get(id)
    if (!session || session.info.owner !== owner) throw new Error("Terminal is not owned by this session")
    return session
  }
  info(owner: string, id: string) { return { ...this.get(owner, id).info } }
  list(owner: string) { return [...this.sessions.values()].filter(s => s.info.owner === owner).map(s => ({ ...s.info })) }
  write(owner: string, id: string, data: string): void {
    if (Buffer.byteLength(data) > 65536) throw new Error("Terminal input exceeds 64 KiB")
    const session = this.get(owner, id)
    if (session.info.state !== "running") throw new Error("Terminal is not running")
    session.lastUsed = Date.now()
    session.proc.terminal?.write(data)
  }
  resize(owner: string, id: string, cols: number, rows: number): void {
    this.dimensions(cols, rows)
    const session = this.get(owner, id)
    if (session.info.state !== "running") throw new Error("Terminal is not running")
    session.proc.terminal?.resize(cols, rows)
    session.output.resize(cols, rows)
    Object.assign(session.info, { cols, rows })
  }
  private dimensions(cols: number, rows: number): void {
    if (![cols, rows].every(Number.isInteger) || cols < 2 || cols > 300 || rows < 2 || rows > 150) throw new Error("Invalid terminal dimensions (2..300 columns, 2..150 rows)")
  }
  read(owner: string, id: string, cursor = 0) { return { ...this.get(owner, id).output.read(cursor), ...this.info(owner, id) } }
  async snapshot(owner: string, id: string) {
    const session = this.get(owner, id)
    await session.output.flush()
    return { ...session.output.snapshot(), ...session.output.read(session.output.read().cursor), ...session.info }
  }
  interrupt(owner: string, id: string): void { this.write(owner, id, "\x03") }
  async close(owner: string, id: string): Promise<void> { await this.get(owner, id).close() }
  async closeOwner(owner: string): Promise<void> { await Promise.all(this.list(owner).map(s => this.close(owner, s.id))) }
  waitFor(owner: string, id: string, text: string, timeout: number) {
    const session = this.get(owner, id)
    return session.wait(() => session.output.read().data.includes(text), timeout).catch(() => {
      throw new Error(`Terminal did not produce ${JSON.stringify(text)}: ${JSON.stringify(session.output.read().data)}`)
    })
  }
  waitForExit(owner: string, id: string, timeout: number) {
    const session = this.get(owner, id)
    return session.wait(() => session.info.exitCode !== null, timeout)
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.timer)
    process.off("exit", this.exitHandler)
    await Promise.all([...this.sessions.values()].map(async s => { await s.close(); s.output.dispose() }))
    this.sessions.clear()
  }
}
