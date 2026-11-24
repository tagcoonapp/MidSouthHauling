import { Hono } from "hono";
import { JOB_TYPE_LABELS, baseCustomerName } from "../../shared/domain";
import { importMoody, nameKey, normSerialKey, parseImport, type ImportRow } from "../../shared/import";
import { newId, requirePermission } from "../auth";
import type { AppEnv } from "../env";

export const importRoutes = new Hono<AppEnv>();
importRoutes.use("*", requirePermission("editSchedule"));

type Status = "new" | "update" | "exists" | "duplicate_in_list";
export interface ImportPreviewRow extends ImportRow { status: Status; reason: string }

interface Existing {
  id: string; customer_name: string; city: string; serial: string; stage: string; job_type: string;
  scheduled_date: string | null; created_at: string; missing_from_netsuite_at: string | null;
  address: string; phone: string; tlo_notes: string; balance_cents: number | null;
}

export interface MissingJob { id: string; customerName: string; jobType: string; stage: string; scheduledDate: string | null; serial: string; createdAt: string }

/** Blank fields on a job already on the site that this import can fill in. Never overwrites anything. */
function fillsFor(e: Existing, r: ImportRow): Record<string, string | number> {
  if (e.stage !== "pipeline" && e.stage !== "scheduled") return {};
  const f: Record<string, string | number> = {};
  if (!e.address.trim() && r.address.trim()) f.address = r.address.trim().slice(0, 500);
  if (!e.city.trim() && r.city.trim()) f.city = r.city.trim().slice(0, 80);
  if (!e.phone.trim() && r.phone.trim()) f.phone = r.phone.trim().slice(0, 40);
  if (!e.tlo_notes.trim() && r.tlo.trim()) f.tlo_notes = r.tlo.trim().slice(0, 3000);
  if (e.balance_cents === null && r.balanceCents !== null) f.balance_cents = r.balanceCents;
  return f;
}
const FIELD_WORDS: Record<string, string> = { address: "address", city: "city", phone: "phone", tlo_notes: "TLO addresses", balance_cents: "balance" };

/**
 * Preview (commit=false) or apply (commit=true) jobs read from NetSuite.
 * New jobs are added; jobs already on the site get only their blank fields filled in (address, city, phone, TLO, balance).
 */
importRoutes.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const text = typeof b.text === "string" ? b.text : "";
  if (text.length > 400_000) return c.json({ error: "That's too much text at once. Import in smaller batches." }, 400);
  const { rows, bad } = parseImport(text);
  if (!rows.length) return c.json({ error: bad.length ? "Couldn't read any jobs from that." : "Paste the jobs first.", bad }, 400);
  if (rows.length > 300) return c.json({ error: "Up to 300 jobs at a time." }, 400);

  const { results: existing } = await c.env.DB.prepare(
    "SELECT id, customer_name, city, serial, stage, job_type, scheduled_date, created_at, missing_from_netsuite_at, address, phone, tlo_notes, balance_cents FROM jobs ORDER BY created_at DESC",
  ).all<Existing>();
  const bySerial = new Map<string, Existing>();
  for (const e of existing) { const k = normSerialKey(e.serial); if (k && !bySerial.has(k)) bySerial.set(k, e); }
  const byName = new Map<string, Existing>();
  for (const e of existing) {
    if (e.stage !== "pipeline" && e.stage !== "scheduled") continue;
    const k = `${nameKey(baseCustomerName(e.customer_name))}|${nameKey(e.city)}`;
    if (!byName.has(k)) byName.set(k, e);
  }

  const seen = new Set<string>();
  const matched = new Set<string>();
  const updates: { id: string; fills: Record<string, string | number> }[] = [];
  const preview: ImportPreviewRow[] = rows.map((r) => {
    const sk = normSerialKey(r.serial);
    const key = sk || `${nameKey(baseCustomerName(r.customerName))}|${nameKey(r.city)}`;
    if (seen.has(key)) return { ...r, status: "duplicate_in_list", reason: "Listed twice" };
    seen.add(key);
    const match = sk ? bySerial.get(sk) ?? byName.get(`${nameKey(baseCustomerName(r.customerName))}|${nameKey(r.city)}`) : byName.get(key);
    if (!match) return { ...r, status: "new", reason: "" };
    matched.add(match.id);
    const fills = fillsFor(match, r);
    if (Object.keys(fills).length) {
      updates.push({ id: match.id, fills });
      return { ...r, status: "update", reason: `Fill in ${Object.keys(fills).map((k) => FIELD_WORDS[k]).join(", ")}` };
    }
    return { ...r, status: "exists", reason: sk ? "Already on the site" : "Same name and city already open" };
  });
  const toAdd = preview.filter((r) => r.status === "new");
  // Open NetSuite jobs on the site that this (full) In Progress list no longer has. Private moves aren't in NetSuite.
  const missing: MissingJob[] = existing
    .filter((e) => (e.stage === "pipeline" || e.stage === "scheduled") && e.job_type !== "private_move" && !matched.has(e.id))
    .map((e) => ({ id: e.id, customerName: e.customer_name, jobType: e.job_type, stage: e.stage, scheduledDate: e.scheduled_date, serial: e.serial, createdAt: e.created_at }));

  if (!b.commit) return c.json({ rows: preview, bad, newCount: toAdd.length, updateCount: updates.length, missing });

  const user = c.get("user");
  const max = await c.env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM jobs WHERE stage = 'pipeline'").first<{ m: number }>();
  let order = max?.m ?? 0;
  const stmts: D1PreparedStatement[] = [];
  for (const r of toAdd) {
    const id = newId();
    order += 1;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO jobs (id, customer_name, address, city, phone, serial, balance_cents, job_type, office_notes, sort_order, moody, source, created_by, tlo_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'netsuite', ?, ?)`,
      ).bind(id, r.customerName.slice(0, 160), r.address.slice(0, 500), r.city.slice(0, 80), r.phone.slice(0, 40), r.serial.slice(0, 60), r.balanceCents, r.jobType, r.notes.slice(0, 2000), order, importMoody(r) ? 1 : 0, user.id, r.tlo.slice(0, 3000)),
      c.env.DB.prepare("INSERT INTO job_events (id, job_id, user_id, kind, detail) VALUES (?, ?, ?, 'created', ?)").bind(newId(), id, user.id, `Imported from NetSuite (${JOB_TYPE_LABELS[r.jobType]})`),
    );
  }
  for (const u of updates) {
    const cols = Object.keys(u.fills);
    // Only fill columns that are still blank, in case someone edited the job since the preview.
    const guards = cols.map((k) => (k === "balance_cents" ? "balance_cents IS NULL" : `${k} = ''`)).join(" AND ");
    const extra = cols.includes("address") || cols.includes("city") ? ", geo_status = 'none', lat = NULL, lng = NULL" : "";
    stmts.push(
      c.env.DB.prepare(`UPDATE jobs SET ${cols.map((k) => `${k} = ?`).join(", ")}${extra}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND ${guards}`)
        .bind(...cols.map((k) => u.fills[k]), u.id),
      c.env.DB.prepare("INSERT INTO job_events (id, job_id, user_id, kind, detail) VALUES (?, ?, ?, 'imported', ?)").bind(newId(), u.id, user.id, `Filled in from NetSuite: ${cols.map((k) => FIELD_WORDS[k]).join(", ")}`),
    );
  }
  // Flag jobs NetSuite no longer lists; clear the flag on ones it lists again.
  for (const m of missing) {
    stmts.push(c.env.DB.prepare("UPDATE jobs SET missing_from_netsuite_at = COALESCE(missing_from_netsuite_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?").bind(m.id));
  }
  const nowFound = existing.filter((e) => e.missing_from_netsuite_at && matched.has(e.id));
  for (const e of nowFound) stmts.push(c.env.DB.prepare("UPDATE jobs SET missing_from_netsuite_at = NULL WHERE id = ?").bind(e.id));
  const newlyMissing = missing.filter((m) => !existing.find((e) => e.id === m.id)?.missing_from_netsuite_at);
  for (const m of newlyMissing) {
    stmts.push(c.env.DB.prepare("INSERT INTO job_events (id, job_id, user_id, kind, detail) VALUES (?, ?, ?, 'netsuite', 'Not in NetSuite In Progress list anymore')").bind(newId(), m.id, user.id));
  }
  for (let i = 0; i < stmts.length; i += 80) await c.env.DB.batch(stmts.slice(i, i + 80));
  return c.json({ rows: preview, bad, added: toAdd.length, updated: updates.length, skipped: preview.length - toAdd.length - updates.length, missing, cleared: nowFound.length });
});
