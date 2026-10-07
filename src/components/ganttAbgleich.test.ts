import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import { gleicheGanttAb } from "./ganttAbgleich";

const t = (id: string, name: string, p: Partial<Task> = {}): Task =>
  ({ id, name, start: "2025-01-06", end: "2025-01-10", typ: "neubau", objektGuids: [], ...p });

describe("gleicheGanttAb", () => {
  it("Bauteile, ID und Kalkulationsdaten bleiben, Termine kommen aus der Datei", () => {
    const alt = [t("a1", "Wand 01", { objektGuids: ["m:::1", "m:::2"], mengen: { beton: 5 }, bauteilKuerzel: "WB" })];
    const neu = [t("n1", "Wand 01", { start: "2025-02-01", end: "2025-02-05" })];
    const r = gleicheGanttAb(alt, neu);
    expect(r.tasks[0]).toMatchObject({ id: "a1", start: "2025-02-01", objektGuids: ["m:::1", "m:::2"], mengen: { beton: 5 }, bauteilKuerzel: "WB" });
    expect(r.bauteileUebernommen).toBe(2);
  });

  it("gleicher Name in verschiedenen Gruppen: Zuordnung über den Pfad", () => {
    const alt = [
      t("g1", "UG", { isGroup: true, outlineLevel: 1 }), t("a1", "Wand", { outlineLevel: 2, objektGuids: ["ug"] }),
      t("g2", "EG", { isGroup: true, outlineLevel: 1 }), t("a2", "Wand", { outlineLevel: 2, objektGuids: ["eg"] }),
    ];
    // neue Datei: Reihenfolge der Gruppen getauscht
    const neu = [
      t("n1", "EG", { isGroup: true, outlineLevel: 1 }), t("n2", "Wand", { outlineLevel: 2 }),
      t("n3", "UG", { isGroup: true, outlineLevel: 1 }), t("n4", "Wand", { outlineLevel: 2 }),
    ];
    const r = gleicheGanttAb(alt, neu);
    expect(r.tasks.map(x => x.objektGuids)).toEqual([[], ["eg"], [], ["ug"]]);
  });

  it("umbenannte Gruppe: Zuordnung über eindeutigen Namen", () => {
    const alt = [t("g", "Rohbau", { isGroup: true, outlineLevel: 1 }), t("a", "Decke 01", { outlineLevel: 2, objektGuids: ["x"] })];
    const neu = [t("ng", "Rohbau Haus A", { isGroup: true, outlineLevel: 1 }), t("n", "Decke 01", { outlineLevel: 2 })];
    expect(gleicheGanttAb(alt, neu).tasks[1]).toMatchObject({ id: "a", objektGuids: ["x"] });
  });

  it("mehrdeutiger Name ohne Pfad-Treffer: lieber nicht zuordnen", () => {
    const alt = [t("a1", "Wand", { objektGuids: ["1"] }), t("a2", "Wand", { objektGuids: ["2"] })];
    const neu = [t("g", "Neu", { isGroup: true }), t("n1", "Wand", { outlineLevel: 2 })];
    const r = gleicheGanttAb(alt, neu);
    expect(r.tasks[1].objektGuids).toEqual([]);
    expect(r.wegfallend).toEqual({ tasks: 2, bauteile: 2 });
  });

  it("Vorgänger aus der Datei zeigen danach auf die übernommenen IDs", () => {
    const alt = [t("a1", "A"), t("a2", "B")];
    const neu = [t("n1", "A"), t("n2", "B", { predecessorId: "n1" })];
    expect(gleicheGanttAb(alt, neu).tasks[1].predecessorId).toBe("a1");
  });

  it("Datei mit eigenen Bauteilen (MS-Project-Rundweg) behält diese", () => {
    const alt = [t("a", "A", { objektGuids: ["alt"] })];
    const neu = [t("n", "A", { objektGuids: ["neu"] })];
    expect(gleicheGanttAb(alt, neu).tasks[0].objektGuids).toEqual(["neu"]);
  });

  it("weggefallene Tasks werden gemeldet; Gross-/Kleinschreibung und Leerzeichen egal", () => {
    const alt = [t("a", "Wand  01", { objektGuids: ["1"] }), t("b", "Alt", { objektGuids: ["2", "3"] })];
    const r = gleicheGanttAb(alt, [t("n", "wand 01")]);
    expect(r.tasks[0].id).toBe("a");
    expect(r.wegfallend).toEqual({ tasks: 1, bauteile: 2 });
  });
});
