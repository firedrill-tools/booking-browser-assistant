import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";
import { BrowserSession } from "./browser.js";

const declarations = [
  { name: "browser_inspect", description: "Inspect the current local booking portal and save a real screenshot.", parameters: { type: Type.OBJECT, properties: {} } },
  { name: "browser_click", description: "Click a visible link or button by exact name.", parameters: { type: Type.OBJECT, properties: { role: { type: Type.STRING, enum: ["link", "button"] }, name: { type: Type.STRING } }, required: ["role", "name"] } },
  { name: "browser_fill", description: "Fill one field by exact visible label.", parameters: { type: Type.OBJECT, properties: { label: { type: Type.STRING }, value: { type: Type.STRING } }, required: ["label", "value"] } },
  { name: "browser_select", description: "Select a labelled dropdown option by exact visible option text.", parameters: { type: Type.OBJECT, properties: { label: { type: Type.STRING }, option: { type: Type.STRING } }, required: ["label", "option"] } },
];

export async function runAssistant(task, { baseUrl, model, outputRoot = "artifacts", client } = {}) {
  if (!client && !process.env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY required; no model fallback");
  const selectedModel = model || process.env.GEMINI_MODEL;
  if (!selectedModel) throw new Error("GEMINI_MODEL must name an enabled Gemini model");
  const ai = client || new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  const portalUrl = baseUrl || process.env.BOOKING_PORTAL_URL || "http://127.0.0.1:8787";
  const parsed = new URL(portalUrl);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("portal URL must use local HTTP loopback");
  const outputDir = path.resolve(outputRoot, crypto.randomUUID());
  const browser = await BrowserSession.open(portalUrl, outputDir);
  const systemInstruction = "You use only the local Atlas Booking portal through browser tools. Search the exact service and date requested. " +
    "Read times with their IANA timezone and UTC value. Never treat a sold-out slot as available. Enter a synthetic .example email only. " +
    "Review the reservation details and wait for explicit confirmation in the user task before clicking Confirm booking. " +
    "After confirming, inspect the reservation ID. If availability changed or a form fails, stop and report it; never claim success from a review page.";
  try {
    const initial = await browser.observe("initial");
    const contents = [{ role: "user", parts: [{ text: `${task}\n\nInitial browser view:\n${JSON.stringify(initial)}` }] }];
    const config = { systemInstruction, tools: [{ functionDeclarations: declarations }] };
    for (let round = 0; round < 18; round++) {
      const response = await ai.models.generateContent({ model: selectedModel, contents, config });
      const calls = response.functionCalls || [];
      if (!calls.length) {
        const result = { task, model: selectedModel, response: response.text || "", usage: response.usageMetadata || null,
          final_url: browser.page.url(), trace: browser.trace };
        fs.writeFileSync(path.join(outputDir, "trace.json"), `${JSON.stringify(result, null, 2)}\n`);
        return { outputDir, result };
      }
      const modelContent = response.candidates?.[0]?.content;
      if (!modelContent) throw new Error("Gemini function call lacks candidate content");
      contents.push(modelContent);
      const results = [];
      for (const call of calls) {
        const observation = await browser.execute(call.name, call.args || {});
        results.push({ functionResponse: { name: call.name, id: call.id, response: { observation } } });
      }
      contents.push({ role: "user", parts: results });
    }
    throw new Error("model exceeded 18 browser-action rounds");
  } finally { await browser.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const task = process.argv.slice(2).join(" ");
  if (!task) { console.error("Usage: npm run operate -- <task>"); process.exitCode = 2; }
  else runAssistant(task).then(({ outputDir, result }) => console.log(JSON.stringify({ outputDir, response: result.response, final_url: result.final_url, usage: result.usage }, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
