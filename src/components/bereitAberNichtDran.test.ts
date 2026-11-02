import { describe, it, expect } from "vitest";
import type { Task, Kran } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { optimiereAuslastung } from "./auslastungOptimieren";
import { tagesplan, bereitAberNichtDran, kranstundenImArbeitstag } from "./tagesplan";

const KAL = { feiertage: [], ferien: [] };
const rate = (k: string, lw: number, p: number, u: string, kran: boolean, kz?: number) =>
  ({ kuerzel: k, bezeichnung: k, leistungswertHProEinheit: lw, anzahlPersonen: p, chfProEinheit: null, unternehmer: u, kranpflichtig: kran, ...(kz != null ? { kranzeitProzent: kz } : {}) });
// wie «Bärchi»: Fundamente (1 P) und Bodenplatte (4 P), Schalung kranpflichtig, Kranzeit % je nach Test (leer = 100 %)
const sd = (kranzeitSchalung?: number): Stammdaten => ({ ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8.5, gewerke: [
  { key: "sch", label: "Schalung", einheit: "m2", raten: [rate("FU", 0.55, 1, "Baumeister", true, kranzeitSchalung), rate("BPL", 0.797, 4, "Baumeister", true, kranzeitSchalung)] },
  { key: "bew", label: "Bewehrung", einheit: "kg", raten: [rate("FU", 0.004, 1, "Akkordant", false), rate("BPL", 0.0035, 5, "Akkordant", false)] },
  { key: "bet", label: "Beton", einheit: "m3", raten: [rate("FU", 0.3, 1, "Baumeister", false), rate("BPL", 0.2, 4, "Baumeister", false)] },
] } as Stammdaten);
const task = (id: string, k: string, mengen: Record<string, number>, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start: "2026-10-26", end: "2026-10-27", typ: "neubau", objektGuids: [], bauteilKuerzel: k, kraene: ["k1"], mengen, ...p });
const kraene: Kran[] = [{ id: "k1", name: "Kran 1", personal: [{ id: "1", unternehmer: "Baumeister", personen: 10 }] }];
const projekt = (): Task[] => [
  ...Array.from({ length: 8 }, (_, i) => task("FU" + i, "FU", { sch: 5.4, bew: 875, bet: 4 })),
  { id: "M", name: "M", start: "2026-10-23", end: "2026-10-23", typ: "neubau", objektGuids: [] },
  task("BPL", "BPL", { sch: 56, bew: 24000, bet: 200 }, { predecessorId: "M", lagDays: 0 }),
];
const gruppen = { gruppen: { stufen: [{ quelle: "kuerzel" as const, werte: ["FU", "BPL"], aktiv: true }] } };

describe("bereitAberNichtDran", () => {
  it("Kranzeit leer (100 %), Reihenfolge FU vor BPL: Bodenplatte bereit, wartet aber auf den Kran", () => {
    const neu = optimiereAuslastung(projekt(), sd(), KAL, "stunden", kraene, "gruppen", false, gruppen);
    const plan = tagesplan("2026-10-27", neu, sd(), KAL, kraene);
    expect(kranstundenImArbeitstag(plan, 8.5).get("k1")).toBeGreaterThan(8.5 * 0.9);
    const b = bereitAberNichtDran("2026-10-27", neu, plan, sd(), KAL, kraene);
    expect(b.map(x => [x.t.id, x.grund, x.bereitSeit])).toEqual([["BPL", "kran", "2026-10-26"]]);
    expect(b[0].kranzeitLeer).toEqual(["Schalung · FU"]);
    expect(b[0].autoVorgaenger.length).toBe(1); // vom Optimieren ergänzt
  });

  it("Kranzeit Schalung 20 %: Bodenplatte beginnt gleich, nichts wartet", () => {
    const neu = optimiereAuslastung(projekt(), sd(20), KAL, "stunden", kraene, "gruppen", false, gruppen);
    expect(neu.find(t => t.id === "BPL")!.start).toBe("2026-10-26");
    const plan = tagesplan("2026-10-27", neu, sd(20), KAL, kraene);
    expect(bereitAberNichtDran("2026-10-27", neu, plan, sd(20), KAL, kraene)).toEqual([]);
  });
});
