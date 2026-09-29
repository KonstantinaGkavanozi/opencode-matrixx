import { describe, expect, test } from "bun:test"
import type { MatrixxConfig } from "../src/config"
import { mergeConfigs, stripProjectCredentials } from "../src/plugin-config"

describe("stripProjectCredentials", () => {
  test("removes a Cyclopt token from a project config but keeps its other cyclopt settings", () => {
    //#given a project file (often committed) carrying a token
    const project = { cyclopt: { api_token: "leak-me", max_batch_files: 10 } } as unknown as MatrixxConfig
    //#when
    const stripped = stripProjectCredentials(project, "/repo/.opencode/matrixx.jsonc")
    //#then
    expect(stripped.cyclopt).toEqual({ max_batch_files: 10 } as never)
  })

  test("leaves configs without a token untouched", () => {
    //#given
    const project = { cyclopt: { max_batch_files: 10 } } as unknown as MatrixxConfig
    //#then
    expect(stripProjectCredentials(project, "p")).toBe(project)
    expect(stripProjectCredentials({} as MatrixxConfig, "p")).toEqual({})
  })

  test("the user-level token survives a project cyclopt block that sets other options", () => {
    //#given a global token and a project that tunes an unrelated cyclopt option
    const user = { cyclopt: { api_token: "user-tok" } } as unknown as MatrixxConfig
    const project = { cyclopt: { max_batch_files: 10 } } as unknown as MatrixxConfig
    //#when
    const merged = mergeConfigs(user, stripProjectCredentials(project, "p"))
    //#then both apply; the project block did not wipe the token
    expect(merged.cyclopt).toEqual({ api_token: "user-tok", max_batch_files: 10 } as never)
  })

  test("a project token never reaches the merged config", () => {
    //#given
    const user = { cyclopt: { api_token: "user-tok" } } as unknown as MatrixxConfig
    const project = { cyclopt: { api_token: "leak-me" } } as unknown as MatrixxConfig
    //#when
    const merged = mergeConfigs(user, stripProjectCredentials(project, "p"))
    //#then
    expect(JSON.stringify(merged)).not.toContain("leak-me")
    expect(merged.cyclopt?.api_token).toBe("user-tok")
  })
})
