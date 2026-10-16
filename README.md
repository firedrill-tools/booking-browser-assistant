# Booking browser assistant

A Gemini function-calling agent operates a local booking portal through real Playwright browser actions. It searches synthetic appointments, checks sold-out times and IANA timezones, reviews a reservation, and can submit a final confirmation. Application-enforced confirmation permission is active development in PLAN.md; the baseline relies on a prompt instruction. Every browser observation saves a screenshot; the final trace records the real portal state.

## Run locally

Requires Node 22+, npm and Playwright Chromium.

```sh
npm ci
npx playwright install chromium
cp fixtures/starter.json workspace.json
npm run portal
```

In another terminal, set `GOOGLE_API_KEY` and an enabled `GEMINI_MODEL` from your account, then:

```sh
npm run operate -- "Find slot S-101 for mia@acme.example, display Europe/London time, review it, and confirm the booking"
```

The operator uses the Gemini SDK's function-calling protocol to invoke `browser_inspect`, `browser_click`, `browser_fill`, and `browser_select`. Tool results contain live page observations and paths to screenshots under `artifacts/<run-id>/`. The browser is restricted to a local HTTP loopback portal. Missing credentials or model selection fail explicitly; no simulated model is substituted.

## Booking controls

The seed offers one available Toronto appointment, one sold-out time, and another available time. All slots store UTC instants. The portal displays Toronto time plus the visitor's selected IANA timezone and UTC on the review page. Reviewing creates an intent but does not reserve capacity. The final confirmation rechecks the slot revision and capacity and writes one local reservation. A repeat confirmation cannot create a second booking. Changing availability between review and confirmation blocks the reservation.

Only `.example` customer addresses are accepted. No real service, payment or notification integration exists. Reset by copying the starter fixture over `workspace.json`. This JSON store is designed for one local process, not concurrent production booking.

`npm test` covers timezone display, sold-out and invalid inputs, changed availability, duplicate confirmation, and a scripted Gemini tool sequence against a real browser and portal. The scripted model verifies tool wiring, not Gemini's live decision quality. Live Gemini proof and the new Firedrill integration remain pending. This private repository has no license pending portfolio publication decisions.

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.


## Development audit active

The baseline at618f0d30bda08baec126a9e34a6a6e5dfe81f620 passes its original4 checks, but the current audit reproduced changed saved intent email/timezone and same-revision moved slot UTC time committing different booking details; a boolean review revision is coerced and accepted. Actual pinned Gemini2.30.0 over controlled loopback HTTP and real Chromium also accepted MAX_TOKENS Confirm booking output and created a local reservation even when the task said review only. This establishes concrete source/permission/native-completion defects; it is not live model quality evidence.

PLAN.md defines strict source/review binding and current final checks, explicit app-owned confirmation scope, owned original native HTTP/usage/lifecycle and browser boundaries, rich source populations/private CLI and fresh locked distribution tasks. These fixes are pending; the existing original tests do not establish those controls. All external live credentials/semantic+billing/Firedrill/real connector/license work stays parked, with development continuing independently. No paid model or external booking was used in the audit.
