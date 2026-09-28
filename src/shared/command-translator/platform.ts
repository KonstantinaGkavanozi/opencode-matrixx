// Platform detection extracted from zip-extractor.ts logic.

import { existsSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import type { Platform } from "./types";

const WINDOWS_BUILD_WITH_TAR = 17134;

/** Current platform, normalized to our Platform type. */
export function getPlatform(): Platform {
  return process.platform as Platform;
}

/**
 * Windows build number, or null on non-Windows or if parsing fails.
 * Extracted from `os.release()` by splitting on "." and reading the third segment.
 */
export function getWindowsBuildNumber(): number | null {
  if (process.platform !== "win32") return null;

  const parts = release().split(".");
  if (parts.length >= 3) {
    const build = parseInt(parts[2], 10);
    if (!Number.isNaN(build)) return build;
  }
  return null;
}

/** Whether tar is available on this Windows build (≥ 17134 / RS4). */
export function hasTarOnWindows(): boolean {
  const build = getWindowsBuildNumber();
  return build !== null && build >= WINDOWS_BUILD_WITH_TAR;
}

/**
 * Windows' bundled bsdtar (System32\tar.exe), or null when absent.
 * A bare `tar` on PATH may resolve to Git for Windows' GNU tar first, which cannot read zip files.
 */
export function getWindowsSystemTar(): string | null {
  const root = process.env.SystemRoot ?? process.env.windir;
  if (!root) return null;
  const path = join(root, "System32", "tar.exe");
  return existsSync(path) ? path : null;
}
