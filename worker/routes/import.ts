import { Hono } from "hono";
import { JOB_TYPE_LABELS } from "../../shared/domain";
import { importMoody, nameKey, normSerialKey, parseImport, type ImportRow } from "../../shared/import";
import { baseCustomerName } from "../../shared/domain";
import { newId, requirePermission } from "../auth";
import type { AppEnv } from "../env";

export const importRoutes = new Hono<AppEnv>();
importRoutes.use("*", requirePermission("editSchedule"));

type Status = "new" | "exists" | "duplicate_in_list";
export interface ImportPreviewRow extends ImportRow { status: Status; reason: string }

/** Preview (commit=false) or add (commit=true) jobs read from NetSuite. Jobs already on the site are skipped. */
importRoutes.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const text = typeof b.text === "string" ? b.text : "";
  if (text.length > 400_000) return c.json({ error: "That's too much text at once. Import in smaller batches." }, 400);
  const { rows, bad } = parseImport(text);
  if (!rows.length) return c.json({ error: bad.length ? "Couldn't read any jobs from that." : "Paste the jobs first.", bad }, 400);
  if (rows.length > 300) return c.json({ error: "Up to 300 jobs at a time." }, 400);

  const { results: existing } = await c.env.DB.prepare("SELECT customer_name, city, serial, stage FROM jobs").all<{ customer_name: string; city: string; serial: string; stage: string }>();
  const serials = new Set(existing.map((e) => normSerialKey(e.serial)).filter(Boolean));
  // Without a serial, a job counts as already here if an open job has the same name and city.
  const openNames = new Set(existing.filter((e) => e.stage === "pipeline" || e.stage === "scheduled").map((e) => `${nameKey(baseCustomerName(e.customer_name))}|${nameKey(e.city)}`));

  const seen = new Set<string>();
  const preview: ImportPreviewRow[] = rows.map((r) => {
    const sk = normSerialKey(r.serial);
    const key = sk || `${nameKey(baseCustomerName(r.customerName))}|${nameKey(r.city)}`;
    if (seen.has(key)) return { ...r, status: "duplicate_in_list", reason: "Listed twice" };
    seen.add(key);
    if (sk && serials.has(sk)) return { ...r, status: "exists", reason: "Serial already on the site" };
    if (!sk && openNames.has(key)) return { ...r, status: "exists", reason: "Same name and city already open" };
    return { ...r, status: "new", reason: "" };
  });
  const toAdd = preview.filter((r) => r.status === "new");

  if (!b.commit) return c.json({ rows: preview, bad, newCount: toAdd.length });

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
  for (let i = 0; i < stmts.length; i += 80) await c.env.DB.batch(stmts.slice(i, i + 80));
  return c.json({ rows: preview, bad, added: toAdd.length, skipped: preview.length - toAdd.length });
});
