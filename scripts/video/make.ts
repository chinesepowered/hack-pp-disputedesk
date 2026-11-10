/**
 * pnpm video <step>: builds demo/video.mp4, demo/thumb.png and demo/narration.txt.
 *
 *   pnpm video narrate            narration audio (ElevenLabs, cached) and demo/narration.txt
 *   pnpm video cards              title and end cards, and the thumbnail
 *   pnpm video record <scene...>  record app scenes against the running app (see record.ts)
 *   pnpm video compose            cut every scene to its narration and join them
 *   pnpm video status             what is recorded and how long everything is
 *
 * The app scenes are real runs against the PayPal sandbox, recorded with Playwright. Some
 * steps use up a sandbox dispute, so scenes are recorded one at a time and kept under
 * demo/raw/ (git-ignored) until compose.
 */
import "../_env";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { charactersUsed, speak } from "../lib/tts";
import { renderCards } from "./cards";
import { AUDIO, CARDS, CLIPS, duration, ensureDirs, ffmpeg, ROOT, SEGMENTS } from "./lib";
import { SCENES, type Scene } from "./scenes";

const FPS = 30;
const LEAD = 0.35; // silence before the narration starts in each scene

const audioFile = (s: Scene) => path.join(AUDIO, `${s.id}.mp3`);
const clipFile = (s: Scene) => path.join(CLIPS, `${s.id}.webm`);
const cardFile = (s: Scene) => path.join(CARDS, `${s.id}.png`);
const segFile = (s: Scene) => path.join(SEGMENTS, `${s.id}.mp4`);
const sceneSeconds = (s: Scene) => LEAD + duration(audioFile(s)) + (s.tail ?? 0.5);

async function narrate() {
  ensureDirs();
  const lines: string[] = ["Dispute Desk: demo video narration", ""];
  let total = 0;
  for (const s of SCENES) {
    const audio = await speak({ text: s.narration, voice: "narrator", purpose: `video narration ${s.id}` });
    writeFileSync(audioFile(s), audio);
    const secs = duration(audioFile(s));
    total += sceneSeconds(s);
    lines.push(`[${s.id}] ${s.title} (${secs.toFixed(1)} s)`, s.narration, "");
    if (s.marlow) lines.push(`  Marlow (in-product voice line, pre-rendered): see lib/client/voice-lines.ts, "${s.marlow.line}"`, "");
    console.log(`${s.id}  ${secs.toFixed(1)} s  ${s.narration.length} characters`);
  }
  lines.push(`Narrator: ElevenLabs eleven_multilingual_v2, voice nPczCjzI2devNBz1zQrb. Marlow: a second premade voice.`, `No music.`);
  writeFileSync(path.join(ROOT, "demo", "narration.txt"), `${lines.join("\n")}\n`);
  console.log(`\nPlanned length ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}. ElevenLabs characters used so far: ${charactersUsed()} of 15000.`);
}

function status() {
  let total = 0;
  for (const s of SCENES) {
    const hasAudio = existsSync(audioFile(s));
    const secs = hasAudio ? sceneSeconds(s) : 0;
    total += secs;
    const picture = s.kind === "card" ? (existsSync(cardFile(s)) ? "card ok" : "card MISSING") : existsSync(clipFile(s)) ? `clip ${duration(clipFile(s)).toFixed(1)} s` : "clip MISSING";
    console.log(`${s.id.padEnd(12)} needs ${secs.toFixed(1).padStart(5)} s  ${hasAudio ? "audio ok" : "audio MISSING"}  ${picture}`);
  }
  console.log(`Total ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}`);
}

function buildSegment(s: Scene) {
  const secs = sceneSeconds(s);
  const narration = audioFile(s);
  const inputs: string[] = [];
  let videoFilter: string;
  let audioIndex = 1;
  if (s.kind === "card") {
    inputs.push("-loop", "1", "-framerate", String(FPS), "-t", secs.toFixed(3), "-i", cardFile(s));
    // A slow push-in keeps a still card alive.
    videoFilter = `[0:v]scale=2112:1188,zoompan=z='1+0.0006*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS},format=yuv420p[v]`;
  } else {
    if (!existsSync(clipFile(s))) throw new Error(`Scene ${s.id} has not been recorded yet. Run: pnpm video record ${s.id}`);
    // Keep only the ranges the recording marked (page loads and sandbox waits are cut), join
    // them, and if the result is shorter than the narration hold the last frame. A range may
    // name another clip, for a part of the scene that was recorded separately.
    const cutsFile = path.join(ROOT, ".data", "video-cuts.json");
    const cuts: [number, number | null, string?][] = (existsSync(cutsFile) ? JSON.parse(readFileSync(cutsFile, "utf8"))[s.id] : null) ?? [[s.skip ?? 0, null]];
    const files = [...new Set(cuts.map((c) => c[2] ?? s.id))];
    for (const f of files) inputs.push("-i", path.join(CLIPS, `${f}.webm`));
    const parts = cuts.map(([from, to, clip], i) => `[${files.indexOf(clip ?? s.id)}:v]trim=start=${from}${to === null ? "" : `:end=${to}`},setpts=PTS-STARTPTS,fps=${FPS},scale=1920:1080:flags=lanczos[c${i}]`);
    const joined = cuts.length > 1 ? `${cuts.map((_, i) => `[c${i}]`).join("")}concat=n=${cuts.length}:v=1:a=0[cj]` : `[c0]null[cj]`;
    videoFilter = `${parts.join(";")};${joined};[cj]tpad=stop_mode=clone:stop_duration=30,trim=duration=${secs.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[v]`;
    audioIndex = files.length;
  }
  inputs.push("-i", narration);
  let audioFilter = `[${audioIndex}:a]adelay=${Math.round(LEAD * 1000)}:all=1,apad[n]`;
  let mix = "[n]";
  if (s.marlow) {
    inputs.push("-i", path.join(ROOT, "public", "audio", `marlow-${s.marlow.line}.mp3`));
    audioFilter += `;[${audioIndex + 1}:a]adelay=${Math.round(s.marlow.at * 1000)}:all=1,volume=0.5,apad[m];[n][m]amix=inputs=2:duration=longest:normalize=0[mix]`;
    mix = "[mix]";
  }
  audioFilter += `;${mix}atrim=duration=${secs.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`;
  ffmpeg([
    ...inputs,
    "-filter_complex",
    `${videoFilter};${audioFilter}`,
    "-map", "[v]", "-map", "[a]",
    "-t", secs.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    segFile(s),
  ]);
  console.log(`segment ${s.id}: ${duration(segFile(s)).toFixed(1)} s`);
}

function compose() {
  ensureDirs();
  for (const s of SCENES) buildSegment(s);
  const list = path.join(SEGMENTS, "list.txt");
  writeFileSync(list, SCENES.map((s) => `file '${segFile(s)}'`).join("\n"));
  const out = path.join(ROOT, "demo", "video.mp4");
  // Re-encode once on the join so the file is a clean 1920x1080 H.264 stream under 50 MB.
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list,
    "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-maxrate", "2400k", "-bufsize", "4800k", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart",
    out,
  ]);
  const secs = duration(out);
  const mb = statSync(out).size / 1024 / 1024;
  console.log(`\ndemo/video.mp4: ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}, ${mb.toFixed(1)} MB`);
  if (secs >= 180) console.log("WARNING: the video is 3 minutes or longer.");
  if (mb >= 50) console.log("WARNING: the video is 50 MB or larger.");
}

async function main() {
  const [step, ...rest] = process.argv.slice(2);
  if (step === "narrate") await narrate();
  else if (step === "cards") await renderCards();
  else if (step === "status") status();
  else if (step === "compose") compose();
  else if (step === "record") {
    const { recordScenes } = await import("./record");
    await recordScenes(rest);
  } else {
    console.log(readFileSync(new URL(import.meta.url)).toString().split("*/")[0].replace(/^\/\*\*/, "").replace(/^ \* ?/gm, ""));
  }
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
