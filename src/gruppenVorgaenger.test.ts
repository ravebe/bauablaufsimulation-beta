import { describe, it, expect } from "vitest";
import type { Task } from "./types";
import { ohneVerschachtelteVorgaenger, gueltigeVorgaenger, vorgaengerListe } from "./types";

const t = (id: string, level: number, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start: "2026-11-09", end: "2026-11-09", typ: "neubau", objektGuids: [], outlineLevel: level, ...p });

describe("Vorgänger zwischen Über- und Untergruppe", () => {
  // Etappe A ▸ UG ▸ F1, Etappe B ▸ F2
  const tasks = [t("A", 1), t("UG", 2, { predecessorId: "A" }), t("F1", 3), t("B", 1, { predecessorId: "A" }), t("F2", 2)];

  it("werden entfernt, Vorgänger zwischen Geschwistern bleiben", () => {
    const neu = ohneVerschachtelteVorgaenger(tasks);
    expect(vorgaengerListe(neu[1])).toEqual([]);
    expect(vorgaengerListe(neu[3]).map(v => v.id)).toEqual(["A"]);
    expect(ohneVerschachtelteVorgaenger(neu)).toBe(neu); // nichts mehr zu tun → dasselbe Array
  });

  it("die eigene Übergruppe ist kein gültiger Vorgänger", () => {
    expect(gueltigeVorgaenger(tasks, "UG").map(x => x.id)).not.toContain("A");
    expect(gueltigeVorgaenger(tasks, "B").map(x => x.id)).toContain("A");
  });
});
