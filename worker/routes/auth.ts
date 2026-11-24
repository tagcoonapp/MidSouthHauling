import { Hono } from "hono";
import { permissionsFor, type Me } from "../../shared/domain";
import { endSession, endAllSessionsFor, hashPassword, newId, requireUser, startSession, verifyPassword } from "../auth";
import type { AppEnv } from "../env";

export const authRoutes = new Hono<AppEnv>();

const MIN_PASSWORD = 8;

function cleanUsername(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const u = v.trim().toLowerCase();
  return /^[a-z0-9._-]{2,40}$/.test(u) ? u : null;
}

/** First run: is there anyone yet? */
authRoutes.get("/setup", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return c.json({ needsSetup: (row?.n ?? 0) === 0 });
});

/** First run only: create the scheduler account. Refuses once any user exists. */
authRoutes.post("/setup", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const username = cleanUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!name || !username) return c.json({ error: "Enter your name and a username (letters and numbers)." }, 400);
  if (password.length < MIN_PASSWORD) return c.json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, 400);
  const { hash, salt } = await hashPassword(password);
  const id = newId();
  // Conditional insert so two simultaneous setups can't both succeed.
  const res = await c.env.DB.prepare(
    `INSERT INTO users (id, name, username, role, color, password_hash, password_salt)
     SELECT ?, ?, ?, 'scheduler', '#14213d', ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
  )
    .bind(id, name, username, hash, salt)
    .run();
  if (!res.meta.changes) return c.json({ error: "Setup is already done. Please sign in." }, 409);
  await startSession(c, id);
  return c.json({ ok: true });
});

authRoutes.post("/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if (c.env.LOGIN_LIMITER) {
    const { success } = await c.env.LOGIN_LIMITER.limit({ key: ip });
    if (!success) return c.json({ error: "Too many tries. Wait a minute and try again." }, 429);
  }
  const body = await c.req.json().catch(() => ({}));
  const username = cleanUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const user = username
    ? await c.env.DB.prepare("SELECT id, password_hash, password_salt, active FROM users WHERE username = ?")
        .bind(username)
        .first<{ id: string; password_hash: string; password_salt: string; active: number }>()
    : null;
  if (!user || !user.active || !(await verifyPassword(password, user.password_hash, user.password_salt))) {
    return c.json({ error: "Wrong username or password." }, 401);
  }
  await startSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, (c) => {
  const u = c.get("user");
  const me: Me = { ...u, permissions: permissionsFor(u.role) };
  return c.json(me);
});

authRoutes.post("/me/password", requireUser, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";
  if (next.length < MIN_PASSWORD) return c.json({ error: `New password must be at least ${MIN_PASSWORD} characters.` }, 400);
  const u = c.get("user");
  const row = await c.env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?")
    .bind(u.id)
    .first<{ password_hash: string; password_salt: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash, row.password_salt))) {
    return c.json({ error: "Your current password is wrong." }, 400);
  }
  const { hash, salt } = await hashPassword(next);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, u.id).run();
  await endAllSessionsFor(c.env.DB, u.id);
  await startSession(c, u.id);
  return c.json({ ok: true });
});

export { cleanUsername, MIN_PASSWORD };
