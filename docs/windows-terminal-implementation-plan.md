# Native Windows terminal implementation plan

Status: proposed; no runtime implementation is included in this plan.

## Outcome and scope

Provide native Windows interactive terminal sessions through a bundled ConPTY backend. Keep the existing tmux implementation on Linux/macOS and WSL as the documented backup. Users must not need a separate terminal application, Node.js installation, Python installation, or compiler toolchain solely for this backend.

Deliver two explicitly separate milestones:

- **M1: interactive sessions**: agents can start a terminal program, send input, read output and screen state, resize, interrupt, and close it on Windows.
- **M2: visual subagent panes**: users can view and interact with multiple `opencode attach` sessions, including titles, focus, splitting, resizing, replacement, and cleanup.

M1 alone is not full replacement of the current tmux features. Sessions surviving a plugin/server restart are a further milestone; initially document process-lifetime sessions and terminate owned children on shutdown.

Existing command translation and unrelated Windows fixes are outside this workstream. Ordinary background commands continue using managed subprocesses; background agent execution remains managed through OpenCode sessions.

## Current integration points

| Area | Existing code | Required change |
|---|---|---|
| Agent interactive tool | `src/tools/interactive-bash/{tools,constants}.ts` | Add structured terminal operations; retain tmux compatibility on Unix |
| Output capture | Interactive tool currently rejects capture operations and directs agents to shell `tmux capture-pane` | Provide backend-neutral output and screen capture |
| Terminal primitives | `src/shared/tmux/tmux-utils/` | Preserve tmux implementation behind capabilities and adapters |
| Visible agent panes | `src/features/tmux-subagent/` | Separate pane layout from terminal session lifecycle |
| Attached agent UI | `pane-spawn.ts`, `pane-replace.ts` | Currently launch `opencode attach <url> --session <id>` inside tmux panes |
| Initialization/shutdown | `src/create-managers.ts` | Own terminal service and dispose resources |
| Session events | `src/plugin/event.ts`, `src/plugin/tool-registry.ts` | Route terminal presentation through selected capabilities |
| Background callbacks | `src/features/background-agent/manager.ts` | Separate tmux-only presentation gates from background execution |
| Configuration | `src/config/schema/tmux.ts` | Preserve existing tmux settings; add independent terminal configuration |
| Agent instructions | `src/agents/oracle/{interview-mode,plan-template}.ts`, architect prompts | Replace Windows instructions requiring literal tmux commands |
| Distribution | `package.json`, `packages/`, build/publish scripts | Include and locate native runtime artifacts |

## Phase 1: compatibility and distribution prototype

Build a disposable prototype before choosing a production dependency or refactoring managers.

1. Test a pinned `node-pty` version directly under the repository-pinned Bun 1.4.0 on Windows x64. Its documented Node/Electron support does not establish Bun compatibility.
2. Spawn Windows PowerShell with profiles disabled; optionally exercise PowerShell 7 when installed. Verify interactive input, Unicode output, resize events, interruption, exit status, and cleanup.
3. Exercise a deterministic terminal fixture that queries dimensions, requests input, updates its screen, and launches a child. Verify it reports a real TTY.
4. Load the prototype from a built local OpenCode plugin, not only a standalone Bun script. Check native module loading and plugin shutdown.
5. Install the packaged prototype on a clean Windows machine without Node, Python, Visual Studio, WSL, or Git Bash. Confirm no implicit source compilation or undeclared binary download.
6. If direct loading fails, prototype a small bundled native ConPTY helper with versioned stdin/stdout IPC. Build it in CI; users run the prebuilt executable. Do not silently add a Node runtime requirement.

Deliverable: a decision record naming backend version, supported Windows builds/architectures, runtime artifact list, licensing, packaging method, and measured startup/cleanup behavior.

Gate: proceed only when real Bun/OpenCode execution and clean-machine installation pass. Windows ARM64 requires its own binaries and execution tests before being advertised as supported.

## Phase 2: terminal contracts and lifecycle

Proposed locations: `src/shared/terminal/` for contracts and adapters; `src/features/terminal-session/` for lifecycle, ownership, and buffering. Keep implementation files within the project's 200-line limit.

Define a typed backend contract:

```typescript
interface TerminalBackend {
  capabilities: TerminalCapabilities
  create(options: TerminalLaunchOptions): Promise<TerminalSession>
  write(id: string, data: string): Promise<void>
  resize(id: string, cols: number, rows: number): Promise<void>
  interrupt(id: string): Promise<void>
  close(id: string): Promise<void>
  dispose(): Promise<void>
}
```

- Launch options carry executable, argument array, absolute working directory, environment, dimensions, and owning OpenCode session/project. Shell interpretation must be explicit.
- Sessions expose stable IDs, data/exit events, and lifecycle states: starting, running, closing, exited, failed. Process exit is distinct from completion of a command entered into a persistent shell.
- Capabilities distinguish interactive input, resize, screen capture, visible panes, and restart persistence. ConPTY must not advertise pane management it does not implement.
- Implement bounded output buffers with monotonic cursors, truncation metadata, and bounded reads. Drain output continuously, including while awaiting exit.
- Provide screen snapshots using a tested VT terminal parser; removing ANSI escape codes is insufficient for full-screen applications. Evaluate a headless terminal parser during dependency selection.
- Serialize writes/resizes per session; handle exit races and duplicate close calls. Isolate sessions by project and owner.
- Verify process-tree cleanup using a Windows Job Object or another proven ownership mechanism. Do not assume killing the shell kills grandchildren.
- For a helper, define protocol handshake, request IDs, bounded frames, errors, and parent-death cleanup. Reserve stdout for protocol traffic and stderr for diagnostics.

Gate: backend contract tests and resource lifecycle tests pass, including helper crash and partial initialization failure.

## Phase 3: agent-facing tools (M1)

Add a factory-based tool under `src/tools/terminal/`, registered through `src/plugin/tool-registry.ts`. Proposed operations: create, list, write, read, snapshot, resize, interrupt, close.

- Use structured arguments instead of translating arbitrary tmux command strings.
- Keep `interactive_bash` compatible on Unix. On Windows, point agents to the new tool; do not claim all tmux subcommands are supported.
- Return the selected backend, terminal ID, state, read cursor, and exit information where applicable.
- Update tool descriptions, agent prompts, permissions, and tool restrictions so Windows agents can capture output without issuing shell `tmux capture-pane` commands.
- Audit existing command-execution guards: a new terminal tool must not bypass applicable execution permissions or project file protections. Input into persistent sessions is command execution too.
- Add runtime capability context so agents choose supported operations. Do not rewrite unrelated shell-tool commands through this backend.

Gate: a real Matrix agent completes an interactive prompt/response task, reads the result, interrupts a long-running child, and closes the session without raw tmux commands or leaked processes.

## Phase 4: configuration, diagnostics, and orchestration

Propose a separate `terminal` configuration with `enabled`, `backend: auto|tmux|conpty`, `max_sessions`, `output_buffer_bytes`, and `idle_timeout_ms`. Final defaults should follow prototype measurements; initially opt in on Windows.

- Preserve `tmux.enabled` and existing layout behavior. Do not reinterpret enabling interactive sessions as enabling visible panes.
- Lazy-load native dependencies only when needed; failed backend loading must not prevent ordinary Matrix startup.
- In auto mode select a supported backend by platform and validated capability, not merely by whether an executable exists. Explicit unavailable selection returns an actionable diagnostic.
- Add doctor checks for backend, artifact version/architecture, executable shell, and unsupported capabilities. Offer an explicit active smoke check rather than spawning a PTY on every startup.
- Integrate cleanup in `create-managers.ts`; ensure closing a visual attachment never cancels its underlying OpenCode agent unless explicitly requested.
- Route presentation callbacks through capabilities; background task admission/completion must continue when terminal UI is disabled or unavailable.
- Regenerate schema artifacts using `bun run build:schema` and document local-build setup and WSL fallback.

Gate: old configurations retain their behavior; disabled/missing terminal support does not break background tasks or plugin initialization.

## Phase 5: visible panes (M2)

Treat this as a frontend integration milestone, not a ConPTY method implementation.

1. OpenCode v1.3.15 source verification confirms no pane-rendering hook in `packages/plugin/src/index.ts` (`PluginModule` declares `tui?: never`). Current Matrix uses external tmux panes. Recheck if targeting a different OpenCode version; a headless `opencode attach` process is not a visible pane.
2. Prototype a supported UI integration if available. Otherwise propose a bundled Matrix terminal viewer, launched explicitly, with tabs/splits and a VT renderer. Record its distribution footprint before implementation.
3. If a browser viewer is chosen, serve bundled assets locally and protect the terminal transport with authentication, origin checks, and project ownership; do not expose unauthenticated terminal control.
4. Connect each pane to an owned ConPTY session running `opencode attach` with separate executable/arguments. Preserve existing OpenCode server authentication handling.
5. Implement titles, focus, split/resize, close, and replacement independently of tmux pane IDs. Reuse layout policy only where it makes sense for the viewer.
6. Test closure of the viewer, attachment, plugin, and OpenCode server independently. Prevent duplicate attachments and orphaned processes.

Gate: users can see and interact with concurrent subagent panes on native Windows without an external terminal installation. If UI integration is unresolved, release only explicitly labelled M1 support; do not mark full tmux parity complete.

## Phase 6: distribution, CI, and rollout

- Ship native artifacts as versioned Windows platform dependencies or existing platform packages; retain dynamic loading and correct paths after bundling.
- Verify package contents, architecture selection, checksums/provenance, licenses, and installation paths containing spaces and Unicode. Include native DLL/helper dependencies explicitly.
- Use CI builds for native compilation. End-user installation must not require a compiler or run an unplanned fallback build.
- Put tests in `tests/**`; add any mock-heavy tests to `script/mock-heavy-list.txt` rather than duplicating isolation lists.
- Add real Windows PTY tests with bounded event-driven waits. Run Linux/macOS tmux regression tests on their actual operating systems, separately from platform mocks.
- Run typecheck, lint, relevant isolated tests, build, and packaged-install smoke tests. Keep Bun pinned consistently with repository policy.
- Release as opt-in, gather diagnostics, then enable auto selection only after clean-machine acceptance. Keep backend disablement and WSL instructions available.
- All implementation PRs target `dev`, use merge commits, and release through existing CI. No local version bump or direct publish.

## Acceptance matrix

| Scenario | Required result |
|---|---|
| Clean Windows install | No extra terminal app, Node, Python, compiler, WSL, or Git Bash required by backend |
| Interactive fixture | TTY detected; input/output, Unicode, resize, screen repaint correct |
| Quoted paths and arguments | Spaces, apostrophes, Unicode, and shell metacharacters retain intended meaning |
| Working directory/environment | Child sees requested cwd and environment without changing plugin-global state |
| Multiple sessions/projects | Independent input/output and ownership; no cross-session access |
| Heavy output | Bounded memory, explicit truncation, no pipe deadlock |
| Interrupt/close/crash | Predictable state and no owned child processes left behind |
| Missing/wrong native artifact | Clear doctor/tool diagnostic; core Matrix still starts |
| Existing Unix configuration | tmux interactions and visual layouts remain functional |
| Background agents without UI | Execution and completion remain independent of presentation |
| Native visual panes | Attach, focus, resize, replacement, and close work; required for M2 |

## Suggested implementation PR sequence

1. Prototype and dependency/distribution decision record (Phase 1).
2. Backend contracts, lifecycle, output parser, and existing tmux adapter (Phase 2).
3. ConPTY implementation and structured terminal tool (Phase 3).
4. Configuration, agent instructions, permissions, diagnostics, and packaging (Phase 4 plus Phase 6 prerequisites); M1 acceptance.
5. Selected Windows pane viewer and presentation integration (Phase 5); M2 acceptance.
6. Clean-machine matrix completion, documentation, and controlled default rollout (Phase 6).

## Technical references

- [Microsoft: creating a pseudoconsole session](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session): process hosting, communication channels, resize, and teardown.
- [Microsoft node-pty](https://github.com/microsoft/node-pty): candidate adapter with ConPTY support and native build requirements; Bun support must be demonstrated.
- [Bun Node-API documentation](https://bun.sh/docs/runtime/node-api): native addon support is not a guarantee that an arbitrary Node addon works unchanged.
- [OpenCode v1.3.15 plugin API](https://github.com/sst/opencode/blob/v1.3.15/packages/plugin/src/index.ts) and [attach command](https://github.com/sst/opencode/blob/v1.3.15/packages/opencode/src/cli/cmd/tui/attach.ts): verified extension boundary and attached TUI behavior.
