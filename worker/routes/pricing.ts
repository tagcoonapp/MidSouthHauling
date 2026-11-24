import { Hono } from "hono";
import { parsePriceSheet } from "../../shared/pricing";
import { requirePermission } from "../auth";
import type { AppEnv } from "../env";
import { loadPricing } from "../pricing-store";

/** Price sheet, repo mileage rates and fuel charge. Scheduler only. */
export const pricingRoutes = new Hono<AppEnv>();
pricingRoutes.use("*", requirePermission("approveExpenses"));

pricingRoutes.get("/", async (c) => c.json(await loadPricing(c.env.DB)));

/** Replaces the whole price sheet with what was pasted. */
pricingRoutes.put("/prices", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const { rows, bad } = parsePriceSheet(typeof b.text === "string" ? b.text : "");
  if (!rows.length) return c.json({ error: "No prices found. Each line should look like: CC 12x32 9695", bad }, 400);
  if (bad.length && !b.ignoreBad) return c.json({ error: `${bad.length} line(s) couldn't be read.`, bad, readable: rows.length }, 400);
  const stmts = [c.env.DB.prepare("DELETE FROM price_list")];
  for (const r of rows) {
    stmts.push(
      c.env.DB.prepare("INSERT OR REPLACE INTO price_list (style, width, length, price_cents) VALUES (?, ?, ?, ?)").bind(r.style, r.width, r.length, r.priceCents),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ...(await loadPricing(c.env.DB)), saved: rows.length, skipped: bad });
});

/** Replaces the repo grid. Each cell is "$300" (flat) or "5%" (of list price, plus escort fees). */
pricingRoutes.put("/repo-rates", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const rates: unknown[] = Array.isArray(b.rates) ? b.rates : [];
  const clean: { width: number; upToMiles: number | null; amountCents: number | null; pct: number | null }[] = [];
  const seen = new Set<string>();
  for (const r of rates as { width?: unknown; upToMiles?: unknown; value?: unknown }[]) {
    const width = Number(r.width);
    const up = r.upToMiles === null || r.upToMiles === "" || r.upToMiles === undefined ? null : Number(r.upToMiles);
    const raw = String(r.value ?? "").trim();
    if (!Number.isInteger(width) || width < 4 || width > 20 || (up !== null && !(up > 0)) || !raw) {
      return c.json({ error: "Each cell needs a width, miles and an amount like $300 or 5%." }, 400);
    }
    const key = `${width}:${up}`;
    if (seen.has(key)) return c.json({ error: `Two rates for ${width}' wide, ${up ?? "and up"} miles.` }, 400);
    seen.add(key);
    if (raw.endsWith("%")) {
      const pct = Number(raw.slice(0, -1));
      if (!(pct > 0 && pct < 100)) return c.json({ error: `"${raw}" isn't a valid percentage.` }, 400);
      clean.push({ width, upToMiles: up, amountCents: null, pct });
    } else {
      const cents = Math.round(Number(raw.replace(/[$,]/g, "")) * 100);
      if (!(cents > 0)) return c.json({ error: `"${raw}" isn't a valid amount.` }, 400);
      clean.push({ width, upToMiles: up, amountCents: cents, pct: null });
    }
  }
  const stmts = [c.env.DB.prepare("DELETE FROM repo_rate_grid")];
  for (const r of clean) {
    stmts.push(c.env.DB.prepare("INSERT INTO repo_rate_grid (width, up_to_miles, amount_cents, pct) VALUES (?, ?, ?, ?)").bind(r.width, r.upToMiles, r.amountCents, r.pct));
  }
  await c.env.DB.batch(stmts);
  return c.json(await loadPricing(c.env.DB));
});

pricingRoutes.put("/settings", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const stmts: D1PreparedStatement[] = [];
  const put = (k: string, v: string) => stmts.push(c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, v));
  if (typeof b.fuelChargeOn === "boolean") put("fuelChargeOn", String(b.fuelChargeOn));
  for (const k of ["fuelCharge", "attemptedRepo", "attemptedRepoPaid"] as const) {
    if (b[k] !== undefined) {
      const cents = Math.round(Number(String(b[k]).replace(/[$,]/g, "")) * 100);
      if (!(cents >= 0)) return c.json({ error: "Amounts must be dollars." }, 400);
      put(`${k}Cents`, String(cents));
    }
  }
  if (!stmts.length) return c.json({ error: "Nothing to change." }, 400);
  await c.env.DB.batch(stmts);
  return c.json(await loadPricing(c.env.DB));
});
