import { describe, expect, it } from "vitest";
import { missingDriverAnswers } from "../shared/domain";
import { driverPay, odometerMiles } from "../shared/pay";
import { receiptChecks, type ReceiptRead } from "../shared/receipt-read";
import { toDriverJob, type JobRow } from "../worker/serialize";

const jacob = { haulPct: 25, repoPct: 25 };
const cason = { haulPct: 35, repoPct: 35 };
const main = (c: number) => ({ kind: "main" as const, amountCents: c });
const fuel = { kind: "fuel" as const, amountCents: 5000 };
const job = (jobType: Parameters<typeof driverPay>[0]["jobType"], extra: Partial<Parameters<typeof driverPay>[0]> = {}) =>
  ({ jobType, keptPaidInFull: null, escortCents: null, ...extra });

describe("driver pay", () => {
  it("pays the haul rate on New, Used, Shop Build and INV Haul", () => {
    expect(driverPay(job("new"), [main(48475)], jacob).cents).toBe(12119);
    expect(driverPay(job("shop_build"), [main(100000)], cason).cents).toBe(35000);
    expect(driverPay(job("inv_haul"), [main(40000)], jacob).cents).toBe(10000);
  });
  it("pays the repo rate on repos, without the $50 fuel line", () => {
    expect(driverPay(job("repo"), [main(35000), fuel], cason).cents).toBe(12250);
    expect(driverPay(job("repo"), [main(35000), fuel], jacob).cents).toBe(8750);
  });
  it("doesn't count escort fees on wide repos", () => {
    const r = driverPay(job("repo", { escortCents: 20000 }), [main(70000), fuel], cason);
    expect(r.cents).toBe(17500); // 35% of 500
    expect(r.basis).toContain("escort");
  });
  it("pays nothing on an attempted repo", () => {
    expect(driverPay(job("attempted_repo", { keptPaidInFull: false }), [main(5000)], cason).cents).toBe(0);
    expect(driverPay(job("attempted_repo"), [main(5000)], cason).cents).toBe(0);
  });
  it("pays half of the $100 when the customer paid to keep the building", () => {
    expect(driverPay(job("attempted_repo", { keptPaidInFull: true }), [main(10000)], jacob).cents).toBe(5000);
    expect(driverPay(job("attempted_repo", { keptPaidInFull: true }), [main(10000)], cason).cents).toBe(5000);
  });
  it("private moves pay nothing here", () => {
    expect(driverPay(job("private_move"), [], cason).cents).toBe(0);
  });
  it("says so when the rate isn't set", () => {
    const r = driverPay(job("new"), [main(10000)], { haulPct: null, repoPct: null });
    expect(r.cents).toBeNull();
    expect(r.basis).toMatch(/not set/);
  });
});

describe("attempted repo: kept building", () => {
  const base = { jobType: "attempted_repo" as const, reportedCustomerName: "Jo", miles: null, lotTakenTo: "", collectCents: null, collectedCents: null, collectedMethod: null };
  it("is optional", () => {
    expect(missingDriverAnswers({ ...base, keptPaidInFull: null })).toEqual([]);
    expect(missingDriverAnswers({ ...base, keptPaidInFull: false })).toEqual([]);
  });
  it("asks who got the money when ticked", () => {
    expect(missingDriverAnswers({ ...base, keptPaidInFull: true, keptPaidTo: null })).toHaveLength(1);
    expect(missingDriverAnswers({ ...base, keptPaidInFull: true, keptPaidTo: "bhr" })).toEqual([]);
    expect(missingDriverAnswers({ ...base, keptPaidInFull: true, keptPaidTo: "driver" })).toEqual([]);
  });
});

describe("drivers never see pay", () => {
  it("driver job view has no pay fields", () => {
    const row = {
      id: "j1", customer_name: "A", address: "", city: "", phone: "", serial: "", building: "", balance_cents: 0, job_type: "attempted_repo",
      stage: "approved", call_status: "confirmed", call_attempts: 0, driver_id: "d1", scheduled_date: "2026-11-23", scheduled_time: null,
      office_notes: "", driver_notes: "", pdf_key: null, submitted_at: null, created_at: "x", reported_customer_name: "", miles: null, lot_taken_to: "",
      moody: 0, amount_override_cents: null, collected_cents: null, collected_method: null, collected_ref: "", escort_cents: null,
      kept_paid_in_full: 1, kept_paid_to: "driver", pay_paid_at: "2026-11-25T00:00:00Z", pay_cents: 4321, pay_basis: "Half of $100",
      ai_status: null, ai_result: null, ai_error: null, ai_read_at: null,
    } as unknown as JobRow;
    const j = toDriverJob(row, []) as unknown as Record<string, unknown>;
    expect(j.keptPaidTo).toBe("driver");
    expect(JSON.stringify(j)).not.toMatch(/4321|Half of/);
    for (const k of Object.keys(j)) expect(k.toLowerCase()).not.toMatch(/pay(?!ment)|rate|pct/);
  });
});

describe("odometer miles", () => {
  it("adds up the gaps between readings, ignoring bad ones", () => {
    expect(odometerMiles([{ odometer: 1000 }, { odometer: 1400 }, { odometer: null }, { odometer: 1700 }])).toBe(700);
    expect(odometerMiles([{ odometer: 1000 }, { odometer: 900 }, { odometer: 1200 }])).toBe(300);
    expect(odometerMiles([{ odometer: 1000 }, { odometer: 99000 }])).toBe(0);
  });
});

describe("fuel receipt checks", () => {
  const read: ReceiptRead = { isFuelReceipt: true, totalDollars: 187.42, gallons: 48.2, pricePerGallon: 3.889, fuelType: "Diesel", station: "Love's", date: "2026-11-24", unclear: "" };
  it("is quiet when the photo matches", () => {
    expect(receiptChecks({ amountCents: 18742, gallons: 48.2, date: "2026-11-24" }, read)).toEqual([]);
  });
  it("flags a different total, gallons or date", () => {
    const c = receiptChecks({ amountCents: 20742, gallons: 52, date: "2026-11-10" }, read);
    expect(c).toHaveLength(3);
  });
  it("flags a photo that isn't a fuel receipt", () => {
    expect(receiptChecks({ amountCents: 18742, gallons: 48.2, date: "2026-11-24" }, { ...read, isFuelReceipt: false })).toHaveLength(1);
  });
});
