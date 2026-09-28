// Capability probing + caching. Synchronous, memoized, injectable for tests.

import { spawnSync } from "bun";
import { getPlatform, getWindowsBuildNumber, hasTarOnWindows } from "./platform";
import type { Capabilities } from "./types";

interface ProbeFn {
  which: (name: string) => string | null;
  spawnSync: (bin: string[], opts?: Record<string, unknown>) => { exitCode: number };
}

const defaultProbe: ProbeFn = {
  which: Bun.which.bind(Bun),
  spawnSync: (bin: string[], opts?: Record<string, unknown>) =>
    spawnSync(bin, opts as Record<string, unknown>),
};

let cache: Capabilities | null = null;

/** Default capabilities resolved from the live environment. */
export function getCapabilities(): Capabilities {
  if (cache) return cache;
  cache = resolve(defaultProbe);
  return cache;
}

/** Internal resolution with injectable probes. */
function resolve(probe: ProbeFn): Capabilities {
  const platform = getPlatform();
  const winBuild = platform === "win32" ? getWindowsBuildNumber() : null;

  // Tar availability.
  const hasTar =
    platform !== "win32" || hasTarOnWindows()
      ? probe.which("tar") != null
      : false;

  // PowerShell variants on Windows.
  let hasPwsh = false;
  let hasPowerShell = false;
  if (platform === "win32") {
    hasPwsh = probe.spawnSync(["where", "pwsh"]).exitCode === 0;
    hasPowerShell = probe.spawnSync(["where", "powershell"]).exitCode === 0;
  } else {
    hasPwsh = probe.which("pwsh") != null;
    hasPowerShell = probe.which("powershell") != null;
  }

  // Python candidate chain. On Windows, `python3` is often a Microsoft Store stub
  // that opens the Store instead of running Python, so prefer the `py` launcher.
  const pythonCandidates: NonNullable<Capabilities["python"]>[] =
    platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  const python = pythonCandidates.find((name) => probe.which(name) != null) ?? null;

  // Git path.
  const git = probe.which("git");

  return { winBuild, hasTar, hasPwsh, hasPowerShell, python, git };
}

/** Reset capability cache — for testing only. */
export function resetCapabilitiesForTesting(): void {
  cache = null;
}

/** Override the cached capabilities — for testing only. */
export function setCapabilitiesForTesting(caps: Capabilities): void {
  cache = caps;
}
