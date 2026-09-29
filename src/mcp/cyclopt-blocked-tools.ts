/**
 * Cyclopt MCP tools Matrixx never exposes to any agent. Cyclopt is report-only
 * here: fix_code rewrites files with an LLM and spends the user's fix credits,
 * so it and its companions are removed from the model's tool list entirely.
 * Both MCP naming forms are listed because the repo references both.
 */
const BLOCKED_TOOL_NAMES = ["fix_code", "check_fix_job", "check_fix_usage"]

export const CYCLOPT_BLOCKED_TOOLS: readonly string[] = BLOCKED_TOOL_NAMES.flatMap((name) => [
  `cyclopt_${name}`,
  `cyclopt__${name}`,
])
