// Driver pay. Office only: nothing here is ever sent to a driver.
import type { JobType } from "./domain";

export interface PayRates { haulPct: number | null; repoPct: number | null }

/** Types paid at the driver's haul rate. */
export const HAUL_TYPES: ReadonlySet<JobType> = new Set<JobType>(["new", "used", "shop_build", "inv_haul"]);
/** Attempted repo where the customer paid to keep the building: the driver gets this share of the charge. */
export const KEPT_BUILDING_DRIVER_PCT = 50;

export interface PayLine { kind: "main" | "fuel"; amountCents: number }
export interface PayResult { cents: number | null; basis: string }

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const pct = (c: number, p: number) => Math.round((c * p) / 100);

/**
 * What the driver earns on one approved job.
 * - Hauls (New, Used, Shop Build, INV Haul): haul % of the expense.
 * - Repo: repo % of the expense, not counting escort fees or the separate $50 fuel line.
 * - Attempted repo: nothing, unless the customer paid to keep the building: then half of that charge.
 * - Private moves: nothing (not expensed).
 * cents is null when the driver's rate hasn't been set.
 */
export function driverPay(
  job: { jobType: JobType; keptPaidInFull: boolean | null; escortCents: number | null },
  lines: PayLine[],
  rates: PayRates,
): PayResult {
  const main = lines.filter((l) => l.kind === "main").reduce((t, l) => t + l.amountCents, 0);
  if (HAUL_TYPES.has(job.jobType)) {
    if (rates.haulPct === null) return { cents: null, basis: "Haul pay rate not set (Team page)" };
    return { cents: pct(main, rates.haulPct), basis: `${rates.haulPct}% of ${usd(main)}` };
  }
  if (job.jobType === "repo") {
    if (rates.repoPct === null) return { cents: null, basis: "Repo pay rate not set (Team page)" };
    const escort = Math.min(job.escortCents ?? 0, main);
    const base = main - escort;
    return { cents: pct(base, rates.repoPct), basis: `${rates.repoPct}% of ${usd(base)}${escort ? ` (escort ${usd(escort)} not counted)` : ""}` };
  }
  if (job.jobType === "attempted_repo") {
    if (!job.keptPaidInFull) return { cents: 0, basis: "Attempted repos don't pay" };
    return { cents: pct(main, KEPT_BUILDING_DRIVER_PCT), basis: `Half of ${usd(main)} (customer paid to keep the building)` };
  }
  return { cents: 0, basis: "Private moves aren't paid through here" };
}

/** Miles driven from odometer readings (sorted by date); ignores readings that go backwards. */
export function odometerMiles(readings: { odometer: number | null }[]): number {
  const vals = readings.map((r) => r.odometer).filter((v): v is number => typeof v === "number" && v > 0);
  let miles = 0;
  for (let i = 1; i < vals.length; i++) {
    const d = vals[i]! - vals[i - 1]!;
    if (d > 0 && d < 3000) miles += d;
  }
  return miles;
}
