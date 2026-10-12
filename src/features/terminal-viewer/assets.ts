import { existsSync } from "node:fs"
import { join } from "node:path"

export function viewerAsset(name: "terminal.js" | "terminal.css"): Response {
  // First path is the published bundle; second supports source-level development.
  const candidates = [join(import.meta.dir, name), join(import.meta.dir, "../../../dist", name)]
  const path = candidates.find(existsSync)
  if (!path) return new Response("Viewer assets missing. Run bun run build:terminal.", { status: 503 })
  return new Response(Bun.file(path), { headers: { "Content-Type": name.endsWith(".js") ? "text/javascript" : "text/css" } })
}
