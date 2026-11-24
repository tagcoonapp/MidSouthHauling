import { Hono } from "hono";
import { parsePriceSheet } from "../../shared/pricing";
import { newId, requirePermission } from "../auth";
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

pricingRoutes.put("/repo-rates", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const rates: unknown[] = Array.isArray(b.rates) ? b.rates : [];
  const clean: { upToMiles: number | null; amountCents: number }[] = [];
  for (const r of rates as { upToMiles?: unknown; amount?: unknown }[]) {
    const up = r.upToMiles === null || r.upToMiles === "" || r.upToMiles === undefined ? null : Number(r.upToMiles);
    const amt = Math.round(Number(String(r.amount ?? "").replace(/[$,]/g, "")) * 100);
    if ((up !== null && !(up > 0)) || !(amt > 0)) return c.json({ error: "Each row needs miles (or blank for 'and up') and a dollar amount." }, 400);
    clean.push({ upToMiles: up, amountCents: amt });
  }
  if (clean.filter((r) => r.upToMiles === null).length > 1) return c.json({ error: "Only one 'and up' row." }, 400);
  const stmts = [c.env.DB.prepare("DELETE FROM repo_rates")];
  for (const r of clean) stmts.push(c.env.DB.prepare("INSERT INTO repo_rates (id, up_to_miles, amount_cents) VALUES (?, ?, ?)").bind(newId(), r.upToMiles, r.amountCents));
  await c.env.DB.batch(stmts);
  return c.json(await loadPricing(c.env.DB));
});

pricingRoutes.put("/settings", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const stmts: D1PreparedStatement[] = [];
  const put = (k: string, v: string) => stmts.push(c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, v));
  if (typeof b.fuelChargeOn === "boolean") put("fuelChargeOn", String(b.fuelChargeOn));
  for (const k of ["fuelCharge", "attemptedRepo"] as const) {
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
