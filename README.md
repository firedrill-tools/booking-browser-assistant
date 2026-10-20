# Booking browser agent with Gemini and Playwright

A Gemini function-calling assistant searches and reserves synthetic appointments through actual Chromium actions on a local server-rendered portal. Reviews capture the exact service, slot, customer, UTC instant and explicit IANA display timezone. Final confirmation requires a separate application-owned permission and a fresh server-side check of the entire reviewed source.

Simulate this Gemini API AI agent with [Firedrill](https://firedrill.run/), a simulation platform for AI agents. Start with the [Firedrill setup and simulation guide](firedrill/README.md); your coding agent can operate it while this application's runner stays in your repository or CI.

## Run

Requires Node 22.13+ and Playwright Chromium. This private repository has no license pending portfolio publication decisions. Development status and verification are recorded in [PLAN.md](PLAN.md).

```sh
npm ci
npx playwright install chromium
npm run workspace -- init workspaces/demo/state.json --case available-review
export BOOKING_WORKSPACE_FILE=workspaces/demo/state.json
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

Strict bounded source parsing rejects duplicate JSON keys, unknown fields, invalid UTF-8, unsafe counts/revisions, incoherent history and source aliasing. Writes are staged, flushed and atomically replaced after checking the original bytes/inode. A persistent SQLite mutex serializes cooperating processes; uncooperative filesystem writers remain outside an OS boundary. The unchanged original imported reservation has unknown prior review, authorization, model and delivery evidence. Old no-UUID state has no cross-reset guarantee. Private initialization supplies a fresh instance UUID; all new reviews bind it, and imported pending reviews must be rereviewed. Do not overwrite a running workspace to reset it.

## Synthetic populations and private workspaces

`npm run workspace -- list` lists twelve hash-bound cases across starter, busy, ambiguous and boundary profiles. `booking-populations1.0.0` preserves 258104 original bytes, SHA256 `58aaf7c8de2b4ffaa6f4193269df73a150e70b977eb3a070b6eea7972564080b`. The busy calendar contains 51 slots, 65 prior reservations, 16 pending reviews and 144 ordered audit events. Other cases cover sold-out capacity, the Toronto DST fold, cross-date zones, changed availability, duplicates, alternate service duration/location, hostile text, Unicode and maximum revision. Imported history is fictional, with unknown prior model evidence, human authentication and external delivery. Fixture/task/scoring labels stay outside business browser/model context.

```sh
npm run workspace -- inspect workspaces/demo/state.json
npm run workspace -- reset workspaces/demo/state.json workspaces/fresh/state.json
npm run datasets:check
```

Initialization is model-free, exclusive and private (new directories 0700, source and provenance files 0600). Source/metadata/mutex collisions reject. Reset requires a distinct fresh destination, preserves original work/mutex/evidence and changes instance identity. Every managed source read verifies the pinned dataset and separate instance/seed provenance. Corrupt, absent, foreign or stripped authority rejects without repair; current valid business edits remain separate from original seed provenance. Two exclusive files are not a multi-file atomic transaction; partial initialization remains visible and needs a fresh destination. The unchanged original `fixtures/starter.json` remains a legacy unmanaged source.

## Native execution and evidence

The actual pinned Google GenAI 2.30.0 SDK uses an explicit owned HTTP transport, selected model and endpoint. Every original response is recorded before normalized SDK output or browser dispatch. Only one complete `STOP` text answer or one strict browser function is accepted. Unfinished, blocked, replayed, unknown, mixed and parallel output cannot authorize a browser write. Limits: 18 prepared requests, final request without tools, 4096 requested output tokens, zero retries, 30-second native HTTP timeout and a 120-second default cooperative operation deadline (maximum 300 seconds). Request/response and source bounds are explicit; they are not OS memory limits or remote billing cancellation.

A fresh Chromium context has page JavaScript, service workers and downloads disabled. Exact portal origin/business routes only; foreign redirects, APIs, WebSockets and popups are blocked. Tools address exact visible controls; no arbitrary URL, JavaScript, file or API tools are exposed. The application owns SIGINT/SIGTERM/SIGHUP handling, browser startup/partial cleanup, pending SDK work and HTTP pools. It closes the server-side operation before reporting a result. Late writes under a closed scope reject. Failed cleanup remains unconfirmed.

Each run creates a UUID directory under `artifacts/` (0700) containing real viewport PNGs (0600) and an atomic private `trace.json` (0600). The trace retains prepared/partial/failed calls, original response bytes and hashes, unknown fields and IDs, SDK values separately, source before/after, real actions, decision scope and cleanup. Keys and operation credentials are excluded. Screenshot paths, source metadata and fixture/scoring labels are excluded from model observations. Native counters retain zero, invalid and unknown distinctions; totals are not recomputed. Cost is unknown. Terminal text is separate from the observed local review/reservation IDs and exact captured details. A committed booking remains recorded if a later request or evidence write fails; do not blindly retry.

## Verification and limits

`npm run check:package` builds a portable complete source archive with an exact file/size/mode/hash manifest, extracts it outside the checkout and performs fresh locked complete and production-only installs. It runs all 73 checks and deterministic authoring, all twelve private CLI initialization/readback/reset cases, the normal installed symlink CLI with actual native SDK/HTTP/Chromium, missing-key receipt, pending-HTTP SIGTERM drain and a narrow viewport. Original delivered files and repeated portable USTAR/gzip bytes must remain unchanged. Source archive, qualification report and genuine synthetic browser captures are written under ignored `dist/`. These are private source artifacts, not a license or public release.


`npm test` has 73 checks and exercises the actual pinned SDK against owned loopback HTTP and real Chromium/portal actions and captures. It covers exact source/history, independent-process serialization, review-only and confirmation permissions, original native output, limits, stale forms, foreign redirects, usage, CLI signals, cancellation during pending confirmation and partial-effect/recording/cleanup failures. Synthetic responses establish transport and application behavior, not live Gemini decision quality or billing.

No real reservation, payment, notification or customer integration exists. Live model semantics/billing, authenticated Firedrill persistence verification and publication/license remain parked. See [COMPATIBILITY.md](COMPATIBILITY.md) and the [portfolio catalog](https://github.com/firedrill-tools/firedrill-example-catalog).

## Current Firedrill integration

Released CLI/SDK 2.2.2, current command invocation, remote operator MCP and recovery are documented in [firedrill/README.md](firedrill/README.md). Offline checks preserve the actual portal/native key boundary and existing independent permissions. Authenticated persisted runs and live quality/cost remain separate parked gates.
