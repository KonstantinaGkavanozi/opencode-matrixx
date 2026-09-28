import { afterEach, describe, expect, it } from "bun:test"
import { optionalToolsCheck } from "../../../src/cli/doctor/checks/optional"
import { runtimeDepsCheck } from "../../../src/cli/doctor/checks/runtime"
import { mockCapabilities, restoreCapabilities } from "../../../src/shared/test-utils/platform"

afterEach(restoreCapabilities)

async function run(check: { check: () => unknown }) {
  return (await check.check()) as { message: string; detail?: string }
}

describe("doctor python detection", () => {
  it("#given a resolved python launcher #when runtime check runs #then it probes that launcher", async () => {
    //#given — the bun binary stands in for a `py` launcher that answers --version
    mockCapabilities({ python: process.execPath as "py" })
    //#when
    const result = await run(runtimeDepsCheck)
    //#then
    expect(result.message).toContain("Python3")
  })

  it("#given no python anywhere #when runtime check runs #then Python3 is reported missing", async () => {
    mockCapabilities({ python: null })
    const result = await run(runtimeDepsCheck)
    expect(`${result.message}\n${result.detail ?? ""}`).toMatch(/Python3/)
  })

  it("#given no python #when optional check runs #then python-backed tools are unavailable, not crashing", async () => {
    mockCapabilities({ python: null })
    const result = await run(optionalToolsCheck)
    expect(result.detail ?? result.message).toContain("PyMuPDF")
  })
})
