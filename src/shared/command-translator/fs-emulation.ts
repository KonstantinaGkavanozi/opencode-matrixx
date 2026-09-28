// Cross-platform filesystem operation emulation.
// Replaces Unix subprocess commands (rm, cp, mv, mkdir) with Node fs calls.
// These work identically on Linux, macOS, and Windows — no subprocess needed.

import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Remove a file or directory recursively (emulates `rm -rf`).
 * Uses Node's built-in fs.rmSync which is cross-platform.
 */
export function rmRf(path: string): void {
  if (!existsSync(path)) return;
  const st = lstatSync(path);
  if (st.isDirectory()) {
    rmSync(path, { recursive: true, force: true });
  } else {
    unlinkSync(path);
  }
}

/**
 * Copy a file or directory recursively (emulates `cp -r`).
 * Handles both single files and directories.
 */
export function cpR(src: string, dest: string): void {
  if (!existsSync(src)) {
    throw new Error(`Source not found: ${src}`);
  }

  const srcStat = statSync(src);

  if (srcStat.isFile()) {
    // Ensure destination directory exists
    const destDir = dirname(dest);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    copyFileSync(src, dest);
    return;
  }

  if (srcStat.isDirectory()) {
    mkdirSync(dest, { recursive: true });

    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      cpR(srcPath, destPath);
    }
    return;
  }

  throw new Error(`Cannot copy: unsupported file type ${src}`);
}

/**
 * Move/rename a file (emulates `mv` for files).
 * Works for files and directories; falls back to copy+delete when crossing filesystems.
 */
export function mvFile(src: string, dest: string): void {
  if (!existsSync(src)) {
    throw new Error(`Source not found: ${src}`);
  }

  try {
    renameSync(src, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    // Cross-filesystem move: copy then delete.
    cpR(src, dest);
    rmRf(src);
  }
}

/**
 * Create directories recursively (emulates `mkdir -p`).
 * Uses Node's built-in mkdirSync with recursive option.
 */
export function mkdirp(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
