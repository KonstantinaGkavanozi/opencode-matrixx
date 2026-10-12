# Cyclopt Agent — Implementation Plan

**Status:** Design proposal, not yet implemented
**Target branch:** `dev` (per repo policy — never `master`)
**Scope:** Add a 15th built-in agent, `cyclopt`, fronting the Cyclopt MCP server's analysis capabilities and feeding structured findings back into the Matrixx pipeline.

> Sections §1 and §2 are grounded in **live calls against the production Cyclopt MCP server**, not inference. The response envelopes quoted are real. Several of them invalidate assumptions the design would otherwise have made — see §2.6 in particular.

---

## 0. Decisions Locked

Settled before design; everything below is constrained by these.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Report-only agent.** `fix_code` / `check_fix_job` excluded from the permission set. | Preserves the auditor/executor separation Matrixx uses everywhere (Sentinel, Merovingian, Trinity). Cyclopt reports; Morpheus routes remediation to Keymaker/Mouse. Also avoids silently burning Cyclopt fix credits. |
| D2 | **Built-in MCP with env-var auth.** `src/mcp/cyclopt.ts`, token from `CYCLOPT_API_TOKEN`. | Ships with the plugin like `websearch`/`context7`. Keeps the JWT out of `matrixx.jsonc`, which is routinely committed. |
| D3 | **Separate agent, distinct lane from Sentinel.** | Cyclopt = Cyclopt-platform analysis (metrics, violations, duplication, maintainability + its own SAST/dependency engines). Sentinel = local-CLI security auditing (gitleaks/semgrep/trivy) + threat modelling. See §8. |
| D4 | **Native orchestration tool** `cyclopt_scan` for repo-scale work. | The MCP is per-call, inline-content-only, and async with multi-minute latency. Prompt-driving it would pull the repo through the transcript and depend on the model honouring a 10-second poll floor across ~20 polls. See §2 and §5. |

---

## 1. What the Cyclopt MCP Actually Provides

Eleven tools, verified live against `https://mcp-server.cyclopt.com/mcp`.

### 1.1 Enqueue tools (async — return a job, not findings)

| Tool | Purpose | Input |
|------|---------|-------|
| `analyze_file` | Any subset of the five analyzers | `files[]`, `analyzers[]` (default: all) |
| `analyze_metrics` | Cyclomatic complexity, LOC, maintainability index, Halstead | `files[]` |
| `analyze_violations` | Style violations, anti-patterns, code smells | `files[]` |
| `analyze_sast` | Injection flaws, OWASP Top 10, auth issues | `files[]` |
| `analyze_duplication` | Repeated / near-repeated blocks across files | `files[]` |
| `analyze_vulnerabilities` | Known-vulnerable dependencies | `files[]` — **manifests/lockfiles only** |

`files[]` entries are `{ filename: string, content: string }`. **File paths are not supported** — content must be inlined.

### 1.2 Result tools

| Tool | Purpose |
|------|---------|
| `check_analysis_job` | The *only* authoritative source of analysis results. Takes `job_id`. |
| `check_fix_job` | Result of a `fix_code` job. **Excluded by D1.** |

### 1.3 Other

| Tool | Purpose |
|------|---------|
| `list_analyzers` | Enumerates the five analyzer IDs + descriptions |
| `fix_code` | LLM-powered refactoring. **Excluded by D1.** |
| `check_fix_usage` | Fix credits / renewal date. Diagnostics only. |

### 1.4 Verified enqueue envelope

`analyze_file` with a one-file JavaScript probe:

```json
{
  "jobId": "8012aebb-6647-4a33-8489-502a0a8e473a",
  "status": "pending",
  "summary": {
    "totalFiles": 1,
    "languages": ["javascript"],
    "analyzers": ["metrics", "violations", "sast"]
  },
  "message": "Analysis queued. Poll with GET /cyclopt/mcp/jobs/:jobId to check status."
}
```

Three things matter:

1. **Enqueue returns `jobId` (camelCase); `check_analysis_job` takes `job_id` (snake_case).** Anything round-tripping this must translate. A live footgun.
2. **`status` is a string enum** — `pending` and `completed` observed, `failed` documented.
3. **`message` leaks the underlying REST route:** `GET /cyclopt/mcp/jobs/:jobId`. This is what makes §5 possible — see §2.5.

### 1.5 Verified completion envelope

The same job, polled to completion. **This is the shape `report-formatter.ts` must consume**, and it is considerably more involved than the tool descriptions suggest. Abridged, with structure preserved:

```jsonc
{
  "jobId": "8012aebb-...",
  "status": "completed",
  "summary": { "totalFiles": 1, "languages": ["javascript"], "analyzers": [...] },
  "languageStatus": { "javascript": "completed" },
  "createdAt":   "2026-09-29T08:13:02.527Z",
  "completedAt": "2026-09-29T08:16:48.658Z",

  "results": {
    "javascript": {                                  // ← keyed BY LANGUAGE first
      "sast": {
        "sast": [],                                  // findings array
        "sastMetrics": { "sastVulnerabilities": 0 },
        "sastScores":  { "SECURITY_VIOL": { "avgScore": 1, "avgValue": 0 } }
      },
      "violations": {
        "violations": {
          "info": {
            "violations": {
              "ESLINT_no-unused-vars": {             // ← keyed BY RULE ID, not a flat list
                "count": 3,
                "files": [ { "filePath": "/probe.js", "line": 1 }, ... ],
                "explanation": "Prevents unused variable declarations, ...",
                "category": "Best Practices",
                "title": "Disallow Unused Variables",
                "severity": "Major"                  // ← Capitalised
              }
            },
            "generalStats": {
              "Best Practices": { "Minor": 0, "Major": 4, "Critical": 0 },
              "Code Smell":     { "Minor": 0, "Major": 0, "Critical": 0 },
              "Vulnerability":  { "Minor": 0, "Major": 0, "Critical": 0 },
              "Bug":            { "Minor": 0, "Major": 0, "Critical": 0 }
            }
          },
          "totalViolationsCount": 4,
          "timeToFixViolations": 0.0208               // in days
        },
        "violationsScores": { "ESLINT_ERR": { "avgValue": 4, "avgScore": 0.95 } }
      },
      "metrics": {
        "metrics": {
          "LOC": 4, "LLOC": 3, "numFiles": 1, "MI": 128.06, "CC": 4,
          "EffortInDays": 0.08, "numParams": 1, "averageLOCPerFunction": 5,
          "numImports": 0, "CD": 0                    // CD = comment density
        },
        "metricsRecommendations": {
          "CD": { "files": [ { "filePath": "/probe.js", "value": 0, "line": 1 } ],
                  "affectedPercetange": 100 }         // NB: misspelled upstream — do not "fix" it
        },
        "metricsScores": {                            // normalised 0–1, higher = better
          "ESCOMP_CC": { "avgValue": 4, "avgScore": 0.01 },
          "ESCOMP_MI": { "avgValue": 128.06, "avgScore": 0.73 }
        },
        "analysisResults": {
          "escomplex": { "complex": { "reports": [ {
            "aggregate": { "cyclomatic": 4, "halstead": { ... }, "sloc": {...} },
            "functions": [ { "name": "f", "cyclomatic": 4, "line": 3, ... } ],
            "maintainability": 128.059,
            "path": "/tmp/qbWiurMMWD7HmQYBmZOFcSDYV/qbWiu.../probe.js"  // ← sandbox path
          } ] } },
          "commentsAnalysis": [ { "filePath": "/tmp/.../probe.js", "lloc": 3, "ploc": 4, "comments": 0 } ]
        }
      }
    }
  }
}
```

Five consequences, each of which changes the implementation:

1. **`results` is keyed by language, then analyzer.** A polyglot repo returns parallel per-language trees that must be merged. `languageStatus` can report per-language completion independently — so a job can be `completed` overall with one language having failed.
2. **Violations are a rule-keyed map, not a list.** Each entry carries `count` plus a `files[]` array of occurrences. Flattening to per-occurrence findings is the formatter's job.
3. **Severity vocabulary is `Minor` / `Major` / `Critical` — capitalised.** But `fix_code`'s `severityFilter` enum is lowercase `minor|major|critical`. **Normalise on ingest**; do not assume one casing.
4. **Paths need remapping.** `filePath` comes back as `/probe.js` (leading slash, sandbox-root-relative) in violations, but as a full ephemeral sandbox path `/tmp/qbWiur.../probe.js` under `analysisResults`. Neither is repo-relative. The collector must retain a `sentFilename → repoRelativePath` map and the formatter must apply it, or **every finding will cite a path that does not exist on the user's machine** — which makes the remediation handoff in §7.2 fail outright.
5. **Two score families are returned** (`metricsScores`, `violationsScores`, `sastScores`) as normalised 0–1 values. These are the natural basis for the quality-gate summary in §7.1 and are more useful than raw values for trend reporting.

### 1.6 Observed latency — the number that reshapes the design

```
createdAt   2026-09-29T08:13:02.527Z
completedAt 2026-09-29T08:16:48.658Z
                                       ≈ 3 min 46 s   for ONE 4-line file
```

This is not a rounding error on the design — it is a structural constraint:

- At the ≥10s poll floor, a single job is **~20 poll rounds**. Prompt-driven polling would spend ~20 model turns per job, each re-reading context. D4 is thereby not a preference but a requirement.
- Latency appears dominated by sandbox provisioning, not file count, so **larger batches are strongly preferred over more jobs**. This inverts the usual instinct to keep batches small.
- The default `job_timeout_ms` must be generous. §10 sets 900 000 ms (15 min), not the 10 min a naive estimate would pick.

### 1.7 SAST calibration caveat

The probe contained a textbook SQL-injection string concatenation:

```js
const q = 'SELECT * FROM t WHERE id = ' + userInput;
```

Cyclopt's SAST returned `sast: []` — zero findings. Its `violations` analyzer did flag `no-undef` and `no-unused-vars` on the same lines.

That may well be defensible (no reachable sink in a 4-line fragment, and the whole file is dead code). But it demonstrates that **Cyclopt SAST and semgrep do not have overlapping coverage**, which is direct empirical support for D3: run Cyclopt and Sentinel in parallel and treat agreement as confirmation rather than picking one. It is also a reason the agent prompt must never present "no SAST findings" as "no vulnerabilities."

---

## 2. Six Constraints That Drive the Whole Design

Everything in §4–§7 follows from one of these. Read this before reviewing the rest.

### 2.1 Inline content only

The MCP cannot read from disk. A repo audit means *this process* selects files, reads them, and ships their bytes. That implies file-selection policy, size caps, binary exclusion, and secret-leakage awareness — none of which the MCP does for us. It also implies the path-remapping obligation from §1.5(4).

### 2.2 Async, with a hard 10-second poll floor

Every analyzer tool enqueues and returns immediately. The server instructions state, repeatedly, a **minimum of 10 seconds** between `check_analysis_job` calls (10–20s recommended). A prompt-driven loop puts that contract in a language model's hands across ~20 rounds (§1.6). A native tool enforces it in code, and the config schema can enforce it structurally via `z.number().int().min(10_000)`.

### 2.3 The server forbids model-side inference

The tool descriptions are unusually strict:

> While status is `pending`, you MUST NOT provide any analysis, findings, severity, or recommendations. Do NOT infer, estimate, guess, or generate your own analysis from file content. Do NOT perform your own code review while waiting for async results.

This is a **behavioural contract that must be mirrored in the agent's system prompt**, not merely honoured incidentally. A Matrixx agent that helpfully starts reviewing code during a 4-minute wait violates the server's operating rules and produces findings that then get attributed to Cyclopt. §6.3 encodes this.

### 2.4 Dependency analysis has a different input shape

`analyze_vulnerabilities` wants *only* manifests and lockfiles (`package.json` + `package-lock.json`, `requirements.txt`, …). Feeding it source files is a misuse. The collector therefore needs **two disjoint input channels**: source and manifest.

### 2.5 Plugin tools cannot invoke MCP tools — verified

The single most consequential finding, and easy to get wrong.

Evidence from the OpenCode source (`sst/opencode`):

- `MCP.Interface` (`packages/opencode/src/mcp/index.ts:164–196`) exposes `status`, `clients`, `tools`, `prompts`, `resources`, `add`, `connect`, `disconnect`, `getPrompt`, `readResource`, and auth methods. **There is no `callTool`.**
- `McpPaths` (`packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts`) defines `/mcp`, `/mcp/:name/auth`, `/mcp/:name/connect`, `/mcp/:name/disconnect`. **No tool-invocation route.**
- `PluginInput` (`packages/plugin/src/index.ts:56`) hands a plugin only `client`, `project`, `directory`, `worktree`, `serverUrl`, `$`. The SDK client's `mcp` namespace mirrors those routes — lifecycle, not invocation.

**Consequence:** `cyclopt_scan` *cannot* orchestrate by calling `cyclopt_analyze_sast`. Only the model can call MCP tools. The orchestration tool must speak to Cyclopt **directly over HTTPS**, using the same base URL and bearer token the MCP registration uses.

This is why the design has two transports into one service (§3). Deliberate, not redundant.

### 2.6 The result envelope is language-nested, rule-keyed, and path-mangled

From §1.5. The naive mental model — "a job returns a list of findings with file paths and severities" — is wrong in three independent ways. Any formatter written against that model will emit findings with unusable paths, lose occurrence counts, and mis-sort severities. This constraint alone justifies the dedicated `report-formatter.ts` module and its test file.

---

## 3. Architecture

```
                    ┌──────────────────────────────────────┐
                    │            Morpheus                  │
                    │  (routes on keyword / delegation)    │
                    └──────────────┬───────────────────────┘
                                   │ task(subagent_type="cyclopt")
                                   ▼
                    ┌──────────────────────────────────────┐
   Layer 3          │          cyclopt agent               │
   src/agents/      │   read-only · temp 0.1 · report-only │
                    └───────┬──────────────────┬───────────┘
                            │                  │
             batch / repo   │                  │  targeted / single-file
                            ▼                  ▼
        ┌───────────────────────────┐   ┌──────────────────────────┐
Layer 2 │   cyclopt_scan (native)   │   │  cyclopt_* (MCP tools)   │ Layer 1
        │  collect→batch→enqueue→   │   │  registered by OpenCode  │
        │  poll→remap→aggregate     │   │  from src/mcp/cyclopt.ts │
        └─────────────┬─────────────┘   └────────────┬─────────────┘
                      │ direct HTTPS                 │ OpenCode MCP client
                      │ (§2.5)                       │
                      ▼                              ▼
        ┌──────────────────────────────────────────────────────────┐
Layer 0 │  src/mcp/cyclopt-endpoint.ts — SINGLE source of truth for │
        │  base URL + CYCLOPT_API_TOKEN + availability check        │
        └──────────────────────────┬───────────────────────────────┘
                                   ▼
                        Cyclopt MCP / REST service
```

**Layer 4** (not drawn) is pipeline integration: the report contract Cyclopt hands back and how Morpheus routes remediation from it (§7).

The key structural idea: **Layer 0 is shared.** Both transports resolve endpoint and credentials through one module, so there is exactly one place auth can be wrong.

---

## 4. Layer 1 — MCP Registration

### 4.1 `src/mcp/cyclopt-endpoint.ts` (new, ~50 LOC)

The shared resolver. No I/O, trivially testable.

```ts
import type { CycloptConfig } from "../config/schema"

export const CYCLOPT_TOKEN_ENV = "CYCLOPT_API_TOKEN"
export const CYCLOPT_DEFAULT_BASE_URL = "https://mcp-server.cyclopt.com/mcp"

export type CycloptEndpoint = { baseUrl: string; token: string }
export type CycloptResolution =
  | { ok: true; endpoint: CycloptEndpoint }
  | { ok: false; error: string }

export function resolveCycloptEndpoint(config?: CycloptConfig): CycloptResolution {
  const token = process.env[CYCLOPT_TOKEN_ENV]
  if (!token) {
    return {
      ok: false,
      error:
        `${CYCLOPT_TOKEN_ENV} environment variable is required for the Cyclopt MCP. ` +
        `Obtain a token from your Cyclopt account and export it before starting OpenCode.`,
    }
  }
  return {
    ok: true,
    endpoint: { baseUrl: config?.base_url ?? CYCLOPT_DEFAULT_BASE_URL, token },
  }
}
```

### 4.2 `src/mcp/cyclopt.ts` (new, ~40 LOC)

Follows the `websearch.ts` remote-config pattern exactly.

```ts
import type { CycloptConfig } from "../config/schema"
import { resolveCycloptEndpoint } from "./cyclopt-endpoint"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

export function createCycloptConfig(config?: CycloptConfig): RemoteMcpConfig {
  const resolution = resolveCycloptEndpoint(config)
  if (!resolution.ok) throw new Error(resolution.error)
  return {
    type: "remote" as const,
    url: resolution.endpoint.baseUrl,
    enabled: true,
    headers: { Authorization: `Bearer ${resolution.endpoint.token}` },
    oauth: false as const,
  }
}
```

### 4.3 Wiring into `createBuiltinMcps()`

Add to `src/mcp/index.ts`, mirroring the **lazy-getter** treatment `websearch` already receives — env vars must not be read at plugin-init time:

```ts
if (!disabledMcps.includes("cyclopt")) {
  const validation = validateCycloptConfig(config?.cyclopt)
  if (!validation.ok) {
    recordFailure("cyclopt", validation.error)
    mcps.cyclopt = DISABLED_REMOTE_STUB
  } else {
    let cycloptConfig: BuiltinMcpConfig | undefined
    Object.defineProperty(mcps, "cyclopt", {
      enumerable: true,
      configurable: true,
      get() {
        if (!cycloptConfig) {
          try {
            cycloptConfig = createCycloptConfig(config?.cyclopt)
          } catch (err) {
            recordFailure("cyclopt", err instanceof Error ? err.message : String(err))
            cycloptConfig = DISABLED_REMOTE_STUB
          }
        }
        return cycloptConfig
      },
    })
  }
}
```

`validateCycloptConfig` goes in `src/mcp/mcp-validator.ts` beside `validateWebsearchConfig` and defers to `resolveCycloptEndpoint`.

### 4.4 Registered tool names — verify before writing permissions

OpenCode derives MCP tool names as:

```ts
// packages/opencode/src/mcp/catalog.ts:119
export const toolName = (clientName, name) => sanitize(clientName) + "_" + sanitize(name)
```

A **single** underscore. So server `cyclopt` yields:

`cyclopt_analyze_file`, `cyclopt_analyze_metrics`, `cyclopt_analyze_violations`, `cyclopt_analyze_sast`, `cyclopt_analyze_duplication`, `cyclopt_analyze_vulnerabilities`, `cyclopt_check_analysis_job`, `cyclopt_list_analyzers`, `cyclopt_fix_code`, `cyclopt_check_fix_job`, `cyclopt_check_fix_usage`.

> ⚠️ **Pre-existing inconsistency to resolve first.** This repo refers to `document_reader__convert_to_markdown` with a *double* underscore in five places — `src/agents/construct.ts:15`, `src/features/builtin-skills/skills/document-reader.ts:30`, `src/hooks/document-reader-guard/constants.ts:35,41`, and `src/mcp/AGENTS.md`. That does not match the single-underscore rule above. Either the pinned OpenCode version differs from `main`, or those permission entries have been silently dead. **Confirm the actual registered names at runtime** (`/mcp` status, or a tool listing) before committing the Cyclopt allowlist in §6.2 — and file an issue for `document_reader` either way.

---

## 5. Layer 2 — Native Orchestration Tool (`cyclopt_scan`)

Location: `src/tools/cyclopt-scan/`. Registered in `src/plugin/tool-registry.ts`, gated per §10.

Per §2.5 this talks **directly** to Cyclopt over HTTPS. Two viable transports; choose in the Phase 2 spike:

- **JSON-RPC over the MCP Streamable-HTTP endpoint** — `POST {base_url}` with a `tools/call` envelope. Same URL as the MCP registration; one contract.
- **The advertised REST route** — `GET {base}/cyclopt/mcp/jobs/:jobId` for polling, per §1.4. Simpler for polling, but undocumented and liable to drift.

**Recommendation:** JSON-RPC for both enqueue and poll, so there is a single transport contract. Keep REST as a fallback only if JSON-RPC polling proves awkward.

### 5.1 Module breakdown

The 200-LOC hard limit is the organising constraint. Ten small modules, each independently testable:

| File | ~LOC | Responsibility |
|------|------|----------------|
| `index.ts` | 5 | Barrel — `export { createCycloptTools } from "./tools"` |
| `types.ts` | 70 | `CycloptFinding`, `CycloptJobResult`, `ScanArgs`, `FileBatch`, `ScanReport`, `PathMap` |
| `constants.ts` | 45 | Poll interval/floor, size caps, skip dirs, source extensions, manifest filenames, severity map |
| `client.ts` | 120 | `enqueue()` / `fetchJob()` — JSON-RPC envelope, auth header, timeout, bounded retry on 429/5xx |
| `file-collector.ts` | 140 | Walk the tree; split **source** vs **manifest** channels (§2.4); skip-dirs, extension filter, per-file byte cap, binary rejection; **emit the `sentFilename → repoRelativePath` map** |
| `batcher.ts` | 80 | Pack files into batches under count/byte caps — biased **large** per §1.6 |
| `poller.ts` | 90 | Poll loop enforcing the ≥10s floor, overall deadline, cancellation |
| `result-normalizer.ts` | 160 | **Unwrap §1.5**: flatten language→analyzer→rule→occurrence into `CycloptFinding[]`; normalise severity casing; **remap sandbox paths to repo-relative** |
| `report-formatter.ts` | 150 | Merge normalised findings across jobs → severity-sorted report + machine-readable block |
| `tools.ts` | 120 | `createCycloptTools()` → `{ cyclopt_scan, cyclopt_job_status }` |

`result-normalizer.ts` is separated from `report-formatter.ts` deliberately: §2.6 shows the unwrapping is intricate enough to deserve its own test surface, and keeping it pure (envelope in, `CycloptFinding[]` out) makes it testable against recorded fixtures without any network.

### 5.2 `cyclopt_scan` tool contract

```ts
args: {
  scope:     "repo" | "staged" | "changed" | "paths",   // default "changed"
  paths:     string[]?,                                  // required when scope="paths"
  analyzers: ("metrics"|"violations"|"sast"|"duplication"|"vulnerabilities")[]?,
  severity:  ("minor"|"major"|"critical")[]?,            // post-filter, case-insensitive
  max_files: number?,                                    // hard ceiling, default from config
}
```

`scope` defaults to `"changed"` (git diff against the merge-base) rather than `"repo"`. Given §1.6, a full scan of a 960-file codebase is both a large volume of source shipped to a third party and a long wall-clock wait. It should be an explicit ask.

### 5.3 Execution sequence

1. **Collect** — `file-collector` walks `scope`, yielding `{ source: File[], manifests: File[], pathMap: PathMap }`. Reuse the bounded-scan discipline already proven in `src/plugin/tool-gating.ts` (`TOOL_GATING_SKIP_DIRS`, depth and entry caps) rather than inventing a second walker.
2. **Guard** — if total bytes exceed the configured ceiling, **stop and report** rather than silently truncating. A partial audit presented as complete is worse than no audit.
3. **Batch** — `batcher` packs source files under the count/byte caps, biased toward **fewer, larger** batches (§1.6). Manifests form their own batch routed to `analyze_vulnerabilities`.
4. **Enqueue** — one call per batch; collect `jobId`s. Mind the camelCase→snake_case translation (§1.4).
5. **Poll** — `poller` waits ≥10s between rounds, polling all outstanding jobs per round, until every job is terminal or the deadline passes. Timed-out jobs are reported as timed out, never as clean. Expect ~20+ rounds per job.
6. **Normalise** — `result-normalizer` unwraps the language/analyzer/rule nesting, normalises severity casing, and **remaps every `filePath` through `pathMap`**. Findings whose path cannot be remapped are surfaced in a dedicated "unmapped" section rather than silently dropped.
7. **Aggregate** — `report-formatter` merges across jobs, applies the `severity` filter, sorts by severity then file, and emits §7.1.

### 5.4 What this tool deliberately does not do

- **No `fix_code`.** D1. The tool has no fix path at all, so the agent cannot reach one by accident.
- **No inference.** If a job fails or times out, the report says so and stops. It never falls back to local heuristics — that would violate §2.3 and mislabel Matrixx output as Cyclopt findings.
- **No cross-session caching** in v1. Content-hash caching of job results is an obvious later optimisation given §1.6 latency — note it, defer it.

### 5.5 Secret-leakage guard

This tool ships repository bytes to a third-party service. `file-collector` must unconditionally exclude:

`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `.git/`, `.matrixx/`, `node_modules/`, `dist/`, `build/`, `coverage/`

and honour the user's `exclude` globs from config. State this in the tool description too, so the model does not try to route around it via `scope: "paths"`.

---

## 6. Layer 3 — The Agent

`src/agents/cyclopt.ts`, modelled structurally on `src/agents/sentinel.ts`.

### 6.1 Factory and metadata

```ts
const MODE: AgentMode = "all"

export const CYCLOPT_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "Cyclopt",
  keyTrigger:
    "Cyclopt analysis, code quality metrics, maintainability index, cyclomatic complexity, " +
    "duplication check, code smells, dependency CVE scan via Cyclopt mentioned → fire `cyclopt`",
  triggers: [
    { domain: "Quality Metrics", trigger: "Cyclomatic complexity, maintainability index, Halstead metrics, LOC analysis" },
    { domain: "Code Violations", trigger: "Style violations, anti-patterns, code smells, best-practice audit" },
    { domain: "Duplication",     trigger: "Copy-paste detection, near-duplicate blocks, DRY audit" },
    { domain: "Platform SAST",   trigger: "Cyclopt-backed static security analysis, injection flaws, OWASP" },
    { domain: "Dependency CVEs", trigger: "Manifest/lockfile vulnerability scan via the Cyclopt platform" },
  ],
  useWhen: [
    "A quality baseline is needed before a refactor",
    "Maintainability or complexity regression must be quantified",
    "Duplication across a module is suspected",
    "Cyclopt-platform findings are wanted specifically (org policy, dashboard/CI parity)",
  ],
  avoidWhen: [
    "Local-CLI security audit with gitleaks/semgrep/trivy, or threat modelling — use Sentinel",
    "Architectural or stylistic code review — use Merovingian",
    "Applying fixes — Cyclopt reports only; the orchestrator routes remediation",
    "CYCLOPT_API_TOKEN is unset — the agent degrades to an explicit unavailability report",
    "A fast answer is needed — jobs take minutes, not seconds (§1.6)",
  ],
}
```

### 6.2 Tool restrictions

Cyclopt is strictly narrower than Sentinel: read/search plus its own tools, nothing else. An **allowlist** is the right primitive, and OpenCode's permission matcher supports wildcards (`Wildcard.match`, `packages/opencode/src/permission/index.ts:32`), so a prefix entry would work — but should not be used here:

```ts
const restrictions = createAgentToolAllowlist([
  "read", "grep", "glob",
  "cyclopt_scan", "cyclopt_job_status",
  "cyclopt_analyze_file", "cyclopt_analyze_metrics", "cyclopt_analyze_violations",
  "cyclopt_analyze_sast", "cyclopt_analyze_duplication", "cyclopt_analyze_vulnerabilities",
  "cyclopt_check_analysis_job", "cyclopt_list_analyzers",
])
```

**Enumerate explicitly rather than using `cyclopt_*`.** A wildcard would sweep in `cyclopt_fix_code` and `cyclopt_check_fix_job`, defeating D1. The allowlist's implicit `"*": "deny"` covers everything else, including `write`, `edit`, `task` and `bash`.

Denying `bash` is a real difference from Sentinel, and intentional: Cyclopt's findings must come from the Cyclopt service, not from a local tool the agent shelled out to.

### 6.3 System prompt — non-negotiable sections

The prompt must encode the server's operating contract (§2.3), or the agent will violate it while being helpful — especially across a 4-minute wait. Required sections:

- **Identity** — Cyclopt platform analyst. Reports; never fixes, never writes.
- **Tool routing** — `cyclopt_scan` for anything multi-file; raw `cyclopt_analyze_*` only for a single targeted file or when the user names an analyzer explicitly.
- **The pending contract**, stated bluntly:
  > While a job is `pending` you MUST NOT produce findings, severities, or recommendations. You MUST NOT review the code yourself while waiting. You MUST NOT infer, estimate, or guess. Report only that the job is running. Jobs routinely take several minutes; waiting is correct behaviour.
- **The failure contract** — on `failed`, report the returned error verbatim and stop. **Never** substitute your own analysis.
- **Fidelity** — preserve Cyclopt's keys, values, numbers and statuses. Do not rewrite severities or renumber findings.
- **Job hygiene** — reuse the exact job id; never mix findings across jobs; do not start extra jobs unsolicited. Note the `jobId` → `job_id` rename explicitly (§1.4).
- **Coverage honesty** — an empty `sast` array means *Cyclopt's engine found nothing*, not that the code is secure (§1.7). Never present it as the latter.
- **Boundary** — if the request is local-CLI security scanning or threat modelling, say so and defer to Sentinel rather than approximating it.
- **Delivery** — emit the §7.1 report contract.

### 6.4 Model and reasoning

Follow the Sentinel entry in `src/shared/model-requirements.ts`:

```ts
cyclopt: {
  fallbackChain: [
    { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" },
    { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
  ],
},
```

`temperature: 0.1`, `maxTokens: 16000`, `thinking: { type: "enabled", budgetTokens: 8000 }` for Claude; `reasoningEffort: "medium"` + `textVerbosity: "high"` for GPT via the `isGptModel(model)` branch.

Cyclopt relays and structures service output rather than reasoning from first principles, so the Sentinel-tier budget is ample. Do not raise it.

---

## 7. Layer 4 — Pipeline Integration

### 7.1 Report contract

Cyclopt's output is consumed by *other agents*, so it needs a stable machine-readable tail alongside the human-readable body.

````markdown
## Cyclopt Analysis Report

**Scope**: [what was scanned]  ·  **Files**: N  ·  **Jobs**: [ids]
**Analyzers**: [ids]  ·  **Languages**: [ids]  ·  **Status**: complete | partial | failed
**Elapsed**: [createdAt → completedAt]

### Critical
| # | Analyzer | Rule | Location | Occurrences | Description | Suggested Remediation |

### Major
### Minor

### Quality Scores (0–1, higher is better)
| Score | Value | Raw |
| ESCOMP_MI | 0.73 | 128.06 |
| ESCOMP_CC | 0.01 | 4 |
| ESLINT_ERR | 0.95 | 4 |

### Metrics Summary
| Metric | Value | Affected files |
| Maintainability index (MI) | | |
| Max cyclomatic complexity (CC) | | |
| Comment density (CD) | | |
| Estimated effort | | |

### Dependency Vulnerabilities
| Package | Version | CVE | Severity | Fixed In |

### Unavailable / Failed / Unmapped
[jobs that failed or timed out, with verbatim error; findings whose path could not be remapped]

```json cyclopt-findings
{ "jobIds": [...], "status": "...", "languages": [...],
  "counts": {"critical":0,"major":0,"minor":0},
  "scores": {"ESCOMP_MI":0.73},
  "findings": [{"analyzer":"","rule":"","file":"","line":0,"severity":"","category":"","message":""}] }
```
````

The fenced `cyclopt-findings` block is what Morpheus parses to build remediation tasks. `file` there is **repo-relative**, post-remap (§1.5(4)). Everything above the block is for humans.

### 7.2 Routing into the pipeline

The flow described in the brief — *Cyclopt audits, the rest of Matrixx fixes* — falls out naturally:

```
User: "security audit this repo"
  └─ Morpheus
       ├─ task(subagent_type="cyclopt")   → platform findings   ─┐
       └─ task(subagent_type="sentinel")  → local CLI findings  ─┤ run in parallel
                                                                  │
       ┌──────────────────────────────────────────────────────────┘
       │ merge; dedupe by (file, line, rule)
       ▼
   task_create per confirmed finding (task system on by default)
       ▼
   task(category="source" | "bullet-time") → Mouse/Keymaker applies fixes
       ▼
   task(subagent_type="cyclopt") re-scan → verify findings cleared
```

Three things to get right:

- **Parallelism.** Per repo convention, never issue sequential `task()` calls. Cyclopt and Sentinel are independent; launch both with `run_in_background=true` and collect via `background_output`. Given §1.6 this is not a micro-optimisation — serialising them roughly doubles a multi-minute wait.
- **Dedupe needs repo-relative paths on both sides.** This is the dependency on §1.5(4): without the remap, Cyclopt findings cite `/probe.js` while Sentinel cites `src/probe.js`, and nothing dedupes.
- **The verification re-scan closes the loop** — and is the cheapest way to catch a "fix" that did not actually clear the finding.

### 7.3 Morpheus prompt wiring

Adding `CYCLOPT_PROMPT_METADATA` to `agentMetadata` in `src/agents/builtin-agents.ts` is sufficient — the Delegation Table, Tool Selection and Key Triggers sections of Morpheus's prompt are generated from metadata by `dynamic-agent-prompt-builder.ts`. **No hand-editing of the Morpheus prompt is needed or wanted.**

---

## 8. Sentinel Boundary (D3)

Overlap is real and must be explicit in both prompts, or Morpheus will route arbitrarily.

| Dimension | **Sentinel** | **Cyclopt** |
|-----------|-------------|-------------|
| Source of findings | Local CLIs: gitleaks, semgrep, trivy, npm audit, osv-scanner | Cyclopt platform (remote) |
| Network required | No | **Yes** + valid token |
| Latency | Seconds | **Minutes** (§1.6) |
| Secret detection | ✅ gitleaks | ❌ |
| Threat modelling (STRIDE) | ✅ | ❌ |
| DAST / runtime testing | ✅ | ❌ |
| Quality metrics (MI, CC, Halstead) | ❌ | ✅ |
| Duplication analysis | ❌ | ✅ |
| Style violations / code smells | ❌ | ✅ |
| Normalised quality scores | ❌ | ✅ |
| SAST | ✅ semgrep | ✅ platform engine (different coverage — §1.7) |
| Dependency CVEs | ✅ trivy/osv | ✅ platform engine |
| Ships code off-machine | No | **Yes** |
| Tool access | `bash` + read | No `bash`; Cyclopt tools + read |

**Routing rule for both prompts:** secrets, threat modelling, DAST, or offline/air-gapped → Sentinel. Quality metrics, duplication, violations, or Cyclopt dashboard/CI parity → Cyclopt. For plain SAST and dependency CVEs both are valid; run **both in parallel** and treat agreement as confirmation.

§1.7 is the empirical case for that last rule: the two engines demonstrably do not find the same things.

---

## 9. Registration Checklist

Every touchpoint. Missing any one produces a silent no-op.

### Agent

| # | File | Change |
|---|------|--------|
| 1 | `src/agents/cyclopt.ts` | **New.** `createCycloptAgent(model)` + `CYCLOPT_PROMPT_METADATA`; set `createCycloptAgent.mode = MODE` |
| 2 | `src/agents/builtin-agents.ts` | Add `cyclopt: createCycloptAgent` to `agentSources`; add `cyclopt: CYCLOPT_PROMPT_METADATA` to `agentMetadata` |
| 3 | `src/agents/types.ts` | Add `"cyclopt"` to the `BuiltinAgentName` union |
| 4 | `src/config/schema/agent-names.ts` | Add `"cyclopt"` to `BuiltinAgentNameSchema` |
| 5 | `src/shared/model-requirements.ts` | Add the `cyclopt` fallback chain |
| 6 | `src/agents/index.ts` | Export the factory + metadata |
| 7 | `src/agents/AGENTS.md` | Add to the agent table, tool-restriction table, thinking table |

> `src/plugin-handlers/agent-config-handler.ts` needs **no** change — `collectPendingBuiltinAgents` picks the agent up from `agentSources` automatically. The area doc's "register in agent-config-handler" step applies only to dynamically-built agents like Oracle.
>
> Consider adding `"cyclopt"` to the `exploreAgents` set in `agent-config-handler.ts:36` so it gets the explore-flavoured context-discipline section rather than the compact one — it is an investigative, read-heavy agent.

### MCP

| # | File | Change |
|---|------|--------|
| 8 | `src/mcp/cyclopt-endpoint.ts` | **New.** Shared endpoint/token resolver |
| 9 | `src/mcp/cyclopt.ts` | **New.** `createCycloptConfig()` |
| 10 | `src/mcp/mcp-validator.ts` | Add `validateCycloptConfig()` |
| 11 | `src/mcp/index.ts` | Lazy-getter registration in `createBuiltinMcps()` |
| 12 | `src/mcp/types.ts` | Add `"cyclopt"` to `McpNameSchema` |
| 13 | `src/mcp/AGENTS.md` | Add to the MCP table and tool-name list |

### Tool

| # | File | Change |
|---|------|--------|
| 14 | `src/tools/cyclopt-scan/` | **New.** Ten modules per §5.1 |
| 15 | `src/tools/index.ts` | `export { createCycloptTools } from "./cyclopt-scan"` |
| 16 | `src/plugin/tool-registry.ts` | Conditional spread into `allTools` (§10) |
| 17 | `src/plugin/tool-gating.ts` | `shouldEnableCycloptTools(hasToken, override)` |
| 18 | `src/tools/AGENTS.md` | Add the tool dir to the inventory |

### Config

| # | File | Change |
|---|------|--------|
| 19 | `src/config/schema/cyclopt.ts` | **New.** `CycloptConfigSchema` |
| 20 | `src/config/schema/matrixx-config.ts` | `cyclopt: CycloptConfigSchema.optional()` |
| 21 | `src/config/schema/tool-gating.ts` | `cyclopt_tools: z.boolean().optional()` |
| 22 | — | Run `bun run build:schema` → regenerates `dist/` + `assets/matrixx.schema.json` |

### Docs

| # | File | Change |
|---|------|--------|
| 23 | `AGENTS.md` | Bump agent count 14→15, MCP count 3→4, tool-dir count 24→25 |
| 24 | `docs/configurations.md` | Document the `cyclopt` config block and `CYCLOPT_API_TOKEN` |

---

## 10. Config Surface

`src/config/schema/cyclopt.ts`:

```ts
export const CycloptAnalyzerSchema = z.enum([
  "metrics", "violations", "sast", "duplication", "vulnerabilities",
])

export const CycloptConfigSchema = z.object({
  /** Base URL of the Cyclopt MCP endpoint. */
  base_url: z.string().url().default("https://mcp-server.cyclopt.com/mcp"),
  /** Analyzers run by cyclopt_scan when the caller does not specify. */
  default_analyzers: z.array(CycloptAnalyzerSchema).default(["metrics", "violations", "sast"]),
  /** Per-file byte cap. Larger files are skipped and listed in the report. */
  max_file_bytes: z.number().int().positive().default(256_000),
  /** Files per enqueued batch. Biased large: per-job latency dominates (§1.6). */
  max_batch_files: z.number().int().positive().default(60),
  /** Total bytes per scan before the tool refuses rather than truncating. */
  max_scan_bytes: z.number().int().positive().default(8_000_000),
  /** Poll interval. Floor enforced at the schema level per the server contract (§2.2). */
  poll_interval_ms: z.number().int().min(10_000).default(15_000),
  /** Overall deadline. Generous: a single 4-line file took ~3m46s (§1.6). */
  job_timeout_ms: z.number().int().positive().default(900_000),
  /** Extra exclude globs, merged with the built-in secret guard (§5.5). */
  exclude: z.array(z.string()).optional(),
})
```

`min(10_000)` on `poll_interval_ms` makes the server's rate contract structurally unviolatable through config — worth more than a comment. The `max_batch_files` default of 60 and the 15-minute timeout are both direct consequences of the measured latency in §1.6, not guesses.

**Gating** — Cyclopt tools are useless without a token, so register conditionally:

```ts
export function shouldEnableCycloptTools(
  hasToken: boolean,
  override: boolean | undefined,
): boolean {
  if (override !== undefined) return override
  return hasToken
}
```

Auto-register when `CYCLOPT_API_TOKEN` is present; `tool_gating.cyclopt_tools` forces either outcome. Matches the `bdd_tools` / `pdf_figures` precedent.

---

## 11. Test Plan

TDD is enforced (`tdd_enforcer.enabled=true`). Tests first, BDD comments `//#given` `//#when` `//#then`, never delete a failing test.

**Place every test under `tests/**`.** Co-located `src/**/*.test.ts` files are CI-orphaned — CI discovers tests via `find tests script -name '*.test.ts'`.

| Test file | Covers |
|-----------|--------|
| `tests/mcp/cyclopt-endpoint.test.ts` | Token present/absent; default vs configured base URL; error text |
| `tests/mcp/cyclopt.test.ts` | Remote config shape; `Authorization` header; throws without token |
| `tests/mcp/index.cyclopt.test.ts` | Lazy getter; `disabled_mcps: ["cyclopt"]`; failure recorded + stub returned |
| `tests/tools/cyclopt-scan/file-collector.test.ts` | Source/manifest split; skip dirs; size cap; **secret-guard exclusions (§5.5)**; binary rejection; **pathMap correctness** |
| `tests/tools/cyclopt-scan/batcher.test.ts` | Count and byte caps; oversize single file; empty input |
| `tests/tools/cyclopt-scan/poller.test.ts` | ≥10s floor honoured; deadline; terminal states; timeout ≠ clean |
| `tests/tools/cyclopt-scan/client.test.ts` | JSON-RPC envelope; `jobId`→`job_id` translation; 429/5xx retry; auth failure |
| `tests/tools/cyclopt-scan/result-normalizer.test.ts` | **Against the recorded §1.5 fixture**: language nesting; rule-map → occurrence flattening; `Major`→`major` casing; sandbox-path remap; unmappable paths surfaced not dropped; multi-language merge; per-language partial failure |
| `tests/tools/cyclopt-scan/report-formatter.test.ts` | Severity ordering; multi-job merge; `cyclopt-findings` block validity; partial/failed rendering; score table |
| `tests/agents/cyclopt.test.ts` | Allowlist **excludes** `fix_code`/`check_fix_job`; denies `write`/`edit`/`task`/`bash`; temp 0.1; GPT vs Claude branch |
| `tests/config/cyclopt-schema.test.ts` | Defaults; `poll_interval_ms` floor rejects `<10_000` |
| `tests/plugin/tool-gating.cyclopt.test.ts` | Auto-on with token; override both directions |

**Record the §1.5 envelope as a JSON fixture** under `tests/tools/cyclopt-scan/fixtures/`. It is real production output and is the only thing standing between `result-normalizer.ts` and the three-way wrongness described in §2.6.

### Avoid `mock.module()`

`client.ts` should take its `fetch` implementation by injection:

```ts
export function createCycloptClient(endpoint: CycloptEndpoint, fetchImpl: typeof fetch = fetch) { … }
```

Tests then pass a stub directly. This sidesteps the module-cache pollution gotcha entirely — **no new entries in `script/mock-heavy-list.txt`**, and no matching additions to `.github/workflows/ci.yml` or `publish.yml`.

If injection proves impossible somewhere, the file must go in `script/mock-heavy-list.txt` (the single source of truth) — never inline into a workflow.

Verify locally with `bash script/run-ci.sh`.

---

## 12. Failure Modes and Degradation

| Failure | Detection | Behaviour |
|---------|-----------|-----------|
| `CYCLOPT_API_TOKEN` unset | `resolveCycloptEndpoint` | MCP registers as a disabled stub with a clear message; `cyclopt_scan` not registered; agent still loads and reports unavailability with remediation steps |
| Token expired / 401 | HTTP status | Report auth failure verbatim; suggest token refresh; **never** fall back to local analysis |
| Service down / 5xx | Bounded retry exhausted | Report unreachable; suggest Sentinel as the offline alternative |
| Job stuck `pending` past deadline | `poller` | Report `partial` with timed-out job ids; findings from completed jobs stand; **never** mark the scan clean |
| Job `failed` | `status` field | Surface the returned error verbatim; no substitute analysis (§2.3) |
| One language fails, others succeed | `languageStatus` | Report per-language status; **do not** let overall `completed` mask a failed language |
| Finding path unmappable | `result-normalizer` | Surface in the "Unmapped" section with the raw path; never drop, never guess |
| Repo exceeds `max_scan_bytes` | Pre-flight in `cyclopt_scan` | Refuse with the byte count; suggest narrowing `scope`; **do not** silently truncate |
| Rate-limited (429) | HTTP status | Exponential backoff within `job_timeout_ms`, then report |
| Agent tries to fix | Permission allowlist | Denied at the permission layer — `write`/`edit`/`fix_code` all unreachable |

The through-line: **every degraded path produces an explicitly-labelled degraded report.** Nothing silently downgrades to "looks clean."

---

## 13. Phased Delivery

Four PRs, each independently reviewable, each targeting `dev`, each merged with a **merge commit** (squash is disabled repo-wide).

| Phase | Deliverable | Checklist items | Exit criteria |
|-------|-------------|-----------------|---------------|
| **1 — Transport** | `cyclopt-endpoint.ts`, `cyclopt.ts`, validator, `McpNameSchema`, config schema | 8–13, 19–22 | `cyclopt_*` MCP tools appear in an OpenCode session with the token set; absent and clearly-failed without it |
| **2 — Spike** | Throwaway script confirming JSON-RPC enqueue+poll from a plugin-side `fetch`; multi-file, multi-language job recorded as a fixture | — | Transport choice settled; §1.5 fixture extended to ≥2 languages and ≥1 duplication result |
| **3 — Tool** | `src/tools/cyclopt-scan/` + gating + registration | 14–18 | `cyclopt_scan` returns a §7.1 report for a fixture repo with **correct repo-relative paths**; full suite green |
| **4 — Agent** | `src/agents/cyclopt.ts` + registration + docs | 1–7, 23–24 | `task(subagent_type="cyclopt")` produces a report; Morpheus routes on keyword; Sentinel boundary respected |

**Phase 2 is narrower than originally scoped** because §1.5 and §1.6 already answered the single-file, single-language case from live calls. What remains genuinely unknown is the *multi*-file and *multi*-language shape — specifically how `duplication` reports across files, and whether `results` gains sibling language keys as expected. Both are load-bearing for `result-normalizer.ts`. Half a day here prevents rewriting it twice.

---

## 14. Open Questions

Resolve during Phase 2 or before Phase 4.

1. **Duplication batch semantics — a correctness issue, not a performance one.** Duplication is inherently cross-file. If batching splits a duplicated pair across two jobs, the duplicate is missed entirely. Either duplication runs as a single whole-scope job (reintroducing the byte-ceiling problem) or the report must explicitly caveat that duplication was detected *within batches only*. **This needs a decision before Phase 3.**
2. **Multi-language `results` shape.** Confirmed single-key (`javascript`). Assumed to gain sibling keys for polyglot input — verify, and verify whether a failed language appears in `results` at all or only in `languageStatus`.
3. **Path remapping fidelity.** Violations returned `/probe.js`; metrics returned a full `/tmp/<sandbox>/<sandbox>/probe.js`. Confirm the rule for nested input paths (`src/a/b.ts`) — whether the leading slash is stable and whether directory structure survives.
4. **Rate limits and concurrency.** Unknown. How many jobs may be in flight? Is there a per-minute enqueue cap? This sets whether batches enqueue in parallel or serially, which given §1.6 matters a great deal.
5. **Language coverage per analyzer.** The probe reported `languages: ["javascript"]`. Which languages each analyzer supports determines whether the collector's extension filter should be permissive or restrictive.
6. **`document_reader__convert_to_markdown` double underscore** (§4.4). Independent of this work, but must be resolved before the Cyclopt allowlist is written — the two share a naming assumption.
7. **Token lifetime.** Observed Cyclopt JWTs carry an `iat` but the expiry policy is unclear. If they are short-lived, a static `CYCLOPT_API_TOKEN` env var is the wrong shape and a refresh path is needed.
8. **`timeToFixViolations` units.** Returned `0.0208` for 4 violations — consistent with days (≈30 min). Confirm before surfacing it in the report, or omit it.

---

## 15. Summary

Four layers over one shared credential resolver:

- **Layer 0** `src/mcp/cyclopt-endpoint.ts` — one place where auth can be wrong.
- **Layer 1** MCP registration — gives the *model* eleven `cyclopt_*` tools for targeted calls.
- **Layer 2** `cyclopt_scan` — gives the *plugin* a direct HTTPS path for repo-scale orchestration, because OpenCode offers plugins no way to invoke MCP tools (§2.5, verified against source).
- **Layer 3** the `cyclopt` agent — read-only, fix-free, bound by the server's no-inference contract.
- **Layer 4** pipeline integration — a machine-readable findings block Morpheus converts into remediation tasks for Keymaker/Mouse, closed by a verification re-scan.

The design's centre of gravity is §2. Each of those six constraints is externally imposed — by the MCP's inline-only inputs, its async contract and multi-minute latency, its explicit prohibition on model-side inference, its split input shapes, OpenCode's plugin boundary, and the shape of its own result envelope. The architecture is what falls out of taking all six seriously at once.

The two that will bite hardest if ignored are **§2.5** (a `cyclopt_scan` written to call MCP tools simply cannot work) and **§1.5(4)** (a formatter that passes Cyclopt's paths through unremapped produces a report no downstream agent can act on).

---

## 16. Implementation Notes (as built)

Implemented on branch `dev` (uncommitted). Where the build differs from the plan above:

| # | Plan said | As built | Why |
|---|-----------|----------|-----|
| 1 | Missing token → register a disabled stub and record a startup failure (§12) | Missing token → the MCP and tools are **skipped silently** | Cyclopt is opt-in; a failure on every startup for non-Cyclopt users is noise, and existing tests assert zero failures with 3 MCPs. |
| 2 | Reuse the `tool-gating.ts` walker for file collection (§5.3) | Own bounded walker in `file-collector.ts` | The gating walker is a boolean "does a match exist" search; collection needs the file list, symlink refusal and per-file caps. |
| 3 | Checklist of 24 touchpoints (§9) | 3 more were needed: `agent-overrides.ts`, `agent-display-names.ts`, `runtime-fallback/agent-resolver.ts` | Found by grepping every `sentinel` reference. |
| 4 | Allowlist uses `cyclopt_<tool>` names (§4.4) | Allowlist lists **both** `cyclopt_<tool>` and `cyclopt__<tool>` | Unresolved single- vs double-underscore question. Deny-by-default makes listing both harmless; `fix_code` is in neither. |
| 5 | Phase 2 spike against the live server | **Not run.** `script/cyclopt-smoke.ts` provided instead | Would have required extracting the token from your config files. Run it yourself: `bun run script/cyclopt-smoke.ts`. |
| 6 | Verified result shapes for all analyzers | Verified for `metrics`, `violations`, and an *empty* `sast` only. `sast` findings, `duplication` and `vulnerabilities` use a **best-effort generic extractor**, flagged `bestEffort` in the model | Only one live job was run; those shapes were never observed populated. |
| 7 | Duplication batching decision left open (§14.1) | One whole-scope duplication job when it fits in one request (2 MB); otherwise per-batch **with an explicit caveat in the report** | Splitting a duplicated pair across jobs silently hides it. |

### Still unverified against the live server

1. The Streamable-HTTP handshake (`initialize` → `notifications/initialized` → `tools/call`) from a plugin-side `fetch`. Unit-tested against a fake server only.
2. Populated `sast` / `duplication` / `vulnerabilities` result shapes.
3. Whether the server preserves directory structure in filenames (`src/a/b.ts`) — affects path remapping; ambiguous basenames are reported as unmapped, never guessed.
4. Rate limits and concurrent-job limits (enqueues are sequential to be safe).
