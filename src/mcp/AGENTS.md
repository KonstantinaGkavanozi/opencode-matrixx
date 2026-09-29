# MCP KNOWLEDGE BASE

## OVERVIEW

Tier 1 of two-tier MCP system: 3 always-on built-in MCPs (2 remote HTTP + 1 local stdio) plus the opt-in `cyclopt` remote MCP (registered only when a token is configured).

**Two-Tier System**:
1. **Built-in** (this directory): websearch, context7, document_reader
2. **Plugin-config / user-configured**: MCPs defined in plugin configuration

## STRUCTURE
```
mcp/
├── index.ts           # createBuiltinMcps() factory
├── index.test.ts      # Tests
├── websearch.ts       # Exa AI / Tavily web search
├── context7.ts        # Library documentation
├── document-reader.ts # Microsoft MarkItDown (PDF, DOCX, XLSX, PPTX, images)
├── cyclopt.ts         # Cyclopt analysis platform (opt-in, bearer token from env)
├── cyclopt-endpoint.ts # Shared base URL + token resolver (MCP AND cyclopt_scan tool)
└── types.ts           # McpNameSchema
```

## MCP SERVERS

| Name | Transport | Auth | Purpose |
|------|-----------|------|---------|
| websearch | remote HTTP | EXA_API_KEY (optional) / TAVILY_API_KEY (required) | Real-time web search |
| context7 | remote HTTP | CONTEXT7_API_KEY (optional) | Library docs lookup |
| document_reader | local stdio (`uvx`) | None | Read PDF/DOCX/XLSX/PPTX/images → Markdown |
| cyclopt | remote HTTP | `cyclopt.api_token` (user-level config) or `CYCLOPT_API_TOKEN` env (required; skipped silently when neither is set) | Cyclopt analysis: 11 tools, async jobs. Only the analysis tools are granted to the `cyclopt` agent; `fix_code` is not |

### document_reader Tool

**Tool name**: `document_reader__convert_to_markdown`
**Input**: `uri: string` — must be a `file:`, `https:`, `http:`, or `data:` URI
**Output**: Markdown string of document content
**Skill**: Load `document-reader` skill for usage instructions

```
file:///absolute/path/to/file.pdf     # local file (MUST be absolute)
https://example.com/report.pdf        # remote file
```

## CONFIG PATTERNS

```typescript
// Remote MCP
export const mcp_name = {
  type: "remote" as const,
  url: "https://...",
  enabled: true,
  oauth: false as const,
  headers?: { ... },
}

// Local stdio MCP
export const mcp_name = {
  type: "local" as const,
  command: ["uvx", "--from", "package-name", "command"],
  enabled: true,
}
```

## HOW TO ADD

1. Create `src/mcp/my-mcp.ts` with config object
2. Add conditional check in `createBuiltinMcps()` in `index.ts`
3. Add name to `McpNameSchema` in `types.ts`

## NOTES

- **Disable**: Set `disabled_mcps: ["name"]` in config
- **Exa**: Default websearch provider, works without API key
- **Tavily**: Requires `TAVILY_API_KEY` env var
- **document_reader**: Requires `uvx` (uv) installed on the system

## LAZY INITIALIZATION (v2.0.0+)

The `websearch` MCP uses deferred config construction (P1 optimization). `createWebsearchConfig(config?.websearch)` is wrapped in an `Object.defineProperty` getter on the returned `mcps` record (see `index.ts` ~line 28-40). Env vars (`EXA_API_KEY`, `TAVILY_API_KEY`) and provider selection only resolve when the consumer first reads `mcps.websearch`.

The other two MCPs (context7, document_reader) are static configs assigned eagerly.

