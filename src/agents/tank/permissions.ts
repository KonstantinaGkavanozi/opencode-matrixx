import type { PermissionValue } from "../../shared/permission-compat"

type PermissionRules = Record<string, PermissionValue | Record<string, PermissionValue>>

/**
 * OpenCode evaluates rules in insertion order and the LAST matching rule wins,
 * so every "allow" exception below comes before the "deny" rules that must beat it.
 * "*" matches any characters including "/", so "*.test.*" covers any directory depth.
 */

/** Tank may only write test files. Everything else, including source, is denied. */
const EDIT_RULES: Record<string, PermissionValue> = {
  "*": "deny",
  "*.test.*": "allow",
  "*.spec.*": "allow",
  "__tests__/*": "allow",
  "*/__tests__/*": "allow",
  "test/*": "allow",
  "*/test/*": "allow",
  "tests/*": "allow",
  "*/tests/*": "allow",
  // These must stay LAST: a test-looking path must never reach dependencies or manifests.
  "node_modules/*": "deny",
  "*/node_modules/*": "deny",
  "package.json": "deny",
  "*/package.json": "deny",
  "package-lock.json": "deny",
  "*/package-lock.json": "deny",
  "npm-shrinkwrap.json": "deny",
  "yarn.lock": "deny",
  "*/yarn.lock": "deny",
  "pnpm-lock.yaml": "deny",
  "*/pnpm-lock.yaml": "deny",
  "bun.lock": "deny",
  "*/bun.lock": "deny",
  "bun.lockb": "deny",
  "*/bun.lockb": "deny",
}

const deny = (patterns: string[]): Record<string, PermissionValue> =>
  Object.fromEntries(patterns.map((pattern) => [pattern, "deny" as const]))

const allow = (patterns: string[]): Record<string, PermissionValue> =>
  Object.fromEntries(patterns.map((pattern) => [pattern, "allow" as const]))

/**
 * Bash is open so build and test commands run, minus what would break the rules of the role:
 * vulnerability scanning, dependency changes, publishing, destructive git, and in-place source rewrites.
 * The frozen-lockfile installs are re-allowed AFTER the install denies because they never edit manifests.
 * `npm ci` is not denied at all. Bash redirection can still write files; the prompt covers that gap.
 */
const BASH_RULES: Record<string, PermissionValue> = {
  "*": "allow",
  // Not a scanner
  ...deny(["npm audit *", "yarn audit *", "yarn npm audit *", "pnpm audit *", "bun audit *"]),
  // Not a fixer: no dependency or manifest changes
  ...deny([
    "npm install *", "npm i *", "npm add *", "npm uninstall *", "npm remove *", "npm rm *",
    "npm update *", "npm upgrade *", "npm dedupe *", "npm prune *", "npm link *", "npm pkg *", "npm version *",
    "yarn add *", "yarn remove *", "yarn upgrade *", "yarn up *", "yarn install *",
    "pnpm add *", "pnpm remove *", "pnpm update *", "pnpm install *",
    "bun add *", "bun remove *", "bun update *", "bun install *",
  ]),
  ...allow(["yarn install --frozen-lockfile *", "yarn install --immutable *", "pnpm install --frozen-lockfile *", "bun install --frozen-lockfile *"]),
  // Never publish or leave the machine
  ...deny(["npm publish *", "yarn publish *", "pnpm publish *", "npm login *", "git push *"]),
  // Never disturb the caller's working tree (git stash push/pop stays allowed for baselines)
  ...deny([
    "git reset *", "git clean *", "git checkout *", "git restore *", "git switch *", "git rebase *",
    "git commit *", "git apply *", "git am *", "git stash drop *", "git stash clear *", "git branch -D *",
  ]),
  // Never rewrite source in place
  ...deny(["sed -i *", "perl -pi *", "patch *", "* --fix *", "* --write *"]),
}

export const TANK_PERMISSION: PermissionRules = {
  edit: EDIT_RULES,
  bash: BASH_RULES,
  // Tank validates; it does not delegate, ask questions (non-interactive pipeline), or scan.
  task: "deny",
  "task_*": "deny",
  teammate: "deny",
  question: "deny",
  "cyclopt_*": "deny",
  "cyclopt__*": "deny",
}
