import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN, parseSchritt, schritteFuerTask, dauerBerechnetTask, schrittVerschieben, schrittText } from "./stammdatenHelpers";
import { aufwandJeTagFuerTask } from "./avorHelpers";

const KAL = { feiertage: [], ferien: [] };
const task = (p: Partial<Task>): Task => ({ id: "A", name: "A", start: "2026-11-09", end: "2026-11-13", typ: "neubau", objektGuids: [], bauteilKuerzel: "W", ...p });
// je 8 h/Tag; Schalung 2 Pers., Bewehrung 1 Pers., Beton 4 Pers.
const sd = (schritte: Partial<Record<"sch" | "bew" | "bet", string>> = {}) => ({
  ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8,
  gewerke: [
    { key: "sch", label: "Schalung", einheit: "m2", raten: [{ kuerzel: "W", bezeichnung: "", leistungswertHProEinheit: 1, anzahlPersonen: 2, chfProEinheit: null, schritt: schritte.sch }] },
    { key: "bew", label: "Bewehrung", einheit: "t", raten: [{ kuerzel: "W", bezeichnung: "", leistungswertHProEinheit: 1, anzahlPersonen: 1, chfProEinheit: null, schritt: schritte.bew }] },
    { key: "bet", label: "Beton", einheit: "m3", raten: [{ kuerzel: "W", bezeichnung: "", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: null, schritt: schritte.bet }] },
  ],
}) as Stammdaten;
// Schalung 32 h (2 Tage), Bewehrung 8 h (1 Tag), Beton 32 h (1 Tag)
const mengen = { sch: 32, bew: 8, bet: 32 };

describe("parseSchritt", () => {
  it("einfache, geteilte und prozentuale Schritte", () => {
    expect(parseSchritt("")).toEqual([]);
    expect(parseSchritt("2")).toEqual([{ schritt: 2, anteil: 1 }]);
    expect(parseSchritt("1/3")).toEqual([{ schritt: 1, anteil: 0.5 }, { schritt: 3, anteil: 0.5 }]);
    expect(parseSchritt("1:60/3:40")).toEqual([{ schritt: 1, anteil: 0.6 }, { schritt: 3, anteil: 0.4 }]);
    expect(parseSchritt("1:70/3")).toEqual([{ schritt: 1, anteil: 0.7 }, { schritt: 3, anteil: expect.closeTo(0.3) }]);
  });
  it("ungültige Eingaben", () => {
    expect(parseSchritt("a")).toBeNull();
    expect(parseSchritt("0")).toBeNull();
    expect(parseSchritt("1:60/3:60")).toBeNull();
    expect(parseSchritt("1:60/3:30")).toBeNull();
  });
});

describe("Arbeitsablauf je Kürzel", () => {
  it("ohne Eingabe: Kategorien nacheinander (wie bisher)", () => {
    expect(schritteFuerTask(task({ mengen }), sd()).map(s => s.schritt)).toEqual([1, 2, 3]);
    expect(dauerBerechnetTask(task({ mengen }), sd())).toBe(4);
  });
  it("gleicher Schritt läuft gleichzeitig — längste Phase zählt", () => {
    // Schalung und Bewehrung beide Schritt 1 → max(2, 1) + Beton 1 = 3 Tage
    expect(dauerBerechnetTask(task({ mengen }), sd({ sch: "1", bew: "1", bet: "2" }))).toBe(3);
  });
  it("geteilte Schalung: 1. Seite → Bewehrung → 2. Seite → Beton", () => {
    const s = sd({ sch: "1/3", bew: "2", bet: "4" });
    const schritte = schritteFuerTask(task({ mengen }), s);
    expect(schritte.map(x => [x.schritt, x.tage])).toEqual([[1, 1], [2, 1], [3, 1], [4, 1]]);
    // 9.–12.11. je ein Schritt: Schalung 16 h, Bewehrung 8 h, Schalung 16 h, Beton 32 h
    const a = aufwandJeTagFuerTask(task({ mengen, end: "2026-11-12" }), s, KAL);
    expect(a.get("2026-11-09")).toEqual({ sch: 16 });
    expect(a.get("2026-11-10")).toEqual({ bew: 8 });
    expect(a.get("2026-11-11")).toEqual({ sch: 16 });
    expect(a.get("2026-11-12")).toEqual({ bet: 32 });
  });
});

describe("Arbeitsablauf-Editor: Schritte verschieben", () => {
  it("verschiebt alle Teile gemeinsam, Prozente bleiben", () => {
    expect(schrittVerschieben(parseSchritt("2")!, -1)).toBe("1");
    expect(schrittVerschieben(parseSchritt("1:70/4:30")!, 1)).toBe("2:70/5:30");
    expect(schrittVerschieben(parseSchritt("1:70/4:30")!, -1)).toBeNull(); // nicht unter Schritt 1
    expect(schrittText(parseSchritt("1/3")!)).toBe("1:50/3:50");
    expect(parseSchritt(schrittVerschieben(parseSchritt("1:60/3:40")!, 2)!)).toEqual([{ schritt: 3, anteil: 0.6 }, { schritt: 5, anteil: 0.4 }]);
  });
});
