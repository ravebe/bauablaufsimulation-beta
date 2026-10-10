import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import { exportZeilen, baueImportTasks } from "./ganttTabelle";
import type { ImportZeile } from "./ganttTabelle";

const task = (id: string, name: string, p: Partial<Task> = {}): Task =>
  ({ id, name, start: "2025-01-06", end: "2025-01-10", typ: "neubau", objektGuids: [], ...p });

const zeile = (name: string, p: Partial<ImportZeile> = {}, t: Partial<Task> = {}): ImportZeile =>
  ({ task: task(crypto.randomUUID(), name, t), vorgRoh: "", lagRoh: "0", ...p });

describe("ganttTabelle", () => {
  it("Gruppen und Untergruppen überstehen Export → Import, Vorgänger zeigen auf dieselben Tasks", () => {
    const tasks: Task[] = [
      task("g1", "Rohbau", { isGroup: true, outlineLevel: 1 }),
      task("g2", "UG", { isGroup: true, outlineLevel: 2 }),
      task("t1", "Bodenplatte", { outlineLevel: 3, start: "2025-01-06", end: "2025-01-10" }),
      task("t2", "Wände UG", { outlineLevel: 3, start: "2025-01-13", end: "2025-01-17", predecessorId: "t1", lagDays: 2 }),
      task("g3", "EG", { isGroup: true, outlineLevel: 2 }),
      task("t3", "Decke EG", { outlineLevel: 3, start: "2025-01-20", end: "2025-01-24", predecessorId: "g2" }),
      task("t4", "Fassade", { outlineLevel: 1 }),
    ];
    const zeilen = exportZeilen(tasks);
    expect(zeilen.map(z => [z.nr, z.gruppe, z.ebene])).toEqual([
      ["A", true, 1], ["B", true, 2], ["1", false, 3], ["2", false, 3], ["C", true, 2], ["3", false, 3], ["4", false, 1],
    ]);
    expect(zeilen[1].start).toBe("06.01.2025"); // Gruppe UG aus ihren Tasks
    expect(zeilen[1].ende).toBe("17.01.2025");
    expect(zeilen[5].vorgaenger).toBe("B");

    const imp = baueImportTasks(zeilen.map(z => zeile(z.name, {
      vorgRoh: z.vorgaenger, lagRoh: String(z.wartetage), nrRoh: z.nr, gruppeRoh: z.gruppe ? "x" : "", ebeneRoh: String(z.ebene),
    }, { start: z.start, end: z.ende })));
    expect(imp.map(t => [t.name, !!t.isGroup, t.outlineLevel])).toEqual(tasks.map(t => [t.name, !!t.isGroup, t.outlineLevel]));
    const byName = new Map(imp.map(t => [t.name, t]));
    expect(byName.get("Wände UG")!.predecessorId).toBe(byName.get("Bodenplatte")!.id);
    expect(byName.get("Wände UG")!.lagDays).toBe(2);
    expect(byName.get("Decke EG")!.predecessorId).toBe(byName.get("UG")!.id);
  });

  it("Vorlage: Gruppen ohne Termine, eingerückte Namen, Ebene leitet Gruppen ab", () => {
    const imp = baueImportTasks([
      zeile("Rohbau", { ebeneRoh: "1" }, { start: "", end: "" }),
      zeile("   Erdarbeiten", { ebeneRoh: "2" }, { start: "2025-01-01", end: "2025-01-15" }),
      zeile("   Abbruch", { ebeneRoh: "2", vorgRoh: "1" }, { start: "2025-01-16", end: "2025-01-20" }),
    ]);
    expect(imp[0].isGroup).toBe(true);
    expect(imp[0].start).toBe("2025-01-01");
    expect(imp[0].end).toBe("2025-01-20");
    expect(imp[1].name).toBe("Erdarbeiten");
    expect(imp[2].predecessorId).toBe(imp[1].id); // "1" = erster Task (Gruppe = A)
  });

  it("nur Spalte Gruppe ohne Ebene: Tasks gehören zur Gruppe darüber", () => {
    const imp = baueImportTasks([
      zeile("Vorab"), zeile("G", { gruppeRoh: "x" }), zeile("T1"), zeile("T2"),
    ]);
    expect(imp.map(t => t.outlineLevel)).toEqual([1, 1, 2, 2]);
    expect(imp[1].isGroup).toBe(true);
  });

  it("Gantt-Reihenfolge stellt die Reihenfolge nach Umsortieren in Excel wieder her", () => {
    const imp = baueImportTasks([
      zeile("C", { reihenfolgeRoh: "3" }), zeile("A", { reihenfolgeRoh: "1" }), zeile("B", { reihenfolgeRoh: "2" }),
    ]);
    expect(imp.map(t => t.name)).toEqual(["A", "B", "C"]);
  });

  it("ohne Gruppen-Spalten wie bisher: Vorgänger = Zeilennummer; fremde Werte in 'Gruppe' bleiben Zusatzspalte", () => {
    const imp = baueImportTasks([
      zeile("A1", { gruppeRoh: "Team Nord" }), zeile("A2", { vorgRoh: "1" }),
    ]);
    expect(imp.some(t => t.isGroup)).toBe(false);
    expect(imp[1].predecessorId).toBe(imp[0].id);
    expect(imp[0].extraSpalten).toEqual({ Gruppe: "Team Nord" });
  });
});
