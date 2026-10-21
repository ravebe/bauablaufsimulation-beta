import { describe, it, expect } from "vitest";
import { fmtZahl, fmtZahlMitVorzeichen, parseZahl } from "./zahlFormat";

describe("Zahlen-Anzeige mit 2 Nachkommastellen", () => {
  it("rundet nur die Anzeige auf 2 Stellen, mit Tausendertrennung", () => {
    expect(fmtZahl(27121.016).replace("’", "'")).toBe("27'121.02"); // Tausender-Apostroph je nach Laufzeit ' oder ’
    expect(fmtZahl(0.29)).toBe("0.29");
    expect(fmtZahl(18)).toBe("18.00");
    expect(fmtZahl(-0.001)).toBe("0.00");
    expect(fmtZahl(null)).toBe("–");
  });
  it("Vorzeichen bei Differenzen", () => {
    expect(fmtZahlMitVorzeichen(1.5)).toBe("+1.50");
    expect(fmtZahlMitVorzeichen(-0.25)).toBe("-0.25");
    expect(fmtZahlMitVorzeichen(0.001)).toBe("0.00");
  });
  it("Eingaben mit Komma, Punkt und Tausendertrennung", () => {
    expect(parseZahl("27’121.02")).toBe(27121.02);
    expect(parseZahl("27'121,5")).toBe(27121.5);
    expect(parseZahl("")).toBeNull();
    expect(parseZahl("abc")).toBeUndefined();
  });
});
