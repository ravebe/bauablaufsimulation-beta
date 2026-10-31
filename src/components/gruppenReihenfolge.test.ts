import { describe, it, expect } from "vitest";
import type { Task, Kran, GruppenReihenfolge } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { gruppenStruktur, gruppenReihenfolgeAbgleichen, rangJeTask } from "./gruppenReihenfolge";
import { optimiereAuslastung } from "./auslastungOptimieren";

const KAL = { feiertage: [], ferien: [] };
const gruppe = (id: string, name: string, outlineLevel: number): Task =>
  ({ id, name, start: "2026-11-09", end: "2026-11-20", typ: "neubau", objektGuids: [], isGroup: true, outlineLevel });
const task = (id: string, kuerzel: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start: "2026-11-09", end: "2026-11-09", typ: "neubau", objektGuids: [], outlineLevel: 3, bauteilKuerzel: kuerzel,
    mengen: { sch: 32 }, kraene: ["k1"], ...p });
// 8 h/Tag; Schalung Wand W und Decke D: Bau AG, Min. 4, 1 h/m² — 4 Leute unter dem Kran → immer nur eine Arbeit gleichzeitig
const stammdaten = { ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8, gewerke: [{ key: "sch", label: "Schalung", einheit: "m2", raten: ["W", "D"].map(k => ({
  kuerzel: k, bezeichnung: k === "W" ? "Wand" : "Decke", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: null, unternehmer: "Bau AG",
  kranpflichtig: true, kranzeitProzent: 25 })) }] } as Stammdaten;
const kraene: Kran[] = [{ id: "k1", name: "Kran 1", personal: [{ id: "1", unternehmer: "Bau AG", personen: 4 }] }];
const termine = (ts: Task[]) => ts.filter(t => !t.isGroup).map(t => `${t.id} ${t.start}`);

// Etappe A: UG (Wand, Decke), EG (Wand)
const gantt = (p: Partial<Record<string, Partial<Task>>> = {}): Task[] => [
  gruppe("eA", "Etappe A", 1), gruppe("ug", "UG", 2), task("UG-W", "W", p["UG-W"]), task("UG-D", "D", p["UG-D"]),
  gruppe("eg", "EG", 2), task("EG-W", "W", p["EG-W"]),
];

describe("Reihenfolge nach Gruppen", () => {
  it("erkennt die Stufen: Gruppenebenen in Gantt-Reihenfolge, zuletzt die Bauteilart", () => {
    expect(gruppenStruktur(gantt())).toEqual([
      { quelle: "gruppe", ebene: 1, werte: ["Etappe A"], aktiv: true },
      { quelle: "gruppe", ebene: 2, werte: ["UG", "EG"], aktiv: true },
      { quelle: "kuerzel", werte: ["W", "D"], aktiv: true },
    ]);
  });

  it("gespeicherte Reihenfolge bleibt, neue Werte kommen an ihre Stelle laut Gantt, verschwundene fallen weg", () => {
    const gespeichert: GruppenReihenfolge = { stufen: [
      { quelle: "kuerzel", werte: ["D", "X", "W"], aktiv: true }, { quelle: "gruppe", ebene: 2, werte: ["EG"], aktiv: false }] };
    expect(gruppenReihenfolgeAbgleichen(gespeichert, gantt()).stufen).toEqual([
      { quelle: "kuerzel", werte: ["D", "W"], aktiv: true },
      { quelle: "gruppe", ebene: 2, werte: ["UG", "EG"], aktiv: false }, // UG steht im Gantt vor EG
      { quelle: "gruppe", ebene: 1, werte: ["Etappe A"], aktiv: true },
    ]);
  });

  it("neue Gruppe zuoberst im Gantt (z.B. Tiefbau) kommt vorne dazu, nicht hinten; Kürzel aus Tab Ressourcen erscheinen gleich", () => {
    const ts = [gruppe("tb", "Tiefbau", 1), task("MB", "MB", { outlineLevel: 2 }), ...gantt()];
    const gespeichert: GruppenReihenfolge = { stufen: [{ quelle: "gruppe", ebene: 1, werte: ["Etappe A"], aktiv: true }, { quelle: "kuerzel", werte: ["D", "W"], aktiv: true }] };
    const erg = gruppenReihenfolgeAbgleichen(gespeichert, ts, ["W", "D", "NEU"]);
    expect(erg.stufen[0].werte).toEqual(["Tiefbau", "Etappe A"]);
    expect(erg.stufen.find(x => x.quelle === "kuerzel")!.werte).toEqual(["MB", "D", "W", "NEU"]);
  });

  it("ohne Gantt-Termine: Tasks mit Dauer werden ab Baubeginn geplant, Meilensteine und Platzhalter bleiben, wie sie sind", () => {
    const ts = [
      gruppe("tb", "Tiefbau", 1),
      task("MB", "", { outlineLevel: 2, start: "", end: "", typ: "bestand", bauteilKuerzel: undefined, mengen: undefined, berechneteDauerManuell: 2 }),
      task("MS", "", { outlineLevel: 2, start: "2026-12-01", end: "2026-12-01", meilenstein: true, bauteilKuerzel: undefined, mengen: undefined }),
      task("PH", "", { outlineLevel: 2, start: "", end: "", bauteilKuerzel: undefined, mengen: undefined }),
      ...gantt({ "UG-W": { start: "", end: "", predecessorId: "MB" }, "UG-D": { start: "", end: "" }, "EG-W": { start: "", end: "" } }),
    ];
    const erg = optimiereAuslastung(ts, stammdaten, KAL, "tage", kraene, "gruppen", false, { gruppen: gruppenReihenfolgeAbgleichen(undefined, ts), abBeginn: true, baubeginn: "2027-03-01" });
    const t = (id: string) => erg.find(x => x.id === id)!;
    expect([t("MB").start, t("MB").end]).toEqual(["2027-03-01", "2027-03-02"]); // feste Dauer 2 d ab Baubeginn
    expect(t("UG-W").start).toBe("2027-03-03"); // nach dem Magerbeton
    expect(t("UG-D").start >= "2027-03-01" && t("EG-W").start >= "2027-03-01").toBe(true);
    expect(t("MS")).toBe(ts.find(x => x.id === "MS")); // Meilenstein unverändert
    expect([t("PH").start, t("PH").end]).toEqual(["", ""]); // Platzhalter bleibt ohne Termine
  });

  it("Baubeginn: kein geplanter Task beginnt davor, auch wenn sein bisheriger Start früher ist", () => {
    const erg = optimiereAuslastung(gantt(), stammdaten, KAL, "tage", kraene, "gruppen", false, { gruppen: gruppenReihenfolgeAbgleichen(undefined, gantt()), baubeginn: "2026-11-16" });
    expect(termine(erg)).toEqual(["UG-W 2026-11-16", "UG-D 2026-11-17", "EG-W 2026-11-18"]);
  });

  it("Stufe «fest»: EG beginnt erst nach dem ganzen UG derselben Etappe — weich dürfte es parallel, wenn Personal frei ist", () => {
    // genug Personal (12 = 3 × Min. 4): weich laufen alle drei am ersten Tag, fest wartet EG auf UG-W und UG-D
    const viel: Kran[] = [{ id: "k1", name: "Kran 1", personal: [{ id: "1", unternehmer: "Bau AG", personen: 12 }] }];
    const weich = gruppenReihenfolgeAbgleichen(undefined, gantt());
    const fest = { stufen: weich.stufen.map(s => s.quelle === "gruppe" && s.ebene === 2 ? { ...s, streng: true } : s) };
    expect(termine(optimiereAuslastung(gantt(), stammdaten, KAL, "tage", viel, "gruppen", false, { gruppen: weich }))).toEqual(["UG-W 2026-11-09", "UG-D 2026-11-09", "EG-W 2026-11-09"]);
    expect(termine(optimiereAuslastung(gantt(), stammdaten, KAL, "tage", viel, "gruppen", false, { gruppen: fest }))).toEqual(["UG-W 2026-11-09", "UG-D 2026-11-09", "EG-W 2026-11-10"]);
    // fest gilt auch mit anderer Reihenfolge der Optimierung (z.B. Gantt-Reihenfolge)
    const eg = (r: "gantt" | "kritischerPfad") => optimiereAuslastung(gantt(), stammdaten, KAL, "tage", viel, r, false, { gruppen: fest }).find(t => t.id === "EG-W")!.start;
    expect(eg("gantt") > "2026-11-09" && eg("kritischerPfad") > "2026-11-09").toBe(true);
  });

  it("Stufe «fest» im Widerspruch zu einem Vorgänger: wird für die Wartenden aufgehoben und gemeldet, keine Endlosschleife", () => {
    // UG-W hat EG-W als Vorgänger, EG soll aber fest nach UG kommen → Widerspruch
    const ts = gantt({ "UG-W": { predecessorId: "EG-W" } });
    const fest = { stufen: gruppenReihenfolgeAbgleichen(undefined, ts).stufen.map(s => s.quelle === "gruppe" && s.ebene === 2 ? { ...s, streng: true } : s) };
    const bericht = { gelockert: [] as string[] };
    const erg = optimiereAuslastung(ts, stammdaten, KAL, "tage", kraene, "gruppen", false, { gruppen: fest, bericht });
    expect(bericht.gelockert.length).toBeGreaterThan(0);
    expect(erg.every(t => t.isGroup || !!t.start)).toBe(true);
    const t = (id: string) => erg.find(x => x.id === id)!;
    expect(t("UG-W").start > t("EG-W").start).toBe(true); // der Vorgänger gilt
  });

  it("Tasks ohne Vorgänger ab Projektbeginn: die Reihenfolge entscheidet, nicht die bisherige Lage im Gantt", () => {
    // Magerbeton (Tiefbau) steht im Gantt spät, ist aber in der Reihenfolge vorne
    const ts = [gruppe("tb", "Tiefbau", 1), task("MB", "W", { outlineLevel: 2, start: "2026-12-14", end: "2026-12-14" }), ...gantt()];
    const reihenfolge = gruppenReihenfolgeAbgleichen(undefined, ts);
    const ohne = optimiereAuslastung(ts, stammdaten, KAL, "tage", kraene, "gruppen", false, { gruppen: reihenfolge });
    expect(ohne.find(t => t.id === "MB")!.start).toBe("2026-12-14"); // frühestens am bisherigen Start
    const mit = optimiereAuslastung(ts, stammdaten, KAL, "tage", kraene, "gruppen", false, { gruppen: reihenfolge, abBeginn: true });
    expect(termine(mit)).toEqual(["MB 2026-11-09", "UG-W 2026-11-10", "UG-D 2026-11-11", "EG-W 2026-11-12"]);
  });

  it("Rang: Tasks ausserhalb der Gruppen zuerst", () => {
    const ts = [task("MB", "W", { outlineLevel: 1 }), ...gantt()];
    const r = rangJeTask(ts, { stufen: gruppenStruktur(ts) });
    expect(r.get("MB")).toEqual([-1, -1, 0]);
    expect(r.get("EG-W")).toEqual([0, 1, 0]);
  });

  it("Personal geht der Reihe nach: Geschoss UG vor EG, darin Decke vor Wand (statt kritischem Pfad)", () => {
    const ts = gantt();
    const g: GruppenReihenfolge = { stufen: [
      { quelle: "gruppe", ebene: 2, werte: ["UG", "EG"], aktiv: true }, { quelle: "kuerzel", werte: ["D", "W"], aktiv: true }] };
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", kraene, "gruppen", false, { gruppen: g })))
      .toEqual(["UG-W 2026-11-10", "UG-D 2026-11-09", "EG-W 2026-11-11"]);
    // EG vor UG
    const umgekehrt: GruppenReihenfolge = { stufen: [{ ...g.stufen[0], werte: ["EG", "UG"] }, g.stufen[1]] };
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", kraene, "gruppen", false, { gruppen: umgekehrt })))
      .toEqual(["UG-W 2026-11-11", "UG-D 2026-11-10", "EG-W 2026-11-09"]);
  });

  it("weich: hat das vordere Geschoss gerade keine Arbeit, geht das Personal ins nächste", () => {
    // UG-Wand darf erst ab 10.11. beginnen (z.B. Wartetage) → am 9.11. arbeiten die Leute im EG
    const ts = gantt({ "UG-W": { start: "2026-11-10", end: "2026-11-10" }, "UG-D": { predecessorId: "UG-W", lagDays: 0 } });
    const g: GruppenReihenfolge = { stufen: [{ quelle: "gruppe", ebene: 2, werte: ["UG", "EG"], aktiv: true }] };
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", kraene, "gruppen", false, { gruppen: g })))
      .toEqual(["UG-W 2026-11-10", "UG-D 2026-11-11", "EG-W 2026-11-09"]);
  });
});
