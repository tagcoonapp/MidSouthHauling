import { CALL_STATUS_LABELS, JOB_TYPE_LABELS, type CallStatus, type JobType } from "../../shared/domain";

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

export function fmtDay(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function fmtDateTime(isoTs: string): string {
  return new Date(isoTs).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function money(cents: number | null): string {
  if (cents === null) return "—";
  if (cents === 0) return "Paid";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export const jobTypeLabel = (t: JobType) => JOB_TYPE_LABELS[t];
export const callLabel = (s: CallStatus) => CALL_STATUS_LABELS[s];

export function mapsUrl(address: string, city: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([address, city].filter(Boolean).join(", "))}`;
}

/**
 * Shrinks a phone photo before upload (max 2000px, JPEG) so uploads are fast on cell data
 * and storage stays inside the free tier. Falls back to the original if the browser can't decode it.
 */
export async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
