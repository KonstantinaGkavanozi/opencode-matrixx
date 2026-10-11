---
description: Finance-domain non-negotiables (silent failures, error taxonomy, timestamps, symbols, secrets, execution)
globs:
  - "**/price_publisher/**"
  - "**/recorder/**"
  - "**/telegram_bot/**"
  - "**/pipeline/**"
  - "**/ingest*/**"
  - "**/exchange*/**"
---

<!--
Wiring note: `src/hooks/rules-injector` discovers rule files only in the
hardcoded subdirs `.github/instructions`, `.cursor/rules`, and `.matrixx/rules`
(plus `.github/copilot-instructions.md`). `.matrixx/` is gitignored, so this
rule lives under `.github/instructions/` (filename must end in
`.instructions.md`) to be both discoverable AND committed. It is injected only
when the file being read/edited matches one of the finance globs above.
-->

# Finance Domain — Non-Negotiables

1. **No silent failures.** Never `except: pass`, never log-and-return-a-default,
   never `asyncio.gather()` without `return_exceptions=True`. Every failure path
   must be observable: re-raise, return an explicit error, or increment a counter
   and change visible state. Empty is not failure; a gap is a gap.

2. **Explicit error taxonomy.** Classify every external call failure as
   *transient* (retry, bounded, exponential backoff + jitter) or *fatal*
   (do not retry; disable the unit visibly with a recorded reason). Never retry
   a fatal error; never give up permanently on a transient one.

3. **UTC-nanosecond timestamps.** All event/tick timestamps are UTC nanoseconds
   (epoch or ISO-8601 with `Z`); never local time, never second/millisecond
   precision for market data.

4. **Never hardcode exchange ids or symbols.** Use CCXT unified symbols
   (`BTC/USDT:USDT`) and configure the exchange; guard capability calls with
   `exchange.has[...]`. No `binance`/`BTCUSDT` literals in logic.

5. **Exchange API keys never reach the model.** Secrets stay in the runtime
   environment/config; never log, echo, or place them into prompts or context.

6. **No trading/execution commands.** This is a read-only market-data domain:
   never place, cancel, or size orders; never call private trading endpoints.
