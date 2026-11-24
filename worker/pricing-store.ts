import { DEFAULT_SETTINGS, draftExpenses, namesMatch, type PriceRow, type PricingSettings, type RepoRate } from "../shared/pricing";
import { amountToCollect, baseCustomerName, type JobType } from "../shared/domain";
import { photoReadOf, type JobRow } from "./serialize";
import { checkPhotoRead, pricingSerial } from "../shared/photo-read";

export interface PricingData {
  prices: PriceRow[];
  repoRates: RepoRate[];
  settings: PricingSettings;
}

export async function loadPricing(db: D1Database): Promise<PricingData> {
  const [prices, rates, settings] = await db.batch([
    db.prepare("SELECT style, width, length, price_cents FROM price_list"),
    db.prepare("SELECT width, up_to_miles, amount_cents, pct FROM repo_rate_grid"),
    db.prepare("SELECT key, value FROM settings"),
  ]);
  const s = Object.fromEntries((settings!.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return {
    prices: (prices!.results as { style: string; width: number; length: number; price_cents: number }[]).map((r) => ({
      style: r.style, width: r.width, length: r.length, priceCents: r.price_cents,
    })),
    repoRates: (rates!.results as { width: number; up_to_miles: number | null; amount_cents: number | null; pct: number | null }[]).map((r) => ({
      width: r.width, upToMiles: r.up_to_miles, amountCents: r.amount_cents, pct: r.pct,
    })),
    settings: {
      fuelChargeOn: s.fuelChargeOn !== undefined ? s.fuelChargeOn === "true" : DEFAULT_SETTINGS.fuelChargeOn,
      fuelChargeCents: s.fuelChargeCents !== undefined ? Number(s.fuelChargeCents) : DEFAULT_SETTINGS.fuelChargeCents,
      attemptedRepoCents: s.attemptedRepoCents !== undefined ? Number(s.attemptedRepoCents) : DEFAULT_SETTINGS.attemptedRepoCents,
      attemptedRepoPaidCents: s.attemptedRepoPaidCents !== undefined ? Number(s.attemptedRepoPaidCents) : DEFAULT_SETTINGS.attemptedRepoPaidCents,
    },
  };
}

/** The expense draft for a job, with the scheduler's amount override applied to the main line. */
export function draftForJob(job: JobRow, pricing: PricingData) {
  const read = photoReadOf(job).result;
  // Job names may carry the lot ("Jade Gibbons | Henagar"); compare and print only the customer part.
  const customer = baseCustomerName(job.customer_name);
  const { serial, fromPhoto } = pricingSerial(job.serial, read);
  const draft = draftExpenses(
    {
      jobType: job.job_type as JobType,
      customerName: job.reported_customer_name || customer,
      serial,
      miles: job.miles,
      moody: !!job.moody,
      lotTakenTo: job.lot_taken_to,
      escortCents: job.escort_cents,
      keptPaidInFull: job.kept_paid_in_full === null ? null : !!job.kept_paid_in_full,
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
      draft.lines.unshift({ kind: "main", description: customer.toUpperCase(), amountCents: job.amount_override_cents, basis: "Set by scheduler" });
      draft.problems = draft.problems.filter((p) => !/price sheet|repo rate|Pricing page|Can't read style/.test(p));
    }
  }
  const nameMatches = job.reported_customer_name.trim() ? namesMatch(job.reported_customer_name, customer) : null;
  if (nameMatches === false) draft.problems.push(`Driver wrote "${job.reported_customer_name}" but the job is for "${customer}".`);
  if (fromPhoto) draft.problems = draft.problems.filter((p) => p !== "No serial number on this job.");
  const photoChecks = read
    ? checkPhotoRead(read, {
        customerName: customer, serial: job.serial, jobType: job.job_type as JobType, miles: job.miles,
        collectCents: amountToCollect(job.job_type as JobType, job.balance_cents), collectedCents: job.collected_cents,
      })
    : [];
  // Serial or type mismatches block a one-click approve; softer notes (hard to read, comments) are shown but don't.
  for (const c of photoChecks) if (!c.ok && /doesn't match|says .* but the job|No happy sheet|Couldn't read a serial|miles; driver entered/.test(c.text)) draft.problems.push(`Photos: ${c.text}`);
  const due = amountToCollect(job.job_type as JobType, job.balance_cents);
  if (due !== null && job.collected_cents !== null && job.collected_cents < due) {
    draft.problems.push(`Collected $${(job.collected_cents / 100).toFixed(2)} of $${(due / 100).toFixed(2)} due.`);
  }
  return { ...draft, nameMatches, photoChecks, serialFromPhoto: fromPhoto };
}
