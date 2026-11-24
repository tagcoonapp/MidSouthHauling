// Turns a job's address into map coordinates using free services, and caches the result on the job.
// 1. US Census geocoder (exact street matches; needs a state, so AL then GA are tried; it corrects the state itself)
// 2. OpenStreetMap Nominatim, limited to the Midsouth region (AL, GA, TN, MS and neighbors)
// 3. Town center only, marked approximate
import type { Env } from "./env";

export interface GeoResult { lat: number; lng: number; approx: boolean }
type Fetch = typeof fetch;

const UA = { "User-Agent": "MidsouthHaulingScheduler/1.0 (+https://midsouthhauling.tagcoon.workers.dev)" };
// lon/lat box around AL, GA, TN, MS and nearby, so "Moody" never lands in South Dakota.
const VIEWBOX = "-91.7,36.8,-80.8,30.1";
const HAS_STATE = /\b(AL|GA|TN|MS|SC|NC|FL|Alabama|Georgia|Tennessee|Mississippi)\b|\b\d{5}\b/i;

async function census(q: string, f: Fetch): Promise<GeoResult | null> {
  const u = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const r = await f(u);
  if (!r.ok) return null;
  const m = ((await r.json()) as { result?: { addressMatches?: { coordinates: { x: number; y: number } }[] } }).result?.addressMatches?.[0];
  return m ? { lat: m.coordinates.y, lng: m.coordinates.x, approx: false } : null;
}

async function nominatim(q: string, approx: boolean, f: Fetch): Promise<GeoResult | null> {
  const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`;
  const r = await f(u, { headers: UA });
  if (!r.ok) return null;
  const j = (await r.json()) as { lat: string; lon: string }[];
  return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon), approx } : null;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function geocodeAddress(address: string, city: string, f: Fetch = fetch): Promise<GeoResult | null> {
  const street = address.trim();
  const town = city.trim();
  const full = street && town && street.toLowerCase().includes(town.toLowerCase()) ? street : [street, town].filter(Boolean).join(", ");
  if (!full) return null;
  if (street && /\d/.test(street)) {
    const tries = HAS_STATE.test(full) ? [full] : [`${full}, AL`, `${full}, GA`];
    for (const q of tries) {
      const hit = await census(q, f).catch(() => null);
      if (hit) return hit;
    }
    const hit = await nominatim(full, false, f).catch(() => null);
    if (hit) return hit;
    await pause(1100); // Nominatim asks for at most one request per second
  }
  if (town) return nominatim(town, true, f).catch(() => null);
  return nominatim(full, true, f).catch(() => null);
}

/** Places up to `limit` un-placed pipeline/scheduled jobs on the map. Safe to call often. */
export async function geocodePending(env: Env, limit = 6): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT id, address, city FROM jobs WHERE geo_status = 'none' AND stage IN ('pipeline','scheduled') AND (address != '' OR city != '') LIMIT ?`,
  ).bind(limit).all<{ id: string; address: string; city: string }>();
  for (const j of results) {
    // Claim the job first so overlapping calls don't look the same address up twice.
    const claim = await env.DB.prepare("UPDATE jobs SET geo_status = 'working' WHERE id = ? AND geo_status = 'none'").bind(j.id).run();
    if (!claim.meta.changes) continue;
    const hit = await geocodeAddress(j.address, j.city).catch(() => null);
    await env.DB.prepare("UPDATE jobs SET geo_status = ?, lat = ?, lng = ?, geo_approx = ? WHERE id = ?")
      .bind(hit ? "ok" : "failed", hit?.lat ?? null, hit?.lng ?? null, hit?.approx ? 1 : 0, j.id)
      .run();
    await pause(1100);
  }
}
