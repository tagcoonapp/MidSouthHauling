import { newId } from "./auth";
import { localToday } from "./dates";
import type { Env } from "./env";

/**
 * Jobs still "scheduled" on a day that has passed (the driver never submitted) go back to the pipeline:
 * driver and day are cleared, the missed day is kept for the tag, and the history notes it.
 * The driver's photos, answers and notes stay on the job.
 */
export async function rollOverMissedJobs(env: Env): Promise<number> {
  const today = localToday(env.TIMEZONE);
  const { results } = await env.DB.prepare(
    "SELECT j.id, j.scheduled_date, u.name AS driver FROM jobs j LEFT JOIN users u ON u.id = j.driver_id WHERE j.stage = 'scheduled' AND j.scheduled_date < ? LIMIT 200",
  ).bind(today).all<{ id: string; scheduled_date: string; driver: string | null }>();
  if (!results.length) return 0;
  await env.DB.batch(results.flatMap((r) => [
    env.DB.prepare(
      `UPDATE jobs SET stage = 'pipeline', missed_date = scheduled_date, scheduled_date = NULL, scheduled_time = NULL, driver_id = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND stage = 'scheduled'`,
    ).bind(r.id),
    env.DB.prepare("INSERT INTO job_events (id, job_id, user_id, kind, detail) VALUES (?, ?, NULL, 'schedule', ?)")
      .bind(newId(), r.id, `Not submitted on ${r.scheduled_date}${r.driver ? ` (${r.driver})` : ""}: moved back to the pipeline`),
  ]));
  return results.length;
}
