import { describe, it, expect } from "vitest";
import type { SimProjekt, Task } from "../types";
import { bauteileAusschliessen, bauteileWiederAufnehmen, unverknuepfteGuids, ohneAusgeschlossene, ausschluesseUmstellen } from "./ausschlussHelpers";

const task = (id: string, objektGuids: string[], p: Partial<Task> = {}): Task =>
  ({ id, name: id, start: "2025-01-06", end: "2025-01-10", typ: "neubau", objektGuids, ...p });
const sim = (tasks: Task[], ausgeschlossen?: SimProjekt["ausgeschlossen"]) =>
  ({ id: "s", name: "S", tasks, modelle: [], ausgeschlossen }) as unknown as SimProjekt;

const M = (n: number) => `m:::${n}`;

describe("bauteileAusschliessen", () => {
  it("nimmt das Bauteil aus seinem Task und merkt den Task", () => {
    const s = bauteileAusschliessen(sim([task("t1", [M(1), M(2)])]), [M(1)]);
    expect(s.tasks[0].objektGuids).toEqual([M(2)]);
    expect(s.ausgeschlossen).toEqual([{ guid: M(1), taskId: "t1" }]);
  });
  it("unverknüpftes Bauteil: ohne Task merken", () => {
    const s = bauteileAusschliessen(sim([task("t1", [])]), [M(9)]);
    expect(s.ausgeschlossen).toEqual([{ guid: M(9) }]);
  });
  it("bereits ausgeschlossen → keine Doppelung, unveränderte Sim", () => {
    const vorher = sim([], [{ guid: M(1) }]);
    expect(bauteileAusschliessen(vorher, [M(1)])).toBe(vorher);
  });
  it("unveränderte Tasks bleiben dieselben Objekte (für Rückgängig/Speichern)", () => {
    const t2 = task("t2", [M(5)]);
    const s = bauteileAusschliessen(sim([task("t1", [M(1)]), t2]), [M(1)]);
    expect(s.tasks[1]).toBe(t2);
  });
});

describe("bauteileWiederAufnehmen", () => {
  it("zurück in den bisherigen Task", () => {
    const aus = bauteileAusschliessen(sim([task("t1", [M(1), M(2)])]), [M(1)]);
    const { sim: s, zurueckInTask } = bauteileWiederAufnehmen(aus, [M(1)]);
    expect(s.tasks[0].objektGuids).toEqual([M(2), M(1)]);
    expect(s.ausgeschlossen).toEqual([]);
    expect(zurueckInTask).toBe(1);
  });
  it("Task inzwischen gelöscht → wieder unverknüpft", () => {
    const { sim: s, zurueckInTask } = bauteileWiederAufnehmen(sim([task("t2", [])], [{ guid: M(1), taskId: "weg" }]), [M(1)]);
    expect(s.ausgeschlossen).toEqual([]);
    expect(s.tasks[0].objektGuids).toEqual([]);
    expect(zurueckInTask).toBe(0);
    expect(unverknuepfteGuids([M(1)], s)).toEqual([M(1)]);
  });
  it("nur die gewählten, andere bleiben ausgeschlossen", () => {
    const { sim: s } = bauteileWiederAufnehmen(sim([], [{ guid: M(1) }, { guid: M(2) }]), [M(2)]);
    expect(s.ausgeschlossen).toEqual([{ guid: M(1) }]);
  });
});

describe("Hilfen", () => {
  it("unverknüpft = alle − in Tasks − ausgeschlossen", () => {
    const s = sim([task("t1", [M(1)])], [{ guid: M(2) }]);
    expect(unverknuepfteGuids([M(1), M(2), M(3)], s)).toEqual([M(3)]);
  });
  it("ohneAusgeschlossene filtert für automatische Zuordnungen", () => {
    expect(ohneAusgeschlossene([M(1), M(2)], { ausgeschlossen: [{ guid: M(2) }] })).toEqual([M(1)]);
  });
  it("Versionswechsel stellt Ausschlüsse um", () => {
    expect(ausschluesseUmstellen([{ guid: M(1), taskId: "t" }], new Map([[M(1), M(7)]]))).toEqual([{ guid: M(7), taskId: "t" }]);
  });
});
