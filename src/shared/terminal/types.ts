export type TerminalState = "running" | "exited" | "failed" | "closing"
export interface TerminalLaunchOptions {
  executable: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
  title?: string
}
export interface TerminalInfo {
  id: string
  title: string
  owner: string
  cwd: string
  backend: "conpty" | "pty"
  state: TerminalState
  pid: number
  exitCode: number | null
  cols: number
  rows: number
}
