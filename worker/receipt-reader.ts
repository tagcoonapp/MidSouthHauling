import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { RECEIPT_READ_SYSTEM, ReceiptReadSchema, type ReceiptRead } from "../shared/receipt-read";
import { PHOTO_MODEL } from "./photo-reader";
import type { Env } from "./env";

const READABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

function toBase64(buf: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function setStatus(db: D1Database, id: string, status: string, error: string | null = null) {
  await db.prepare("UPDATE fuel_receipts SET ai_status = ?, ai_error = ? WHERE id = ?").bind(status, error, id).run();
}

/**
 * Reads a fuel receipt photo with Claude Haiku. Fills in the amount, gallons and station when they were left blank.
 * Never throws; failures are saved as a status the office sees.
 */
export async function readReceipt(env: Env, id: string): Promise<void> {
  const db = env.DB;
  try {
    if (!env.ANTHROPIC_API_KEY) { await setStatus(db, id, "unavailable", "Receipt reading isn't set up (no Claude API key)."); return; }
    const r = await db.prepare("SELECT photo_key, content_type FROM fuel_receipts WHERE id = ?").bind(id).first<{ photo_key: string | null; content_type: string | null }>();
    if (!r?.photo_key) { await setStatus(db, id, "error", "No photo."); return; }
    if (!READABLE.has(r.content_type ?? "")) { await setStatus(db, id, "error", "Photo format can't be read (HEIC). Re-upload as JPG."); return; }
    const obj = await env.FILES.get(r.photo_key);
    if (!obj) { await setStatus(db, id, "error", "Photo missing."); return; }
    await setStatus(db, id, "reading");
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
    const res = await client.messages.parse({
      model: PHOTO_MODEL,
      max_tokens: 1500,
      system: RECEIPT_READ_SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(ReceiptReadSchema) },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: r.content_type as "image/jpeg", data: toBase64(await obj.arrayBuffer()) } },
          { type: "text", text: "Read this fuel receipt." },
        ],
      }],
    });
    const read = res.parsed_output as ReceiptRead | null;
    if (res.stop_reason === "refusal" || !read) { await setStatus(db, id, "error", "Couldn't read this receipt. Check it by eye."); return; }
    const cents = read.totalDollars !== null ? Math.round(read.totalDollars * 100) : null;
    await db
      .prepare(
        `UPDATE fuel_receipts SET ai_status = 'done', ai_error = NULL, ai_result = ?,
           amount_cents = COALESCE(amount_cents, ?),
           gallons = COALESCE(gallons, ?),
           station = CASE WHEN station = '' THEN ? ELSE station END
         WHERE id = ?`,
      )
      .bind(JSON.stringify(read), cents, read.gallons, read.station ?? "", id)
      .run();
  } catch (err) {
    console.error("receipt read failed", err);
    const msg =
      err instanceof Anthropic.AuthenticationError ? "The Claude API key was rejected."
      : err instanceof Anthropic.RateLimitError ? "Claude is busy. Try again in a minute."
      : "Receipt reading failed. Check it by eye.";
    await setStatus(db, id, "error", msg).catch(() => {});
  }
}
