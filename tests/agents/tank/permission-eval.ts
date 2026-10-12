/**
 * Test-only evaluator mirroring OpenCode's permission semantics
 * (packages/opencode/src/permission/index.ts + core/util/wildcard.ts):
 *  - a string value is a rule with pattern "*"; an object value is one rule per pattern
 *  - rules are evaluated in insertion order and the LAST matching rule wins
 *  - "*" in a pattern matches any characters including "/"; a trailing " *" also matches the bare command
 *  - input has "\" normalised to "/"
 * A tool is hidden from the model when its last matching rule is pattern "*" with action deny.
 */
export type PermissionInput = Record<string, string | Record<string, string>>

type Rule = { permission: string; pattern: string; action: string }

export function wildcardMatch(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = `${escaped.slice(0, -3)}( .*)?`
  return new RegExp(`^${escaped}$`, "si").test(normalized)
}

function toRules(permission: PermissionInput): Rule[] {
  const rules: Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") rules.push({ permission: key, pattern: "*", action: value })
    else for (const [pattern, action] of Object.entries(value)) rules.push({ permission: key, pattern, action })
  }
  return rules
}

/** Action for `tool` acting on `target` (a path for edit, a command for bash). Defaults to allow. */
export function evaluate(permission: PermissionInput, tool: string, target = "*"): string {
  const rules = toRules(permission)
  const hit = rules.findLast((r) => wildcardMatch(tool, r.permission) && wildcardMatch(target, r.pattern))
  return hit?.action ?? "allow"
}

/** Whether OpenCode would remove the tool from the model's tool list entirely. */
export function isHidden(permission: PermissionInput, tool: string): boolean {
  const hit = toRules(permission).findLast((r) => wildcardMatch(tool, r.permission))
  return hit?.pattern === "*" && hit.action === "deny"
}
