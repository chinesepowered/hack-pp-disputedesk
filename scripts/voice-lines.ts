/**
 * pnpm voice: pre-renders Marlow's in-product voice lines into public/audio/, so the running
 * app never calls ElevenLabs. Safe to re-run: unchanged lines come from the local cache.
 */
import "./_env";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MARLOW_LINES } from "@/lib/client/voice-lines";
import { charactersUsed, speak } from "./lib/tts";

async function main() {
  const dir = path.join(process.cwd(), "public", "audio");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(MARLOW_LINES)) {
    const audio = await speak({ text, voice: "marlow", purpose: `in-product line: ${name}`, stability: 0.6 });
    writeFileSync(path.join(dir, `marlow-${name}.mp3`), audio);
    console.log(`public/audio/marlow-${name}.mp3  (${text.length} characters)  "${text}"`);
  }
  console.log(`\nElevenLabs characters used by this build so far: ${charactersUsed()} of 15000.`);
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
