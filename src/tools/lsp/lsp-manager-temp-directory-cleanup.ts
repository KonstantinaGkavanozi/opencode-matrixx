import { tmpdir } from "node:os"
import { resolve } from "node:path"

type ManagedClientForTempDirectoryCleanup = {
  refCount: number
  client: {
    stop: () => Promise<void>
  }
}

function isTempPath(key: string): boolean {
  const normalize = (p: string) => resolve(p).replaceAll("\\", "/").toLowerCase()
  const tempRoot = normalize(tmpdir())
  return normalize(key).startsWith(`${tempRoot}/`) || key.startsWith("/tmp/") || key.startsWith("/var/folders/")
}

export async function cleanupTempDirectoryLspClients(
  clients: Map<string, ManagedClientForTempDirectoryCleanup>
): Promise<void> {
  const keysToRemove: string[] = []
  for (const [key, managed] of clients.entries()) {
    const isTempDir = isTempPath(key)
    const isIdle = managed.refCount === 0
    if (isTempDir && isIdle) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    const managed = clients.get(key)
    if (managed) {
      clients.delete(key)
      try {
        await managed.client.stop()
      } catch {}
    }
  }
}
