import { describe, expect, it } from "vitest";
import { permissionsFor } from "../shared/domain";
import { toDriverJob, toOfficeJob, type JobRow } from "../worker/serialize";
import { addDays, isIsoDate, localToday } from "../worker/dates";

const row: JobRow = {
  id: "j1", customer_name: "Derrick Owens", address: "77 Pine Hollow Ln", city: "Decatur", phone: "256-555-0142",
  serial: "PPB-24-118733", building: "12x24 Side Lofted", balance_cents: 211540, job_type: "repo", stage: "scheduled",
  call_status: "confirmed", call_attempts: 2, driver_id: "d1", driver_name: "Marcus", driver_color: "#2563eb",
  scheduled_date: "2026-11-23", scheduled_time: "11:30 AM", office_notes: "", driver_notes: "", pdf_key: null,
  submitted_at: null, created_at: "2026-11-20T00:00:00Z",
  reported_customer_name: "", miles: 31, lot_taken_to: "", moody: 0, amount_override_cents: 38500,
};

describe("roles", () => {
  it("drivers can't see the pipeline, other drivers, money, or pending expenses", () => {
    const p = permissionsFor("driver");
    expect(p).toMatchObject({ viewPipeline: false, editSchedule: false, viewAllDrivers: false, viewFinancial: false, viewPendingExpenses: false, manageTeam: false });
    expect(p.submitJobs).toBe(true);
  });
  it("owners see the calendar, pipeline and money and can edit the calendar, but not pending expenses", () => {
    const p = permissionsFor("owner");
    expect(p).toMatchObject({ viewPipeline: true, editSchedule: true, viewFinancial: true, viewPendingExpenses: false, approveExpenses: false, manageTeam: false });
  });
  it("the scheduler sees and does everything", () => {
    expect(Object.values(permissionsFor("scheduler")).every(Boolean)).toBe(true);
  });
});

describe("driver job view", () => {
  it("never includes money or other drivers' details", () => {
    const j = toDriverJob(row, []) as unknown as Record<string, unknown>;
    const json = JSON.stringify(j);
    expect(json).not.toContain("2115");
    expect(json).not.toContain("385");
    expect(Object.keys(j)).not.toEqual(expect.arrayContaining(["balanceCents"]));
    for (const k of Object.keys(j)) expect(k.toLowerCase()).not.toMatch(/balance|price|amount|cost|override|moody|draft|expense|driver(id|name|color)/);
  });
  it("office view adds the balance", () => {
    expect(toOfficeJob(row, []).balanceCents).toBe(211540);
  });
  it("lists only this job's photos", () => {
    const j = toDriverJob(row, [
      { id: "p1", job_id: "j1", created_at: "x" },
      { id: "p2", job_id: "other", created_at: "x" },
    ]);
    expect(j.photos.map((p) => p.id)).toEqual(["p1"]);
    expect(j.photos[0]!.url).toBe("/api/photos/p1");
  });
});

describe("dates", () => {
  it("uses the business time zone for today", () => {
    // 03:00 UTC on Nov 24 is still Nov 23 in Memphis.
    expect(localToday("America/Chicago", new Date("2026-11-24T03:00:00Z"))).toBe("2026-11-23");
  });
  it("validates and adds dates", () => {
    expect(isIsoDate("2026-11-23")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("tomorrow")).toBe(false);
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});
