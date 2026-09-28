// Platform and strategy types for cross-platform command translation.

/** Detected operating system platform. */
export type Platform = "win32" | "darwin" | "linux";

/** Shell kind, matching shell-env.ts conventions. */
export type ShellKind = "unix" | "powershell" | "cmd";

/** How a translated command is resolved. */
export type StrategyKind =
  /** Same binary+flags everywhere (git, curl). */
  | "native"
  /** Different argv per platform (rm → Remove-Item, unzip → Expand-Archive). */
  | "translated"
  /** Node/Bun API instead of subprocess (chmod → no-op, rm/cp/mv → fs.*). */
  | "emulated"
  /** Fail fast with actionable message (tmux, screen). */
  | "unsupported";

/** A fully-resolved command ready for execution. */
export interface TranslatedCommand {
  /** argv array — never shell strings. */
  argv: string[];
  /** How this was resolved. */
  strategy: StrategyKind;
  /** Human-readable resolver, e.g. "tar(build 22631)", "pwsh", "fs-emulation". */
  resolvedWith: string;
}

/** Capabilities discovered via probing + caching. */
export interface Capabilities {
  winBuild: number | null;
  hasTar: boolean;
  hasPwsh: boolean;
  hasPowerShell: boolean;
  /** Resolved python candidate, or null if none found. */
  python: "python3" | "py" | "python" | null;
  /** Resolved git path (via Bun.which), or null. */
  git: string | null;
}

/** Options injected into runTranslated for testing. */
export interface RunOptions {
  platform?: Platform;
  capabilities?: Capabilities;
}

/** Error thrown when a command is not supported on the current platform. */
export class UnsupportedCommandError extends Error {
  override name = "UnsupportedCommandError";
  constructor(
    public readonly command: string,
    public readonly platform: Platform,
    hint: string,
  ) {
    super(`Command not supported on ${platform}: ${command}. ${hint}`);
  }
}

/** Error thrown when a required binary is missing from PATH. */
export class MissingBinaryError extends Error {
  override name = "MissingBinaryError";
  constructor(
    public readonly binary: string,
    installHint: string,
  ) {
    super(`Required binary not found: ${binary}. ${installHint}`);
  }
}

/** Error thrown when all translation fallbacks fail. */
export class TranslationFailedError extends Error {
  override name = "TranslationFailedError";
  constructor(
    public readonly command: string,
    public readonly attempts: ReadonlyArray<string>,
  ) {
    const chain = attempts.map((a) => `  - ${a}`).join("\n");
    super(`All translation attempts failed for "${command}":\n${chain}`);
  }
}

/** Error thrown after a spawned process exits non-zero. */
export class CommandFailedError extends Error {
  override name = "CommandFailedError";
  constructor(
    public readonly argv: string[],
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`Command failed (exit ${exitCode}): ${argv.join(" ")}`);
  }
}
