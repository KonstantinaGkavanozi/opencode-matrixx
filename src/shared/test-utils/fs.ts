// Filesystem helpers for cross-platform tests. Test-only.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Create a unique temp directory under the OS temp dir (os.tmpdir(), not a hardcoded /tmp). */
export function createTempDir(prefix = "matrixx-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Create a file with the given content inside dir and return its path. */
export function createTempFile(dir: string, name = "file.txt", content = "test"): string {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

export function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
