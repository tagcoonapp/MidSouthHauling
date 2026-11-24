import { describe, expect, it } from "vitest";
import { checkPhotoRead, isMoodyLot, pricingSerial, serialsMatch, type PhotoRead } from "../shared/photo-read";
import { parseSerial } from "../shared/pricing";

// What the sample happy sheet (Brenda Rory, 11/24/26) should read as.
const sample: PhotoRead = {
  happySheetFound: true,
  serialOnHappySheet: "ULBC-266321-1024-060323",
  serialOnBuilding: "LB-266321-1024-060323", // pencil on the beam, start cut off in the photo
  customerName: "Brenda Rory",
  topLineRaw: "Henagar - Rory - used - 10miles",
  topLineLot: "Henagar",
  topLineJobType: "used",
  topLineMiles: 10,
  sheetDate: "11/24/26",
  customerSigned: true,
  driverName: "Jacob W",
  repairsOrComments: null,
  unclear: "",
};
const job = { customerName: "Brenda Rory", serial: "ULBC-266321-1024-060323", jobType: "used" as const, miles: 10 };

describe("sample happy sheet", () => {
  it("decodes a 3-letter style", () => expect(parseSerial("ULBC-266321-1024-060323")).toEqual({ style: "LBC", width: 10, length: 24 }));
  it("passes every check when everything agrees", () => {
    expect(checkPhotoRead(sample, job).filter((c) => !c.ok)).toEqual([]);
  });
  it("accepts a cropped serial on the beam but not a different one", () => {
    expect(serialsMatch("LB-266321-1024-060323", "ULBC-266321-1024-060323")).toBe(true);
    expect(serialsMatch("ulbc 266321 1024 060323", "ULBC-266321-1024-060323")).toBe(true);
    expect(serialsMatch("ULBC-266321-1024-060324", "ULBC-266321-1024-060323")).toBe(false);
    expect(serialsMatch("0323", "ULBC-266321-1024-060323")).toBe(false);
  });
  it("flags a type or miles mismatch with the driver's answers", () => {
    const bad = checkPhotoRead(sample, { ...job, jobType: "new", miles: 25 }).filter((c) => !c.ok).map((c) => c.text);
    expect(bad.some((t) => t.includes("says Used"))).toBe(true);
    expect(bad.some((t) => t.includes("10 miles; driver entered 25"))).toBe(true);
  });
  it("flags a wrong serial and a different customer", () => {
    const bad = checkPhotoRead(sample, { ...job, serial: "UCC-1-1232-1", customerName: "Tom Jones" }).filter((c) => !c.ok);
    expect(bad.map((c) => c.text).join("|")).toMatch(/doesn't match the job's UCC-1-1232-1/);
    expect(bad.map((c) => c.text).join("|")).toMatch(/job is for “Tom Jones”/);
  });
  it("notes a missing plate but still checks the happy sheet", () => {
    const checks = checkPhotoRead({ ...sample, serialOnBuilding: null }, job);
    expect(checks.find((c) => c.text.startsWith("No serial plate"))?.ok).toBe(false);
    expect(checks.find((c) => c.text.startsWith("Happy sheet serial"))?.ok).toBe(true);
  });
});

describe("Moody and serial fallback", () => {
  it("spots the Moody lot", () => {
    expect(isMoodyLot("Moody")).toBe(true);
    expect(isMoodyLot("moody lot")).toBe(true);
    expect(isMoodyLot("Henagar")).toBe(false);
    expect(isMoodyLot(null)).toBe(false);
  });
  it("prices from the happy sheet serial when the job has none", () => {
    expect(pricingSerial("", sample)).toEqual({ serial: "ULBC-266321-1024-060323", fromPhoto: true });
    expect(pricingSerial("UCC-1-1232-1", sample)).toEqual({ serial: "UCC-1-1232-1", fromPhoto: false });
  });
});
