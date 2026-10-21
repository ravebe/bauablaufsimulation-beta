import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { personalbedarfJeLeistungsposition } from "./avorHelpers";
import { personalbedarfAlsCsv } from "./avorExportHelpers";
import { fmtTageStunden } from "./zahlFormat";

const KAL = { feiertage: [], ferien: [] };
const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });

describe("Personen als Tage + Stunden", () => {
  it("unter einem Tag nur Stunden, sonst Tage + Reststunden", () => {
    expect(fmtTageStunden(1.65, 8.5)).toBe("1.65 h");
    expect(fmtTageStunden(7.8 * 8.5, 8.5)).toBe("7 d 6.80 h");
    expect(fmtTageStunden(17, 8.5)).toBe("2 d");
    expect(fmtTageStunden(0, 8.5)).toBe("0.00 h");
  });
});

describe("Personalbedarf je Tag und Leistungsposition", () => {
  // Wand (WB): Schalung 4 Pers. 1 Tag (34 h), Fertigteilstütze (EM): Elemente versetzen 1 Stk × 1,875 h
  const stammdaten: Stammdaten = {
    ...LEERE_STAMMDATEN,
    arbeitszeitStdProTag: 8.5,
    gewerke: [
      { key: "sch", label: "Schalung", einheit: "m2", raten: [{ kuerzel: "WB", bezeichnung: "Wandschalung", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: null }] },
      { key: "em", label: "Elemente versetzen", einheit: "Stk", raten: [{ kuerzel: "EM", bezeichnung: "Elemente versetzen", leistungswertHProEinheit: 1.875, anzahlPersonen: 2, chfProEinheit: null }] },
    ],
  } as Stammdaten;
  const tasks = [
    task("W", "2026-11-09", "2026-11-09", { bauteilKuerzel: "WB", mengen: { sch: 34 } }),
    task("S", "2026-11-09", "2026-11-09", { bauteilKuerzel: "EM", mengen: { em: 1 } }),
  ];

  it("Stunden je Leistungsposition ergeben zusammen den Aufwand des Tages", () => {
    const { positionen, tage } = personalbedarfJeLeistungsposition(tasks, stammdaten, KAL);
    expect(positionen.map(p => p.key)).toEqual(["sch::WB", "em::EM"]);
    expect(tage).toHaveLength(1);
    expect(tage[0].stunden["sch::WB"]).toBeCloseTo(34);
    expect(tage[0].stunden["em::EM"]).toBeCloseTo(1.875);
  });

  it("CSV: Personen total, Stunden total, Personen je Gewerk, Stunden je Position", () => {
    const zeilen = personalbedarfAlsCsv(tasks, stammdaten, KAL).replace(/^﻿/, "").split("\r\n").map(z => z.split(";"));
    expect(zeilen[0].slice(0, 5)).toEqual(["Datum", "Wochentag", "Personen total", "Personenstunden total [h]", "Personenstunden total (Tage + Stunden)"]);
    expect(zeilen[0]).toContain("Schalung · WB Wandschalung [h]");
    // 35,875 h ÷ 8,5 = 4,22 Personen; 4 d 1,88 h
    expect(zeilen[1].slice(0, 5)).toEqual(["09.11.2026", "Mo", "4.22", "35.88", "4 d 1.88 h"]);
    expect(zeilen[1].slice(5)).toEqual(["4.00", "0.22", "34.00", "1.88"]);
    expect(zeilen[2][0]).toBe("Total");
  });
});
