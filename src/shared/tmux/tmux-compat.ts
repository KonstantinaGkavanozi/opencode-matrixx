import type { Platform } from "../command-translator/types"

/**
 * Explain why tmux-backed features are unavailable, or return null when tmux can be used.
 * tmux has no native Windows build, so features that need it degrade to a clear message
 * instead of failing with a raw spawn error.
 */
export function getTmuxUnavailableMessage(platform: Platform, tmuxFound: boolean): string | null {
  if (tmuxFound) return null

  if (platform === "win32") {
    return (
      "Error: tmux is not available on native Windows, so interactive_bash cannot run. " +
      "Use the bash tool for one-shot commands and background tasks for long-running processes, " +
      "or run OpenCode inside WSL to use tmux."
    )
  }

  return "Error: tmux was not found in PATH. Install tmux to use interactive_bash."
}
