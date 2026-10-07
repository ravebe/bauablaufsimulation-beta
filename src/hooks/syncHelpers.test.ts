import { describe, it, expect } from "vitest";
import type { SimProjekt } from "../types";
import { fuehreZusammen, waehleAktivId } from "./syncHelpers";

const sim = (id: string, name = id) => ({ id, name, tasks: [], modelle: [] }) as unknown as SimProjekt;

describe("fuehreZusammen", () => {
  it("Cloud gewinnt bei gleicher ID", () => {
    const r = fuehreZusammen([sim("a", "alt")], [sim("a", "neu")], ["a"]);
    expect(r.sims.map(s => s.name)).toEqual(["neu"]);
  });

  it("von jemand anderem gelöschte Sim wird NICHT aus der lokalen Kopie wiederbelebt", () => {
    const r = fuehreZusammen([sim("a"), sim("b")], [sim("a")], ["a", "b"]);
    expect(r.sims.map(s => s.id)).toEqual(["a"]);
    expect(r.geloeschtVerworfen).toEqual(["b"]);
  });

  it("nie hochgeladene Sim (z.B. Speichern war blockiert) bleibt erhalten", () => {
    const r = fuehreZusammen([sim("a"), sim("neu")], [sim("a")], ["a"]);
    expect(r.sims.map(s => s.id)).toEqual(["a", "neu"]);
    expect(r.nurLokalBehalten).toEqual(["neu"]);
  });

  it("ohne Wissen über Cloud-IDs (erster Start nach Update): nur-lokale Sims vorsichtshalber behalten", () => {
    const r = fuehreZusammen([sim("x")], [sim("a")], null);
    expect(r.sims.map(s => s.id)).toEqual(["a", "x"]);
  });

  it("leere Cloud + leere lokale Kopie → leer", () => {
    expect(fuehreZusammen([], [], null).sims).toEqual([]);
  });
});

describe("waehleAktivId", () => {
  const sims = [sim("a"), sim("b")];
  it("eigene Wahl vor Cloud", () => expect(waehleAktivId("b", "a", sims)).toBe("b"));
  it("eigene Wahl existiert nicht mehr → Cloud", () => expect(waehleAktivId("weg", "a", sims)).toBe("a"));
  it("beides ungültig → erste Sim", () => expect(waehleAktivId(null, "weg", sims)).toBe("a"));
  it("keine Sims → null", () => expect(waehleAktivId("a", "a", [])).toBeNull());
});
