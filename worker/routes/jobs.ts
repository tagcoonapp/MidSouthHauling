import { Hono, type Context } from "hono";
import {
  CALL_STATUS_LABELS,
  DRIVER_LOG_DAYS,
  JOB_TYPE_LABELS,
  MAX_PDF_BYTES,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_JOB,
  isCallStatus,
  isJobType,
  missingDriverAnswers,
  permissionsFor,
  type ApprovedExpense,
  type JobEvent,
  type JobType,
} from "../../shared/domain";
import { draftForJob, loadPricing } from "../pricing-store";
import { newId, requirePermission } from "../auth";
import { addDays, isIsoDate, localToday } from "../dates";
import type { AppEnv, SessionUser } from "../env";
import { toDriverJob, toOfficeJob, type JobRow, type PhotoRow } from "../serialize";

export const jobRoutes = new Hono<AppEnv>();

type C = Context<AppEnv>;

const JOB_SELECT = `SELECT j.*, u.name AS driver_name, u.color AS driver_color FROM jobs j LEFT JOIN users u ON u.id = j.driver_id`;

async function photosForJobs(db: D1Database, ids: string[]): Promise<PhotoRow[]> {
  if (!ids.length) return [];
  const out: PhotoRow[] = [];
  // D1 caps bound parameters per statement; chunk to stay well under it.
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { results } = await db
      .prepare(`SELECT id, job_id, created_at FROM job_photos WHERE job_id IN (${chunk.map(() => "?").join(",")}) ORDER BY created_at`)
      .bind(...chunk)
      .all<PhotoRow>();
    out.push(...results);
  }
  return out;
}

async function getJob(db: D1Database, id: string): Promise<JobRow | null> {
  return db.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(id).first<JobRow>();
}

async function logEvent(db: D1Database, jobId: string, userId: string, kind: string, detail = ""): Promise<void> {
  await db.prepare("INSERT INTO job_events (id, job_id, user_id, kind, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(newId(), jobId, userId, kind, detail)
    .run();
}

function driverLogCutoffIso(): string {
  return new Date(Date.now() - DRIVER_LOG_DAYS * 86400_000).toISOString();
}

/** Can this user see this job at all? Office roles see everything; drivers only their own scheduled work, for 60 days after submitting. */
function canSee(user: SessionUser, job: JobRow): boolean {
  if (permissionsFor(user.role).viewAllDrivers) return true;
  if (job.driver_id !== user.id || job.stage === "pipeline") return false;
  if (job.submitted_at && job.submitted_at < driverLogCutoffIso()) return false;
  return true;
}

/** May this user add photos/notes and submit? The assigned driver, or the scheduler on anyone's job. Locked once approved. */
function canWork(user: SessionUser, job: JobRow): boolean {
  if (job.stage !== "scheduled" && job.stage !== "submitted") return false;
  if (user.role === "scheduler") return true;
  return user.role === "driver" && job.driver_id === user.id;
}

async function respondJob(c: C, job: JobRow, withEvents = false) {
  const photos = await photosForJobs(c.env.DB, [job.id]);
  const user = c.get("user");
  if (!permissionsFor(user.role).viewFinancial) return c.json(toDriverJob(job, photos));
  const out = toOfficeJob(job, photos);
  if (job.stage === "submitted" && permissionsFor(user.role).viewPendingExpenses) out.draft = draftForJob(job, await loadPricing(c.env.DB));
  if (job.stage === "approved") out.expenses = await expensesFor(c.env.DB, [job.id]);
  if (withEvents) {
    const { results } = await c.env.DB.prepare(
      `SELECT e.id, e.kind, e.detail, e.created_at, COALESCE(u.name, 'System') AS user_name
       FROM job_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.job_id = ? ORDER BY e.created_at DESC LIMIT 100`,
    )
      .bind(job.id)
      .all<{ id: string; kind: string; detail: string; created_at: string; user_name: string }>();
    out.events = results.map((e): JobEvent => ({ id: e.id, kind: e.kind, detail: e.detail, userName: e.user_name, createdAt: e.created_at }));
  }
  return c.json(out);
}

async function expensesFor(db: D1Database, jobIds: string[]): Promise<(ApprovedExpense & { jobId: string })[]> {
  if (!jobIds.length) return [];
  const out: (ApprovedExpense & { jobId: string })[] = [];
  for (let i = 0; i < jobIds.length; i += 50) {
    const chunk = jobIds.slice(i, i + 50);
    const { results } = await db
      .prepare(`SELECT * FROM expenses WHERE job_id IN (${chunk.map(() => "?").join(",")}) ORDER BY kind DESC`)
      .bind(...chunk)
      .all<{ id: string; job_id: string; kind: "main" | "fuel"; description: string; basis: string; amount_cents: number; approved_at: string; entered_at: string | null }>();
    out.push(...results.map((e) => ({
      id: e.id, jobId: e.job_id, kind: e.kind, description: e.description, basis: e.basis, amountCents: e.amount_cents, approvedAt: e.approved_at, enteredAt: e.entered_at,
    })));
  }
  return out;
}

function parseMiles(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 5000 ? Math.round(n * 10) / 10 : undefined;
}

const str = (v: unknown, max = 500): string | undefined => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

function parseBalance(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

// ---------- Office: board (pipeline + calendar) ----------

jobRoutes.get("/board", requirePermission("viewPipeline"), async (c) => {
  const today = localToday(c.env.TIMEZONE);
  const from = isIsoDate(c.req.query("from")) ? c.req.query("from")! : today;
  const to = isIsoDate(c.req.query("to")) ? c.req.query("to")! : addDays(from, 6);
  const [pipeline, scheduled] = await Promise.all([
    c.env.DB.prepare(`${JOB_SELECT} WHERE j.stage = 'pipeline' ORDER BY j.sort_order, j.created_at`).all<JobRow>(),
    c.env.DB.prepare(
      `${JOB_SELECT} WHERE j.stage != 'pipeline' AND j.scheduled_date BETWEEN ? AND ? ORDER BY j.scheduled_date, j.sort_order, j.created_at`,
    )
      .bind(from, to)
      .all<JobRow>(),
  ]);
  const all = [...pipeline.results, ...scheduled.results];
  const photos = await photosForJobs(c.env.DB, all.map((j) => j.id));
  return c.json({
    today,
    from,
    to,
    pipeline: pipeline.results.map((j) => toOfficeJob(j, photos)),
    scheduled: scheduled.results.map((j) => toOfficeJob(j, photos)),
  });
});

jobRoutes.post("/", requirePermission("editSchedule"), async (c) => {
  const user = c.get("user");
  const b = await c.req.json().catch(() => ({}));
  const customerName = str(b.customerName, 120);
  if (!customerName) return c.json({ error: "Enter the customer's name." }, 400);
  if (!isJobType(b.jobType)) return c.json({ error: "Pick a job type." }, 400);
  const balance = parseBalance(b.balance);
  if (b.balance !== undefined && b.balance !== null && b.balance !== "" && balance === undefined) {
    return c.json({ error: "Balance must be a dollar amount." }, 400);
  }
  const serial = str(b.serial, 60) ?? "";
  if (serial) {
    const dupe = await c.env.DB.prepare("SELECT id FROM jobs WHERE serial = ? AND stage IN ('pipeline','scheduled') LIMIT 1")
      .bind(serial)
      .first<{ id: string }>();
    if (dupe && !b.allowDuplicate) return c.json({ error: "A job with this serial number is already open.", duplicateOf: dupe.id }, 409);
  }
  const id = newId();
  const maxOrder = await c.env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM jobs WHERE stage = 'pipeline'").first<{ m: number }>();
  await c.env.DB.prepare(
    `INSERT INTO jobs (id, customer_name, address, city, phone, serial, building, balance_cents, job_type, office_notes, sort_order, source, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, customerName, str(b.address) ?? "", str(b.city, 80) ?? "", str(b.phone, 40) ?? "", serial, str(b.building, 120) ?? "",
      balance ?? null, b.jobType, str(b.officeNotes, 2000) ?? "", (maxOrder?.m ?? 0) + 1, str(b.source, 30) || "manual", user.id,
    )
    .run();
  await logEvent(c.env.DB, id, user.id, "created", `Added to pipeline (${JOB_TYPE_LABELS[b.jobType as keyof typeof JOB_TYPE_LABELS]})`);
  return c.json(toOfficeJob((await getJob(c.env.DB, id))!, []), 201);
});

jobRoutes.patch("/:id", requirePermission("editSchedule"), async (c) => {
  const user = c.get("user");
  const job = await getJob(c.env.DB, c.req.param("id"));
  if (!job) return c.json({ error: "Job not found." }, 404);
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: unknown[] = [];
  const events: [string, string][] = [];
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };

  for (const [key, col, max] of [
    ["customerName", "customer_name", 120], ["address", "address", 500], ["city", "city", 80], ["phone", "phone", 40],
    ["serial", "serial", 60], ["building", "building", 120], ["officeNotes", "office_notes", 2000], ["scheduledTime", "scheduled_time", 20],
  ] as const) {
    const v = str(b[key], max);
    if (v !== undefined) {
      if (key === "customerName" && !v) return c.json({ error: "Customer name can't be empty." }, 400);
      set(col, v);
    }
  }
  if (b.balance !== undefined) {
    const bal = parseBalance(b.balance);
    if (bal === undefined) return c.json({ error: "Balance must be a dollar amount." }, 400);
    set("balance_cents", bal);
  }
  if (b.jobType !== undefined) {
    const jt: unknown = b.jobType;
    if (!isJobType(jt)) return c.json({ error: "Pick a job type." }, 400);
    if (jt !== job.job_type) { set("job_type", jt); events.push(["job_type", `Job type → ${JOB_TYPE_LABELS[jt]}`]); }
  }
  if (b.callStatus !== undefined) {
    const cs: unknown = b.callStatus;
    if (!isCallStatus(cs)) return c.json({ error: "Unknown call status." }, 400);
    set("call_status", cs);
    if (cs === "attempted") {
      sets.push("call_attempts = call_attempts + 1");
      events.push(["call", `Call attempt #${job.call_attempts + 1}${b.callNote ? `: ${str(b.callNote, 300)}` : ""}`]);
    } else if (cs !== job.call_status) {
      events.push(["call", `${CALL_STATUS_LABELS[cs]}${b.callNote ? `: ${str(b.callNote, 300)}` : ""}`]);
    }
  }
  if (b.sortOrder !== undefined && Number.isInteger(b.sortOrder)) set("sort_order", b.sortOrder);

  // Expense review fields: scheduler only, and frozen once approved.
  const reviewKeys = ["moody", "miles", "lotTakenTo", "reportedCustomerName", "amountOverride"];
  if (reviewKeys.some((k) => b[k] !== undefined)) {
    if (!permissionsFor(user.role).approveExpenses) return c.json({ error: "Only the scheduler can change expense details." }, 403);
    if (job.stage === "approved") return c.json({ error: "This job is approved; its expense is locked." }, 400);
    if (typeof b.moody === "boolean") { set("moody", b.moody ? 1 : 0); events.push(["review", b.moody ? "Marked Moody (10%)" : "Unmarked Moody"]); }
    const miles = parseMiles(b.miles);
    if (b.miles !== undefined) { if (miles === undefined) return c.json({ error: "Miles must be a number." }, 400); set("miles", miles); }
    const lot = str(b.lotTakenTo, 120); if (lot !== undefined) set("lot_taken_to", lot);
    const rn = str(b.reportedCustomerName, 120); if (rn !== undefined) set("reported_customer_name", rn);
    if (b.amountOverride !== undefined) {
      const amt = parseBalance(b.amountOverride);
      if (amt === undefined) return c.json({ error: "Amount must be dollars." }, 400);
      set("amount_override_cents", amt);
      events.push(["review", amt === null ? "Cleared custom amount" : `Set expense amount to $${(amt / 100).toFixed(2)}`]);
    }
  }

  let driverId = job.driver_id;
  if (b.driverId !== undefined) {
    if (b.driverId === null || b.driverId === "") driverId = null;
    else {
      const d = await c.env.DB.prepare("SELECT id, name FROM users WHERE id = ? AND active = 1").bind(b.driverId).first<{ id: string; name: string }>();
      if (!d) return c.json({ error: "That driver doesn't exist." }, 400);
      driverId = d.id;
      if (d.id !== job.driver_id) events.push(["assign", `Assigned to ${d.name}`]);
    }
    set("driver_id", driverId);
  }

  if (b.scheduledDate !== undefined) {
    if (job.stage === "submitted" || job.stage === "approved") return c.json({ error: "This job is already done; it can't be moved." }, 400);
    if (b.scheduledDate === null) {
      set("scheduled_date", null);
      set("stage", "pipeline");
      events.push(["unscheduled", "Moved back to pipeline"]);
    } else {
      if (!isIsoDate(b.scheduledDate)) return c.json({ error: "Bad date." }, 400);
      set("scheduled_date", b.scheduledDate);
      set("stage", "scheduled");
      if (b.scheduledDate !== job.scheduled_date) events.push(["scheduled", `Scheduled for ${b.scheduledDate}`]);
    }
  }
  const finalStage = b.scheduledDate === null ? "pipeline" : b.scheduledDate !== undefined ? "scheduled" : job.stage;
  if (finalStage === "scheduled" && !driverId) return c.json({ error: "Pick a driver for this day." }, 400);

  if (!sets.length) return c.json({ error: "Nothing to change." }, 400);
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  await c.env.DB.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, job.id).run();
  for (const [kind, detail] of events) await logEvent(c.env.DB, job.id, user.id, kind, detail);
  return respondJob(c, (await getJob(c.env.DB, job.id))!, true);
});

jobRoutes.delete("/:id", requirePermission("editSchedule"), async (c) => {
  const job = await getJob(c.env.DB, c.req.param("id"));
  if (!job) return c.json({ error: "Job not found." }, 404);
  if (job.stage === "submitted" || job.stage === "approved") return c.json({ error: "Finished jobs can't be deleted." }, 400);
  const { results } = await c.env.DB.prepare("SELECT r2_key FROM job_photos WHERE job_id = ?").bind(job.id).all<{ r2_key: string }>();
  const keys = results.map((r) => r.r2_key);
  if (job.pdf_key) keys.push(job.pdf_key);
  if (keys.length) await c.env.FILES.delete(keys);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM job_photos WHERE job_id = ?").bind(job.id),
    c.env.DB.prepare("DELETE FROM job_events WHERE job_id = ?").bind(job.id),
    c.env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(job.id),
  ]);
  return c.json({ ok: true });
});

// ---------- Customer PDF ----------

jobRoutes.put("/:id/pdf", requirePermission("editSchedule"), async (c) => {
  const job = await getJob(c.env.DB, c.req.param("id"));
  if (!job) return c.json({ error: "Job not found." }, 404);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "Choose a PDF file." }, 400);
  if (file.type !== "application/pdf") return c.json({ error: "Only PDF files." }, 400);
  if (file.size > MAX_PDF_BYTES) return c.json({ error: "PDF is too large (20 MB max)." }, 400);
  const key = `pdfs/${job.id}/${newId()}.pdf`;
  await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: "application/pdf" } });
  if (job.pdf_key) await c.env.FILES.delete(job.pdf_key);
  await c.env.DB.prepare("UPDATE jobs SET pdf_key = ? WHERE id = ?").bind(key, job.id).run();
  await logEvent(c.env.DB, job.id, c.get("user").id, "pdf", "Customer PDF uploaded");
  return respondJob(c, (await getJob(c.env.DB, job.id))!, true);
});

jobRoutes.get("/:id/pdf", async (c) => {
  const job = await getJob(c.env.DB, c.req.param("id"));
  if (!job || !canSee(c.get("user"), job) || !job.pdf_key) return c.json({ error: "Not found." }, 404);
  const obj = await c.env.FILES.get(job.pdf_key);
  if (!obj) return c.json({ error: "Not found." }, 404);
  return new Response(obj.body, {
    headers: { "content-type": "application/pdf", "cache-control": "private, max-age=300", "content-disposition": "inline" },
  });
});

// ---------- One job (any role, filtered) ----------

jobRoutes.get("/:id", async (c) => {
  const job = await getJob(c.env.DB, c.req.param("id"));
  if (!job || !canSee(c.get("user"), job)) return c.json({ error: "Job not found." }, 404);
  return respondJob(c, job, true);
});

// ---------- Driver work: job type, notes, photos, submit ----------

jobRoutes.patch("/:id/work", requirePermission("submitJobs"), async (c) => {
  const user = c.get("user");
  const job = await getJob(c.env.DB, c.req.param("id"));
  if (!job || !canSee(user, job)) return c.json({ error: "Job not found." }, 404);
  if (!canWork(user, job)) return c.json({ error: "This job is locked." }, 400);
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.jobType !== undefined) {
    const jt: unknown = b.jobType;
    if (!isJobType(jt)) return c.json({ error: "Pick a job type." }, 400);
    sets.push("job_type = ?"); vals.push(jt);
    if (jt !== job.job_type) await logEvent(c.env.DB, job.id, user.id, "job_type", `Driver set job type → ${JOB_TYPE_LABELS[jt]}`);
  }
  const notes = str(b.driverNotes, 4000);
  if (notes !== undefined) { sets.push("driver_notes = ?"); vals.push(notes); }
  const rn = str(b.reportedCustomerName, 120);
  if (rn !== undefined) { sets.push("reported_customer_name = ?"); vals.push(rn); }
  const miles = parseMiles(b.miles);
  if (b.miles !== undefined) {
    if (miles === undefined) return c.json({ error: "Miles must be a number." }, 400);
    sets.push("miles = ?"); vals.push(miles);
  }
  const lot = str(b.lotTakenTo, 120);
  if (lot !== undefined) { sets.push("lot_taken_to = ?"); vals.push(lot); }
  if (!sets.length) return c.json({ error: "Nothing to change." }, 400);
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  await c.env.DB.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, job.id).run();
  return respondJob(c, (await getJob(c.env.DB, job.id))!);
});

jobRoutes.post("/:id/photos", requirePermission("submitJobs"), async (c) => {
  const user = c.get("user");
  const job = await getJob(c.env.DB, c.req.param("id"));
  if (!job || !canSee(user, job)) return c.json({ error: "Job not found." }, 404);
  if (!canWork(user, job)) return c.json({ error: "This job is locked." }, 400);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "Choose a photo." }, 400);
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return c.json({ error: "Photos must be JPG, PNG, WebP or HEIC." }, 400);
  if (file.size > MAX_PHOTO_BYTES) return c.json({ error: "Photo is too large (10 MB max)." }, 400);
  const id = newId();
  const key = `photos/${job.id}/${id}`;
  // Reserve the slot first so two uploads at once can't make a fifth photo.
  const res = await c.env.DB.prepare(
    `INSERT INTO job_photos (id, job_id, r2_key, content_type, size_bytes, uploaded_by)
     SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM job_photos WHERE job_id = ?) < ?`,
  )
    .bind(id, job.id, key, file.type, file.size, user.id, job.id, MAX_PHOTOS_PER_JOB)
    .run();
  if (!res.meta.changes) return c.json({ error: `A job can have ${MAX_PHOTOS_PER_JOB} photos at most. Delete one first.` }, 400);
  try {
    await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  } catch (e) {
    await c.env.DB.prepare("DELETE FROM job_photos WHERE id = ?").bind(id).run();
    throw e;
  }
  return respondJob(c, (await getJob(c.env.DB, job.id))!);
});

jobRoutes.post("/:id/submit", requirePermission("submitJobs"), async (c) => {
  const user = c.get("user");
  const job = await getJob(c.env.DB, c.req.param("id"));
  if (!job || !canSee(user, job)) return c.json({ error: "Job not found." }, 404);
  if (job.stage !== "scheduled" || !canWork(user, job)) return c.json({ error: "This job was already submitted." }, 400);
  const missing = missingDriverAnswers({ jobType: job.job_type as JobType, reportedCustomerName: job.reported_customer_name, miles: job.miles, lotTakenTo: job.lot_taken_to });
  if (missing.length) return c.json({ error: `Fill in: ${missing.join(", ")}.`, missing }, 400);
  await c.env.DB.prepare(
    "UPDATE jobs SET stage = 'submitted', submitted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND stage = 'scheduled'",
  )
    .bind(job.id)
    .run();
  await logEvent(c.env.DB, job.id, user.id, "submitted", `Submitted as ${JOB_TYPE_LABELS[job.job_type as keyof typeof JOB_TYPE_LABELS]}`);
  return respondJob(c, (await getJob(c.env.DB, job.id))!);
});

// ---------- Scheduler review (pending) ----------

jobRoutes.post("/:id/approve", requirePermission("approveExpenses"), async (c) => {
  const job = await getJob(c.env.DB, c.req.param("id"));
  if (!job) return c.json({ error: "Job not found." }, 404);
  if (job.stage !== "submitted") return c.json({ error: "Only submitted jobs can be approved." }, 400);
  const b = await c.req.json().catch(() => ({}));
  const draft = draftForJob(job, await loadPricing(c.env.DB));
  if (!draft.lines.length) return c.json({ error: "There's no amount to approve yet. Fix the problems or type an amount.", problems: draft.problems }, 400);
  if (draft.problems.length && !b.force) return c.json({ error: "Check these first, or approve anyway.", problems: draft.problems }, 409);
  const userId = c.get("user").id;
  const res = await c.env.DB.prepare("UPDATE jobs SET stage = 'approved', approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND stage = 'submitted'").bind(job.id).run();
  if (!res.meta.changes) return c.json({ error: "Already approved." }, 409);
  await c.env.DB.batch(
    draft.lines.map((l) =>
      c.env.DB.prepare("INSERT INTO expenses (id, job_id, kind, description, basis, amount_cents, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(newId(), job.id, l.kind, l.description, l.basis, l.amountCents, userId),
    ),
  );
  const total = draft.lines.reduce((t, l) => t + l.amountCents, 0);
  await logEvent(c.env.DB, job.id, userId, "approved", `Approved $${(total / 100).toFixed(2)}${draft.lines.length > 1 ? ` (${draft.lines.length} expenses)` : ""}`);
  return respondJob(c, (await getJob(c.env.DB, job.id))!, true);
});

jobRoutes.post("/:id/send-back", requirePermission("approveExpenses"), async (c) => {
  const job = await getJob(c.env.DB, c.req.param("id"));
  if (!job) return c.json({ error: "Job not found." }, 404);
  if (job.stage !== "submitted") return c.json({ error: "Only submitted jobs can be sent back." }, 400);
  const b = await c.req.json().catch(() => ({}));
  const reason = str(b.reason, 500) ?? "";
  await c.env.DB.prepare(
    "UPDATE jobs SET stage = 'scheduled', submitted_at = NULL, office_notes = CASE WHEN ? = '' THEN office_notes ELSE ? END WHERE id = ?",
  )
    .bind(reason, `Sent back: ${reason}\n${job.office_notes}`.trim(), job.id)
    .run();
  await logEvent(c.env.DB, job.id, c.get("user").id, "sent_back", reason ? `Sent back to driver: ${reason}` : "Sent back to driver");
  return respondJob(c, (await getJob(c.env.DB, job.id))!, true);
});

jobRoutes.post("/:id/entered", requirePermission("approveExpenses"), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const entered = b.entered !== false;
  const res = await c.env.DB.prepare(
    "UPDATE expenses SET entered_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END WHERE job_id = ?",
  ).bind(entered ? 1 : 0, c.req.param("id")).run();
  if (!res.meta.changes) return c.json({ error: "No approved expenses on this job." }, 404);
  await logEvent(c.env.DB, c.req.param("id"), c.get("user").id, "entered", entered ? "Marked entered in NetSuite" : "Unmarked entered in NetSuite");
  return c.json({ ok: true });
});

// ---------- Lists ----------

export const listRoutes = new Hono<AppEnv>();

/** A driver's own schedule for a date range. Never includes pipeline jobs or other drivers. */
listRoutes.get("/my/schedule", async (c) => {
  const user = c.get("user");
  const today = localToday(c.env.TIMEZONE);
  const from = isIsoDate(c.req.query("from")) ? c.req.query("from")! : today;
  const to = isIsoDate(c.req.query("to")) ? c.req.query("to")! : from;
  const { results } = await c.env.DB.prepare(
    `${JOB_SELECT} WHERE j.driver_id = ? AND j.stage != 'pipeline' AND j.scheduled_date BETWEEN ? AND ?
     ORDER BY j.scheduled_date, j.sort_order, j.created_at`,
  )
    .bind(user.id, from, to)
    .all<JobRow>();
  const photos = await photosForJobs(c.env.DB, results.map((j) => j.id));
  return c.json({ today, from, to, jobs: results.map((j) => toDriverJob(j, photos)) });
});

/** A driver's own submitted jobs from the last 60 days. */
listRoutes.get("/my/log", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `${JOB_SELECT} WHERE j.driver_id = ? AND j.stage IN ('submitted','approved') AND j.submitted_at >= ? ORDER BY j.submitted_at DESC`,
  )
    .bind(user.id, driverLogCutoffIso())
    .all<JobRow>();
  const photos = await photosForJobs(c.env.DB, results.map((j) => j.id));
  return c.json({ today: localToday(c.env.TIMEZONE), jobs: results.map((j) => toDriverJob(j, photos)) });
});

listRoutes.get("/pending", requirePermission("viewPendingExpenses"), async (c) => {
  const { results } = await c.env.DB.prepare(`${JOB_SELECT} WHERE j.stage = 'submitted' ORDER BY j.submitted_at`).all<JobRow>();
  const photos = await photosForJobs(c.env.DB, results.map((j) => j.id));
  const pricing = await loadPricing(c.env.DB);
  return c.json(results.map((j) => ({ ...toOfficeJob(j, photos), draft: draftForJob(j, pricing) })));
});

listRoutes.get("/completed", requirePermission("viewFinancial"), async (c) => {
  const { results } = await c.env.DB.prepare(`${JOB_SELECT} WHERE j.stage = 'approved' ORDER BY j.approved_at DESC LIMIT 500`).all<JobRow>();
  const [photos, expenses] = await Promise.all([photosForJobs(c.env.DB, results.map((j) => j.id)), expensesFor(c.env.DB, results.map((j) => j.id))]);
  return c.json(results.map((j) => ({ ...toOfficeJob(j, photos), expenses: expenses.filter((e) => e.jobId === j.id) })));
});

/** Lot names used before, to suggest when a driver fills in "lot taken to". */
listRoutes.get("/lots", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT lot_taken_to AS name, COUNT(*) AS n FROM jobs WHERE lot_taken_to != '' GROUP BY lot_taken_to COLLATE NOCASE ORDER BY n DESC LIMIT 30",
  ).all<{ name: string }>();
  return c.json(results.map((r) => r.name));
});

// ---------- Photos ----------

export const photoRoutes = new Hono<AppEnv>();

async function photoWithJob(c: C) {
  const photo = await c.env.DB.prepare("SELECT id, job_id, r2_key, content_type FROM job_photos WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ id: string; job_id: string; r2_key: string; content_type: string }>();
  if (!photo) return null;
  const job = await getJob(c.env.DB, photo.job_id);
  if (!job || !canSee(c.get("user"), job)) return null;
  return { photo, job };
}

photoRoutes.get("/:id", async (c) => {
  const found = await photoWithJob(c);
  if (!found) return c.json({ error: "Not found." }, 404);
  const obj = await c.env.FILES.get(found.photo.r2_key);
  if (!obj) return c.json({ error: "Not found." }, 404);
  return new Response(obj.body, { headers: { "content-type": found.photo.content_type, "cache-control": "private, max-age=86400" } });
});

photoRoutes.delete("/:id", requirePermission("submitJobs"), async (c) => {
  const found = await photoWithJob(c);
  if (!found) return c.json({ error: "Not found." }, 404);
  if (!canWork(c.get("user"), found.job)) return c.json({ error: "This job is locked." }, 400);
  await c.env.FILES.delete(found.photo.r2_key);
  await c.env.DB.prepare("DELETE FROM job_photos WHERE id = ?").bind(found.photo.id).run();
  return c.json({ ok: true });
});
