import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { VIEWER_PAGE } from "../../../src/features/terminal-viewer/page"

const ROOT = join(import.meta.dir, "..", "..", "..")

describe("terminal viewer asset contract", () => {
  //#given the viewer page markup
  //#when it is inspected for how it references its bundled assets
  //#then the script is loaded as an ES module and the stylesheet is linked
  test("page loads the bundled viewer as a module", () => {
    expect(VIEWER_PAGE).toContain('<script type="module" src="/terminal.js">')
    expect(VIEWER_PAGE).not.toMatch(/<script(?![^>]*type="module")[^>]*src="\/terminal\.js"/)
    expect(VIEWER_PAGE).toContain('<link rel="stylesheet" href="/terminal.css">')
  })

  //#given the build:terminal script definition
  //#when it is checked for its output location and external flags
  //#then it emits into dist/ root and keeps xterm bundled for the browser
  test("build:terminal emits browser-resolvable assets into dist/", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    const buildTerminal = pkg.scripts["build:terminal"]
    expect(buildTerminal).toBeDefined()
    expect(buildTerminal).toContain("script/build-terminal-viewer.ts")

    const builder = readFileSync(join(ROOT, "script", "build-terminal-viewer.ts"), "utf8")
    expect(builder).not.toMatch(/["']--external["']/)
    expect(builder).not.toMatch(/external\s*:\s*\[/)
    expect(builder).toMatch(/outdir\s*:\s*OUT_DIR/)
    expect(builder).toMatch(/const OUT_DIR = "dist"/)
    expect(builder).toContain("terminal.css")
  })

  //#given the published flat bundle layout where import.meta.dir is dist/
  //#when the viewer resolves an asset name
  //#then it probes the dist root first so the published layout is served
  test("asset resolver probes the published bundle path first", () => {
    const assets = readFileSync(
      join(ROOT, "src", "features", "terminal-viewer", "assets.ts"),
      "utf8",
    )
    const order = assets.indexOf('join(import.meta.dir, name)')
    const devFallback = assets.indexOf('"../../../dist"')
    expect(order).toBeGreaterThan(-1)
    expect(devFallback).toBeGreaterThan(-1)
    expect(order).toBeLessThan(devFallback)
  })
})
