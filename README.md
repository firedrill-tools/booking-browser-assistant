# Booking browser assistant

A Gemini function-calling agent operates a local booking portal through real Playwright browser actions. It searches synthetic appointments, checks sold-out times and IANA timezones, reviews a reservation, and confirms only when the task explicitly authorizes that final step. Every browser observation saves a screenshot; the final trace records the real portal state.

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
