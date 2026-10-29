import { describe, it, expect } from "vitest";
import type { Task, Kran } from "../types";
import { vorgaengerListe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { optimiereAuslastung } from "./auslastungOptimieren";
import { eingeplantesPersonalJeTag } from "./kranHelpers";

const KAL = { feiertage: [], ferien: [] };
const task = (id: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start: "2026-11-09", end: "2026-11-20", typ: "neubau", objektGuids: [], bauteilKuerzel: "W", kraene: ["k1"], ...p });
// 8 h/Tag. Wand W: Schalung (Bau AG, Kolonne 4, 1 h/m², kranpflichtig), Bewehrung (Eisen GmbH, Kolonne 2, 1 h/t, kranpflichtig)
const stammdaten: Stammdaten = {
  ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8,
  gewerke: [
    { key: "sch", label: "Schalung", einheit: "m2", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: null, unternehmer: "Bau AG", kranpflichtig: true }] },
    { key: "bew", label: "Bewehrung", einheit: "t", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 2, chfProEinheit: null, unternehmer: "Eisen GmbH", kranpflichtig: true }] },
  ],
} as Stammdaten;
const kran = (personal: { unternehmer: string; personen: number }[]): Kran[] =>
  [{ id: "k1", name: "Kran 1", personal: personal.map((p, i) => ({ id: String(i), ...p })) }];
const termine = (ts: Task[]) => ts.map(t => `${t.id} ${t.start}–${t.end}`);

describe("Auslastung optimieren mit Kranpersonal", () => {
  it("Pool von 8 Allroundern: zwei Wände (je 32 h Schalung, Kolonne 4) laufen parallel statt nacheinander", () => {
    const ts = [task("A", { mengen: { sch: 32 } }), task("B", { mengen: { sch: 32 } })];
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", kran([{ unternehmer: "Bau AG", personen: 8 }])))).toEqual([
      "A 2026-11-09–2026-11-09", "B 2026-11-09–2026-11-09",
    ]);
    // ohne Kranpersonal (Kolonnen-Variante): nacheinander
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage"))).toEqual(["A 2026-11-09–2026-11-09", "B 2026-11-10–2026-11-10"]);
  });

  it("freie Leute verstärken eine Phase (höchstens doppelte Kolonne) — 64 h Schalung mit 8 Leuten in 1 Tag", () => {
    const ts = [task("A", { mengen: { sch: 64 } })];
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", kran([{ unternehmer: "Bau AG", personen: 12 }])))).toEqual(["A 2026-11-09–2026-11-09"]);
    // 96 h: mit max. 8 Leuten (2 × Kolonne 4) 1.5 Tage → 2 Tage
    expect(termine(optimiereAuslastung([task("A", { mengen: { sch: 96 } })], stammdaten, KAL, "tage", kran([{ unternehmer: "Bau AG", personen: 12 }]))))
      .toEqual(["A 2026-11-09–2026-11-10"]);
  });

  it("Personal unter dem Kran ist die Höchstzahl: 4 Leute → nur eine Schalung (Min. 4) gleichzeitig", () => {
    const ts = [task("A", { mengen: { sch: 32 } }), task("B", { mengen: { sch: 32 } })];
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", kran([{ unternehmer: "Bau AG", personen: 4 }])))).toEqual([
      "A 2026-11-09–2026-11-09", "B 2026-11-10–2026-11-10",
    ]);
  });

  it("Unternehmer helfen sich nicht aus: Bewehrung der Eisen GmbH nutzt nicht den Pool der Bau AG", () => {
    // Bau AG 8 Leute, Eisen GmbH ohne Personal unter dem Kran → Bewehrung mit ihrer Kolonne (2), je Wand 16 h = 1 Tag, nacheinander
    const ts = [task("A", { mengen: { bew: 16 } }), task("B", { mengen: { bew: 16 } })];
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", kran([{ unternehmer: "Bau AG", personen: 8 }])))).toEqual([
      "A 2026-11-09–2026-11-09", "B 2026-11-10–2026-11-10",
    ]);
  });

  it("Arbeitsablauf je Task und Vorgänger bleiben massgebend", () => {
    // A: Schalung 32 h, dann Bewehrung 16 h (Kolonne 2 → 1 Tag); B folgt auf A
    const ts = [task("A", { mengen: { sch: 32, bew: 16 } }), task("B", { mengen: { sch: 32 }, predecessorId: "A", lagDays: 0 })];
    const neu = optimiereAuslastung(ts, stammdaten, KAL, "tage", kran([{ unternehmer: "Bau AG", personen: 8 }, { unternehmer: "Eisen GmbH", personen: 2 }]));
    // Schalung A mit 8 Leuten (verstärkt) in ½ Tag, Bewehrung ab Mittag 16 h mit 2 Leuten → bis Mittag Tag 2; B am Tag 3
    expect(termine(neu)).toEqual(["A 2026-11-09–2026-11-10", "B 2026-11-11–2026-11-11"]);
  });

  it("Kran erst später verfügbar → kranpflichtige Arbeit wartet", () => {
    const ts = [task("A", { mengen: { sch: 32 } })];
    const k = kran([{ unternehmer: "Bau AG", personen: 4 }]);
    k[0].verfuegbarVon = "2026-11-11";
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", k))).toEqual(["A 2026-11-11–2026-11-11"]);
  });

  it("Fundamente mit gemeinsamem Vorgänger: wer auf Personal wartet, bekommt den Task als Vorgänger, nach dem die Leute frei wurden", () => {
    // Magerbeton (ohne Mengen, unverändert) bis 9.11.; F1, F2 je 32 h Schalung, nur 4 Leute → nacheinander
    const ts = [task("M", { start: "2026-11-09", end: "2026-11-09", bauteilKuerzel: undefined, mengen: undefined }),
      task("F1", { mengen: { sch: 32 }, predecessorId: "M", lagDays: 0 }), task("F2", { mengen: { sch: 32 }, predecessorId: "M", lagDays: 0 })];
    const neu = optimiereAuslastung(ts, stammdaten, KAL, "tage", kran([{ unternehmer: "Bau AG", personen: 4 }]));
    expect(termine(neu.slice(1))).toEqual(["F1 2026-11-10–2026-11-10", "F2 2026-11-11–2026-11-11"]);
    expect(vorgaengerListe(neu[2]).map(v => v.id)).toEqual(["M", "F1"]); // bisheriger Vorgänger bleibt, F1 kommt dazu
    expect(vorgaengerListe(neu[1]).map(v => v.id)).toEqual(["M"]);
  });

  it("Zeiteinheit Halbtage: Nachfolger am selben Tag — Vorgänger nur, wenn er vor dem Start endet", () => {
    // F1, F2 je 16 h mit 4 Leuten = ½ Tag
    const ts = [task("F1", { mengen: { sch: 16 } }), task("F2", { mengen: { sch: 16 } })];
    const k = kran([{ unternehmer: "Bau AG", personen: 4 }]);
    const tage = optimiereAuslastung(ts, stammdaten, KAL, "tage", k);
    expect(termine(tage)).toEqual(["F1 2026-11-09–2026-11-09", "F2 2026-11-09–2026-11-09"]);
    expect(vorgaengerListe(tage[1])).toEqual([]); // bei Tagen endet F1 erst am Abend → kein Vorgänger möglich
    const halb = optimiereAuslastung(ts, stammdaten, KAL, "halbtage", k);
    expect(halb[0].endZeit).toBe("12:00");
    expect(halb[1].startZeit).toBe("13:00");
    expect(vorgaengerListe(halb[1]).map(v => v.id)).toEqual(["F1"]);
  });

  it("Reihenfolge: kritischer Pfad zieht die längere Restkette vor, Gantt-Reihenfolge nicht", () => {
    // A ohne Nachfolger, B mit Nachfolger C; nur 4 Leute
    const ts = [task("A", { mengen: { sch: 32 } }), task("B", { mengen: { sch: 32 } }), task("C", { mengen: { sch: 32 }, predecessorId: "B", lagDays: 0 })];
    const k = kran([{ unternehmer: "Bau AG", personen: 4 }]);
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", k, "kritischerPfad")).slice(0, 2)).toEqual(["A 2026-11-10–2026-11-10", "B 2026-11-09–2026-11-09"]);
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", k, "gantt")).slice(0, 2)).toEqual(["A 2026-11-09–2026-11-09", "B 2026-11-10–2026-11-10"]);
  });

  it("Reihenfolge Startdatum: frühester aktueller Start zuerst, unabhängig von der Gantt-Reihenfolge", () => {
    // Gantt nach Etappe: E2-Wand steht oben, startet aber später als die E1-Wand; beide nach M (bis 6.11.) ab 9.11. möglich
    const m = task("M", { start: "2026-11-06", end: "2026-11-06", bauteilKuerzel: undefined, mengen: undefined });
    const ts = [m, task("E2", { mengen: { sch: 32 }, start: "2026-11-12", predecessorId: "M", lagDays: 0 }),
      task("E1", { mengen: { sch: 32 }, start: "2026-11-10", predecessorId: "M", lagDays: 0 })];
    const k = kran([{ unternehmer: "Bau AG", personen: 4 }]);
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", k, "startdatum")).slice(1)).toEqual(["E2 2026-11-10–2026-11-10", "E1 2026-11-09–2026-11-09"]);
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", k, "gantt")).slice(1)).toEqual(["E2 2026-11-09–2026-11-09", "E1 2026-11-10–2026-11-10"]);
  });

  it("nur ein Kran: Tasks ohne Kran-Zuweisung gelten als Tasks dieses Krans", () => {
    const ts = [task("A", { mengen: { sch: 32 }, kraene: undefined }), task("B", { mengen: { sch: 32 }, kraene: undefined })];
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", kran([{ unternehmer: "Bau AG", personen: 8 }])))).toEqual([
      "A 2026-11-09–2026-11-09", "B 2026-11-09–2026-11-09",
    ]);
  });

  it("Eingeplant: kranpflichtige Kolonnen ohne Pool zählen innerhalb von Max. Personen, mit Grund", () => {
    // Bau AG 6 Leute, Max. 6; Bewehrung (Eisen GmbH, ohne Personal unter dem Kran, Kolonne 2) am selben Tag
    const ts = [task("A", { start: "2026-11-09", end: "2026-11-09", mengen: { sch: 16, bew: 8 } })];
    const e = eingeplantesPersonalJeTag(ts, kran([{ unternehmer: "Bau AG", personen: 6 }]), stammdaten, KAL, ["2026-11-09"]).get("2026-11-09")!;
    expect(e.kranPersonal).toBe(6); // Bewehrung (Min. 2) ohne Pool zählt innerhalb der 6 unter dem Kran
    expect(e.kolonnen).toBe(0);
    expect(e.total).toBe(6);
    expect(e.ohnePool.map(o => o.grund)).toEqual(["Eisen GmbH hat kein Personal unter dem Kran"]);
    // zwei Kräne, Task ohne Zuweisung → Kolonnen ausserhalb, Grund "Task ohne Kran"
    const zwei = [...kran([{ unternehmer: "Bau AG", personen: 6 }]), { id: "k2", name: "Kran 2" }];
    const ohne = eingeplantesPersonalJeTag([{ ...ts[0], kraene: undefined }], zwei, stammdaten, KAL, ["2026-11-09"]).get("2026-11-09")!;
    expect(ohne.kranPersonal).toBe(6);
    expect(ohne.kolonnen).toBe(6); // Schalung 4 + Bewehrung 2 ausserhalb
    expect(ohne.ohnePool.every(o => o.grund.startsWith("Task ohne Kran"))).toBe(true);
  });

  it("mehr Personal unter dem Kran → kürzeres Bauprogramm (6 → 13)", () => {
    const ts = ["A", "B", "C", "D", "E", "F"].map(id => task(id, { mengen: { sch: 48 } }));
    const ende = (k: Kran[]) => optimiereAuslastung(ts, stammdaten, KAL, "tage", k).reduce((m, t) => (t.end > m ? t.end : m), "");
    const mit6 = ende(kran([{ unternehmer: "Bau AG", personen: 6 }])), mit13 = ende(kran([{ unternehmer: "Bau AG", personen: 13 }]));
    expect(mit13 < mit6).toBe(true);
  });
});
