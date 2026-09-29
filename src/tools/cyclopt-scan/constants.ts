/** Cyclopt server contract: never poll check_analysis_job faster than every 10s. */
export const POLL_FLOOR_MS = 10_000

/** Bytes per enqueued request body (content is inlined into the JSON-RPC call). */
export const MAX_BATCH_BYTES = 2_000_000

/** Client-side retry policy for 429 / 5xx responses. */
export const MAX_HTTP_ATTEMPTS = 3
export const RETRY_BASE_DELAY_MS = 1_000

export const REQUEST_TIMEOUT_MS = 60_000

/** Directory names never descended into. */
export const SKIP_DIRS: readonly string[] = [
  ".git",
  ".matrixx",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  "target",
]

export const WALK_MAX_DEPTH = 12
export const WALK_MAX_ENTRIES = 50_000

/**
 * Secret guard — this tool ships file bytes to a third-party service, so these
 * are excluded unconditionally, regardless of scope or user config.
 */
export const SECRET_BASENAME_PREFIXES: readonly string[] = [".env", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"]
export const SECRET_BASENAMES: readonly string[] = [".npmrc", ".pypirc", ".netrc", "credentials", "credentials.json"]
export const SECRET_EXTENSIONS: readonly string[] = [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".kdbx"]

/** Extensions submitted to the source analyzers. */
export const SOURCE_EXTENSIONS: readonly string[] = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".java", ".kt", ".go", ".rb", ".php", ".cs",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".rs", ".swift", ".scala", ".vue", ".svelte",
]

/** Files routed to analyze_vulnerabilities (and only there). */
export const MANIFEST_BASENAMES: readonly string[] = [
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "requirements.txt", "Pipfile", "Pipfile.lock", "poetry.lock", "pyproject.toml",
  "pom.xml", "build.gradle", "go.mod", "go.sum",
  "Gemfile", "Gemfile.lock", "composer.json", "composer.lock",
  "Cargo.toml", "Cargo.lock",
]

/** Filename fragments that mark generated/minified output. */
export const GENERATED_FRAGMENTS: readonly string[] = [".min.", ".bundle.", ".d.ts"]
