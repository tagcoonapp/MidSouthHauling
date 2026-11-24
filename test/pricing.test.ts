import { describe, expect, it } from "vitest";
import { DEFAULT_REPO_RATES, DEFAULT_SETTINGS, draftExpenses, namesMatch, parsePriceSheet, parseSerial, repoRateFor, shopBuildPercent, type ExpenseInput } from "../shared/pricing";

const prices = [
  { style: "CC", width: 12, length: 32, priceCents: 969500 },
  { style: "LB", width: 10, length: 16, priceCents: 459500 },
  { style: "LBC", width: 14, length: 32, priceCents: 1339500 },
];
const repoRates = DEFAULT_REPO_RATES;
const base: ExpenseInput = { jobType: "new", customerName: "Derrick Owens", serial: "UCC-34543-1232-090356", miles: 30, moody: false, lotTakenTo: "" };
const draft = (over: Partial<ExpenseInput>, settings = DEFAULT_SETTINGS) => draftExpenses({ ...base, ...over }, prices, repoRates, settings);

describe("serial numbers", () => {
  it("reads style and size", () => {
    expect(parseSerial("UCC-34543-1232-090356")).toEqual({ style: "CC", width: 12, length: 32 });
    expect(parseSerial(" ucc-34543-1232-090356 ")).toEqual({ style: "CC", width: 12, length: 32 });
    expect(parseSerial("ULB-1-0812-5")).toEqual({ style: "LB", width: 8, length: 12 });
    expect(parseSerial("ULB-1-812-5")).toEqual({ style: "LB", width: 8, length: 12 });
  });
  it("rejects junk", () => {
    expect(parseSerial("12345")).toBeNull();
    expect(parseSerial("")).toBeNull();
  });
});

describe("expense rules", () => {
  it("new = 5% of list price", () => {
    const d = draft({});
    expect(d.problems).toEqual([]);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]!.amountCents).toBe(48475);
    expect(d.lines[0]!.description).toContain("CC 12x32");
  });
  it("new with Moody = 10%", () => expect(draft({ moody: true }).lines[0]!.amountCents).toBe(96950));
  it("used = 5% even if Moody", () => expect(draft({ jobType: "used", moody: true }).lines[0]!.amountCents).toBe(48475));
  it("shop build tiers by 50 miles, boundary stays low", () => {
    expect([0, 30, 50, 50.5, 100, 101, 150, 151, 260].map(shopBuildPercent)).toEqual([10, 10, 10, 11, 11, 12, 12, 13, 15]);
    expect(draft({ jobType: "shop_build", miles: 75 }).lines[0]!.amountCents).toBe(106645); // 11% of 9695
  });
  it("repo pays by width and miles, plus a separate fuel expense", () => {
    const d = draft({ jobType: "repo", miles: 80, lotTakenTo: "Hartselle" }); // 12' wide, 51–100 mi
    expect(d.problems).toEqual([]);
    expect(d.lines.map((l) => [l.kind, l.amountCents])).toEqual([["main", 40000], ["fuel", 5000]]);
    expect(d.lines[1]!.description).toBe("DERRICK OWENS Fuel");
    const tenWide = (miles: number) => draft({ jobType: "repo", serial: "ULB-305353-1016-092126", miles, lotTakenTo: "x" }).lines[0]!.amountCents;
    expect([0, 50, 51, 100, 101, 150].map(tenWide)).toEqual([30000, 30000, 35000, 35000, 42500, 42500]);
    expect(draft({ jobType: "repo", miles: 120, lotTakenTo: "x" }).lines[0]!.amountCents).toBe(52500); // 12' wide, 101–150
  });
  it("repo over 150 miles asks for a custom amount", () => {
    const d = draft({ jobType: "repo", miles: 200, lotTakenTo: "x" });
    expect(d.lines.filter((l) => l.kind === "main")).toEqual([]);
    expect(d.problems[0]).toContain("over 150 miles");
  });
  it("14' and 16' wide repos pay a % of list price plus escort fees", () => {
    const wide = (over: Partial<ExpenseInput>) => draft({ jobType: "repo", serial: "ULBC-1-1432-1", lotTakenTo: "x", ...over });
    const noEscort = wide({ miles: 40 });
    expect(noEscort.problems).toContain("Enter the escort fees for this 14' wide repo (0 if none).");
    expect(noEscort.lines[0]!.amountCents).toBe(66975); // 5% of 13,395
    expect(wide({ miles: 40, escortCents: 25000 }).lines[0]!.amountCents).toBe(66975 + 25000);
    expect(wide({ miles: 75, escortCents: 0 }).lines[0]!.amountCents).toBe(80370); // 6%
    expect(wide({ miles: 75, escortCents: 0 }).problems).toEqual([]);
    expect(wide({ miles: 140, escortCents: 0 }).lines[0]!.amountCents).toBe(93765); // 7%
  });
  it("rate lookup uses the building width", () => {
    expect(repoRateFor(8, 10, repoRates)?.amountCents).toBe(30000);
    expect(repoRateFor(16, 10, repoRates)?.pct).toBe(5);
    expect(repoRateFor(9, 10, repoRates)).toBeNull();
  });
  it("fuel charge can be turned off", () => {
    expect(draft({ jobType: "repo", miles: 10, lotTakenTo: "x" }, { ...DEFAULT_SETTINGS, fuelChargeOn: false }).lines).toHaveLength(1);
  });
  it("attempted repo = $50, or $100 if the customer paid in full to keep it; no fuel", () => {
    const d = draft({ jobType: "attempted_repo", serial: "", keptPaidInFull: false });
    expect(d.lines.map((l) => l.amountCents)).toEqual([5000]);
    expect(d.problems).toEqual([]);
    expect(draft({ jobType: "attempted_repo", serial: "", keptPaidInFull: true }).lines.map((l) => l.amountCents)).toEqual([10000]);
    expect(draft({ jobType: "attempted_repo", serial: "" }).problems[0]).toContain("paid in full");
  });
  it("flags missing pieces instead of guessing", () => {
    expect(draft({ serial: "UXX-1-1010-1" }).problems[0]).toContain("XX 10x10 isn't on the price sheet");
    expect(draft({ jobType: "shop_build", miles: null }).problems).toContain("Miles are missing.");
    expect(draft({ jobType: "repo", miles: 20, lotTakenTo: "" }).problems).toContain("Lot taken to is missing.");
    expect(draftExpenses({ ...base, jobType: "repo", miles: 20, lotTakenTo: "x" }, prices, [], DEFAULT_SETTINGS).problems[0]).toContain("Pricing page");
    expect(draft({ serial: "UXX-1-1010-1" }).lines).toEqual([]);
  });
});

describe("private move", () => {
  it("is recorded only: no expense, no serial needed", () => {
    const d = draft({ jobType: "private_move", serial: "" });
    expect(d.lines).toEqual([]);
    expect(d.problems).toEqual([]);
  });
});

describe("2022 price sheet file", () => {
  it("parses every line, including both samples", async () => {
    const { readFileSync } = await import("node:fs");
    const { rows, bad } = parsePriceSheet(readFileSync("pricing/2022-hauling-base.txt", "utf8"));
    expect(bad).toEqual([]);
    expect(rows).toHaveLength(240);
    const find = (s: string, w: number, l: number) => rows.find((r) => r.style === s && r.width === w && r.length === l)?.priceCents;
    expect(find("CC", 12, 32)).toBe(969500);
    expect(find("LB", 10, 16)).toBe(459500); // ULB-305353-1016-092126
    expect(find("LBC", 10, 24)).toBe(759500); // ULBC-266321-1024-060323
    expect(find("CS", 6, 10)).toBe(279500);
  });
});

describe("helpers", () => {
  it("matches names loosely", () => {
    expect(namesMatch("Derrick Owens", "OWENS, DERRICK")).toBe(true);
    expect(namesMatch("Derrick Owens", "Derek Owens")).toBe(false);
  });
  it("reads pasted price sheets", () => {
    const { rows, bad } = parsePriceSheet("CC 12x32 9695\nCC,10x16,$4,250.00\nLB | 8 x 12 | 2995\nnonsense line");
    expect(rows).toEqual([
      { style: "CC", width: 12, length: 32, priceCents: 969500 },
      { style: "CC", width: 10, length: 16, priceCents: 425000 },
      { style: "LB", width: 8, length: 12, priceCents: 299500 },
    ]);
    expect(bad).toEqual(["nonsense line"]);
  });
});
