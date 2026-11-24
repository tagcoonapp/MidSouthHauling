import { describe, expect, it } from "vitest";
import { daysOnUs, isShopBuildLot, mapCategory } from "../shared/domain";
import { parseImport } from "../shared/import";
import { geocodeAddress } from "../worker/geocode";

describe("map colors and shop-build lots", () => {
  it("colors pins by what the job is", () => {
    expect(mapCategory("new", "Ann | Henagar")).toBe("sale");
    expect(mapCategory("used", "Bo")).toBe("sale");
    expect(mapCategory("shop_build", "Cy")).toBe("shop_build");
    expect(mapCategory("repo", "Di | Mize")).toBe("repo");
    expect(mapCategory("attempted_repo", "Ed")).toBe("repo");
    expect(mapCategory("private_move", "Fi")).toBe("private_move");
  });
  it("Mize, South Fulton and Toccoa GA lots count as shop builds", () => {
    expect(["Mize", "South Fulton", "south  fulton", "Toccoa GA", "Toccoa, GA"].every(isShopBuildLot)).toBe(true);
    expect(["Moody", "Henagar", "", null].some(isShopBuildLot)).toBe(false);
    expect(mapCategory("new", "Gus | Toccoa GA")).toBe("shop_build");
  });
  it("imports jobs from those lots as Shop Builds (but not repos)", () => {
    const { rows } = parseImport(JSON.stringify([
      { customerName: "Hal", lot: "Mize", jobType: "New", serial: "A-1-1010-1" },
      { customerName: "Ivy", lot: "South Fulton", jobType: "Used", serial: "A-1-1010-2" },
      { customerName: "Jo", lot: "Mize", jobType: "Repo", serial: "A-1-1010-3" },
    ]));
    expect(rows.map((r) => [r.customerName, r.jobType])).toEqual([["Hal | Mize", "shop_build"], ["Ivy | South Fulton", "shop_build"], ["Jo", "repo"]]);
  });
  it("counts whole days on us", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(daysOnUs("2026-11-25T08:00:00Z", now)).toBe(0);
    expect(daysOnUs("2026-11-20T12:00:00Z", now)).toBe(5);
  });
});

describe("geocoding order", () => {
  const fakeFetch = (log: string[], answers: Record<string, unknown>) =>
    (async (url: string) => {
      const host = new URL(url).host;
      const q = new URL(url).searchParams.get(host.includes("census") ? "address" : "q")!;
      log.push(`${host.split(".")[0]}:${q}`);
      const body = answers[`${host.split(".")[0]}:${q}`] ?? (host.includes("census") ? { result: { addressMatches: [] } } : []);
      return new Response(JSON.stringify(body));
    }) as unknown as typeof fetch;

  it("tries Census with AL then GA, then OpenStreetMap in the region, then the town", async () => {
    const log: string[] = [];
    const r = await geocodeAddress("1 Nowhere Rd", "Moody", fakeFetch(log, { "nominatim:Moody": [{ lat: "33.59", lon: "-86.49" }] }));
    expect(log).toEqual(["geocoding:1 Nowhere Rd, Moody, AL", "geocoding:1 Nowhere Rd, Moody, GA", "nominatim:1 Nowhere Rd, Moody", "nominatim:Moody"]);
    expect(r).toEqual({ lat: 33.59, lng: -86.49, approx: true });
  });
  it("stops at the first exact match", async () => {
    const log: string[] = [];
    const r = await geocodeAddress("670 Park Ave", "Moody", fakeFetch(log, { "geocoding:670 Park Ave, Moody, AL": { result: { addressMatches: [{ coordinates: { x: -86.49, y: 33.589 } }] } } }));
    expect(log).toHaveLength(1);
    expect(r).toEqual({ lat: 33.589, lng: -86.49, approx: false });
  });
  it("uses the town only when there's no street number", async () => {
    const log: string[] = [];
    await geocodeAddress("", "Henagar", fakeFetch(log, {}));
    expect(log).toEqual(["nominatim:Henagar"]);
  });
});
