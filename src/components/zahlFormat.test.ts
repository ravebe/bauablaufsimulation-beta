import { describe, it, expect } from "vitest";
import { fmtZahl, fmtZahlFix2, fmtZahlMitVorzeichen, parseZahl } from "./zahlFormat";

describe("Zahlen-Anzeige mit 2 Nachkommastellen", () => {
  it("höchstens 2 Stellen, Nachkommastellen nur wenn vorhanden, mit Tausendertrennung", () => {
    expect(fmtZahl(27121.016).replace("’", "'")).toBe("27'121.02"); // Tausender-Apostroph je nach Laufzeit ' oder ’
    expect(fmtZahl(0.29)).toBe("0.29");
    expect(fmtZahl(0.5)).toBe("0.5");
    expect(fmtZahl(18)).toBe("18");
    expect(fmtZahl(17.999)).toBe("18");
    expect(fmtZahl(-0.001)).toBe("0");
    expect(fmtZahl(null)).toBe("–");
  });
  it("Tab Kosten: immer genau 2 Stellen", () => {
    expect(fmtZahlFix2(18)).toBe("18.00");
    expect(fmtZahlFix2(0.5)).toBe("0.50");
  });
  it("Vorzeichen bei Differenzen", () => {
    expect(fmtZahlMitVorzeichen(1.5)).toBe("+1.5");
    expect(fmtZahlMitVorzeichen(-0.25)).toBe("-0.25");
    expect(fmtZahlMitVorzeichen(0.001)).toBe("0");
  });
  it("Eingaben mit Komma, Punkt und Tausendertrennung", () => {
    expect(parseZahl("27’121.02")).toBe(27121.02);
    expect(parseZahl("27'121,5")).toBe(27121.5);
    expect(parseZahl("")).toBeNull();
    expect(parseZahl("abc")).toBeUndefined();
  });
});
