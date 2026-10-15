import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

export const zones = ["America/Toronto", "Europe/London", "America/Los_Angeles"];
export function displayTime(instant, zone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(instant));
}

export class Store {
  constructor(file) { this.file = file; this.read(); }
  read() { const state = JSON.parse(fs.readFileSync(this.file, "utf8")); if (state.synthetic !== true || state.version !== 1) throw new Error("only synthetic booking state is supported"); return state; }
  write(state) { const temp = path.join(path.dirname(this.file), `.booking-${crypto.randomUUID()}.tmp`); fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 }); fs.renameSync(temp, this.file); }
  review(slotId, email, zone, expectedRevision) {
    const state = this.read();
    const slot = state.slots.find((item) => item.id === slotId);
    if (!slot) return { error: "slot_not_found" };
    if (slot.revision !== Number(expectedRevision)) return { error: "stale_slot" };
    if (slot.booked >= slot.capacity) return { error: "sold_out" };
    if (!zones.includes(zone)) return { error: "invalid_timezone" };
    email = String(email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.example$/.test(email)) return { error: "synthetic_email_required" };
    if (state.reservations.some((item) => item.slot_id === slotId && item.email === email)) return { error: "already_reserved" };
    const intent = { id: `I-${state.intents.length + 1}`, token: crypto.randomUUID(), slot_id: slotId, slot_revision: slot.revision,
      email, timezone: zone, status: "reviewed" };
    state.intents.push(intent);
    state.audit.push({ action: "review", target: intent.id, outcome: "ready" });
    this.write(state);
    return { intent };
  }
  confirm(token) {
    const state = this.read();
    const intent = state.intents.find((item) => item.token === token);
    if (!intent) return { error: "intent_not_found" };
    if (intent.status !== "reviewed") return { error: "already_confirmed" };
    const slot = state.slots.find((item) => item.id === intent.slot_id);
    let error = slot.revision !== intent.slot_revision ? "availability_changed" : null;
    if (!error && slot.booked >= slot.capacity) error = "sold_out";
    if (!error && state.reservations.some((item) => item.slot_id === intent.slot_id && item.email === intent.email)) error = "already_reserved";
    if (error) { state.audit.push({ action: "confirm", target: intent.id, outcome: error }); this.write(state); return { error }; }
    slot.booked++; slot.revision++;
    intent.status = "confirmed";
    const reservation = { id: `R-${state.reservations.length + 1}`, intent_id: intent.id, slot_id: slot.id,
      starts_at_utc: slot.starts_at_utc, email: intent.email, timezone: intent.timezone };
    state.reservations.push(reservation);
    state.audit.push({ action: "confirm", target: intent.id, outcome: "reserved" });
    this.write(state);
    return { reservation };
  }
  setAvailability(slotId, capacity) {
    const state = this.read();
    const slot = state.slots.find((item) => item.id === slotId);
    if (!slot) return { error: "slot_not_found" };
    if (!Number.isSafeInteger(capacity) || capacity < slot.booked) return { error: "invalid_capacity" };
    slot.capacity = capacity; slot.revision++;
    state.audit.push({ action: "availability", target: slotId, outcome: String(capacity) });
    this.write(state);
    return { slot };
  }
}
