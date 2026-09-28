// Spawn executor for translated commands. Throws typed errors on failure.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { spawn } from "bun";
import { parseUnzipArgs } from "../archive-extractor";
import { getCapabilities, resetCapabilitiesForTesting } from "./capabilities";
import { cpR, mkdirp, mvFile, rmRf } from "./fs-emulation";
import { getPlatform } from "./platform";
import { lookupEntry, resolve } from "./registry";
import type { RunOptions } from "./types";
import { CommandFailedError, MissingBinaryError, UnsupportedCommandError } from "./types";

/**
 * Resolve and run a translated command. Uses Bun.spawn (argv array, never shell strings).
 * On Linux/macOS: zero-cost pass-through — same commands, same behavior.
 * On Windows: selects platform-appropriate strategy from the registry.
 */
export async function runTranslated(
  argv: string[],
  options?: RunOptions & { cwd?: string },
): Promise<void> {
  const p = options?.platform ?? getPlatform();
  const c = options?.capabilities ?? getCapabilities();
  const resolved = resolve(argv[0], argv, p, c);

  if (!resolved) {
    const entry = lookupEntry(argv[0]);
    if (!entry) {
      // Not in registry — pass through (native command).
      return run(argv, options);
    }
    if (entry.strategy === "unsupported") {
      throw new UnsupportedCommandError(argv[0], p, entry.hint ?? "");
    }
    // Registered, but no strategy is available on this machine (e.g. no tar/python).
    throw new MissingBinaryError(argv[0], entry.hint ?? "No compatible tool found on this platform.");
  }

  // Emulated — no spawn needed.
  if (resolved.strategy === "emulated") {
    return emulate(argv[0], argv.slice(1));
  }

  // Unix `unzip -d` creates the destination; tar/Expand-Archive targets may not.
  if (argv[0] === "unzip") {
    mkdirSync(parseUnzipArgs(argv).dest, { recursive: true });
  }

  await run(resolved.argv, options);
}

/** Run an argv array via Bun.spawn. Throws CommandFailedError on non-zero exit. */
async function run(argv: string[], options?: { cwd?: string }): Promise<void> {
  const proc = spawn(argv, {
    cwd: options?.cwd,
    stdout: "ignore",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
    throw new CommandFailedError(argv, exitCode, stderr);
  }
}

/** Like cp/mv: when dest is an existing directory, the source lands inside it. */
function resolveTarget(src: string, dest: string): string {
  return existsSync(dest) && statSync(dest).isDirectory() ? join(dest, basename(src)) : dest;
}

/** Emulated operations — Node fs instead of subprocess. */
export function emulate(cmd: string, argv: string[]): void {
  switch (cmd) {
    case "chmod":
      // chmod on win32 is a no-op — do nothing.
      break;
    case "rm": {
      const paths = argv.filter((a) => !a.startsWith("-"));
      if (paths.length === 0) return;
      for (const p of paths) {
        rmRf(p);
      }
      break;
    }
    case "cp": {
      const paths = argv.filter((a) => !a.startsWith("-"));
      if (paths.length < 2) return;
      const dest = paths[paths.length - 1];
      for (const src of paths.slice(0, -1)) {
        cpR(src, resolveTarget(src, dest));
      }
      break;
    }
    case "mv": {
      const paths = argv.filter((a) => !a.startsWith("-"));
      if (paths.length < 2) return;
      const dest = paths[paths.length - 1];
      for (const src of paths.slice(0, -1)) {
        mvFile(src, resolveTarget(src, dest));
      }
      break;
    }
    case "mkdir": {
      const dirs = argv.filter((a) => !a.startsWith("-"));
      for (const d of dirs) {
        mkdirp(d);
      }
      break;
    }
    default:
      // Unknown emulated command — silently ignore (safety fallback).
      break;
  }
}

/** Reset capability cache — for testing only (re-exports capabilities.ts). */
export { resetCapabilitiesForTesting };
