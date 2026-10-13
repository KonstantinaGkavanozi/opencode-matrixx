import { describe, expect, test } from "bun:test"
import { findMissingWrappedTool } from "./unix-tool-guard"

const missing = () => null
const present = () => "/bin/tool"

describe("findMissingWrappedTool", () => {
  test("returns the tool when rtk wraps ls and ls is not on PATH", () => {
    //#given
    const rewritten = "rtk ls test"
    //#when
    const result = findMissingWrappedTool(rewritten, missing)
    //#then
    expect(result).toBe("ls")
  })

  test("finds the missing tool inside a chained command", () => {
    //#given
    const rewritten = "rtk git status; rtk ls tests 2>&1; rtk ls __tests__"
    const which = (name: string) => (name === "git" ? "/bin/git" : null)
    //#when
    const result = findMissingWrappedTool(rewritten, which)
    //#then
    expect(result).toBe("ls")
  })

  test("returns null when every wrapped Unix tool resolves", () => {
    //#given
    const rewritten = "rtk ls test; rtk grep foo src"
    //#when
    const result = findMissingWrappedTool(rewritten, present)
    //#then
    expect(result).toBeNull()
  })

  test("ignores rtk native subcommands that are not Unix tools", () => {
    //#given
    const rewritten = "rtk git status; rtk gain; rtk read file.ts"
    //#when
    const result = findMissingWrappedTool(rewritten, missing)
    //#then
    expect(result).toBeNull()
  })

  test("returns null for commands without rtk", () => {
    //#given
    const rewritten = "ls test"
    //#when
    const result = findMissingWrappedTool(rewritten, missing)
    //#then
    expect(result).toBeNull()
  })
})
