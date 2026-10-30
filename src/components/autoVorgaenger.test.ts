import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import { vorgaengerListe, automatischeVorgaenger, setzeVorgaenger } from "../types";
import { autoVorgaengerSetzen } from "./autoVorgaenger";

const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });
const vorg = (ts: Task[]) => Object.fromEntries(ts.map(t => [t.id, vorgaengerListe(t).map(v => v.id).join(",")]));

describe("Auto-Vorgänger", () => {
  // Gantt-Reihenfolge A, C, B — Termine: A und C am 9.11. (parallel), B am 10.11.
  const ts = [task("A", "2026-11-09", "2026-11-09"), task("C", "2026-11-09", "2026-11-09"), task("B", "2026-11-10", "2026-11-10")];

  it("nach Gantt-Reihenfolge: alles nacheinander, als automatisch markiert", () => {
    const neu = autoVorgaengerSetzen(ts, "gantt");
    expect(vorg(neu)).toEqual({ A: "", C: "A", B: "C" });
    expect([...automatischeVorgaenger(neu[1])]).toEqual(["A"]);
  });

  it("nach aktuellen Terminen: Vorgänger = zuletzt vor dem Start endender Task, Paralleles bleibt parallel", () => {
    expect(vorg(autoVorgaengerSetzen(ts, "daten"))).toEqual({ A: "", C: "", B: "C" });
  });

  it("Tasks ohne Termine werden der Gantt-Reihenfolge nach angehängt", () => {
    const mitLeerem = [...ts, task("X", "", "")];
    expect(vorg(autoVorgaengerSetzen(mitLeerem, "daten")).X).toBe("B");
  });

  it("erneut ausführen ersetzt nur die eigenen Vorgänger — von Hand gesetzte bleiben", () => {
    const erst = autoVorgaengerSetzen(ts, "gantt"); // C ← A, B ← C (automatisch)
    const vonHand = erst.map(t => t.id === "B" ? { ...t, predecessorId: "A", autoVorgaenger: undefined } : t); // B ← A von Hand
    const neu = autoVorgaengerSetzen(vonHand, "daten");
    expect(vorg(neu)).toEqual({ A: "", C: "", B: "A" }); // C neu bestimmt (parallel zu A), B unverändert
    expect(automatischeVorgaenger(neu[2]).size).toBe(0);
  });

  it("Gruppen nur mit ihren Geschwistern", () => {
    const g = [task("G1", "2026-11-09", "2026-11-09", { isGroup: true, outlineLevel: 1 }), task("a", "2026-11-09", "2026-11-09", { outlineLevel: 2 }),
      task("G2", "2026-11-10", "2026-11-10", { isGroup: true, outlineLevel: 1 }), task("b", "2026-11-10", "2026-11-10", { outlineLevel: 2 })];
    expect(vorg(autoVorgaengerSetzen(g, "daten"))).toEqual({ G1: "", a: "", G2: "G1", b: "a" });
  });

  it("von Hand bearbeitet: unveränderte Vorgänger bleiben automatisch, neue/geänderte gelten als von Hand", () => {
    const erst = autoVorgaengerSetzen(ts, "gantt"); // B ← C automatisch
    const neu = setzeVorgaenger(erst, ["B"], [{ id: "C", lagDays: 0 }, { id: "A", lagDays: 2 }]);
    const b = neu.find(t => t.id === "B")!;
    expect([...automatischeVorgaenger(b)]).toEqual(["C"]);
    const geaendert = setzeVorgaenger(erst, ["B"], [{ id: "C", lagDays: 1 }]).find(t => t.id === "B")!;
    expect(automatischeVorgaenger(geaendert).size).toBe(0); // Wartetage geändert → von Hand
  });
});
