import { DEFAULT_SETTINGS, draftExpenses, namesMatch, type PriceRow, type PricingSettings, type RepoRate } from "../shared/pricing";
import type { JobType } from "../shared/domain";
import type { JobRow } from "./serialize";

export interface PricingData {
  prices: PriceRow[];
  repoRates: RepoRate[];
  settings: PricingSettings;
}

export async function loadPricing(db: D1Database): Promise<PricingData> {
  const [prices, rates, settings] = await db.batch([
    db.prepare("SELECT style, width, length, price_cents FROM price_list"),
    db.prepare("SELECT up_to_miles, amount_cents FROM repo_rates"),
    db.prepare("SELECT key, value FROM settings"),
  ]);
  const s = Object.fromEntries((settings!.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return {
    prices: (prices!.results as { style: string; width: number; length: number; price_cents: number }[]).map((r) => ({
      style: r.style, width: r.width, length: r.length, priceCents: r.price_cents,
    })),
    repoRates: (rates!.results as { up_to_miles: number | null; amount_cents: number }[]).map((r) => ({ upToMiles: r.up_to_miles, amountCents: r.amount_cents })),
    settings: {
      fuelChargeOn: s.fuelChargeOn !== undefined ? s.fuelChargeOn === "true" : DEFAULT_SETTINGS.fuelChargeOn,
      fuelChargeCents: s.fuelChargeCents !== undefined ? Number(s.fuelChargeCents) : DEFAULT_SETTINGS.fuelChargeCents,
      attemptedRepoCents: s.attemptedRepoCents !== undefined ? Number(s.attemptedRepoCents) : DEFAULT_SETTINGS.attemptedRepoCents,
    },
  };
}

/** The expense draft for a job, with the scheduler's amount override applied to the main line. */
export function draftForJob(job: JobRow, pricing: PricingData) {
  const draft = draftExpenses(
    {
      jobType: job.job_type as JobType,
      customerName: job.reported_customer_name || job.customer_name,
      serial: job.serial,
      miles: job.miles,
      moody: !!job.moody,
      lotTakenTo: job.lot_taken_to,
    },
    pricing.prices,
    pricing.repoRates,
    pricing.settings,
  );
  if (job.amount_override_cents !== null) {
    const main = draft.lines.find((l) => l.kind === "main");
    if (main) {
      main.basis = `Set by scheduler (calculated: ${(main.amountCents / 100).toFixed(2)})`;
      main.amountCents = job.amount_override_cents;
    } else {
      draft.lines.unshift({ kind: "main", description: job.customer_name.toUpperCase(), amountCents: job.amount_override_cents, basis: "Set by scheduler" });
      draft.problems = draft.problems.filter((p) => !/price sheet|repo rate|Pricing page|Can't read style/.test(p));
    }
  }
  const nameMatches = job.reported_customer_name.trim() ? namesMatch(job.reported_customer_name, job.customer_name) : null;
  if (nameMatches === false) draft.problems.push(`Driver wrote "${job.reported_customer_name}" but the job is for "${job.customer_name}".`);
  return { ...draft, nameMatches };
}
