// Expense rules. Pure functions so they can be unit-tested and shown to the scheduler line by line.
import type { JobType } from "./domain";

export interface SerialInfo {
  style: string;
  width: number;
  length: number;
}

/**
 * Serial pattern: one prefix letter, the style letters, then groups. The third group is width+length.
 * UCC-34543-1232-090356 -> style CC, 12x32. (3-digit size groups like 812 mean 8x12.)
 */
export function parseSerial(serial: string): SerialInfo | null {
  const m = serial.trim().toUpperCase().replace(/\s+/g, "").match(/^[A-Z]([A-Z]+)-\d+-(\d{3,4})-\d+$/);
  if (!m) return null;
  const size = m[2]!;
  const width = Number(size.length === 4 ? size.slice(0, 2) : size.slice(0, 1));
  const length = Number(size.length === 4 ? size.slice(2) : size.slice(1));
  if (!width || !length) return null;
  return { style: m[1]!, width, length };
}

export const sizeLabel = (s: { style: string; width: number; length: number }) => `${s.style} ${s.width}x${s.length}`;

export interface PriceRow {
  style: string;
  width: number;
  length: number;
  priceCents: number;
}

/** Repo pay by miles: the first tier whose upToMiles covers the trip. upToMiles null = "and up". */
export interface RepoRate {
  upToMiles: number | null;
  amountCents: number;
}

export interface PricingSettings {
  fuelChargeOn: boolean;
  fuelChargeCents: number;
  attemptedRepoCents: number;
}

export const DEFAULT_SETTINGS: PricingSettings = { fuelChargeOn: true, fuelChargeCents: 5000, attemptedRepoCents: 5000 };

export const PERCENT_RULES = {
  new: 5,
  newMoody: 10,
  used: 5,
  shopBuildBase: 10,
  shopBuildStepMiles: 50,
} as const;

/** 0–50 mi = 10%, 50.01–100 = 11%, 100.01–150 = 12% … (exactly 50 stays in the lower tier). */
export function shopBuildPercent(miles: number): number {
  if (miles <= 0) return PERCENT_RULES.shopBuildBase;
  return PERCENT_RULES.shopBuildBase + Math.max(0, Math.ceil(miles / PERCENT_RULES.shopBuildStepMiles) - 1);
}

export function repoRateFor(miles: number, rates: RepoRate[]): RepoRate | null {
  const sorted = [...rates].sort((a, b) => (a.upToMiles ?? Infinity) - (b.upToMiles ?? Infinity));
  return sorted.find((r) => r.upToMiles === null || miles <= r.upToMiles) ?? null;
}

export interface ExpenseInput {
  jobType: JobType;
  customerName: string;
  serial: string;
  miles: number | null;
  moody: boolean;
  lotTakenTo: string;
}

export interface ExpenseLine {
  kind: "main" | "fuel";
  description: string;
  amountCents: number;
  /** How the amount was worked out, in plain words, for the review screen. */
  basis: string;
}

export interface ExpenseDraft {
  lines: ExpenseLine[];
  /** Things the scheduler must fix or check before approving. Empty = ready. */
  problems: string[];
  serialInfo: SerialInfo | null;
  listPriceCents: number | null;
}

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const pctOf = (cents: number, pct: number) => Math.round((cents * pct) / 100);
const TYPE_WORD: Record<JobType, string> = {
  new: "NEW", used: "USED", shop_build: "SHOP BUILD", repo: "REPO", attempted_repo: "ATTEMPTED REPO",
};

export function draftExpenses(input: ExpenseInput, prices: PriceRow[], repoRates: RepoRate[], settings: PricingSettings): ExpenseDraft {
  const problems: string[] = [];
  const lines: ExpenseLine[] = [];
  const name = input.customerName.trim().toUpperCase();
  const serialInfo = parseSerial(input.serial);
  const needsPrice = input.jobType === "new" || input.jobType === "used" || input.jobType === "shop_build";
  const needsMiles = input.jobType === "shop_build" || input.jobType === "repo";

  if (!input.serial.trim() && input.jobType !== "attempted_repo") problems.push("No serial number on this job.");
  else if (!serialInfo && input.jobType !== "attempted_repo") problems.push(`Can't read style and size from serial "${input.serial}".`);

  let listPriceCents: number | null = null;
  if (serialInfo) {
    const row = prices.find((p) => p.style === serialInfo.style && p.width === serialInfo.width && p.length === serialInfo.length);
    if (row) listPriceCents = row.priceCents;
    else if (needsPrice) problems.push(`${sizeLabel(serialInfo)} isn't on the price sheet.`);
  }
  if (needsMiles && (input.miles === null || !(input.miles >= 0))) problems.push("Miles are missing.");
  if (input.jobType === "repo" && !input.lotTakenTo.trim()) problems.push("Lot taken to is missing.");

  const building = serialInfo ? sizeLabel(serialInfo) : "";
  const memo = (extra = "") =>
    [TYPE_WORD[input.jobType], name, building, input.serial.trim() && `SN ${input.serial.trim().toUpperCase()}`, extra].filter(Boolean).join(" · ");

  switch (input.jobType) {
    case "new":
    case "used": {
      if (listPriceCents === null) break;
      const pct = input.jobType === "used" ? PERCENT_RULES.used : input.moody ? PERCENT_RULES.newMoody : PERCENT_RULES.new;
      lines.push({
        kind: "main",
        description: memo(),
        amountCents: pctOf(listPriceCents, pct),
        basis: `${pct}% of ${usd(listPriceCents)} (${building} list price)${input.jobType === "new" && input.moody ? " · Moody" : ""}`,
      });
      break;
    }
    case "shop_build": {
      if (listPriceCents === null || input.miles === null) break;
      const pct = shopBuildPercent(input.miles);
      lines.push({
        kind: "main",
        description: memo(`${input.miles} mi`),
        amountCents: pctOf(listPriceCents, pct),
        basis: `${pct}% of ${usd(listPriceCents)} (${building} list price) for ${input.miles} miles`,
      });
      break;
    }
    case "repo": {
      if (input.miles === null) break;
      const rate = repoRateFor(input.miles, repoRates);
      if (!rate) { problems.push(repoRates.length ? `No repo rate covers ${input.miles} miles.` : "Repo mileage rates haven't been entered yet (Pricing page)."); break; }
      lines.push({
        kind: "main",
        description: memo(`${input.miles} mi${input.lotTakenTo.trim() ? ` · to ${input.lotTakenTo.trim()}` : ""}`),
        amountCents: rate.amountCents,
        basis: `Repo rate for ${input.miles} miles (${rate.upToMiles === null ? "top tier" : `up to ${rate.upToMiles} mi`})`,
      });
      if (settings.fuelChargeOn) {
        lines.push({ kind: "fuel", description: `${name} Fuel`, amountCents: settings.fuelChargeCents, basis: "Repo fuel charge (separate expense)" });
      }
      break;
    }
    case "attempted_repo":
      lines.push({ kind: "main", description: memo(), amountCents: settings.attemptedRepoCents, basis: "Attempted repo flat rate" });
      break;
  }
  return { lines, problems, serialInfo, listPriceCents };
}

/** Loose name match for "does the happy sheet name match the job?": ignores case, punctuation and word order. */
export function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
  return !!norm(a) && norm(a) === norm(b);
}

/**
 * Reads a pasted price sheet. Accepts lines like "CC 12x32 9695", "CC,12x32,$9,695.00" or "CC | 12 x 32 | 9695".
 * Returns rows plus the lines it couldn't read.
 */
export function parsePriceSheet(text: string): { rows: PriceRow[]; bad: string[] } {
  const rows: PriceRow[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z]+)[\s,|;\t]+(\d{1,2})\s*[xX×]\s*(\d{1,2})[\s,|;\t]+\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/);
    if (!m) { bad.push(line); continue; }
    const cents = Math.round(Number(m[4]!.replace(/,/g, "")) * 100);
    if (!cents) { bad.push(line); continue; }
    rows.push({ style: m[1]!.toUpperCase(), width: Number(m[2]), length: Number(m[3]), priceCents: cents });
  }
  return { rows, bad };
}
