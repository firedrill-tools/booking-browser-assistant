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
test("actual pinned Gemini function calls drive real booking pages with explicit confirmation and screenshot proof", async t => {
  const {environment} = await import("./helpers.js");
  const {store,options,requests,trace} = await environment(t);
  const {outputDir,result} = await runAssistant("Confirm booking S-101 for mia@acme.example in Europe/London",options);
  assert.match(result.final_url,/\/reservations\/R-2/);
  assert.equal(store.read().reservations.length,2);assert.equal(store.read().reservations[1].timezone,"Europe/London");
  assert.equal(fs.readdirSync(outputDir).filter(n=>n.endsWith('.png')).length,6);assert.equal(requests.length,6);
  const receipt=trace();assert.equal(receipt.status,'completed');assert.ok(receipt.cleanupConfirmed);assert.equal(receipt.calls[0].response.body.unknown_original.retained,true);assert.equal(receipt.reportedUsage.input.value,60);assert.equal(receipt.reportedUsage.costUsd,null);assert.equal(result.business.reservationIds[0],'R-2');assert.ok(!JSON.stringify(receipt).includes('synthetic-booking-key'));
  const {chromium}=await import('playwright');const mobile=await chromium.launch({headless:true});try{const page=await mobile.newPage({viewport:{width:390,height:844}});await page.goto(options.portalUrl+'/reservations/R-2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}finally{await mobile.close();}
});
