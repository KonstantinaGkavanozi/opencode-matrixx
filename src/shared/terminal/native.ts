import { join } from "node:path"
import type { TerminalLaunchOptions } from "./types"

export function nativeTerminalAvailable(): boolean {
  return typeof Bun !== "undefined" && typeof Bun.Terminal === "function" && Bun.semver.satisfies(Bun.version, ">=1.4.0")
}

export function spawnTerminal(options: TerminalLaunchOptions, onData: (text: string) => void) {
  if (!nativeTerminalAvailable()) throw new Error("Native terminals require Bun 1.4.0 or later. Use WSL/tmux as a fallback.")
  const decoder = new TextDecoder()
  return Bun.spawn([options.executable, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: { ...process.env, TERM: "xterm-256color", ...options.env },
    windowsHide: true,
    terminal: {
      cols: options.cols ?? 80, rows: options.rows ?? 24,
      data(_terminal, bytes) { onData(decoder.decode(bytes, { stream: true })) },
    },
  })
}

export type NativeTerminalProcess = ReturnType<typeof spawnTerminal>

/** Only callers holding a process they created may invoke this function. */
export function killTerminalTree(proc: NativeTerminalProcess): void {
  if (proc.exitCode !== null) return
  if (process.platform === "win32") {
    const result = Bun.spawnSync([join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), "/PID", String(proc.pid), "/T", "/F"], {
      stdout: "ignore", stderr: "ignore", windowsHide: true, timeout: 5000,
    })
    if (result.exitCode !== 0 && proc.exitCode === null) proc.kill()
  } else {
    // A PTY child is a session leader; terminate its owned process group.
    try { process.kill(-proc.pid, "SIGKILL") } catch { proc.kill() }
  }
}
