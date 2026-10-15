import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, displayTime, zones } from "./state.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const layout = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | Atlas Booking</title><link rel="stylesheet" href="/assets/style.css"></head><body><header><div class="brand">ATLAS <span>/ BOOKINGS</span></div><span class="header-right">LOCAL SERVICE DESK</span></header><main>${body}</main></body></html>`;
const errorPage = (reason, back) => layout("Booking blocked", `<a class="back" href="${escape(back)}">← Back</a><div role="alert" class="alert"><div class="eyebrow">RESERVATION BLOCKED</div><h1>We could not reserve this time.</h1><p>${escape(reason)}</p></div>`);
const localDate = (instant) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export function createApp(file) {
  const store = new Store(file);
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use("/assets", express.static(path.join(root, "public")));
  app.get("/", (req, res) => {
    const state = store.read();
    const date = String(req.query.date || "");
    const slots = state.slots.filter((slot) => !date || localDate(slot.starts_at_utc) === date);
    const cards = slots.map((slot) => `<article class="slot"><div><span class="slot-id">${escape(slot.id)}</span><h3>${escape(displayTime(slot.starts_at_utc, "America/Toronto"))}</h3><p>${escape(state.service.duration_minutes)} minutes · ${escape(state.service.location)}</p></div><div class="slot-action"><span class="${slot.booked >= slot.capacity ? "sold" : "open"}">${slot.booked >= slot.capacity ? "SOLD OUT" : "AVAILABLE"}</span><a href="/slots/${escape(slot.id)}">Review ${escape(slot.id)} →</a></div></article>`).join("");
    res.send(layout("Search appointments", `<div class="eyebrow">SERVICE / ${escape(state.service.id.toUpperCase())}</div><h1>Book a time that works.</h1><p class="intro">Browse live synthetic availability for ${escape(state.service.name.toLowerCase())}. Review the exact local time before confirming.</p><form class="search" method="get"><label for="date">Date (Toronto)</label><div><input id="date" type="date" name="date" value="${escape(date)}"><button>Search times</button></div></form><div class="section-head"><h2>Available appointments</h2><span>${slots.length} shown</span></div><section class="slots">${cards || '<p class="empty">No appointments on this date.</p>'}</section>`));
  });
  app.get("/slots/:id", (req, res) => {
    const state = store.read(); const slot = state.slots.find((item) => item.id === req.params.id);
    if (!slot) return res.status(404).send(errorPage("slot_not_found", "/"));
    const sold = slot.booked >= slot.capacity;
    const options = zones.map((zone) => `<option value="${escape(zone)}">${escape(zone)}</option>`).join("");
    const form = sold ? '<div role="alert" class="warning">This time is sold out. Choose another appointment.</div>' : `<form method="post" action="/slots/${escape(slot.id)}/review"><input type="hidden" name="revision" value="${slot.revision}"><label for="email">Customer email</label><input id="email" name="email" type="email" required placeholder="name@acme.example"><label for="timezone">Display timezone</label><select id="timezone" name="timezone">${options}</select><button>Review reservation</button></form>`;
    res.send(layout(slot.id, `<a class="back" href="/">← All appointments</a><div class="eyebrow">APPOINTMENT / ${escape(slot.id)}</div><h1>Review this time.</h1><div class="columns"><section class="panel"><div class="panel-head"><h2>${escape(state.service.name)}</h2><span>30 MIN</span></div><dl><div><dt>Toronto</dt><dd>${escape(displayTime(slot.starts_at_utc, "America/Toronto"))}</dd></div><div><dt>UTC</dt><dd>${escape(slot.starts_at_utc)}</dd></div><div><dt>Location</dt><dd>${escape(state.service.location)}</dd></div><div><dt>Availability</dt><dd>${sold ? "Sold out" : "One space available"}</dd></div></dl></section><section class="panel"><div class="panel-head"><h2>Your details</h2><span>STEP 1 / 2</span></div>${form}</section></div>`));
  });
  app.post("/slots/:id/review", (req, res) => {
    const result = store.review(req.params.id, req.body.email, req.body.timezone, req.body.revision);
    if (result.error) return res.status(409).send(errorPage(result.error, `/slots/${encodeURIComponent(req.params.id)}`));
    res.redirect(303, `/review/${encodeURIComponent(result.intent.token)}`);
  });
  app.get("/review/:token", (req, res) => {
    const state = store.read(); const intent = state.intents.find((item) => item.token === req.params.token);
    if (!intent) return res.status(404).send(errorPage("intent_not_found", "/"));
    const slot = state.slots.find((item) => item.id === intent.slot_id);
    res.send(layout("Confirm reservation", `<a class="back" href="/slots/${escape(slot.id)}">← Appointment</a><div class="eyebrow">REVIEW / ${escape(intent.id)}</div><h1>Confirm your reservation.</h1><p class="intro">Nothing is reserved until you confirm. Availability is checked again at the final step.</p><section class="panel confirm"><div class="panel-head"><h2>${escape(state.service.name)}</h2><span>STEP 2 / 2</span></div><dl><div><dt>Slot</dt><dd>${escape(slot.id)}</dd></div><div><dt>Local time</dt><dd>${escape(displayTime(slot.starts_at_utc, intent.timezone))}</dd></div><div><dt>Timezone</dt><dd>${escape(intent.timezone)}</dd></div><div><dt>UTC</dt><dd>${escape(slot.starts_at_utc)}</dd></div><div><dt>Customer</dt><dd>${escape(intent.email)}</dd></div></dl>${intent.status === "confirmed" ? '<div role="status" class="notice">This reservation is already confirmed.</div>' : `<form method="post" action="/confirm/${escape(intent.token)}"><button>Confirm booking</button></form>`}</section>`));
  });
  app.post("/confirm/:token", (req, res) => {
    const result = store.confirm(req.params.token);
    if (result.error) return res.status(409).send(errorPage(result.error, `/review/${encodeURIComponent(req.params.token)}`));
    res.redirect(303, `/reservations/${encodeURIComponent(result.reservation.id)}`);
  });
  app.get("/reservations/:id", (req, res) => {
    const state = store.read(); const reservation = state.reservations.find((item) => item.id === req.params.id);
    if (!reservation) return res.status(404).send(errorPage("reservation_not_found", "/"));
    res.send(layout("Reservation confirmed", `<div class="eyebrow">CONFIRMED / ${escape(reservation.id)}</div><h1>Your time is reserved.</h1><p class="intro">Reservation ${escape(reservation.id)} is saved in the local booking ledger.</p><section class="panel confirm"><div class="panel-head"><h2>Booking details</h2><span>CONFIRMED</span></div><dl><div><dt>Service</dt><dd>${escape(state.service.name)}</dd></div><div><dt>Local time</dt><dd>${escape(displayTime(reservation.starts_at_utc, reservation.timezone))}</dd></div><div><dt>Timezone</dt><dd>${escape(reservation.timezone)}</dd></div><div><dt>Customer</dt><dd>${escape(reservation.email)}</dd></div></dl></section><a class="back bottom" href="/">← All appointments</a>`));
  });
  app.get("/api/state", (_req, res) => res.json(store.read()));
  return app;
}

export function startServer(file, port = 8787) { return new Promise((resolve) => { const server = createApp(file).listen(port, "127.0.0.1", () => resolve(server)); }); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer(path.resolve(process.env.BOOKING_WORKSPACE_FILE || "workspace.json"), Number(process.env.PORT || 8787)).then(() => console.log("Booking portal listening on 127.0.0.1"));
}
