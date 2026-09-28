// Static command-to-strategy registry. Maps Unix command names to per-platform resolution.

import { buildExtractArgv, parseUnzipArgs } from "../archive-extractor";
import { getCapabilities } from "./capabilities";
import { getPlatform } from "./platform";
import type { Capabilities, Platform, TranslatedCommand } from "./types";

type StrategyFn = (
  argv: string[],
  platform: Platform,
  caps: Capabilities,
) => TranslatedCommand | null;

interface RegistryEntry {
  strategy: "native" | "translated" | "emulated" | "unsupported";
  hint?: string;
  fn: StrategyFn;
}

/** Resolve a translated command for the given argv. Returns null if no entry matches. */
export function resolve(
  firstArg: string,
  fullArgv: string[],
  platform?: Platform,
  caps?: Capabilities,
): TranslatedCommand | null {
  const p = platform ?? getPlatform();
  const c = caps ?? getCapabilities();
  const entry = entries.get(firstArg);
  if (!entry) return null;
  return entry.fn(fullArgv, p, c) ?? null;
}

/** Registry metadata for a command, or null when the command is not registered. */
export function lookupEntry(name: string): { strategy: RegistryEntry["strategy"]; hint?: string } | null {
  const entry = entries.get(name);
  return entry ? { strategy: entry.strategy, hint: entry.hint } : null;
}

/* ------------------------------------------------------------------ */
/* Registry map                                                         */
/* ------------------------------------------------------------------ */

const entries = new Map<string, RegistryEntry>();

function reg(name: string, entry: RegistryEntry): void {
  entries.set(name, entry);
}

// --- unzip / zip extraction ----------------------------------------
// Extraction logic lives in archive-extractor.ts.
reg("unzip", {
  strategy: "translated",
  fn: (argv, p, c) => {
    const { archive, dest } = parseUnzipArgs(argv);
    const resolved = buildExtractArgv(archive, dest, p, c);
    return resolved
      ? { argv: resolved.argv, strategy: "translated", resolvedWith: resolved.resolvedWith }
      : null;
  },
});

// --- tar -----------------------------------------------------------
reg("tar", {
  strategy: "translated",
  hint: "On older Windows, install via winget install GNU.Tar or use WSL.",
  fn: (argv, p, c) => {
    if (p === "win32") {
      if (c.hasTar) {
        return { argv, strategy: "translated", resolvedWith: `tar${c.winBuild ? `(build ${c.winBuild})` : ""}` };
      }
      return null;
    }
    return { argv, strategy: "native", resolvedWith: "tar" };
  },
});

// --- chmod ---------------------------------------------------------
reg("chmod", {
  strategy: "emulated",
  hint: "Use emulateFileOp() instead of spawning chmod.",
  fn: (argv, p) => {
    if (p === "win32") {
      // No-op on Windows — files don't need execute bits.
      return { argv: [], strategy: "emulated", resolvedWith: "noop-win32" };
    }
    return { argv, strategy: "native", resolvedWith: "chmod" };
  },
});

// --- rm ------------------------------------------------------------
reg("rm", {
  strategy: "emulated",
  hint: "Use rmRf() or rmDir() from command-translator instead of spawning rm.",
  fn: (argv) => ({ argv, strategy: "emulated", resolvedWith: "fs-emulation" }),
});

// --- cp ------------------------------------------------------------
reg("cp", {
  strategy: "emulated",
  hint: "Use cpR() from command-translator instead of spawning cp.",
  fn: (argv) => ({ argv, strategy: "emulated", resolvedWith: "fs-emulation" }),
});

// --- mv ------------------------------------------------------------
reg("mv", {
  strategy: "emulated",
  hint: "Use mvFile() from command-translator instead of spawning mv.",
  fn: (argv) => ({ argv, strategy: "emulated", resolvedWith: "fs-emulation" }),
});

// --- mkdir ---------------------------------------------------------
reg("mkdir", {
  strategy: "emulated",
  hint: "Use mkdirp() from command-translator instead of spawning mkdir.",
  fn: (argv) => ({ argv, strategy: "emulated", resolvedWith: "fs-emulation" }),
});

// --- python3 -------------------------------------------------------
reg("python3", {
  strategy: "translated",
  hint: "Install Python via winget install Python.Python.3.11 or visit https://python.org.",
  fn: (argv, p, c) => {
    if (p === "win32") {
      if (!c.python) return null; // not found.
      return { argv: [c.python, ...argv.slice(1)], strategy: "translated", resolvedWith: c.python };
    }
    return { argv, strategy: "native", resolvedWith: "python3" };
  },
});

// --- git, curl, docker (native pass-through) ----------------------
for (const name of ["git", "curl", "docker", "opencode"]) {
  reg(name, {
    strategy: "native",
    fn: (argv) => ({ argv, strategy: "native", resolvedWith: name }),
  });
}

// --- tmux, screen, pty (unsupported on Windows) --------------------
const UNSUPPORTED_HINTS: Record<string, string> = {
  tmux: "Use the interactive-bash tool instead, which handles tmux gating automatically.",
  screen: "No Windows equivalent. Use background-task tools instead.",
  pty: "This command requires a Unix terminal multiplexer.",
};

for (const name of ["tmux", "screen", "pty"]) {
  reg(name, {
    strategy: "unsupported",
    hint: UNSUPPORTED_HINTS[name],
    fn: (argv, p) =>
      p === "win32" ? null : { argv, strategy: "native", resolvedWith: name },
  });
}
