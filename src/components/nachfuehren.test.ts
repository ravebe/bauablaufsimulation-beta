import { describe, it, expect } from "vitest";
import type { Task, Kran, SimProjekt } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { optimiereAuslastung, optimierungUebernehmen } from "./auslastungOptimieren";
import { simNachfuehren, nachzufuehrendeTasks } from "./nachfuehren";
import { gueltigeTagesArbeit } from "./avorHelpers";

const KAL = { feiertage: [], ferien: [] };
const task = (id: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start: "2026-11-09", end: "2026-11-09", typ: "neubau", objektGuids: [], bauteilKuerzel: "W", kraene: ["k1"], ...p });
// 8 h/Tag, Wand W: Schalung (Bau AG, Min. 4, 1 h/m², kranpflichtig, Kranzeit 25 %)
const stammdaten: Stammdaten = {
  ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8,
  gewerke: [{ key: "sch", label: "Schalung", einheit: "m2", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 4,
    chfProEinheit: null, unternehmer: "Bau AG", kranpflichtig: true, kranzeitProzent: 25 }] }],
} as Stammdaten;
const kraene: Kran[] = [{ id: "k1", name: "Kran 1", personal: [{ id: "1", unternehmer: "Bau AG", personen: 8 }] }];
const termine = (ts: Task[]) => ts.map(t => `${t.id} ${t.start}–${t.end}`);

/** Optimierte Simulation mit «Automatisch nachführen»: A und C parallel am 9.11. (je 4 Leute), B nach A am 10.11. */
function optimierteSim(): SimProjekt {
  const ts = [task("A", { mengen: { sch: 32 } }), task("B", { mengen: { sch: 32 }, predecessorId: "A", lagDays: 0 }), task("C", { mengen: { sch: 32 } })];
  const tasks = optimierungUebernehmen(ts, optimiereAuslastung(ts, stammdaten, KAL, "tage", kraene, "kritischerPfad", false));
  return { id: "s", name: "S", tasks, stammdaten, kalender: KAL, kraene, autoNachfuehren: { reihenfolge: "kritischerPfad", luecken: false } } as unknown as SimProjekt;
}

describe("Automatisch nachführen", () => {
  it("nach dem Optimieren ist nichts nachzuführen — die Simulation bleibt dasselbe Objekt", () => {
    const sim = optimierteSim();
    expect(termine(sim.tasks)).toEqual(["A 2026-11-09–2026-11-09", "B 2026-11-10–2026-11-10", "C 2026-11-09–2026-11-09"]);
    expect(sim.tasks.every(t => gueltigeTagesArbeit(t, stammdaten, KAL))).toBe(true);
    expect(simNachfuehren(sim)).toBe(sim);
  });

  it("ausgeschaltet: nichts passiert", () => {
    const sim = { ...optimierteSim(), autoNachfuehren: undefined };
    const geaendert = { ...sim, tasks: sim.tasks.map(t => t.id === "C" ? { ...t, start: "2026-11-16", end: "2026-11-16" } : t) };
    expect(simNachfuehren(geaendert)).toBe(geaendert);
  });

  it("von Hand verschoben: nur dieser Task wird neu geplant, frühestens am neuen Start — die übrigen bleiben unverändert", () => {
    const sim = optimierteSim();
    const geaendert = { ...sim, tasks: sim.tasks.map(t => t.id === "B" ? { ...t, start: "2026-11-12", end: "2026-11-12" } : t) };
    expect([...nachzufuehrendeTasks(geaendert.tasks, stammdaten, KAL, kraene)]).toEqual(["B"]);
    const neu = simNachfuehren(geaendert);
    expect(termine(neu.tasks)).toEqual(["A 2026-11-09–2026-11-09", "B 2026-11-12–2026-11-12", "C 2026-11-09–2026-11-09"]); // B bleibt am 12.11., obwohl A früher erlaubt
    expect(neu.tasks[0]).toBe(geaendert.tasks[0]);
    expect(neu.tasks[2]).toBe(geaendert.tasks[2]);
    expect(neu.tasks.every(t => gueltigeTagesArbeit(t, stammdaten, KAL))).toBe(true);
    expect(simNachfuehren(neu)).toBe(neu); // danach ist alles gültig
  });

  it("Menge geändert: der Task und seine Nachfolger werden neu geplant, mit dem Personal, das der unveränderte Task übrig lässt", () => {
    const sim = optimierteSim();
    const geaendert = { ...sim, tasks: sim.tasks.map(t => t.id === "A" ? { ...t, mengen: { sch: 64 } } : t) };
    expect([...nachzufuehrendeTasks(geaendert.tasks, stammdaten, KAL, kraene)].sort()).toEqual(["A", "B"]);
    const neu = simNachfuehren(geaendert);
    // 9.11.: C belegt 4 der 8 Leute → A mit 4 (32 h); 10.11.: A mit 8 Leuten fertig (32 h) → B am 11.11.
    expect(termine(neu.tasks)).toEqual(["A 2026-11-09–2026-11-10", "B 2026-11-11–2026-11-11", "C 2026-11-09–2026-11-09"]);
    expect(neu.tasks[2]).toBe(geaendert.tasks[2]);
    expect(neu.tasks[0].tagesArbeit?.tage["2026-11-09"]).toEqual([{ pos: "sch::W", von: 0, bis: 8, leute: 4, ph: 32 }]);
  });

  it("Kräne & Personal geändert: alle Tasks werden neu geplant", () => {
    const sim = optimierteSim();
    const weniger: Kran[] = [{ id: "k1", name: "Kran 1", personal: [{ id: "1", unternehmer: "Bau AG", personen: 4 }] }];
    const neu = simNachfuehren({ ...sim, kraene: weniger });
    expect(termine(neu.tasks)).toEqual(["A 2026-11-09–2026-11-09", "B 2026-11-10–2026-11-10", "C 2026-11-11–2026-11-11"]);
  });
});
