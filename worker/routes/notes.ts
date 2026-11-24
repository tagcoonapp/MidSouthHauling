import { Hono } from "hono";
import type { CalendarNote } from "../../shared/domain";
import { newId, requirePermission } from "../auth";
import { isIsoDate } from "../dates";
import type { AppEnv } from "../env";

export const noteRoutes = new Hono<AppEnv>();

interface NoteRow { id: string; date: string; driver_id: string | null; driver_name: string | null; driver_color: string | null; text: string; sort_order: number; created_at: string }

export const toNote = (r: NoteRow): CalendarNote => ({
  id: r.id, date: r.date, driverId: r.driver_id, driverName: r.driver_name, driverColor: r.driver_color, text: r.text, sortOrder: r.sort_order, createdAt: r.created_at,
});
export const NOTE_SELECT = "SELECT n.*, u.name AS driver_name, u.color AS driver_color FROM calendar_notes n LEFT JOIN users u ON u.id = n.driver_id";

/** Next sort position at the end of a day (shared by jobs and notes). */
export async function endOfDay(db: D1Database, date: string, excludeId = ""): Promise<number> {
  const r = await db.prepare(
    `SELECT MAX(m) AS m FROM (
       SELECT COALESCE(MAX(sort_order), 0) AS m FROM jobs WHERE scheduled_date = ? AND stage != 'pipeline' AND id != ?
       UNION ALL SELECT COALESCE(MAX(sort_order), 0) FROM calendar_notes WHERE date = ? AND id != ?)`,
  ).bind(date, excludeId, date, excludeId).first<{ m: number }>();
  return (r?.m ?? 0) + 10;
}

async function getNote(db: D1Database, id: string) {
  return db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).bind(id).first<NoteRow>();
}

async function checkDriver(db: D1Database, v: unknown): Promise<string | null | "bad"> {
  if (v === null || v === "" || v === undefined) return null;
  const d = await db.prepare("SELECT id FROM users WHERE id = ? AND active = 1").bind(v).first<{ id: string }>();
  return d ? d.id : "bad";
}

noteRoutes.post("/", requirePermission("editSchedule"), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 500) : "";
  if (!text) return c.json({ error: "Type the note." }, 400);
  if (!isIsoDate(b.date)) return c.json({ error: "Pick a day." }, 400);
  const driverId = await checkDriver(c.env.DB, b.driverId);
  if (driverId === "bad") return c.json({ error: "That driver doesn't exist." }, 400);
  const id = newId();
  const order = Number.isInteger(b.sortOrder) ? b.sortOrder : await endOfDay(c.env.DB, b.date);
  await c.env.DB.prepare("INSERT INTO calendar_notes (id, date, driver_id, text, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, b.date, driverId, text, order, c.get("user").id).run();
  return c.json(toNote((await getNote(c.env.DB, id))!), 201);
});

noteRoutes.patch("/:id", requirePermission("editSchedule"), async (c) => {
  const note = await getNote(c.env.DB, c.req.param("id"));
  if (!note) return c.json({ error: "Note not found." }, 404);
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof b.text === "string") {
    const t = b.text.trim().slice(0, 500);
    if (!t) return c.json({ error: "A note can't be empty. Delete it instead." }, 400);
    sets.push("text = ?"); vals.push(t);
  }
  if (b.driverId !== undefined) {
    const d = await checkDriver(c.env.DB, b.driverId);
    if (d === "bad") return c.json({ error: "That driver doesn't exist." }, 400);
    sets.push("driver_id = ?"); vals.push(d);
  }
  if (b.date !== undefined) {
    if (!isIsoDate(b.date)) return c.json({ error: "Bad date." }, 400);
    sets.push("date = ?"); vals.push(b.date);
    if (b.sortOrder === undefined && b.date !== note.date) { sets.push("sort_order = ?"); vals.push(await endOfDay(c.env.DB, b.date, note.id)); }
  }
  if (Number.isInteger(b.sortOrder)) { sets.push("sort_order = ?"); vals.push(b.sortOrder); }
  if (!sets.length) return c.json({ error: "Nothing to change." }, 400);
  await c.env.DB.prepare(`UPDATE calendar_notes SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, note.id).run();
  return c.json(toNote((await getNote(c.env.DB, note.id))!));
});

noteRoutes.delete("/:id", requirePermission("editSchedule"), async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM calendar_notes WHERE id = ?").bind(c.req.param("id")).run();
  if (!res.meta.changes) return c.json({ error: "Note not found." }, 404);
  return c.json({ ok: true });
});
