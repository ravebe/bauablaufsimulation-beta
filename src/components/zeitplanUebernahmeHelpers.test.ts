import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { zeitplanAbweichendeTasks, zeitplanHatAenderungen } from "./zeitplanUebernahmeHelpers";

const KAL = { feiertage: [], ferien: [] };
const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });
// Schalung WB: 1 h/m², 4 Personen, 8 h/Tag → 32 m² = 1 Tag
const stammdaten: Stammdaten = {
  ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8,
  gewerke: [{ key: "sch", label: "Schalung", einheit: "m2", raten: [{ kuerzel: "WB", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: null }] }],
} as Stammdaten;

describe("Hinweis: Tasks, deren Gantt-Termine von der berechneten Dauer abweichen", () => {
  it("nur Tasks mit anderer Dauer bzw. über die Vorgänger-Kette verschobene Tasks", () => {
    const tasks = [
      task("A", "2026-11-09", "2026-11-09", { bauteilKuerzel: "WB", mengen: { sch: 32 } }),                       // 1 Tag = berechnet
      task("B", "2026-11-10", "2026-11-11", { bauteilKuerzel: "WB", mengen: { sch: 32 }, predecessorId: "A" }),  // 2 Tage, berechnet 1
      task("C", "2026-11-12", "2026-11-12", { bauteilKuerzel: "WB", mengen: { sch: 32 }, predecessorId: "B" }),  // rückt nach vorne
      task("D", "2026-11-20", "2026-11-20"),                                                                    // ohne Kalkulation
    ];
    expect(zeitplanAbweichendeTasks(tasks, stammdaten, KAL).map(t => t.id)).toEqual(["B", "C"]);
    expect(zeitplanHatAenderungen(tasks, stammdaten, KAL)).toBe(true);
    expect(zeitplanHatAenderungen(tasks.slice(0, 1), stammdaten, KAL)).toBe(false);
  });
});
