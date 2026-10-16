import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Store, displayTime } from "../src/state.js";
import { startServer } from "../src/server.js";
import { runAssistant } from "../src/operator.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function setup() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booking-")); const file = path.join(dir, "state.json"); fs.copyFileSync(path.join(root, "fixtures/starter.json"), file); return { dir, file, store: new Store(file) }; }

test("time zone display names the exact instant", () => {
  assert.match(displayTime("2026-11-03T15:00:00Z", "America/Toronto"), /10:00.*EST/);
  assert.match(displayTime("2026-11-03T15:00:00Z", "Europe/London"), /3:00.*GMT/);
});
test("sold-out, invalid timezone, duplicate and unconfirmed review are guarded", () => {
  const { store } = setup();
  assert.equal(store.review("S-102", "mia@acme.example", "America/Toronto", 1).error, "sold_out");
  assert.equal(store.review("S-101", "mia@acme.example", "Mars/Base", 1).error, "invalid_timezone");
  assert.equal(store.review("S-101", "mia@gmail.com", "America/Toronto", 1).error, "synthetic_email_required");
  const reviewed = store.review("S-101", "mia@acme.example", "Europe/London", 1);
  assert.ok(reviewed.intent.token);
  assert.equal(store.read().reservations.length, 1);
  const confirmed = store.confirm(reviewed.intent.token, reviewed.intent.content_sha256);
  assert.equal(confirmed.reservation.id, "R-2");
  assert.equal(store.confirm(reviewed.intent.token, reviewed.intent.content_sha256).error, "already_confirmed");
  assert.equal(store.read().reservations.length, 2);
});
test("availability change between review and confirmation blocks booking", () => {
  const { store } = setup();
  const intent = store.review("S-103", "mia@acme.example", "America/Toronto", 1).intent;
  store.setAvailability("S-103", 0);
  assert.equal(store.confirm(intent.token, intent.content_sha256).error, "availability_changed");
  assert.equal(store.read().reservations.length, 1);
});
test("scripted Gemini function calls drive real booking pages and screenshot proof", async () => {
  const { dir, file, store } = setup();
  const server = await startServer(file, 0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const actions = [
    ["browser_click", { role: "link", name: "Review S-101 →" }],
    ["browser_fill", { label: "Customer email", value: "mia@acme.example" }],
    ["browser_select", { label: "Display timezone", option: "Europe/London" }],
    ["browser_click", { role: "button", name: "Review reservation" }],
    ["browser_click", { role: "button", name: "Confirm booking" }]
  ];
  let round = 0;
  const client = { models: { generateContent: async ({ contents, config }) => {
    assert.equal(config.tools[0].functionDeclarations.length, 4);
    if (round > 0) assert.equal(contents.at(-1).parts[0].functionResponse.name, actions[round - 1][0]);
    const action = actions[round++];
    return action ? { functionCalls: [{ name: action[0], args: action[1], id: `call-${round}` }], candidates: [{ content: { role: "model", parts: [{ functionCall: { name: action[0], args: action[1], id: `call-${round}` } }] } }] }
      : { functionCalls: [], text: "Reservation R-2 confirmed.", usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 }, candidates: [{ content: { role: "model", parts: [{ text: "Reservation R-2 confirmed." }] } }] };
  } } };
  try {
    const search = await fetch(`${baseUrl}/?date=2026-11-03`);
    assert.match(await search.text(), /Review S-101/);
    const { outputDir, result } = await runAssistant("Confirm booking S-101 for Mia", { baseUrl, client, model: "scripted-offline", outputRoot: dir });
    assert.match(result.final_url, /\/reservations\/R-2/);
    assert.match(result.trace.at(-1).text, /R-2/);
    assert.equal(store.read().reservations.length, 2);
    assert.equal(store.read().reservations[1].timezone, "Europe/London");
    assert.equal(fs.readdirSync(outputDir).filter((name) => name.endsWith(".png")).length, 6);
    assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "trace.json"))).response, "Reservation R-2 confirmed.");
    // The confirmation page remains usable at a narrow viewport.
    const { chromium } = await import("playwright");
    const mobileBrowser = await chromium.launch({ headless: true });
    try {
      const mobilePage = await mobileBrowser.newPage({ viewport: { width: 390, height: 844 } });
      await mobilePage.goto(`${baseUrl}/reservations/R-2`);
      assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    } finally { await mobileBrowser.close(); }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
