/**
 * Terminal Viewer Frontend
 *
 * Renders native terminal sessions via the TerminalViewer HTTP API.
 * Uses xterm.js + @xterm/addon-fit for rendering.
 * Token is read from window.location.hash (#<token>).
 */

import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"

function readToken(): string | null {
  const hash = window.location.hash.slice(1)
  return hash.length >= 36 ? hash : null
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const token = readToken()
  if (!token) throw new Error("No auth token")

  const init: RequestInit = {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }
  if (body != null) init.body = JSON.stringify(body)

  const res = await fetch(path, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

interface Session {
  id: string
  title: string
  cols: number
  rows: number
  data: string
  cursor: number
  truncated: boolean
}

interface SessionListEntry {
  id: string
  title: string
  cols: number
  rows: number
  state: string
  backend: string
}

function createPane(sessionId: string, title: string): HTMLElement {
  const pane = document.createElement("div")
  pane.className = "pane"
  pane.dataset.sessionId = sessionId

  const bar = document.createElement("div")
  bar.className = "bar"

  const titleEl = document.createElement("span")
  titleEl.className = "title"
  titleEl.textContent = title

  const closeBtn = document.createElement("button")
  closeBtn.textContent = "✕"
  closeBtn.title = "Close terminal"
  closeBtn.addEventListener("click", () => {
    removePane(pane)
  })

  bar.appendChild(titleEl)
  bar.appendChild(closeBtn)
  pane.appendChild(bar)

  const screen = document.createElement("div")
  screen.className = "screen"
  pane.appendChild(screen)

  return pane
}

const panes = document.getElementById("panes") as HTMLElement
const activeTerminals = new Map<string, { term: Terminal; fit: FitAddon; pollTimer: ReturnType<typeof setInterval> | null }>()

function removePane(pane: HTMLElement): void {
  const id = pane.dataset.sessionId
  if (id) {
    const entry = activeTerminals.get(id)
    if (entry) {
      clearInterval(entry.pollTimer ?? undefined)
      entry.term.dispose()
      activeTerminals.delete(id)
    }
    api("/api/close", { id }).catch(() => {})
  }
  pane.remove()
}

async function startPolling(session: SessionListEntry): Promise<void> {
  const pane = createPane(session.id, session.title)
  panes.appendChild(pane)

  const screen = pane.querySelector(".screen") as HTMLElement
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
    fontSize: 14,
    lineHeight: 1.3,
    theme: {
      background: "#10151c",
      foreground: "#e8eef5",
      cursor: "#6dd8ad",
      selectionBackground: "#2a4a6b99",
      black: "#10151c",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#e8eef5",
      brightBlack: "#50627b",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
  })

  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(screen)

  fit.fit()

  const ro = new ResizeObserver(() => {
    fit.fit()
    api("/api/resize", { id: session.id, cols: term.cols, rows: term.rows }).catch(() => {})
  })
  ro.observe(screen)

  let cursor = 0
  const poll = setInterval(async () => {
    try {
      const data = await api<Session>("/api/read", { id: session.id, cursor })
      if (data.data.length > 0) {
        term.write(data.data)
        cursor = data.cursor
      }
    } catch {
      // Silently ignore transient errors
    }
  }, 500)

  term.onData((data) => {
    api("/api/write", { id: session.id, data }).catch(() => {})
  })

  term.onBinary?.((data) => {
    api("/api/write", { id: session.id, data }).catch(() => {})
  })

  activeTerminals.set(session.id, { term, fit, pollTimer: poll })
  updateStatus()
}

function updateStatus(): void {
  const statusEl = document.getElementById("status")
  if (!statusEl) return
  const count = activeTerminals.size
  statusEl.textContent = count === 0
    ? "No terminals"
    : count === 1
      ? "1 terminal"
      : `${count} terminals`
}

// "New shell" button
const newBtn = document.getElementById("new") as HTMLButtonElement | null
newBtn?.addEventListener("click", async () => {
  try {
    const session = await api<SessionListEntry>("/api/create")
    await startPolling(session)
  } catch (err) {
    const statusEl = document.getElementById("status")
    if (statusEl) statusEl.textContent = `Error: ${err instanceof Error ? err.message : "unknown"}`
  }
})

// Layout selector
const layoutSelect = document.getElementById("layout") as HTMLSelectElement | null
layoutSelect?.addEventListener("change", () => {
  if (panes) panes.dataset.layout = layoutSelect.value
})

// Load existing sessions on page load
async function init(): Promise<void> {
  try {
    const sessions = await api<SessionListEntry[]>("/api/list")
    if (sessions.length === 0) {
      // No sessions — show status and wait for user to click "New shell"
      updateStatus()
      return
    }
    for (const session of sessions) {
      await startPolling(session)
    }
  } catch {
    // Viewer may be behind auth; user must create a new session
    updateStatus()
  }
}

init()
