import { GoogleGenAI } from "@google/genai";

const key = process.env.GEMINI_API_KEY;
console.log("key exists:", !!key, "prefix:", key?.slice(0, 8));

const client = new GoogleGenAI({ apiKey: key! });
try {
  const r = await client.models.generateContent({
    model: "gemini-2.0-flash",
    contents: "Say hello in one word",
  });
  console.log("response:", r.text);
} catch (e: any) {
  console.error("error:", e.message);
}
