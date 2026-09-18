import { describe, it, expect } from "vitest";
import type { Task, Kran } from "../types";
import { LEERER_KALENDER } from "./kalenderHelpers";
import type { Stammdaten } from "./stammdatenHelpers";
import { personenstundenProKranUndBucket, personalRichtwertJeBucket, MAX_PERSONEN_PRO_KRAN } from "./kapazitaetsCheckHelpers";

const stammdaten: Stammdaten = {
  arbeitszeitStdProTag: 8,
  gewerke: [{
    key: "beton", label: "Beton", einheit: "m3",
    raten: [{ kuerzel: "WB", bezeichnung: "Wand", leistungswertHProEinheit: 2, anzahlPersonen: 3, chfProEinheit: null, kranpflichtig: true }],
  }],
};
const k1: Kran = { id: "k1", name: "Kran 1" };
const k2: Kran = { id: "k2", name: "Kran 2" };
// Mo 5.1.2026 – Fr 9.1.2026 (5 Arbeitstage), Menge 40 × Leistungswert 2 = 80 Personenstunden
const task: Task = { id: "t1", name: "T", start: "2026-01-05", end: "2026-01-09", typ: "neubau", objektGuids: [],
  bauteilKuerzel: "WB", mengen: { beton: 40 }, kraene: ["k1", "k2"] };

describe("personenstundenProKranUndBucket", () => {
  it("verteilt Personenstunden gleichmässig über Arbeitstage UND anteilig auf mehrere Kräne", () => {
    const { serien } = personenstundenProKranUndBucket([task], [k1, k2], stammdaten, LEERER_KALENDER, "woche");
    // 80 Personenstunden gesamt, je Kran Anteil 0.5 → 40 Personenstunden je Kran
    expect(serien.find(s => s.kranId === "k1")?.personenstunden[0]).toBeCloseTo(40, 5);
    expect(serien.find(s => s.kranId === "k2")?.personenstunden[0]).toBeCloseTo(40, 5);
  });

  it("kein Bedarf ohne Kran-Zuweisung am Task", () => {
    const ohneKran: Task = { ...task, kraene: undefined };
    const { serien } = personenstundenProKranUndBucket([ohneKran], [k1, k2], stammdaten, LEERER_KALENDER, "woche");
    expect(serien.every(s => s.personenstunden.every(v => v === 0))).toBe(true);
  });
});

describe("personalRichtwertJeBucket — Personal-Ampel (13-Regel)", () => {
  it("rundet auf ganze Personen, keine Nachkommastellen", () => {
    // 40 Personenstunden / (8h × 5 Arbeitstage) = 1 Person
    const rw = personalRichtwertJeBucket(40, 5, 8);
    expect(rw.richtwert).toBe(1);
    expect(Number.isInteger(rw.richtwert)).toBe(true);
    expect(rw.engpass).toBe(false);
  });

  it("Engpass, wenn der Richtwert über MAX_PERSONEN_PRO_KRAN liegt", () => {
    // 800 Personenstunden / (8h × 5 Arbeitstage) = 20 Personen > 13
    const rw = personalRichtwertJeBucket(800, 5, 8);
    expect(rw.richtwert).toBeGreaterThan(MAX_PERSONEN_PRO_KRAN);
    expect(rw.engpass).toBe(true);
  });

  it("konfigurierbares Maximum wird respektiert", () => {
    const rw = personalRichtwertJeBucket(80, 5, 8, 3); // Richtwert 2, Max 3 → kein Engpass
    expect(rw.richtwert).toBe(2);
    expect(rw.engpass).toBe(false);
    const rwEng = personalRichtwertJeBucket(80, 5, 8, 1); // Max 1 → Engpass
    expect(rwEng.engpass).toBe(true);
  });

  it("Kran nicht verfügbar (0 Arbeitstage) aber Bedarf vorhanden = Engpass ohne sinnvollen Richtwert", () => {
    const rw = personalRichtwertJeBucket(40, 0, 8);
    expect(rw.richtwert).toBeNull();
    expect(rw.engpass).toBe(true);
    expect(rw.kranNichtVerfuegbar).toBe(true);
  });

  it("kein Bedarf und Kran nicht verfügbar = kein Engpass (nichts zu decken)", () => {
    const rw = personalRichtwertJeBucket(0, 0, 8);
    expect(rw.richtwert).toBeNull();
    expect(rw.engpass).toBe(false);
  });
});
