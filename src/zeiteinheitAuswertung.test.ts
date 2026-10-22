import { describe, it, expect } from "vitest";
import type { Task } from "./types";
import type { Kalender } from "./components/kalenderHelpers";
import { arbeitsAnteilAmTag, startPos, endPos, datumZeitBeiPos } from "./components/zeitHelpers";
import { personalauslastung, mengenProTag, ertragsoptik } from "./components/avorHelpers";
import type { Stammdaten } from "./components/stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./components/stammdatenHelpers";
import { erzeuge4dIfc, fuegeIfcEin } from "./components/ifcExport";
import { leseBauablaufAusIfc } from "./components/ifcImport";

const KAL: Kalender = { feiertage: [], ferien: [] };
// 2026-11-09 = Montag
const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });

describe("Anteil eines Tages und Positionen auf der Zeitachse", () => {
  it("Halbtags-Task Mo NM – Di VM arbeitet an beiden Tagen je einen halben Tag", () => {
    const t = task("A", "2026-11-09", "2026-11-10", { startZeit: "13:00", endZeit: "12:00" });
    expect(arbeitsAnteilAmTag(t, "2026-11-09", KAL)).toBe(0.5);
    expect(arbeitsAnteilAmTag(t, "2026-11-10", KAL)).toBe(0.5);
    expect(arbeitsAnteilAmTag(t, "2026-11-11", KAL)).toBe(0);
    expect(arbeitsAnteilAmTag(task("B", "2026-11-09", "2026-11-10"), "2026-11-10", KAL)).toBe(1);
  });
  it("Start-/Endposition für Abspielen: aktiv für start <= Tag < ende; ganze Tage wie bisher", () => {
    const min = new Date(2026, 10, 9);
    expect(startPos(task("A", "2026-11-09", "2026-11-10"), min)).toBe(0);
    expect(endPos(task("A", "2026-11-09", "2026-11-10"), min)).toBe(2);
    const h = task("H", "2026-11-09", "2026-11-10", { startZeit: "13:00", endZeit: "12:00" });
    expect(startPos(h, min)).toBe(0.5);
    expect(endPos(h, min)).toBe(1.5);
  });
  it("Datum mit Zeit für die Anzeige über dem Slider", () => {
    const min = new Date(2026, 10, 9);
    expect(datumZeitBeiPos(min, 0, "tage")).toBe("09.11.2026");
    expect(datumZeitBeiPos(min, 1.5, "halbtage")).toBe("10.11.2026 NM");
    expect(datumZeitBeiPos(min, 0.25, "stunden")).toBe("09.11.2026 10:00");
    expect(datumZeitBeiPos(min, 3, "halbtage", 3)).toBe("11.11.2026 NM"); // Ende der Achse = letzter Tag
  });
});

describe("AVOR-Auswertungen mit halben Tagen", () => {
  const stammdaten: Stammdaten = {
    ...LEERE_STAMMDATEN,
    arbeitszeitStdProTag: 8,
    gewerke: [{ key: "sch", label: "Schalung", einheit: "m2", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: 10 }] }],
  } as Stammdaten;
  it("Personal zählt am halben Tag mit dem halben Wert", () => {
    // 10 m2 × 1 h = 10 Personenstunden, verteilt auf zwei halbe Tage → je 5 h = 0,625 Personen
    const t = task("A", "2026-11-09", "2026-11-10", { startZeit: "13:00", endZeit: "12:00", bauteilKuerzel: "W", mengen: { sch: 10 } });
    const reihe = personalauslastung([t], stammdaten, KAL);
    expect(reihe.map(r => r.werte.sch ?? 0)).toEqual([0.625, 0.625]);
  });
});

describe("Mengen-Filter verteilt wie der Aufwand", () => {
  const stammdaten: Stammdaten = {
    ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8,
    gewerke: [
      { key: "sch", label: "Schalung", einheit: "m2", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: null }] },
      { key: "bet", label: "Beton", einheit: "m3", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 2, anzahlPersonen: 4, chfProEinheit: null }] },
    ],
  } as Stammdaten;
  it("Beton erscheint erst am Tag, an dem betoniert wird (wie in der Personalauslastung)", () => {
    // Schalung 32 h = 1 Tag, Beton 16 m³ × 2 h = 32 h = 1 Tag → Mo Schalung, Di Beton
    const t = task("W", "2026-11-09", "2026-11-10", { bauteilKuerzel: "W", mengen: { sch: 32, bet: 16 } });
    expect(mengenProTag([t], "bet", KAL, undefined, stammdaten).map(r => r.menge)).toEqual([0, 16]);
    expect(mengenProTag([t], "sch", KAL, undefined, stammdaten).map(r => r.menge)).toEqual([32, 0]);
    expect(mengenProTag([t], "bet", KAL).map(r => r.menge)).toEqual([8, 8]); // ohne Stammdaten gleichmässig
  });
});

describe("Personalauslastung: Gewerke nacheinander, Personen aus dem Aufwand", () => {
  // Wand: Schalung 4 Pers. 3 Tage (96 h), Bewehrung 3 Pers. 1 Tag (24 h), Beton 3 Pers. 1 Tag (24 h) → berechnet 5 Tage
  const stammdaten: Stammdaten = {
    ...LEERE_STAMMDATEN,
    arbeitszeitStdProTag: 8,
    gewerke: [
      { key: "sch", label: "Schalung", einheit: "m2", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: null }] },
      { key: "bew", label: "Bewehrung", einheit: "t", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 24, anzahlPersonen: 3, chfProEinheit: null }] },
      { key: "bet", label: "Beton", einheit: "m3", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 2, anzahlPersonen: 3, chfProEinheit: null }] },
    ],
  } as Stammdaten;
  const mengen = { sch: 96, bew: 1, bet: 12 };
  const summe = (w: Record<string, number>) => Object.values(w).reduce((s, v) => s + v, 0);

  it("geplante = berechnete Dauer: genau die Kolonnen aus Tab Ressourcen, nacheinander", () => {
    const t = task("W", "2026-11-09", "2026-11-13", { bauteilKuerzel: "W", mengen }); // Mo–Fr = 5 Tage
    const reihe = personalauslastung([t], stammdaten, KAL);
    expect(reihe.map(r => r.werte)).toEqual([{ sch: 4 }, { sch: 4 }, { sch: 4 }, { bew: 3 }, { bet: 3 }]);
  });

  it("im Gantt doppelt so lang: Phasen gestreckt, halbe Kolonne, Personenstunden unverändert", () => {
    const t = task("W", "2026-11-09", "2026-11-20", { bauteilKuerzel: "W", mengen }); // 10 Arbeitstage (Wochenende frei)
    const reihe = personalauslastung([t], stammdaten, KAL).filter(r => Object.keys(r.werte).length > 0);
    expect(reihe).toHaveLength(10);
    expect(reihe.slice(0, 6).every(r => r.werte.sch === 2)).toBe(true);
    expect(reihe[6].werte).toEqual({ bew: 1.5 });
    const personentage = reihe.reduce((s, r) => s + summe(r.werte), 0);
    expect(personentage * 8).toBeCloseTo(96 + 24 + 24);
  });

  it("Phasengrenze mitten im Tag: der Tag teilt sich anteilig auf beide Gewerke", () => {
    const t = task("W", "2026-11-09", "2026-11-12", { bauteilKuerzel: "W", mengen }); // 4 statt 5 Tage → Faktor 0,8
    const reihe = personalauslastung([t], stammdaten, KAL);
    // Schalung 2,4 Tage à 5 Pers., Bewehrung 0,8 Tage à 3,75, Beton 0,8 Tage à 3,75
    expect(reihe[2].werte.sch).toBeCloseTo(2);
    expect(reihe[2].werte.bew).toBeCloseTo(0.6 * 3.75);
    expect(reihe.reduce((s, r) => s + summe(r.werte), 0) * 8).toBeCloseTo(144);
  });

  it("Stütze: 1 Tag im Gantt, aber nur 6 Personenstunden → 0,75 Personen, Ertrag 6 h × Umsatz, Kosten Menge × CHF", () => {
    const sd: Stammdaten = {
      ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8, umsatzChfProMannstunde: 80,
      gewerke: [{ key: "ver", label: "Elemente versetzen", einheit: "Stk", raten: [{ kuerzel: "ST", bezeichnung: "Stütze", leistungswertHProEinheit: 6, anzahlPersonen: 3, chfProEinheit: 500 }] }],
    } as Stammdaten;
    const t = task("S", "2026-11-09", "2026-11-09", { bauteilKuerzel: "ST", mengen: { ver: 1 } });
    expect(personalauslastung([t], sd, KAL)[0].werte.ver).toBeCloseTo(0.75); // 6 h ÷ 8 h
    const ertrag = ertragsoptik([t], sd, KAL);
    expect(ertrag[0].ertragKum).toBeCloseTo(480); // 6 h × 80 CHF
    expect(ertrag[0].kostenKum).toBeCloseTo(500); // 1 Stk × 500 CHF
  });

  it("Kosten folgen dem Aufwand: Schalungskosten fallen während der Schalung an, Summe bleibt Menge × CHF", () => {
    const sd: Stammdaten = { ...stammdaten, gewerke: stammdaten.gewerke.map(g => ({ ...g, raten: g.raten.map(r => ({ ...r, chfProEinheit: 10 })) })) } as Stammdaten;
    const t = task("W", "2026-11-09", "2026-11-13", { bauteilKuerzel: "W", mengen });
    const reihe = ertragsoptik([t], sd, KAL);
    expect(reihe[2].kostenKum).toBeCloseTo(960); // nach 3 Tagen ist die Schalung (96 m2 × 10) komplett
    expect(reihe[4].kostenKum).toBeCloseTo((96 + 1 + 12) * 10);
  });
});

describe("Mengen je Tag mit halben Tagen", () => {
  it("Menge verteilt sich nach Arbeitszeit", () => {
    const t = task("A", "2026-11-09", "2026-11-10", { endZeit: "12:00", bauteilKuerzel: "W", mengen: { sch: 30 } }); // 1,5 Tage: Mo ganz, Di VM
    const reihe = mengenProTag([t], "sch", KAL);
    expect(reihe.map(r => Math.round(r.menge))).toEqual([20, 10]);
  });
});

describe("IFC mit Uhrzeiten", () => {
  it("Export und Re-Import behalten Start- und Endzeit", () => {
    const text = ["ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION((''),'2;1');", "FILE_NAME('t.ifc','',(''),(''),'','','');",
      "FILE_SCHEMA(('IFC4'));", "ENDSEC;", "DATA;", "#1=IFCOWNERHISTORY(#2,#3,$,.ADDED.,$,$,$,0);",
      "#10=IFCPROJECT('3abcdefghijklmnopqrstu',#1,'P',$,$,$,$,$,$);", "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
    const tasks = [task("a", "2026-11-09", "2026-11-10", { startZeit: "13:00", endZeit: "12:00" })];
    const erg = erzeuge4dIfc({ ifcText: text, simId: "s", simName: "Sim", modellId: "m", tasks, bauteilGuidsJeTask: new Map(), kalender: KAL });
    expect(erg.einfuegeText).toContain("'2026-11-09T13:00:00','2026-11-10T12:00:00'");
    expect(erg.einfuegeText).toContain("'P1D'");
    let n = 0;
    const r = leseBauablaufAusIfc(fuegeIfcEin(text, erg), () => `id${++n}`);
    expect(r.tasks[0]).toMatchObject({ start: "2026-11-09", end: "2026-11-10", startZeit: "13:00", endZeit: "12:00" });
  });
});
