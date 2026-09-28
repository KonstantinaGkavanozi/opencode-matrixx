import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseJsoncSafe } from "../../../shared/jsonc-parser"
import { getOpenCodeConfigDir } from "../../../shared/opencode-config-dir"
import { nativeTerminalAvailable } from "../../../shared/terminal/native"
import type { CheckResult, DoctorCheck } from "../types"

function loadTerminalConfig(): Record<string, unknown> | null {
  const userDir = getOpenCodeConfigDir({ binary: "opencode" })
  const bases = [join(userDir, "matrixx"), join(process.cwd(), ".opencode", "matrixx"), join(process.cwd(), "matrixx")]
  for (const base of bases) {
    for (const ext of [".jsonc", ".json"]) {
      const p = `${base}${ext}`
      if (!existsSync(p)) continue
      try {
        const c = readFileSync(p, "utf-8")
        const parsed = parseJsoncSafe<Record<string, unknown>>(c)
        if (!parsed.data || parsed.errors.length > 0) continue
        const terminal = parsed.data.terminal as Record<string, unknown> | undefined
        if (terminal) return terminal
      } catch {}
    }
  }
  return null
}

export const terminalCheck: DoctorCheck = {
  name: "terminal-backend",
  category: "integrations",
  check: (): CheckResult => {
    const cfg = loadTerminalConfig()
    const enabled = cfg?.enabled === true

    if (!enabled) {
      return {
        name: "terminal-backend",
        status: "pass",
        message: "terminal disabled — skipping",
        detail: "Set terminal.enabled:true in matrixx.jsonc to enable",
      }
    }

    const backend = (cfg?.backend as string) ?? "auto"
    const hasNative = nativeTerminalAvailable()

    if (!hasNative) {
      return {
        name: "terminal-backend",
        status: "warn",
        message: `terminal enabled (backend: ${backend}) but Bun < 1.4.0 — native terminal unavailable`,
        detail: "Upgrade to Bun >= 1.4.0 or use WSL/tmux as a fallback",
      }
    }

    const shell = process.platform === "win32"
      ? Bun.which("pwsh") ?? Bun.which("powershell")
      : Bun.which("bash") ?? Bun.which("sh")

    if (!shell) {
      return {
        name: "terminal-backend",
        status: "warn",
        message: `terminal enabled (backend: ${backend}) but no interactive shell found`,
        detail: process.platform === "win32"
          ? "Install PowerShell Core: winget install Microsoft.PowerShell"
          : "Install bash or sh",
      }
    }

    return {
      name: "terminal-backend",
      status: "pass",
      message: `terminal enabled (backend: ${backend}), Bun >= 1.4.0, shell: ${shell}`,
    }
  },
}
