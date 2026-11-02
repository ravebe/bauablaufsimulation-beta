import { describe, it, expect } from "vitest";
import type { Task, Kran, UnternehmerPersonal } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { optimiereAuslastung } from "./auslastungOptimieren";
import { tagesplan } from "./tagesplan";
import { eingeplantesPersonalJeTag, unternehmerAmTag, personalJeUnternehmerAusKraenen } from "./kranHelpers";

const KAL = { feiertage: [], ferien: [] };
const rate = (lw: number, p: number, u: string, kran: boolean, kz?: number) =>
  ({ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: lw, anzahlPersonen: p, chfProEinheit: null, unternehmer: u, kranpflichtig: kran, ...(kz != null ? { kranzeitProzent: kz } : {}) });
// Wand: Schalung Baumeister (Min. 4, kranpflichtig 20 %), Bewehrung Akkordant (Min. 2, ohne Kran), Beton Baumeister (Min. 3, ohne Kran)
const sd: Stammdaten = { ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8, gewerke: [
  { key: "sch", label: "Schalung", einheit: "m2", raten: [rate(1, 4, "Baumeister", true, 20)] },
  { key: "bew", label: "Bewehrung", einheit: "t", raten: [rate(1, 2, "Akkordant", false)] },
  { key: "bet", label: "Beton", einheit: "m3", raten: [rate(1, 3, "Baumeister", false)] },
] } as Stammdaten;
const task = (id: string, mengen: Record<string, number>): Task =>
  ({ id, name: id, start: "2026-11-09", end: "2026-11-09", typ: "neubau", objektGuids: [], bauteilKuerzel: "W", kraene: ["k1"], mengen });
const kraene: Kran[] = [{ id: "k1", name: "Kran 1", personal: [{ id: "1", unternehmer: "Baumeister", personen: 10 }] }];
const tage = (ts: Task[]) => { const s = new Set<string>(); for (const t of ts) for (let d = new Date(t.start); d <= new Date(t.end); d.setDate(d.getDate() + 1)) s.add(d.toISOString().slice(0, 10)); return [...s].sort(); };
/** Höchstzahl gleichzeitig arbeitender Leute über alle Tage (Tagesablauf, «Im Einsatz») */
const maxImEinsatz = (ts: Task[], up: UnternehmerPersonal[]) => Math.max(0, ...tage(ts).map(iso => tagesplan(iso, ts, sd, KAL, kraene, undefined, up).imEinsatz.anzahl));

describe("Personal je Unternehmer", () => {
  it("unternehmerAmTag: Zeiträume, kleinste Grenze, wie Leistungsposition gewinnt", () => {
    const up: UnternehmerPersonal[] = [
      { id: "1", unternehmer: "Baumeister", personen: 7, bis: "2026-11-20" }, { id: "2", unternehmer: "Baumeister", personen: 10, von: "2026-11-21" },
      { id: "3", unternehmer: "Akkordant", unbegrenzt: true }, { id: "4", unternehmer: "Akkordant", personen: 2 },
    ];
    expect(unternehmerAmTag(up, "2026-11-10").grenze.get("Baumeister")).toBe(7);
    expect(unternehmerAmTag(up, "2026-11-23").grenze.get("Baumeister")).toBe(10);
    expect(unternehmerAmTag(up, "2026-11-10").unbegrenzt.has("Akkordant")).toBe(true);
    expect(unternehmerAmTag(up, "2026-11-10").grenze.has("Akkordant")).toBe(false);
  });

  it("höchstens 7 Baumeister: Kran-Pool von 10 und Beton ohne Kran zusammen nie über 7", () => {
    const ts = ["A", "B", "C", "D"].map(id => task(id, { sch: 32, bet: 12 }));
    const up: UnternehmerPersonal[] = [{ id: "1", unternehmer: "Baumeister", personen: 7 }];
    const ohne = optimiereAuslastung(ts, sd, KAL, "stunden", kraene);
    expect(maxImEinsatz(ohne, [])).toBeGreaterThan(7); // ohne Grenze: Pool 10 + Beton-Kolonne
    const mit = optimiereAuslastung(ts, sd, KAL, "stunden", kraene, "kritischerPfad", false, { unternehmer: up });
    expect(maxImEinsatz(mit, up)).toBeLessThanOrEqual(7);
    expect(mit.every(t => t.tagesArbeit)).toBe(true); // alles eingeplant
  });

  it("Grenze kleiner als Min. Personen: Arbeit läuft mit der ganzen Grenze statt ewig zu warten", () => {
    const up: UnternehmerPersonal[] = [{ id: "1", unternehmer: "Baumeister", personen: 2 }];
    const neu = optimiereAuslastung([task("A", { sch: 16 })], sd, KAL, "stunden", kraene, "kritischerPfad", false, { unternehmer: up });
    // 16 h mit 2 Leuten = 1 Tag
    expect(neu[0].start).toBe("2026-11-09");
    expect(neu[0].end).toBe("2026-11-09");
  });

  it("wie Leistungsposition: Bewehrung des Akkordanten an zwei Wänden gleichzeitig statt nacheinander", () => {
    const ts = [task("A", { bew: 16 }), task("B", { bew: 16 })];
    const nacheinander = optimiereAuslastung(ts, sd, KAL, "stunden", kraene);
    expect(nacheinander.map(t => t.start)).toEqual(["2026-11-09", "2026-11-10"]);
    const up: UnternehmerPersonal[] = [{ id: "1", unternehmer: "Akkordant", unbegrenzt: true }];
    const parallel = optimiereAuslastung(ts, sd, KAL, "stunden", kraene, "kritischerPfad", false, { unternehmer: up });
    expect(parallel.map(t => `${t.start}–${t.end}`)).toEqual(["2026-11-09–2026-11-09", "2026-11-09–2026-11-09"]);
  });

  it("von Kränen übernehmen: Kran 1 ab Februar 10, Kran 2 ab März 10 → Baumeister 10 im Februar, ab März 20", () => {
    const zwei: Kran[] = [
      { id: "k1", name: "Kran 1", verfuegbarVon: "2027-02-01", personal: [{ id: "1", unternehmer: "Baumeister", personen: 10 }] },
      { id: "k2", name: "Kran 2", verfuegbarVon: "2027-03-01", personal: [{ id: "2", unternehmer: "Baumeister", personen: 10 }, { id: "3", unternehmer: "Akkordant", personen: 4, bis: "2027-04-30" }] },
    ];
    expect(personalJeUnternehmerAusKraenen(zwei)).toEqual([
      { unternehmer: "Baumeister", personen: 10, von: "2027-02-01", bis: "2027-02-28" },
      { unternehmer: "Baumeister", personen: 20, von: "2027-03-01" },
      { unternehmer: "Akkordant", personen: 4, von: "2027-03-01", bis: "2027-04-30" },
    ]);
    // ohne Zeiträume: eine offene Zeile je Unternehmer
    expect(personalJeUnternehmerAusKraenen(kraene)).toEqual([{ unternehmer: "Baumeister", personen: 10 }]);
  });

  it("Eingeplant: Kran-Pool 10 wird auf die Grenze 7 gekappt", () => {
    const ts = [task("A", { sch: 32 })];
    const iso = "2026-11-09";
    expect(eingeplantesPersonalJeTag(ts, kraene, sd, KAL, [iso]).get(iso)!.total).toBe(10);
    expect(eingeplantesPersonalJeTag(ts, kraene, sd, KAL, [iso], [{ id: "1", unternehmer: "Baumeister", personen: 7 }]).get(iso)!.total).toBe(7);
  });
});
