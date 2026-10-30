import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { optimiereAuslastung, auslastungAbweichendeTasks } from "./auslastungOptimieren";

const KAL = { feiertage: [], ferien: [] };
const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });
// 8 h/Tag (Standard-Arbeitszeit der Tests). Wand (WB): Schalung 4 Pers. à 1 h/m², Beton 4 Pers. à 2 h/m³; Decke (DB): Schalung 4 Pers.
const stammdaten: Stammdaten = {
  ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8,
  gewerke: [
    { key: "sch", label: "Schalung", einheit: "m2", raten: [
      { kuerzel: "WB", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: null },
      { kuerzel: "DB", bezeichnung: "Decke", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: null },
    ] },
    { key: "bet", label: "Beton", einheit: "m3", raten: [{ kuerzel: "WB", bezeichnung: "Wand", leistungswertHProEinheit: 2, anzahlPersonen: 4, chfProEinheit: null }] },
  ],
} as Stammdaten;
const termine = (ts: Task[]) => ts.map(t => `${t.id} ${t.start}–${t.end}`);

describe("Auslastung optimieren ohne Kranpersonal: eine Kolonne je Gewerk + Unternehmer", () => {
  it("drei parallele Wände (nur Schalung WB, je 1 Tag) laufen nacheinander", () => {
    const ts = ["A", "B", "C"].map(id => task(id, "2026-11-09", "2026-11-11", { bauteilKuerzel: "WB", mengen: { sch: 32 } }));
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL))).toEqual([
      "A 2026-11-09–2026-11-09", "B 2026-11-10–2026-11-10", "C 2026-11-11–2026-11-11",
    ]);
  });

  it("eine Kolonne je Gewerk + Unternehmer: Wand- und Deckenschalung derselben Unternehmung nacheinander, verschiedener parallel", () => {
    const ts = [
      task("W", "2026-11-09", "2026-11-12", { bauteilKuerzel: "WB", mengen: { sch: 32 } }),
      task("D", "2026-11-09", "2026-11-12", { bauteilKuerzel: "DB", mengen: { sch: 32 } }),
    ];
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL))).toEqual(["W 2026-11-09–2026-11-09", "D 2026-11-10–2026-11-10"]);
    const zweiFirmen = { ...stammdaten, gewerke: stammdaten.gewerke.map(g => ({ ...g, raten: g.raten.map(r => ({ ...r, unternehmer: r.kuerzel === "DB" ? "Decken AG" : "Wand AG" })) })) } as Stammdaten;
    expect(termine(optimiereAuslastung(ts, zweiFirmen, KAL))).toEqual(["W 2026-11-09–2026-11-09", "D 2026-11-09–2026-11-09"]);
  });

  it("Gewerke überlappen: Wand B wird geschalt, während Wand A betoniert wird", () => {
    // je Wand: Schalung 1 Tag (32 m²), Beton 1 Tag (16 m³) → 2 Tage
    const ts = ["A", "B"].map(id => task(id, "2026-11-09", "2026-11-10", { bauteilKuerzel: "WB", mengen: { sch: 32, bet: 16 } }));
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL))).toEqual(["A 2026-11-09–2026-11-10", "B 2026-11-10–2026-11-11"]);
  });

  it("Vorgänger und Wartetage bleiben massgebend, über das Wochenende", () => {
    const ts = [
      task("A", "2026-11-12", "2026-11-12", { bauteilKuerzel: "WB", mengen: { sch: 32 } }),                                // Do
      task("B", "2026-11-09", "2026-11-09", { bauteilKuerzel: "DB", mengen: { sch: 64 }, predecessorId: "A", lagDays: 0 }), // 2 Tage
    ];
    // B beginnt am Arbeitstag nach A (Fr) und läuft über das Wochenende bis Mo
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL))).toEqual(["A 2026-11-12–2026-11-12", "B 2026-11-13–2026-11-16"]);
  });

  it("Tasks ohne Kalkulation und Gruppen bleiben unverändert; nichts zu tun → keine Abweichung", () => {
    const ts = [
      task("G", "2026-11-09", "2026-11-20", { isGroup: true }),
      task("X", "2026-11-09", "2026-11-20"),
      task("A", "2026-11-09", "2026-11-09", { bauteilKuerzel: "WB", mengen: { sch: 32 } }),
    ];
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL))).toEqual(termine(ts));
    expect(auslastungAbweichendeTasks(ts, stammdaten, KAL)).toEqual([]);
  });
});
