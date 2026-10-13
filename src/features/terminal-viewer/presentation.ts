import { log } from "../../shared/logger"
import type { TerminalService } from "../terminal-session/service"
import { TerminalViewer } from "./server"

type AgentSession = { id: string; parentID?: string; title?: string }

/** Presentation never participates in agent admission or completion. */
export class TerminalPresentation {
  private readonly viewer: TerminalViewer
  private readonly known = new Map<string, AgentSession>()
  private readonly watching = new Set<string>()
  private readonly attached = new Map<string, { owner: string; terminal: string }>()
  private readonly pending = new Set<string>()
  constructor(private readonly terminals: TerminalService, private readonly serverUrl: string) {
    this.viewer = new TerminalViewer(terminals)
  }
  async open(owner: string): Promise<string> {
    const link = this.viewer.open(owner)
    this.watching.add(owner)
    // Show main and child sessions without requiring a new task to start.
    this.known.set(owner, this.known.get(owner) ?? { id: owner, title: "Main session" })
    for (const info of this.known.values()) await this.attach(owner, info)
    return link
  }
  async created(info: AgentSession): Promise<void> {
    this.known.set(info.id, info)
    for (const owner of this.watching) await this.attach(owner, info)
  }
  private belongs(owner: string, info: AgentSession): boolean {
    const seen = new Set<string>()
    let current: AgentSession | undefined = info
    while (current && !seen.has(current.id)) {
      if (current.id === owner) return true
      seen.add(current.id)
      current = current.parentID ? this.known.get(current.parentID) : undefined
    }
    return false
  }
  private async attach(owner: string, info: AgentSession): Promise<void> {
    const key = `${owner}:${info.id}`
    if (!this.belongs(owner, info) || this.attached.has(key) || this.pending.has(key)) return
    this.pending.add(key)
    try {
      const executable = Bun.which("opencode.exe") ?? Bun.which("opencode")
      if (!executable || /\.(cmd|bat|ps1)$/i.test(executable)) throw new Error("Viewer attachments need the native opencode executable in PATH")
      const session = await this.terminals.create(owner, {
        executable, args: ["attach", this.serverUrl, "--session", info.id],
        title: info.title ?? info.id, cols: 100, rows: 28,
      })
      this.attached.set(key, { owner, terminal: session.id })
    } catch (error) { log("[terminal-viewer] Attachment unavailable", { session: info.id, error: String(error) }) }
    finally { this.pending.delete(key) }
  }
  async deleted(id: string): Promise<void> {
    this.known.delete(id)
    this.watching.delete(id)
    this.viewer.revoke(id)
    await this.terminals.closeOwner(id)
    for (const [key, attachment] of this.attached) {
      if (key.endsWith(`:${id}`) || attachment.owner === id) {
        await this.terminals.close(attachment.owner, attachment.terminal).catch(error => log("[terminal-viewer] Close failed", { error: String(error) }))
        this.attached.delete(key)
      }
    }
  }
  dispose(): void { this.viewer.dispose(); this.watching.clear(); this.known.clear(); this.attached.clear() }
}
