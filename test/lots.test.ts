import { describe, expect, it } from "vitest";
import { matchLot, type Lot } from "../shared/domain";

const lot = (name: string, aliases = ""): Lot => ({ id: name, name, address: "", phone: "", lat: 1, lng: 1, aliases });
const lots = [
  lot("Modern Living", "Moody"),
  lot("Premier of South Fulton", "South Fulton"),
  lot("Yoders Buildings Inc", "Mize"),
  lot("Vision 7 Buildings", "Sumiton"),
  lot("Southern Boys Sheds & Trailers- winfield", "Winfield"),
  lot("Premier Buildings of Florence, AL", "Florence, Killen"),
  lot("Jeff Key Motors", "Anniston, Brett Key"),
  lot("Sylacauga Portable Buildings", "Sylacauga"),
  lot("Premier Buildings of Hollis Crossroads", "Hollis Crossroads, Heflin"),
];

describe("matching job lot names to Premier lots", () => {
  it.each([
    ["Vision 7 Buildings - Sumiton", "Vision 7 Buildings"],
    ["SOUTH FULTON", "Premier of South Fulton"],
    ["Moody lot", "Modern Living"],
    ["MOODY LOT", "Modern Living"],
    ["Modern Living- Moody", "Modern Living"],
    ["Southern Boy Sheds & Trailers - Winfield, AL", "Southern Boys Sheds & Trailers- winfield"],
    ["Premier Buildings of Florence, AL", "Premier Buildings of Florence, AL"],
    ["MIZE", "Yoders Buildings Inc"],
    ["Sylacauga Portable Buildings", "Sylacauga Portable Buildings"],
    ["Premier Buildings of Hollis Crossroads", "Premier Buildings of Hollis Crossroads"],
    ["Jeff Key Motors", "Jeff Key Motors"],
  ])("%s → %s", (text, name) => {
    expect(matchLot(text, lots)?.name).toBe(name);
  });
  it("prefers the nearer lot when two names match equally", () => {
    const far = { ...lot("Sheds of Columbus"), id: "far", lat: 39.96, lng: -82.99 };
    const near = { ...lot("Sheds of Columbus"), id: "near", lat: 32.5, lng: -84.97 };
    expect(matchLot("Sheds of Columbus", [far, near])?.id).toBe("near");
    expect(matchLot("Sheds of Columbus", [near, far])?.id).toBe("near");
  });
  it("returns null for unknown or empty", () => {
    expect(matchLot("Somewhere Else", lots)).toBeNull();
    expect(matchLot("", lots)).toBeNull();
    expect(matchLot("Premier Buildings", lots)).toBeNull();
  });
});
