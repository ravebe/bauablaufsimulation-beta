import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import { kolonnenJeTag, aufwandJeTagFuerTask } from "./avorHelpers";
import { tagesplan } from "./tagesplan";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";

const KAL = { feiertage: [], ferien: [] };
const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });
const stammdaten = {
  ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8,
  gewerke: [{ key: "sch", label: "Schalung", einheit: "m2", raten: [
    { kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: 10 },
    { kuerzel: "D", bezeichnung: "Decke", leistungswertHProEinheit: 1, anzahlPersonen: 6, chfProEinheit: 10 },
  ] }],
} as Stammdaten;

describe("kolonnenJeTag (Tooltip Personalauslastung)", () => {
  it("dieselbe Leistungsposition in parallelen Tasks zählt nur einmal", () => {
    const a = task("A", "2026-11-09", "2026-11-09", { bauteilKuerzel: "W", mengen: { sch: 32 } });
    const b = task("B", "2026-11-09", "2026-11-09", { bauteilKuerzel: "W", mengen: { sch: 16 } });
    const c = task("C", "2026-11-09", "2026-11-09", { bauteilKuerzel: "W", mengen: { sch: 8 } });
    expect(kolonnenJeTag([a, b, c], stammdaten, KAL).get("2026-11-09")?.sch).toEqual({ kolonnen: 1, personen: 4 });
  });
  it("je Gewerk + Unternehmer eine Kolonne: mit den grössten Min. Personen des Tages, verschiedene Unternehmer addieren sich", () => {
    // Mo 9.11.: Wand (4 Pers.) und Decke (6 Pers.) — dieselbe Schalungs-Kolonne, sie arbeitet nacheinander an beiden
    const a = task("A", "2026-11-09", "2026-11-09", { bauteilKuerzel: "W", mengen: { sch: 32 } });
    const b = task("B", "2026-11-09", "2026-11-10", { bauteilKuerzel: "D", mengen: { sch: 48 } });
    const k = kolonnenJeTag([a, b], stammdaten, KAL);
    expect(k.get("2026-11-09")?.sch).toEqual({ kolonnen: 1, personen: 6 });
    expect(k.get("2026-11-10")?.sch).toEqual({ kolonnen: 1, personen: 6 });
    // Decke von einer anderen Unternehmung → zwei Kolonnen
    const zwei = { ...stammdaten, gewerke: stammdaten.gewerke.map(g => ({ ...g, raten: g.raten.map(r => ({ ...r, unternehmer: r.kuerzel === "D" ? "Decken AG" : "Wand AG" })) })) } as Stammdaten;
    expect(kolonnenJeTag([a, b], zwei, KAL).get("2026-11-09")?.sch).toEqual({ kolonnen: 2, personen: 10 });
    const ph = (aufwandJeTagFuerTask(a, stammdaten, KAL).get("2026-11-09")?.sch ?? 0) + (aufwandJeTagFuerTask(b, stammdaten, KAL).get("2026-11-09")?.sch ?? 0);
    expect(ph).toBeCloseTo(56); // Decke auf 2 Tage gestreckt → je 24 h
  });
});

describe("Tagesablauf ohne Kran (Rechenkern): Kolonnen je Gewerk + Unternehmer", () => {
  const sd = { ...stammdaten, gewerke: [...stammdaten.gewerke,
    { key: "bew", label: "Bewehrung", einheit: "t", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 2, chfProEinheit: 10 }] }] } as Stammdaten;
  it("Gewerke eines Tasks nacheinander: Summe ihrer Dauern", () => {
    // Schalung 16 h ÷ 4 Pers. = 4 h, danach Bewehrung 8 h ÷ 2 Pers. = 4 h → 8 h
    const a = task("A", "2026-11-09", "2026-11-09", { bauteilKuerzel: "W", mengen: { sch: 16, bew: 8 } });
    expect(tagesplan("2026-11-09", [a], sd, KAL, []).dauer).toBeCloseTo(8);
  });
  it("verschiedene Kolonnen parallel: die längste zählt", () => {
    const a = task("A", "2026-11-09", "2026-11-09", { bauteilKuerzel: "W", mengen: { sch: 20 } }); // 5 h
    const b = task("B", "2026-11-09", "2026-11-09", { bauteilKuerzel: "W", mengen: { bew: 6 } }); // 3 h
    expect(tagesplan("2026-11-09", [a, b], sd, KAL, []).dauer).toBeCloseTo(5);
  });
  it("dieselbe Kolonne an zwei Tasks: nacheinander", () => {
    const a = task("A", "2026-11-09", "2026-11-09", { bauteilKuerzel: "W", mengen: { sch: 12 } }); // 3 h
    const b = task("B", "2026-11-09", "2026-11-09", { bauteilKuerzel: "W", mengen: { sch: 16 } }); // 4 h
    expect(tagesplan("2026-11-09", [a, b], sd, KAL, []).dauer).toBeCloseTo(7);
  });
});
