// Checks the API key and lists which Gemini models it can use. Usage: npm run smoke
import { GoogleGenAI } from "@google/genai";

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY is empty: fill in .env");
const ai = new GoogleGenAI({ apiKey: key });

const names: string[] = [];
for await (const m of await ai.models.list({ config: { pageSize: 100 } })) names.push(m.name ?? "");
const interesting = names.filter((n) => /argon|gemini-4|3\.8|3\.6|image|veo|live/i.test(n));
console.log(`${names.length} models visible. Relevant:\n  ` + interesting.join("\n  "));

for (const id of [process.env.ARGON_MODEL]) {
  if (!id) continue;
  try {
    const r = await ai.models.generateContent({ model: id, contents: "Reply with the single word: ok" });
    console.log(`${id}: ${r.text?.trim()}`);
  } catch (e: any) {
    console.log(`${id}: FAILED ${String(e.message).slice(0, 160)}`);
  }
}
