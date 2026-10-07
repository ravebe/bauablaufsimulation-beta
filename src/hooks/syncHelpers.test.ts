import { describe, it, expect } from "vitest";
import type { SimProjekt } from "../types";
import { fuehreZusammen, waehleAktivId, stelleSimWiederHer } from "./syncHelpers";

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

describe("stelleSimWiederHer", () => {
  const heute = [sim("a", "Rohbau"), sim("b", "Ausbau")];
  const frueherA = { ...sim("a", "Rohbau"), tasks: [{}, {}] } as unknown as SimProjekt;

  it("Ersetzen tauscht nur diese Sim aus, Position bleibt", () => {
    const r = stelleSimWiederHer(heute, frueherA, "ersetzen", 0, "u1");
    expect(r.sims.map(s => s.id)).toEqual(["a", "b"]);
    expect(r.sims[0].tasks.length).toBe(2);
    expect(r.sims[1]).toBe(heute[1]);
  });

  it("Ersetzen einer inzwischen gelöschten Sim legt sie wieder an", () => {
    const r = stelleSimWiederHer([heute[1]], frueherA, "ersetzen", 0, "u1");
    expect(r.sims.map(s => s.id)).toEqual(["b", "a"]);
  });

  it("Kopie: neue ID, Name mit Stand, Ersteller = wer wiederherstellt, Original unberührt", () => {
    const r = stelleSimWiederHer(heute, frueherA, "kopie", new Date(2026, 9, 7, 14, 5).getTime(), "u1", () => "neu");
    expect(r.sims.map(s => s.id)).toEqual(["a", "b", "neu"]);
    expect(r.sims[2].name).toMatch(/^Rohbau \(Stand 07\.10\.2026 14:05\)$/);
    expect(r.sims[2].erstellerId).toBe("u1");
    expect(r.sims[0]).toBe(heute[0]);
  });
});
