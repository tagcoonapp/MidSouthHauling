import { Hono } from "hono";
import type { SchedulingNote } from "../../shared/domain";
import { newId, requirePermission } from "../auth";
import type { AppEnv } from "../env";

// Office-only scheduling notes about a customer. Drivers can't reach any of these routes.
export const schedulingNoteRoutes = new Hono<AppEnv>();
schedulingNoteRoutes.use("*", requirePermission("editSchedule"));

interface Row {
  id: string; job_id: string | null; customer_name: string; text: string; created_by: string | null; author: string | null;
  created_at: string; done_at: string | null; done_by_name: string | null; job_stage: string | null; job_date: string | null;
}
const SELECT = `SELECT n.*, a.name AS author, d.name AS done_by_name, j.stage AS job_stage, j.scheduled_date AS job_date
  FROM scheduling_notes n LEFT JOIN users a ON a.id = n.created_by LEFT JOIN users d ON d.id = n.done_by LEFT JOIN jobs j ON j.id = n.job_id`;
const toNote = (r: Row): SchedulingNote => ({
  id: r.id, jobId: r.job_id, customerName: r.customer_name, text: r.text, author: r.author ?? "", createdAt: r.created_at,
  doneAt: r.done_at, doneBy: r.done_by_name, jobStage: r.job_stage, jobDate: r.job_date,
});
const one = async (db: D1Database, id: string) => db.prepare(`${SELECT} WHERE n.id = ?`).bind(id).first<Row>();

/** Open notes, plus done ones from the last 60 days with ?done=1. */
schedulingNoteRoutes.get("/", async (c) => {
  const withDone = c.req.query("done") === "1";
  const { results } = await c.env.DB.prepare(
    `${SELECT} WHERE n.done_at IS NULL ${withDone ? "OR n.done_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days')" : ""} ORDER BY n.done_at IS NOT NULL, n.created_at DESC LIMIT 500`,
  ).all<Row>();
  return c.json(results.map(toNote));
});

schedulingNoteRoutes.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 2000) : "";
  let name = typeof b.customerName === "string" ? b.customerName.trim().slice(0, 160) : "";
  let jobId: string | null = typeof b.jobId === "string" && b.jobId ? b.jobId : null;
  if (jobId) {
    const job = await c.env.DB.prepare("SELECT customer_name FROM jobs WHERE id = ?").bind(jobId).first<{ customer_name: string }>();
    if (!job) jobId = null;
    else if (!name) name = job.customer_name;
  }
  if (!name || !text) return c.json({ error: "Pick a customer and write the note." }, 400);
  const id = newId();
  await c.env.DB.prepare("INSERT INTO scheduling_notes (id, job_id, customer_name, text, created_by) VALUES (?, ?, ?, ?, ?)")
    .bind(id, jobId, name, text, c.get("user").id).run();
  return c.json(toNote((await one(c.env.DB, id))!), 201);
});

schedulingNoteRoutes.patch("/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof b.text === "string" && b.text.trim()) { sets.push("text = ?"); vals.push(b.text.trim().slice(0, 2000)); }
  if (typeof b.done === "boolean") {
    if (b.done) { sets.push("done_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", "done_by = ?"); vals.push(c.get("user").id); }
    else sets.push("done_at = NULL", "done_by = NULL");
  }
  if (!sets.length) return c.json({ error: "Nothing to change." }, 400);
  const res = await c.env.DB.prepare(`UPDATE scheduling_notes SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, c.req.param("id")).run();
  if (!res.meta.changes) return c.json({ error: "Not found." }, 404);
  return c.json(toNote((await one(c.env.DB, c.req.param("id")))!));
});

schedulingNoteRoutes.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM scheduling_notes WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
