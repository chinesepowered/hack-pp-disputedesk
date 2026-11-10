/**
 * ElevenLabs text to speech for the video narration and Marlow's in-product lines.
 *
 * Every request is cached by voice and text under demo/raw/tts-cache/ (git-ignored), so a
 * re-run costs nothing, and every new request is added to demo/elevenlabs-usage.json so the
 * character budget for this build (15,000) is tracked in the repo.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const VOICES = {
  /** The narrator: Jessica, a young female premade voice (the owner's choice, replacing the brief's first id). */
  narrator: "cgSgspJ2msm6clMCkdW9",
  /** Marlow: a calm, older premade voice. */
  marlow: "pqHfZKP75CvOlQylNhV4",
} as const;

const MODEL = "eleven_multilingual_v2";
const BUDGET = 15_000;
const CACHE = path.join(process.cwd(), "demo", "raw", "tts-cache");
const LEDGER = path.join(process.cwd(), "demo", "elevenlabs-usage.json");

type Ledger = { budget: number; used: number; requests: { at: string; voice: string; voiceId?: string; characters: number; purpose: string }[] };

function ledger(): Ledger {
  if (!existsSync(LEDGER)) return { budget: BUDGET, used: 0, requests: [] };
  return JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;
}

export function charactersUsed(): number {
  return ledger().used;
}

export async function speak(opts: { text: string; voice: keyof typeof VOICES; purpose: string; stability?: number }): Promise<Buffer> {
  const text = opts.text.trim();
  if (/[\u2014\u2013]/.test(text)) throw new Error("Narration must not contain em or en dashes.");
  const key = createHash("sha256").update(`${MODEL}|${VOICES[opts.voice]}|${opts.stability ?? 0.5}|${text}`).digest("hex").slice(0, 24);
  const cached = path.join(CACHE, `${key}.mp3`);
  if (existsSync(cached)) return readFileSync(cached);

  const book = ledger();
  if (book.used + text.length > BUDGET) throw new Error(`ElevenLabs budget exceeded: ${book.used} used, ${text.length} requested, ${BUDGET} allowed.`);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set.");

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[opts.voice]}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability: opts.stability ?? 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const audio = Buffer.from(await res.arrayBuffer());
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cached, audio);

  book.used += text.length;
  book.requests.push({ at: new Date().toISOString(), voice: opts.voice, voiceId: VOICES[opts.voice], characters: text.length, purpose: opts.purpose });
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, `${JSON.stringify(book, null, 2)}\n`);
  return audio;
}
