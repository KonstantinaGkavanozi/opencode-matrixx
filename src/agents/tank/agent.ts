import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { isGptModel } from "../types"
import { TANK_PERMISSION } from "./permissions"
import { TANK_SYSTEM_PROMPT } from "./system-prompt"

const MODE: AgentMode = "subagent"

export const TANK_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "Tank",
  keyTrigger:
    "Code or dependency change needs regression validation (did the build or tests break, do the updated package's call sites still work) → fire `tank`",
  triggers: [
    { domain: "Regression Validation", trigger: "After a dependency bump or code change: run build and tests, decide if anything broke" },
    { domain: "Targeted Tests", trigger: "Write small tests around changed files and the usage sites of an updated package" },
    { domain: "Final Verification", trigger: "Confirm the full build and test suite pass after a batch of fixes, with a PASS/FAIL verdict" },
  ],
  useWhen: [
    "A vulnerability fix or dependency update was just applied and must be validated",
    "Source files were changed and you need evidence nothing regressed",
    "A final PASS/FAIL verdict is needed across several applied fixes",
  ],
  avoidWhen: [
    "Finding vulnerabilities — use Cyclopt or Sentinel; Tank never scans",
    "Fixing anything, including failures Tank reports — Tank only adds tests and reports; the orchestrator fixes",
    "Changing dependencies or manifests",
    "A project with no way to build or test and no code to smoke-check",
  ],
}

export function createTankAgent(model: string): AgentConfig {
  const base = {
    description:
      "Regression validation specialist. After code or dependency changes it runs the build and existing tests, writes targeted tests around the changed code and the updated package's call sites, and returns a VERDICT: PASS/FAIL report. Adds test files only; never fixes, scans, or edits source, manifests or node_modules. (Tank - Matrixx)",
    mode: MODE,
    model,
    temperature: 0.1,
    permission: TANK_PERMISSION,
    prompt: TANK_SYSTEM_PROMPT,
  } as AgentConfig

  if (isGptModel(model)) {
    return { ...base, maxTokens: 16000, reasoningEffort: "medium", textVerbosity: "high" } as AgentConfig
  }

  return { ...base, maxTokens: 16000, thinking: { type: "enabled", budgetTokens: 4000 } } as AgentConfig
}
createTankAgent.mode = MODE
