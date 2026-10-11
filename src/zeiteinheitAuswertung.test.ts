import { describe, it, expect } from "vitest";
import type { Task } from "./types";
import type { Kalender } from "./components/kalenderHelpers";
import { arbeitsAnteilAmTag, startPos, endPos, datumZeitBeiPos } from "./components/zeitHelpers";
import { personalauslastung, mengenProTag } from "./components/avorHelpers";
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
    const t = task("A", "2026-11-09", "2026-11-10", { startZeit: "13:00", endZeit: "12:00", bauteilKuerzel: "W", mengen: { sch: 10 } });
    const reihe = personalauslastung([t], stammdaten, KAL);
    expect(reihe.map(r => r.werte.sch ?? 0)).toEqual([2, 2]);
  });
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
