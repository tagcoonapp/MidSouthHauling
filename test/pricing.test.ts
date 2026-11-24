import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, draftExpenses, namesMatch, parsePriceSheet, parseSerial, shopBuildPercent, type ExpenseInput, type RepoRate } from "../shared/pricing";

const prices = [{ style: "CC", width: 12, length: 32, priceCents: 969500 }];
const repoRates: RepoRate[] = [
  { upToMiles: 50, amountCents: 15000 },
  { upToMiles: 100, amountCents: 20000 },
  { upToMiles: null, amountCents: 30000 },
];
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
  it("repo uses the mileage rate and adds a separate fuel expense", () => {
    const d = draft({ jobType: "repo", miles: 80, lotTakenTo: "Hartselle" });
    expect(d.problems).toEqual([]);
    expect(d.lines.map((l) => [l.kind, l.amountCents])).toEqual([["main", 20000], ["fuel", 5000]]);
    expect(d.lines[1]!.description).toBe("DERRICK OWENS Fuel");
    expect(draft({ jobType: "repo", miles: 500, lotTakenTo: "x" }).lines[0]!.amountCents).toBe(30000);
  });
  it("fuel charge can be turned off", () => {
    expect(draft({ jobType: "repo", miles: 10, lotTakenTo: "x" }, { ...DEFAULT_SETTINGS, fuelChargeOn: false }).lines).toHaveLength(1);
  });
  it("attempted repo = $50, no fuel, no price needed", () => {
    const d = draft({ jobType: "attempted_repo", serial: "" });
    expect(d.lines.map((l) => l.amountCents)).toEqual([5000]);
    expect(d.problems).toEqual([]);
  });
  it("flags missing pieces instead of guessing", () => {
    expect(draft({ serial: "UXX-1-1010-1" }).problems[0]).toContain("XX 10x10 isn't on the price sheet");
    expect(draft({ jobType: "shop_build", miles: null }).problems).toContain("Miles are missing.");
    expect(draft({ jobType: "repo", miles: 20, lotTakenTo: "" }).problems).toContain("Lot taken to is missing.");
    expect(draftExpenses({ ...base, jobType: "repo", miles: 20, lotTakenTo: "x" }, prices, [], DEFAULT_SETTINGS).problems[0]).toContain("Pricing page");
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
