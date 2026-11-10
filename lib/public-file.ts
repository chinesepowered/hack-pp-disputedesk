/**
 * Read a file from public/ on the server (the seeded photos the vision model and the evidence
 * pack use).
 *
 * Locally and in a normal Node server the file is on disk. On a serverless host, public/ is
 * served from the CDN and is only on the function's disk if it was traced in (next.config.ts
 * asks for that). If it is not there, the file is fetched from this deployment's own URL.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export async function readPublicFile(file: string): Promise<Buffer | null> {
  const relative = file.replace(/^\/+/, "");
  if (relative.includes("..")) return null;
  try {
    return await fs.readFile(path.join(process.cwd(), "public", relative));
  } catch {
    // Not on this machine's disk: try the deployment's own static files.
  }
  const host = process.env.VERCEL_URL?.trim();
  if (!host) return null;
  try {
    const res = await fetch(`https://${host}/${relative}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
