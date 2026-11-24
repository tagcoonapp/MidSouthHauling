import { describe, expect, it } from "vitest";
import { importInstructions, parseImport, parseJobType } from "../shared/import";

describe("lot after the name", () => {
  it("adds the lot to non-repo names and ticks Moody for New from Moody", async () => {
    const { importMoody } = await import("../shared/import");
    const { rows } = parseImport(JSON.stringify([
      { customerName: "Jade Gibbons", lot: "Henagar", jobType: "Used", serial: "A-1-1010-1" },
      { customerName: "Ron Tate", lot: "Henagar", jobType: "Repo", serial: "A-1-1010-2" },
      { customerName: "Al Try", lot: "Moody", jobType: "Attempted Repo" },
      { customerName: "Mo New", lot: "Moody", jobType: "New", serial: "A-1-1010-3" },
      { customerName: "Already | Moody", lot: "Moody", jobType: "New" },
    ]));
    expect(rows.map((r) => r.customerName)).toEqual(["Jade Gibbons | Henagar", "Ron Tate", "Al Try", "Mo New | Moody", "Already | Moody"]);
    expect(rows.map(importMoody)).toEqual([false, false, false, true, true]);
  });
  it("line format takes the lot as the 8th column", () => {
    expect(parseImport("Jade Gibbons | 1 Rd | Athens | | UCC-1-1232-1 | 0 | New | Henagar").rows[0]!.customerName).toBe("Jade Gibbons | Henagar");
  });
});

describe("NetSuite import parsing", () => {
  it("reads the JSON list Claude in Chrome pastes, with loose keys and money", () => {
    const { rows, bad } = parseImport(`Here you go:
\`\`\`json
[{"customerName":"William Temples","address":"123 Main St","city":"Moody","phone":"(205) 555-0100","serial":"ulb-305353-1016-092126","balance":"$0.00","jobType":"New"},
 {"Customer":"Brenda Rory","Delivery Address":"9 Elm","City":"Henagar","Building Inventory Number":"ULBC-266321-1024-060323","Balance Due":"3,085.43","Type":"customer purchase"},
 {"city":"Nowhere"}]
\`\`\``);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ customerName: "William Temples", serial: "ULB-305353-1016-092126", balanceCents: 0, jobType: "new" });
    expect(rows[1]).toMatchObject({ customerName: "Brenda Rory", address: "9 Elm", serial: "ULBC-266321-1024-060323", balanceCents: 308543, jobType: "used" });
    expect(bad).toHaveLength(1);
  });
  it("reads pipe or tab separated lines", () => {
    const { rows } = parseImport("Name | Address | City | Phone | Serial | Balance | Type\nPat Hollis | 5 Oak | Athens | 256-555-0101 | UCC-1-1232-1 | NDB | Shop Build\nAl\tx\ty");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ customerName: "Pat Hollis", balanceCents: 0, jobType: "shop_build", serial: "UCC-1-1232-1" });
    expect(rows[1]!.customerName).toBe("Al");
  });
  it("maps type words", () => {
    expect(parseJobType("Repossession")).toBe("repo");
    expect(parseJobType("attempted repo")).toBe("attempted_repo");
    expect(parseJobType("shop_build")).toBe("shop_build");
    expect(parseJobType(undefined)).toBe("new");
  });
  it("instructions point at the import page and forbid changing NetSuite", () => {
    const t = importInstructions("https://example.test");
    expect(t).toContain("https://example.test/import");
    expect(t).toMatch(/Do not change, submit or delete anything in NetSuite/);
  });
});
