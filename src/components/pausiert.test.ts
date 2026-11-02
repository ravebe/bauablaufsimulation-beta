import { describe, it, expect } from "vitest";
import type { Task, Kran } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { optimiereAuslastung } from "./auslastungOptimieren";
import { tagesplan, pausiertAmTag } from "./tagesplan";

const KAL = { feiertage: [], ferien: [] };
const rate = (lw: number, p: number, u: string, kran: boolean) =>
  ({ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: lw, anzahlPersonen: p, chfProEinheit: null, unternehmer: u, kranpflichtig: kran, kranzeitProzent: 10 });
// Schalung Baumeister (Pool 8 unter dem Kran), danach Bewehrung Eisen GmbH als eine Kolonne (ohne Kran) — nur eine Wand gleichzeitig
const sd: Stammdaten = { ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8, gewerke: [
  { key: "sch", label: "Schalung", einheit: "m2", raten: [rate(1, 4, "Baumeister", true)] },
  { key: "bew", label: "Bewehrung", einheit: "t", raten: [rate(1, 2, "Eisen GmbH", false)] },
] } as Stammdaten;
const task = (id: string): Task => ({ id, name: id, start: "2026-11-09", end: "2026-11-09", typ: "neubau", objektGuids: [], bauteilKuerzel: "W", kraene: ["k1"], mengen: { sch: 32, bew: 16 } });
const kraene: Kran[] = [{ id: "k1", name: "Kran 1", personal: [{ id: "1", unternehmer: "Baumeister", personen: 8 }] }];

describe("pausiertAmTag", () => {
  it("Task läuft laut Gantt, hat heute aber keine Arbeit (Kolonne an der anderen Wand) → pausiert mit Grund und nächstem Tag", () => {
    const ts = optimiereAuslastung([task("A"), task("B")], sd, KAL, "tage", kraene);
    // beide Schalungen am 9.11., Bewehrung A am 10.11., Bewehrung B erst am 11.11.
    const b = ts.find(t => t.id === "B")!;
    expect([b.start, b.end]).toEqual(["2026-11-09", "2026-11-11"]);
    const iso = "2026-11-10";
    const plan = tagesplan(iso, ts, sd, KAL, kraene);
    expect(plan.tasks.map(z => z.t.id)).toEqual(["A"]);
    const p = pausiertAmTag(iso, ts, plan, sd, KAL, kraene);
    expect(p.map(x => [x.t.id, x.grund, x.weiterAm])).toEqual([["B", "kolonne", "2026-11-11"]]);
  });
});
