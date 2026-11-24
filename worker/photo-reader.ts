import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PHOTO_READ_SYSTEM, PhotoReadSchema, isMoodyLot, type PhotoRead } from "../shared/photo-read";
import { newId } from "./auth";
import type { Env } from "./env";

// The user chose Claude Haiku for photo reading (cheapest; about a tenth of a cent per job).
export const PHOTO_MODEL = "claude-haiku-5-5";
export const MAX_READS_PER_JOB = 5;

type ImageType = "image/jpeg" | "image/png" | "image/webp";
const READABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

function toBase64(buf: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function setStatus(db: D1Database, jobId: string, status: string, fields: { result?: string | null; error?: string | null } = {}) {
  await db
    .prepare(
      `UPDATE jobs SET ai_status = ?, ai_error = ?, ai_result = COALESCE(?, ai_result),
       ai_read_at = CASE WHEN ? IN ('done','error','unavailable') THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE ai_read_at END WHERE id = ?`,
    )
    .bind(status, fields.error ?? null, fields.result ?? null, status, jobId)
    .run();
}

/**
 * Reads a job's photos with Claude and saves the result on the job. Never throws: failures are saved
 * as a status the scheduler sees, and the job can still be approved by hand.
 */
export async function readJobPhotos(env: Env, jobId: string, userId: string | null): Promise<void> {
  const db = env.DB;
  try {
    if (!env.ANTHROPIC_API_KEY) {
      await setStatus(db, jobId, "unavailable", { error: "Photo reading isn't set up yet (the Claude API key hasn't been added)." });
      return;
    }
    const job = await db.prepare("SELECT id, job_type, moody, ai_runs FROM jobs WHERE id = ?").bind(jobId).first<{ id: string; job_type: string; moody: number; ai_runs: number }>();
    if (!job) return;
    if (job.ai_runs >= MAX_READS_PER_JOB) {
      await setStatus(db, jobId, "error", { error: `Photos were already read ${MAX_READS_PER_JOB} times for this job.` });
      return;
    }
    const { results: photos } = await db.prepare("SELECT r2_key, content_type FROM job_photos WHERE job_id = ? ORDER BY created_at").bind(jobId).all<{ r2_key: string; content_type: string }>();
    const readable = photos.filter((p) => READABLE.has(p.content_type));
    if (!readable.length) {
      await setStatus(db, jobId, "error", { error: photos.length ? "Photos are in a format Claude can't read (HEIC). Re-upload as JPG." : "No photos to read." });
      return;
    }
    await db.prepare("UPDATE jobs SET ai_status = 'reading', ai_error = NULL, ai_runs = ai_runs + 1 WHERE id = ?").bind(jobId).run();

    const content: Anthropic.ContentBlockParam[] = [];
    for (const [i, p] of readable.entries()) {
      const obj = await env.FILES.get(p.r2_key);
      if (!obj) continue;
      content.push({ type: "text", text: `Photo ${i + 1}:` });
      content.push({ type: "image", source: { type: "base64", media_type: p.content_type as ImageType, data: toBase64(await obj.arrayBuffer()) } });
    }
    content.push({ type: "text", text: "Read these job photos and fill in every field." });

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 90_000 });
    const res = await client.messages.parse({
      model: PHOTO_MODEL,
      max_tokens: 4000,
      system: PHOTO_READ_SYSTEM,
      output_config: { effort: "medium", format: zodOutputFormat(PhotoReadSchema) },
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "refusal") { await setStatus(db, jobId, "error", { error: "Claude declined to read these photos." }); return; }
    const read = res.parsed_output as PhotoRead | null;
    if (!read) { await setStatus(db, jobId, "error", { error: "Claude's answer was incomplete. Try reading again." }); return; }

    await setStatus(db, jobId, "done", { result: JSON.stringify(read) });
    // A New building from the Moody lot pays 10%: tick Moody for the scheduler (they can untick it).
    if (job.job_type === "new" && !job.moody && isMoodyLot(read.topLineLot)) {
      await db.batch([
        db.prepare("UPDATE jobs SET moody = 1 WHERE id = ?").bind(jobId),
        db.prepare("INSERT INTO job_events (id, job_id, user_id, kind, detail) VALUES (?, ?, ?, 'review', ?)").bind(newId(), jobId, userId, `Photo reading: top line says ${read.topLineLot} lot → Moody (10%)`),
      ]);
    }
  } catch (err) {
    console.error("photo read failed", err);
    const msg =
      err instanceof Anthropic.AuthenticationError ? "The Claude API key was rejected. Check it in Cloudflare."
      : err instanceof Anthropic.RateLimitError ? "Claude is busy right now. Try reading again in a minute."
      : err instanceof Anthropic.APIError && err.status === 400 && /credit/i.test(err.message) ? "The Claude account is out of credit."
      : "Photo reading failed. Try again, or check the photos by eye.";
    await setStatus(db, jobId, "error", { error: msg }).catch(() => {});
  }
}
