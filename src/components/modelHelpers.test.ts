import { describe, it, expect } from "vitest";
import { istBauteilKlasse, istBehaelterKlasse } from "./modelHelpers";

describe("istBauteilKlasse", () => {
  it("physische Bauteile zählen", () => {
    for (const k of ["IfcWall", "IFCWALLSTANDARDCASE", "IfcSlab", "IfcColumn", "IfcBeam", "IfcBuildingElementProxy", "IfcReinforcingBar", "IfcElementAssembly"]) {
      expect(istBauteilKlasse(k), k).toBe(true);
    }
  });
  it("Struktur, Räume, Öffnungen, Raster, Beschriftungen zählen nicht", () => {
    for (const k of ["IfcProject", "IfcSite", "IfcBuilding", "IFCBUILDINGSTOREY", "IfcSpace", "IfcOpeningElement",
      "IfcOpeningStandardCase", "IfcGrid", "IfcGridAxis", "IfcAnnotation", "IfcVirtualElement", "IfcZone"]) {
      expect(istBauteilKlasse(k), k).toBe(false);
    }
  });
  it("unbekannt/leer → zählt (lieber zeigen als verstecken)", () => {
    expect(istBauteilKlasse(undefined)).toBe(true);
    expect(istBauteilKlasse("")).toBe(true);
  });
});

describe("istBehaelterKlasse", () => {
  it("Baugruppen sind Behälter, Einzelteile nicht", () => {
    expect(istBehaelterKlasse("IFCELEMENTASSEMBLY")).toBe(true);
    expect(istBehaelterKlasse("IfcElementAssembly")).toBe(true);
    expect(istBehaelterKlasse("IfcWall")).toBe(false);
    expect(istBehaelterKlasse(undefined)).toBe(false);
  });
});
