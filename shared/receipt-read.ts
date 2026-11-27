// What the AI reads off a fuel receipt, and how that is checked against what the driver typed.
import { z } from "zod";

export const ReceiptReadSchema = z.object({
  isFuelReceipt: z.boolean().describe("The photo shows a fuel/gas station receipt or pump display."),
  totalDollars: z.number().nullable().describe("The total charged, in dollars, e.g. 187.42. Null if unreadable."),
  gallons: z.number().nullable().describe("Gallons pumped, e.g. 48.213. Null if not shown."),
  pricePerGallon: z.number().nullable().describe("Price per gallon in dollars, e.g. 3.889. Null if not shown."),
  fuelType: z.string().nullable().describe("Fuel grade, e.g. Diesel, Unleaded. Null if not shown."),
  station: z.string().nullable().describe("Station name and town if shown, e.g. 'Love's #412 Florence AL'."),
  date: z.string().nullable().describe("Receipt date as YYYY-MM-DD. Null if unreadable."),
  unclear: z.string().describe("Short note on anything hard to read. Empty string if all clear."),
});
export type ReceiptRead = z.infer<typeof ReceiptReadSchema>;

export const RECEIPT_READ_SYSTEM = `You read fuel receipts photographed by truck drivers for a building-hauling company.
Read only what is printed on the receipt or pump. Never guess a number: use null when it isn't legible.
The total is the final amount charged (after any discount), not the subtotal.`;

/** Mismatches between what the driver typed and what the photo says. Office only. */
export function receiptChecks(
  r: { amountCents: number | null; gallons: number | null; date: string },
  read: ReceiptRead | null,
): string[] {
  const out: string[] = [];
  if (r.amountCents === null) out.push("No amount yet");
  if (r.gallons === null) out.push("No gallons entered");
  if (!read) return out;
  if (!read.isFuelReceipt) out.push("Photo doesn't look like a fuel receipt");
  if (read.totalDollars !== null && r.amountCents !== null && Math.abs(Math.round(read.totalDollars * 100) - r.amountCents) > 100)
    out.push(`Receipt total says $${read.totalDollars.toFixed(2)}`);
  if (read.gallons !== null && r.gallons !== null && Math.abs(read.gallons - r.gallons) > 0.5)
    out.push(`Receipt says ${read.gallons} gal, driver typed ${r.gallons}`);
  if (read.date && /^\d{4}-\d{2}-\d{2}$/.test(read.date) && read.date !== r.date) {
    const days = Math.abs(Date.parse(read.date) - Date.parse(r.date)) / 86_400_000;
    if (days > 2) out.push(`Receipt dated ${read.date}`);
  }
  return out;
}
