// What the AI reads off a job's photos, and how that is checked against the job.
import { z } from "zod";
import { JOB_TYPE_LABELS, type JobType } from "./domain";
import { namesMatch, parseSerial } from "./pricing";

export const PhotoReadSchema = z.object({
  happySheetFound: z.boolean().describe("A signed customer acceptance sheet ('happy sheet') is in the photos."),
  serialOnHappySheet: z.string().nullable().describe("The 'Building Inventory Number' written on the happy sheet, exactly as written, e.g. ULBC-266321-1024-060323."),
  serialOnBuilding: z.string().nullable().describe("A serial number on the building itself: a serial plate or one written on the framing. Null if none is visible."),
  customerName: z.string().nullable().describe("The customer name written on the happy sheet's name line."),
  topLineRaw: z.string().nullable().describe("The handwritten note across the top of the happy sheet, exactly as written, e.g. 'Henagar - Rory - used - 10miles'."),
  topLineLot: z.string().nullable().describe("First part of the top note: the lot the building came from, e.g. Henagar or Moody."),
  topLineJobType: z.enum(["new", "used", "shop_build", "repo", "attempted_repo"]).nullable().describe("Job type written in the top note, if any."),
  topLineMiles: z.number().nullable().describe("Miles written in the top note, if any."),
  sheetDate: z.string().nullable().describe("Date written on the happy sheet, as written."),
  customerSigned: z.boolean().nullable().describe("The customer signature line is signed."),
  driverName: z.string().nullable().describe("Driver name written at the bottom of the happy sheet."),
  repairsOrComments: z.string().nullable().describe("Anything written in the repairs/comments box."),
  unclear: z.string().describe("Short note on anything hard to read or uncertain. Empty string if all clear."),
});
export type PhotoRead = z.infer<typeof PhotoReadSchema>;

export type PhotoReadStatus = "none" | "reading" | "done" | "error" | "unavailable";

export interface PhotoReadState {
  status: PhotoReadStatus;
  result: PhotoRead | null;
  error: string | null;
  readAt: string | null;
}

export const PHOTO_READ_SYSTEM = `You read photos from a shed-hauling company's completed jobs. Drivers photograph:
- the "happy sheet": a Premier Portable Buildings form the customer signs. It has a "Building Inventory Number" (the serial, like ULBC-266321-1024-060323), the customer name line, signature, date, balance due, and the driver's name. Drivers often handwrite a note across the top in the form "LOT - CUSTOMER LAST NAME - TYPE - MILES", e.g. "Henagar - Rory - used - 10miles". TYPE is one of new, used, shop build, repo, attempted repo.
- the serial plate inside the building, or the serial written in pencil on the framing when the plate is missing.
- the building itself.
Copy serial numbers and names exactly as written, character for character. Do not guess: use null when something isn't visible, and say what was hard to read in "unclear". Ignore payment details.`;

const normSerial = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
/**
 * Serials match if they're the same ignoring dashes/spaces, or if all the numbers match: the style letters at the
 * start are what gets cropped out of photos or abbreviated in pencil on the framing (ULBC vs "LB").
 */
export function serialsMatch(a: string, b: string): boolean {
  const x = normSerial(a), y = normSerial(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const dx = x.replace(/\D/g, ""), dy = y.replace(/\D/g, "");
  return dx.length >= 12 && dx === dy;
}

export interface PhotoCheck {
  ok: boolean;
  text: string;
}

/** Compares what the AI read with the job and the driver's answers. */
export function checkPhotoRead(
  read: PhotoRead,
  job: { customerName: string; serial: string; jobType: JobType; miles: number | null },
): PhotoCheck[] {
  const out: PhotoCheck[] = [];
  if (!read.happySheetFound) out.push({ ok: false, text: "No happy sheet found in the photos." });

  const sheetSerial = read.serialOnHappySheet?.trim() || "";
  const buildingSerial = read.serialOnBuilding?.trim() || "";
  if (sheetSerial && job.serial) {
    out.push(serialsMatch(sheetSerial, job.serial)
      ? { ok: true, text: `Happy sheet serial ${sheetSerial} matches the job.` }
      : { ok: false, text: `Happy sheet serial ${sheetSerial} doesn't match the job's ${job.serial}.` });
  }
  if (buildingSerial) {
    const against = sheetSerial || job.serial;
    if (against) {
      out.push(serialsMatch(buildingSerial, against)
        ? { ok: true, text: `Serial on the building (${buildingSerial}) matches ${sheetSerial ? "the happy sheet" : "the job"}.` }
        : { ok: false, text: `Serial on the building reads ${buildingSerial}, which doesn't match ${against}.` });
    }
  } else if (read.happySheetFound) {
    out.push({ ok: false, text: "No serial plate or written serial visible on the building. Checked against the happy sheet only." });
  }
  if (!sheetSerial && !buildingSerial) out.push({ ok: false, text: "Couldn't read a serial number in any photo." });

  if (read.customerName) {
    out.push(namesMatch(read.customerName, job.customerName) || lastNamesMatch(read.customerName, job.customerName)
      ? { ok: true, text: `Happy sheet name “${read.customerName}” matches.` }
      : { ok: false, text: `Happy sheet name reads “${read.customerName}”; job is for “${job.customerName}”.` });
  }
  if (read.customerSigned === false) out.push({ ok: false, text: "Customer signature looks missing." });
  if (read.topLineJobType && read.topLineJobType !== job.jobType) {
    out.push({ ok: false, text: `Top of the sheet says ${JOB_TYPE_LABELS[read.topLineJobType]}, but the job is marked ${JOB_TYPE_LABELS[job.jobType]}.` });
  }
  if (read.topLineMiles !== null && job.miles !== null && Math.abs(read.topLineMiles - job.miles) > 1) {
    out.push({ ok: false, text: `Top of the sheet says ${read.topLineMiles} miles; driver entered ${job.miles}.` });
  }
  if (read.repairsOrComments?.trim()) out.push({ ok: false, text: `Repairs/comments on the sheet: “${read.repairsOrComments.trim()}”` });
  if (read.unclear.trim()) out.push({ ok: false, text: `Hard to read: ${read.unclear.trim()}` });
  return out;
}

function lastNamesMatch(a: string, b: string): boolean {
  const last = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").trim().split(/\s+/).pop() ?? "";
  return !!last(a) && last(a) === last(b);
}

export const isMoodyLot = (lot: string | null | undefined) => !!lot && /\bmood(y|ie)\b/i.test(lot);

/** The serial to price from: the job's, or the happy sheet's if the job has none. */
export function pricingSerial(jobSerial: string, read: PhotoRead | null): { serial: string; fromPhoto: boolean } {
  if (jobSerial.trim()) return { serial: jobSerial, fromPhoto: false };
  const s = read?.serialOnHappySheet || read?.serialOnBuilding || "";
  return { serial: s, fromPhoto: !!s && !!parseSerial(s) };
}
