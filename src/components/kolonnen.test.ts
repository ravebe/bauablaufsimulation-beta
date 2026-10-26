import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import { kolonnenJeTag, aufwandJeTagFuerTask } from "./avorHelpers";
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
  it("zählt je Tag und Gewerk die laufenden Kolonnen und ihre Köpfe über alle Tasks", () => {
    // Mo 9.11.: Wand (4 Pers., 32 h → 1 Tag) und Decke (6 Pers., 48 h → 1 Tag) parallel
    const a = task("A", "2026-11-09", "2026-11-09", { bauteilKuerzel: "W", mengen: { sch: 32 } });
    const b = task("B", "2026-11-09", "2026-11-10", { bauteilKuerzel: "D", mengen: { sch: 48 } });
    const k = kolonnenJeTag([a, b], stammdaten, KAL);
    expect(k.get("2026-11-09")?.sch).toEqual({ kolonnen: 2, personen: 10 });
    expect(k.get("2026-11-10")?.sch).toEqual({ kolonnen: 1, personen: 6 });
    // Ø Arbeitszeit am Montag: (32 + 24) h ÷ 10 Pers. = 5.6 h (Decke auf 2 Tage gestreckt → je 24 h)
    const ph = (aufwandJeTagFuerTask(a, stammdaten, KAL).get("2026-11-09")?.sch ?? 0) + (aufwandJeTagFuerTask(b, stammdaten, KAL).get("2026-11-09")?.sch ?? 0);
    expect(ph / 10).toBeCloseTo(5.6);
  });
});
