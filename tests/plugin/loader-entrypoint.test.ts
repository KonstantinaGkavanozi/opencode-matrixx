import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  files: string[]
  exports: Record<string, { import?: string }>
}

describe("OpenCode v2 loader entrypoints", () => {
  test("file:// directory loading resolves a root-level server entry", () => {
    //#given a plugin directory target (no package name)
    //#when the host resolves <dir>/server
    const shim = join(root, "server.js")

    //#then a root server.js re-exporting the built default must exist and ship
    expect(existsSync(shim)).toBe(true)
    expect(readFileSync(shim, "utf8")).toContain('export { default } from "./dist/index.js"')
    expect(pkg.files).toContain("server.js")
  })

  test("named npm installs resolve the ./server export to the v2 plugin build", () => {
    //#given the package exports map
    //#when the host resolves "opencode-matrixx/server"
    const entry = pkg.exports["./server"]?.import

    //#then it points at the same built entry as "."
    expect(entry).toBe("./dist/index.js")
    expect(pkg.exports["."]?.import).toBe(entry)
  })
})
