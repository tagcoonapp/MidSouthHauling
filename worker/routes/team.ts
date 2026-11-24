import { Hono } from "hono";
import { DRIVER_COLORS, isRole, type TeamMember } from "../../shared/domain";
import { endAllSessionsFor, hashPassword, newId, requirePermission } from "../auth";
import type { AppEnv } from "../env";
import { cleanUsername, MIN_PASSWORD } from "./auth";

export const teamRoutes = new Hono<AppEnv>();

interface UserRow {
  id: string;
  name: string;
  username: string;
  role: string;
  color: string;
  active: number;
}

const toMember = (r: UserRow): TeamMember => ({
  id: r.id,
  name: r.name,
  username: r.username,
  role: r.role as TeamMember["role"],
  color: r.color,
  active: !!r.active,
});

const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/** Office roles need the driver list to schedule; only the scheduler sees usernames of everyone. */
teamRoutes.get("/", requirePermission("editSchedule"), async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, username, role, color, active FROM users ORDER BY active DESC, role, name",
  ).all<UserRow>();
  return c.json(results.map(toMember));
});

teamRoutes.post("/", requirePermission("manageTeam"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const username = cleanUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!name || !username) return c.json({ error: "Enter a name and a username (letters and numbers, no spaces)." }, 400);
  if (!isRole(body.role)) return c.json({ error: "Pick a role." }, 400);
  if (password.length < MIN_PASSWORD) return c.json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, 400);
  let color = isColor(body.color) ? body.color : null;
  if (!color) {
    const { results } = await c.env.DB.prepare("SELECT color FROM users WHERE role = 'driver'").all<{ color: string }>();
    const used = new Set(results.map((r) => r.color));
    color = DRIVER_COLORS.find((x) => !used.has(x)) ?? DRIVER_COLORS[0]!;
  }
  const { hash, salt } = await hashPassword(password);
  const id = newId();
  try {
    await c.env.DB.prepare(
      "INSERT INTO users (id, name, username, role, color, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, name, username, body.role, color, hash, salt)
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) return c.json({ error: "That username is taken." }, 409);
    throw e;
  }
  const row = await c.env.DB.prepare("SELECT id, name, username, role, color, active FROM users WHERE id = ?").bind(id).first<UserRow>();
  return c.json(toMember(row!), 201);
});

teamRoutes.patch("/:id", requirePermission("manageTeam"), async (c) => {
  const id = c.req.param("id");
  const me = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.name === "string" && body.name.trim()) { sets.push("name = ?"); vals.push(body.name.trim()); }
  if (isColor(body.color)) { sets.push("color = ?"); vals.push(body.color); }
  if (body.role !== undefined) {
    if (!isRole(body.role)) return c.json({ error: "Pick a role." }, 400);
    if (id === me.id && body.role !== "scheduler") return c.json({ error: "You can't remove your own scheduler access." }, 400);
    sets.push("role = ?"); vals.push(body.role);
  }
  if (typeof body.active === "boolean") {
    if (id === me.id && !body.active) return c.json({ error: "You can't turn off your own account." }, 400);
    sets.push("active = ?"); vals.push(body.active ? 1 : 0);
  }
  let resetPassword = false;
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < MIN_PASSWORD) return c.json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, 400);
    const { hash, salt } = await hashPassword(body.password);
    sets.push("password_hash = ?", "password_salt = ?"); vals.push(hash, salt);
    resetPassword = true;
  }
  if (!sets.length) return c.json({ error: "Nothing to change." }, 400);
  const res = await c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  if (!res.meta.changes) return c.json({ error: "Not found." }, 404);
  if (resetPassword || body.active === false) await endAllSessionsFor(c.env.DB, id);
  const row = await c.env.DB.prepare("SELECT id, name, username, role, color, active FROM users WHERE id = ?").bind(id).first<UserRow>();
  return c.json(toMember(row!));
});
