/**
 * `rtk <tool> ...` shells out to a real `<tool>` binary. Windows has no `ls`,
 * `grep`, etc. on PATH (PowerShell's `ls` is an alias), so such a rewrite fails
 * even though `rtk rewrite` reports success. Only these external-binary
 * wrappers are checked; rtk's native subcommands (gain, read, ...) are left alone.
 */
const WRAPPED_UNIX_TOOLS = new Set(["ls", "cat", "grep", "find", "head", "tail", "wc", "tree", "diff"])

const RTK_INVOCATION = /(?:^|[\s;&|(])rtk\s+([A-Za-z0-9_.-]+)/g

export function findMissingWrappedTool(
  rewritten: string,
  which: (name: string) => string | null,
): string | null {
  for (const match of rewritten.matchAll(RTK_INVOCATION)) {
    const tool = match[1]
    if (WRAPPED_UNIX_TOOLS.has(tool) && which(tool) === null) {
      return tool
    }
  }
  return null
}
