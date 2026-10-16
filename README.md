# Booking browser assistant

A Gemini function-calling assistant searches and reserves synthetic appointments through actual Chromium actions on a local server-rendered portal. Reviews capture the exact service, slot, customer, UTC instant and explicit IANA display timezone. Final confirmation requires a separate application-owned permission and a fresh server-side check of the entire reviewed source.

## Run

Requires Node 22.13+ and Playwright Chromium. This private development checkpoint has no license; rich datasets, private initialization and fresh distribution are still in progress in [PLAN.md](PLAN.md).

```sh
npm ci
npx playwright install chromium
cp fixtures/starter.json workspace.json
npm run portal
```

Set `GOOGLE_API_KEY` and your enabled `GEMINI_MODEL` in another terminal. The default operation is review only:

```sh
npm run operate -- "Review S-101 for mia@acme.example in Europe/London"
npm run operate -- --allow-confirm "Review S-101 for mia@acme.example in Europe/London and confirm the exact details"
```

`--allow-confirm` supplies structured caller permission. Prompt text or model tool arguments cannot grant it. CLI options include `--model`, `--base-url` (Gemini origin), `--portal-url` (loopback portal), `--output` and `--timeout-ms`. The callable `runAssistant(task, options)` uses `providerBaseUrl` for Gemini and `portalUrl` for the portal; the old callable `baseUrl` remains a portal alias. Injected SDK clients are unsupported. Missing keys/model fail with a prepared private receipt; no model fallback exists.

## Source and confirmation

Only synthetic `.example` contacts are accepted. The final server commit binds the reviewed payload/hash, current service and complete slot, operation ownership and explicit permission. Review reserves no capacity. Stale details, altered recipients/zones, duplicates, exhausted revisions and wrong/closed operations cannot commit. A separate synthetic human form may explicitly approve an operator's review-only proposal. These local permission markers are not real authentication. UTC instants and the selected IANA timezone remain in the reservation; the portal shows actual service duration and capacity.

Strict bounded source parsing rejects duplicate JSON keys, unknown fields, invalid UTF-8, unsafe counts/revisions, incoherent history and source aliasing. Writes are staged, flushed and atomically replaced after checking the original bytes/inode. A persistent SQLite mutex serializes cooperating processes; uncooperative filesystem writers remain outside an OS boundary. The unchanged original imported reservation has unknown prior review, authorization, model and delivery evidence. Old no-UUID state has no cross-reset guarantee. Do not overwrite a running workspace to reset it.

## Native execution and evidence

The actual pinned Google GenAI 2.30.0 SDK uses an explicit owned HTTP transport, selected model and endpoint. Every original response is recorded before normalized SDK output or browser dispatch. Only one complete `STOP` text answer or one strict browser function is accepted. Unfinished, blocked, replayed, unknown, mixed and parallel output cannot authorize a browser write. Limits: 18 prepared requests, final request without tools, 4096 requested output tokens, zero retries, 30-second native HTTP timeout and a 120-second default cooperative operation deadline (maximum 300 seconds). Request/response and source bounds are explicit; they are not OS memory limits or remote billing cancellation.

A fresh Chromium context has page JavaScript, service workers and downloads disabled. Exact portal origin/business routes only; foreign redirects, APIs, WebSockets and popups are blocked. Tools address exact visible controls; no arbitrary URL, JavaScript, file or API tools are exposed. The application owns SIGINT/SIGTERM/SIGHUP handling, browser startup/partial cleanup, pending SDK work and HTTP pools. It closes the server-side operation before reporting a result. Late writes under a closed scope reject. Failed cleanup remains unconfirmed.

Each run creates a UUID directory under `artifacts/` (0700) containing real viewport PNGs (0600) and an atomic private `trace.json` (0600). The trace retains prepared/partial/failed calls, original response bytes and hashes, unknown fields and IDs, SDK values separately, source before/after, real actions, decision scope and cleanup. Keys and operation credentials are excluded. Screenshot paths, source metadata and fixture/scoring labels are excluded from model observations. Native counters retain zero, invalid and unknown distinctions; totals are not recomputed. Cost is unknown. Terminal text is separate from the observed local review/reservation IDs and exact captured details. A committed booking remains recorded if a later request or evidence write fails; do not blindly retry.

## Verification and limits

`npm test` exercises the actual pinned SDK against owned loopback HTTP and real Chromium/portal actions and captures. It covers exact source/history, independent-process serialization, review-only and confirmation permissions, original native output, limits, stale forms, foreign redirects, usage, CLI signals, cancellation during pending confirmation and partial-effect/recording/cleanup failures. Synthetic responses establish transport and application behavior, not live Gemini decision quality or billing.

No real reservation, payment, notification or customer integration exists. Live model semantics/billing, qualified new Firedrill persisted scenarios and publication/license remain parked. See [COMPATIBILITY.md](COMPATIBILITY.md) and the [portfolio catalog](https://github.com/firedrill-tools/firedrill-example-catalog).
