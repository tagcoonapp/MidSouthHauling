import { Hono, type Context } from "hono";
import {
  isTruckCostCategory, permissionsFor,
  type AccountingReport, type FuelReceipt, type JobType, type KeptPaidTo, type PayJob, type TruckCost,
} from "../../shared/domain";
import { driverPay } from "../../shared/pay";
import { receiptChecks, type ReceiptRead } from "../../shared/receipt-read";
import { newId, requirePermission } from "../auth";
import { addDays, isIsoDate, localToday } from "../dates";
import type { AppEnv } from "../env";
import { readReceipt } from "../receipt-reader";

type C = Context<AppEnv>;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const IMAGE = /^image\/(jpeg|png|webp|heic|heif)$/;
/** Drivers can fix or delete their own receipts for this many days. */
const DRIVER_EDIT_DAYS = 7;

const isOffice = (c: C) => permissionsFor(c.get("user").role).viewFinancial;

function num(v: unknown): number | null | undefined {
  if (v === null || v === "") return null;
  if (v === undefined) return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
const cents = (v: unknown) => { const n = num(v); return n === undefined || n === null ? n : Math.round(n * 100); };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

async function bodyOf(c: C): Promise<{ fields: Record<string, unknown>; file: File | null }> {
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await c.req.formData().catch(() => null);
    const fields: Record<string, unknown> = {};
    let file: File | null = null;
    form?.forEach((v, k) => { if (v instanceof File) { if (k === "file" && v.size) file = v; } else fields[k] = v; });
    return { fields, file };
  }
  return { fields: await c.req.json().catch(() => ({})), file: null };
}

function checkFile(file: File | null): string | null {
  if (!file) return null;
  if (!IMAGE.test(file.type) && file.type !== "application/pdf") return "Receipts must be a photo (JPG, PNG, HEIC) or PDF.";
  if (file.size > MAX_PHOTO_BYTES) return "File is too large (10 MB max).";
  return null;
}

// ---------- Fuel receipts ----------

interface FuelRow {
  id: string; driver_id: string; driver_name?: string; driver_color?: string; date: string;
  amount_cents: number | null; gallons: number | null; odometer: number | null; station: string; notes: string;
  photo_key: string | null; ai_status: string | null; ai_error: string | null; ai_result: string | null; created_at: string;
}
const FUEL_SELECT = `SELECT f.*, u.name AS driver_name, u.color AS driver_color FROM fuel_receipts f JOIN users u ON u.id = f.driver_id`;

function toFuel(r: FuelRow, office: boolean): FuelReceipt {
  const out: FuelReceipt = {
    id: r.id, driverId: r.driver_id, driverName: r.driver_name, driverColor: r.driver_color, date: r.date,
    amountCents: r.amount_cents, gallons: r.gallons, odometer: r.odometer, station: r.station, notes: r.notes,
    photoUrl: r.photo_key ? `/api/fuel/${r.id}/photo` : null,
    aiStatus: r.ai_status, aiError: office ? r.ai_error : null, createdAt: r.created_at,
  };
  if (office) {
    let read: ReceiptRead | null = null;
    try { read = r.ai_result ? JSON.parse(r.ai_result) : null; } catch { read = null; }
    out.checks = receiptChecks({ amountCents: r.amount_cents, gallons: r.gallons, date: r.date }, read);
  }
  return out;
}

async function fuelFor(c: C, id: string): Promise<FuelRow | null> {
  const r = await c.env.DB.prepare(`${FUEL_SELECT} WHERE f.id = ?`).bind(id).first<FuelRow>();
  if (!r) return null;
  if (!isOffice(c) && r.driver_id !== c.get("user").id) return null;
  return r;
}

function driverCanChange(c: C, r: FuelRow): boolean {
  if (isOffice(c)) return true;
  return Date.now() - Date.parse(r.created_at) < DRIVER_EDIT_DAYS * 86_400_000;
}

export const fuelRoutes = new Hono<AppEnv>();

/** A driver's own receipts (last 90 days). No totals. */
fuelRoutes.get("/mine", async (c) => {
  const since = addDays(localToday(c.env.TIMEZONE), -90);
  const { results } = await c.env.DB.prepare(`${FUEL_SELECT} WHERE f.driver_id = ? AND f.date >= ? ORDER BY f.date DESC, f.created_at DESC`)
    .bind(c.get("user").id, since).all<FuelRow>();
  return c.json(results.map((r) => toFuel(r, false)));
});

fuelRoutes.post("/", async (c) => {
  const user = c.get("user");
  const office = isOffice(c);
  if (user.role !== "driver" && !office) return c.json({ error: "You don't have access to this." }, 403);
  const { fields: b, file } = await bodyOf(c);
  const bad = checkFile(file);
  if (bad) return c.json({ error: bad }, 400);
  if (!file && !office) return c.json({ error: "Take a photo of the receipt." }, 400);
  const date = isIsoDate(b.date) ? b.date : localToday(c.env.TIMEZONE);
  // Fields left out are blank (the photo reading fills the amount in).
  const gallons = num(b.gallons ?? null);
  const odometer = num(b.odometer ?? null);
  const amount = cents(b.amount ?? null);
  if (gallons === undefined) return c.json({ error: "Gallons must be a number." }, 400);
  if (odometer === undefined) return c.json({ error: "Odometer must be a number." }, 400);
  if (amount === undefined) return c.json({ error: "Amount must be dollars." }, 400);
  if (!office && (gallons === null || odometer === null)) return c.json({ error: "Enter gallons and the odometer reading." }, 400);
  let driverId = user.id;
  if (office && typeof b.driverId === "string" && b.driverId) driverId = b.driverId;
  const id = newId();
  const key = file ? `receipts/fuel/${id}` : null;
  if (file && key) await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await c.env.DB.prepare(
    `INSERT INTO fuel_receipts (id, driver_id, date, amount_cents, gallons, odometer, station, notes, photo_key, content_type, ai_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, driverId, date, amount, gallons, odometer === null ? null : Math.round(odometer), text(b.station, 120) ?? "", text(b.notes, 500) ?? "",
    key, file?.type ?? null, file ? "reading" : null).run();
  if (file) c.executionCtx.waitUntil(readReceipt(c.env, id));
  return c.json(toFuel((await fuelFor(c, id))!, office), 201);
});

fuelRoutes.patch("/:id", async (c) => {
  const r = await fuelFor(c, c.req.param("id"));
  if (!r) return c.json({ error: "Receipt not found." }, 404);
  if (!driverCanChange(c, r)) return c.json({ error: `Receipts can only be changed for ${DRIVER_EDIT_DAYS} days. Ask the office.` }, 400);
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.date !== undefined) { if (!isIsoDate(b.date)) return c.json({ error: "Pick a date." }, 400); sets.push("date = ?"); vals.push(b.date); }
  for (const [k, col, conv] of [["gallons", "gallons", num], ["odometer", "odometer", num], ["amount", "amount_cents", cents]] as const) {
    if (b[k] === undefined) continue;
    const v = conv(b[k]);
    if (v === undefined) return c.json({ error: `${k[0]!.toUpperCase()}${k.slice(1)} must be a number.` }, 400);
    sets.push(`${col} = ?`); vals.push(k === "odometer" && v !== null ? Math.round(v) : v);
  }
  const st = text(b.station, 120); if (st !== undefined) { sets.push("station = ?"); vals.push(st); }
  const nt = text(b.notes, 500); if (nt !== undefined) { sets.push("notes = ?"); vals.push(nt); }
  if (isOffice(c) && typeof b.driverId === "string" && b.driverId) { sets.push("driver_id = ?"); vals.push(b.driverId); }
  if (!sets.length) return c.json({ error: "Nothing to change." }, 400);
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  await c.env.DB.prepare(`UPDATE fuel_receipts SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, r.id).run();
  return c.json(toFuel((await fuelFor(c, r.id))!, isOffice(c)));
});

fuelRoutes.delete("/:id", async (c) => {
  const r = await fuelFor(c, c.req.param("id"));
  if (!r) return c.json({ error: "Receipt not found." }, 404);
  if (!driverCanChange(c, r)) return c.json({ error: `Receipts can only be deleted for ${DRIVER_EDIT_DAYS} days. Ask the office.` }, 400);
  await c.env.DB.prepare("DELETE FROM fuel_receipts WHERE id = ?").bind(r.id).run();
  if (r.photo_key) await c.env.FILES.delete(r.photo_key).catch(() => {});
  return c.json({ ok: true });
});

fuelRoutes.get("/:id/photo", async (c) => {
  const r = await fuelFor(c, c.req.param("id"));
  if (!r?.photo_key) return c.json({ error: "Not found." }, 404);
  const obj = await c.env.FILES.get(r.photo_key);
  if (!obj) return c.json({ error: "Not found." }, 404);
  const headers: Record<string, string> = { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=86400" };
  if (c.req.query("download") !== undefined) headers["content-disposition"] = `attachment; filename="fuel-${r.date}-${(r.driver_name ?? "").replace(/[^A-Za-z0-9]/g, "")}.${(obj.httpMetadata?.contentType ?? "").includes("pdf") ? "pdf" : "jpg"}"`;
  return new Response(obj.body, { headers });
});

fuelRoutes.post("/:id/read", requirePermission("viewFinancial"), async (c) => {
  const r = await fuelFor(c, c.req.param("id"));
  if (!r) return c.json({ error: "Receipt not found." }, 404);
  await readReceipt(c.env, r.id);
  return c.json(toFuel((await fuelFor(c, r.id))!, true));
});

// ---------- Truck and trailer costs (office) ----------

interface CostRow {
  id: string; date: string; category: string; vehicle: string; driver_id: string | null; driver_name: string | null;
  vendor: string; description: string; amount_cents: number; photo_key: string | null; created_at: string;
}
const COST_SELECT = `SELECT t.*, u.name AS driver_name FROM truck_costs t LEFT JOIN users u ON u.id = t.driver_id`;
const toCost = (r: CostRow): TruckCost => ({
  id: r.id, date: r.date, category: isTruckCostCategory(r.category) ? r.category : "other", vehicle: r.vehicle,
  driverId: r.driver_id, driverName: r.driver_name, vendor: r.vendor, description: r.description, amountCents: r.amount_cents,
  photoUrl: r.photo_key ? `/api/truck-costs/${r.id}/photo` : null, createdAt: r.created_at,
});

export const truckCostRoutes = new Hono<AppEnv>();
truckCostRoutes.use("*", requirePermission("viewFinancial"));

truckCostRoutes.post("/", async (c) => {
  const { fields: b, file } = await bodyOf(c);
  const bad = checkFile(file);
  if (bad) return c.json({ error: bad }, 400);
  const amount = cents(b.amount);
  if (amount === undefined || amount === null) return c.json({ error: "Enter the amount." }, 400);
  if (!isTruckCostCategory(b.category)) return c.json({ error: "Pick a category." }, 400);
  const date = isIsoDate(b.date) ? b.date : localToday(c.env.TIMEZONE);
  const id = newId();
  const key = file ? `receipts/truck/${id}` : null;
  if (file && key) await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await c.env.DB.prepare(
    `INSERT INTO truck_costs (id, date, category, vehicle, driver_id, vendor, description, amount_cents, photo_key, content_type, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, date, b.category, text(b.vehicle, 60) ?? "", typeof b.driverId === "string" && b.driverId ? b.driverId : null,
    text(b.vendor, 120) ?? "", text(b.description, 500) ?? "", amount, key, file?.type ?? null, c.get("user").id).run();
  const row = await c.env.DB.prepare(`${COST_SELECT} WHERE t.id = ?`).bind(id).first<CostRow>();
  return c.json(toCost(row!), 201);
});

truckCostRoutes.patch("/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.date !== undefined) { if (!isIsoDate(b.date)) return c.json({ error: "Pick a date." }, 400); sets.push("date = ?"); vals.push(b.date); }
  if (b.category !== undefined) { if (!isTruckCostCategory(b.category)) return c.json({ error: "Pick a category." }, 400); sets.push("category = ?"); vals.push(b.category); }
  if (b.amount !== undefined) { const a = cents(b.amount); if (a === undefined || a === null) return c.json({ error: "Enter the amount." }, 400); sets.push("amount_cents = ?"); vals.push(a); }
  for (const [k, max] of [["vehicle", 60], ["vendor", 120], ["description", 500]] as const) {
    const v = text(b[k], max); if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (b.driverId !== undefined) { sets.push("driver_id = ?"); vals.push(typeof b.driverId === "string" && b.driverId ? b.driverId : null); }
  if (!sets.length) return c.json({ error: "Nothing to change." }, 400);
  const res = await c.env.DB.prepare(`UPDATE truck_costs SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, c.req.param("id")).run();
  if (!res.meta.changes) return c.json({ error: "Not found." }, 404);
  const row = await c.env.DB.prepare(`${COST_SELECT} WHERE t.id = ?`).bind(c.req.param("id")).first<CostRow>();
  return c.json(toCost(row!));
});

truckCostRoutes.delete("/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT photo_key FROM truck_costs WHERE id = ?").bind(c.req.param("id")).first<{ photo_key: string | null }>();
  if (!row) return c.json({ error: "Not found." }, 404);
  await c.env.DB.prepare("DELETE FROM truck_costs WHERE id = ?").bind(c.req.param("id")).run();
  if (row.photo_key) await c.env.FILES.delete(row.photo_key).catch(() => {});
  return c.json({ ok: true });
});

truckCostRoutes.get("/:id/photo", async (c) => {
  const row = await c.env.DB.prepare("SELECT photo_key FROM truck_costs WHERE id = ?").bind(c.req.param("id")).first<{ photo_key: string | null }>();
  if (!row?.photo_key) return c.json({ error: "Not found." }, 404);
  const obj = await c.env.FILES.get(row.photo_key);
  if (!obj) return c.json({ error: "Not found." }, 404);
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=86400" } });
});

// ---------- Accounting report (scheduler and owners) ----------

interface PayJobRow {
  id: string; scheduled_date: string | null; approved_at: string | null; customer_name: string; job_type: string; serial: string;
  driver_id: string | null; driver_name: string | null; driver_color: string | null; miles: number | null;
  kept_paid_in_full: number | null; kept_paid_to: string | null; escort_cents: number | null;
  pay_paid_at: string | null; pay_cents: number | null; pay_basis: string | null;
  collected_cents: number | null; collected_method: string | null;
  pay_haul_pct: number | null; pay_repo_pct: number | null;
}

/** The job date used for accounting: the day it was hauled (or approved, if it was never on the calendar). */
const JOB_DATE = "COALESCE(j.scheduled_date, substr(j.approved_at, 1, 10))";

async function payJobs(c: C, where: string, binds: unknown[]): Promise<PayJob[]> {
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT j.id, j.scheduled_date, j.approved_at, j.customer_name, j.job_type, j.serial, j.driver_id, j.miles,
            j.kept_paid_in_full, j.kept_paid_to, j.escort_cents, j.pay_paid_at, j.pay_cents, j.pay_basis, j.collected_cents, j.collected_method,
            u.name AS driver_name, u.color AS driver_color, u.pay_haul_pct, u.pay_repo_pct
     FROM jobs j LEFT JOIN users u ON u.id = j.driver_id
     WHERE j.stage = 'approved' AND ${where} ORDER BY ${JOB_DATE}, j.approved_at`,
  ).bind(...binds).all<PayJobRow>();
  const lines: { job_id: string; kind: "main" | "fuel"; amount_cents: number }[] = [];
  for (let i = 0; i < results.length; i += 50) {
    const ids = results.slice(i, i + 50).map((r) => r.id);
    const { results: ex } = await db.prepare(`SELECT job_id, kind, amount_cents FROM expenses WHERE job_id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids).all<{ job_id: string; kind: "main" | "fuel"; amount_cents: number }>();
    lines.push(...ex);
  }
  return results.map((r) => {
    const mine = lines.filter((l) => l.job_id === r.id).map((l) => ({ kind: l.kind, amountCents: l.amount_cents }));
    const jobType = r.job_type as JobType;
    const live = driverPay(
      { jobType, keptPaidInFull: r.kept_paid_in_full === null ? null : !!r.kept_paid_in_full, escortCents: r.escort_cents },
      mine, { haulPct: r.pay_haul_pct, repoPct: r.pay_repo_pct },
    );
    const frozen = r.pay_paid_at && r.pay_cents !== null;
    return {
      id: r.id,
      date: r.scheduled_date ?? (r.approved_at ?? "").slice(0, 10),
      customerName: r.customer_name, jobType, serial: r.serial,
      driverId: r.driver_id, driverName: r.driver_name, driverColor: r.driver_color, miles: r.miles,
      expensedCents: mine.reduce((t, l) => t + l.amountCents, 0),
      fuelLineCents: mine.filter((l) => l.kind === "fuel").reduce((t, l) => t + l.amountCents, 0),
      payCents: frozen ? r.pay_cents : r.driver_id ? live.cents : null,
      payBasis: frozen ? (r.pay_basis ?? "") : r.driver_id ? live.basis : "No driver on this job",
      payPaidAt: r.pay_paid_at,
      collectedCents: r.collected_cents, collectedMethod: r.collected_method,
      keptPaidTo: (r.kept_paid_to === "driver" || r.kept_paid_to === "bhr" ? r.kept_paid_to : null) as KeptPaidTo | null,
    };
  });
}

export const accountingRoutes = new Hono<AppEnv>();
accountingRoutes.use("*", requirePermission("viewFinancial"));

accountingRoutes.get("/", async (c) => {
  const today = localToday(c.env.TIMEZONE);
  const from = isIsoDate(c.req.query("from")) ? c.req.query("from")! : today.slice(0, 8) + "01";
  const to = isIsoDate(c.req.query("to")) ? c.req.query("to")! : today;
  const db = c.env.DB;
  const [jobs, fuelRes, costRes, driverRes] = await Promise.all([
    payJobs(c, `${JOB_DATE} BETWEEN ? AND ?`, [from, to]),
    db.prepare(`${FUEL_SELECT} WHERE f.date BETWEEN ? AND ? ORDER BY f.date DESC, f.created_at DESC`).bind(from, to).all<FuelRow>(),
    db.prepare(`${COST_SELECT} WHERE t.date BETWEEN ? AND ? ORDER BY t.date DESC, t.created_at DESC`).bind(from, to).all<CostRow>(),
    db.prepare("SELECT id, name, color, pay_haul_pct, pay_repo_pct FROM users WHERE role = 'driver' ORDER BY active DESC, name")
      .all<{ id: string; name: string; color: string; pay_haul_pct: number | null; pay_repo_pct: number | null }>(),
  ]);
  // Miles from odometer: each reading in the period minus that driver's reading before it (which may be before the period).
  const { results: odo } = await db.prepare(
    "SELECT driver_id, date, odometer FROM fuel_receipts WHERE odometer IS NOT NULL AND date <= ? ORDER BY driver_id, date, odometer",
  ).bind(to).all<{ driver_id: string; date: string; odometer: number }>();
  const odometerMiles: Record<string, number> = {};
  let prev: { driver_id: string; odometer: number } | null = null;
  for (const r of odo) {
    if (prev && prev.driver_id === r.driver_id && r.date >= from) {
      const d = r.odometer - prev.odometer;
      if (d > 0 && d < 3000) odometerMiles[r.driver_id] = (odometerMiles[r.driver_id] ?? 0) + d;
    }
    prev = r;
  }
  const report: AccountingReport = {
    from, to, jobs,
    fuel: fuelRes.results.map((r) => toFuel(r, true)),
    truckCosts: costRes.results.map(toCost),
    drivers: driverRes.results.map((d) => ({ id: d.id, name: d.name, color: d.color, payHaulPct: d.pay_haul_pct, payRepoPct: d.pay_repo_pct })),
    odometerMiles,
  };
  return c.json(report);
});

/** Unpaid driver pay, all time (so nothing slips between periods). */
accountingRoutes.get("/unpaid", async (c) => c.json(await payJobs(c, "j.pay_paid_at IS NULL AND j.driver_id IS NOT NULL", [])));

/** Mark jobs' driver pay as paid (freezes the amount) or not paid. */
accountingRoutes.post("/pay", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(b.jobIds) ? b.jobIds.filter((x: unknown) => typeof x === "string").slice(0, 500) : [];
  if (!ids.length) return c.json({ error: "Pick jobs." }, 400);
  const db = c.env.DB;
  if (b.paid === false) {
    await db.batch(ids.map((id) => db.prepare("UPDATE jobs SET pay_paid_at = NULL, pay_cents = NULL, pay_basis = NULL WHERE id = ?").bind(id)));
    return c.json({ ok: true, count: ids.length });
  }
  const jobs = await payJobs(c, `j.id IN (${ids.map(() => "?").join(",")}) AND j.pay_paid_at IS NULL`, ids);
  const unset = jobs.filter((j) => j.payCents === null);
  if (unset.length) return c.json({ error: `Set the pay rate for ${[...new Set(unset.map((j) => j.driverName ?? "this driver"))].join(", ")} on the Team page first.` }, 400);
  if (jobs.length) await db.batch(jobs.map((j) =>
    db.prepare("UPDATE jobs SET pay_paid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), pay_cents = ?, pay_basis = ? WHERE id = ? AND pay_paid_at IS NULL")
      .bind(j.payCents, j.payBasis, j.id)));
  return c.json({ ok: true, count: jobs.length });
});
