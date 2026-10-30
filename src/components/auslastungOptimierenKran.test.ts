import { describe, it, expect } from "vitest";
import type { Task, Kran } from "../types";
import { vorgaengerListe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { optimiereAuslastung } from "./auslastungOptimieren";
import { eingeplantesPersonalJeTag } from "./kranHelpers";
import { aufwandJeTagFuerTask } from "./avorHelpers";
import { tagesplan } from "./tagesplan";

const KAL = { feiertage: [], ferien: [] };
const task = (id: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start: "2026-11-09", end: "2026-11-20", typ: "neubau", objektGuids: [], bauteilKuerzel: "W", kraene: ["k1"], ...p });
// 8 h/Tag, Kranzeit je 25 %. Wand W: Schalung (Bau AG, Kolonne 4, 1 h/m², kranpflichtig), Bewehrung (Eisen GmbH, Kolonne 2, 1 h/t, kranpflichtig)
const stammdaten: Stammdaten = {
  ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8,
  gewerke: [
    { key: "sch", label: "Schalung", einheit: "m2", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 4, chfProEinheit: null, unternehmer: "Bau AG", kranpflichtig: true, kranzeitProzent: 25 }] },
    { key: "bew", label: "Bewehrung", einheit: "t", raten: [{ kuerzel: "W", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 2, chfProEinheit: null, unternehmer: "Eisen GmbH", kranpflichtig: true, kranzeitProzent: 25 }] },
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

  it("nochmals optimieren ändert nichts: ergänzte Vorgänger werden neu bestimmt, nicht angehäuft", () => {
    const m = task("M", { start: "2026-11-09", end: "2026-11-09", bauteilKuerzel: undefined, mengen: undefined });
    const ts = [m, ...["F1", "F2", "F3", "F4"].map(id => task(id, { mengen: { sch: 32 }, predecessorId: "M", lagDays: 0 })),
      task("W", { mengen: { sch: 32 }, start: "2026-11-11" })];
    const k = kran([{ unternehmer: "Bau AG", personen: 4 }]);
    const erst = optimiereAuslastung(ts, stammdaten, KAL, "tage", k);
    const zweit = optimiereAuslastung(erst, stammdaten, KAL, "tage", k);
    expect(termine(zweit)).toEqual(termine(erst));
    expect(zweit.map(t => vorgaengerListe(t).map(v => v.id))).toEqual(erst.map(t => vorgaengerListe(t).map(v => v.id)));
    expect(vorgaengerListe(erst[2]).map(v => v.id)).toEqual(["M", "F1"]); // genau ein ergänzter Vorgänger
  });

  it("Lücken füllen: untätiges Kranpersonal zieht Tasks ohne Vorgänger vor, nie über dem Personal", () => {
    // A ab 9.11. (32 h, Min. 4), B ohne Vorgänger erst ab 16.11.; 8 Leute → B läuft mit den freien 4 schon am 9.11.
    const ts = [task("A", { mengen: { sch: 32 }, start: "2026-11-09" }), task("B", { mengen: { sch: 32 }, start: "2026-11-16" })];
    const k = kran([{ unternehmer: "Bau AG", personen: 8 }]);
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", k))).toEqual(["A 2026-11-09–2026-11-09", "B 2026-11-16–2026-11-16"]);
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", k, "kritischerPfad", true))).toEqual(["A 2026-11-09–2026-11-09", "B 2026-11-09–2026-11-09"]);
    // nur 4 Leute → am 9.11. nichts frei, B folgt am 10.11., sobald die Leute sonst untätig wären
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", kran([{ unternehmer: "Bau AG", personen: 4 }]), "kritischerPfad", true)))
      .toEqual(["A 2026-11-09–2026-11-09", "B 2026-11-10–2026-11-10"]);
  });
  it("Kranzeit: zwei Kolonnen mit 100 % Kranzeit passen nicht gleichzeitig unter einen Kran — sie arbeiten nacheinander", () => {
    const voll = { ...stammdaten, gewerke: stammdaten.gewerke.map(g => ({ ...g, raten: g.raten.map(r => ({ ...r, kranzeitProzent: 100 })) })) } as Stammdaten;
    const ts = [task("A", { mengen: { sch: 32 } }), task("B", { mengen: { sch: 32 } })];
    const k = kran([{ unternehmer: "Bau AG", personen: 8 }]);
    expect(termine(optimiereAuslastung(ts, voll, KAL, "tage", k))).toEqual(["A 2026-11-09–2026-11-09", "B 2026-11-10–2026-11-10"]);
    expect(termine(optimiereAuslastung(ts, stammdaten, KAL, "tage", k))).toEqual(["A 2026-11-09–2026-11-09", "B 2026-11-09–2026-11-09"]); // 25 %: parallel
  });

  it("Überstunden bis 5 %: bleibt am Tagesende höchstens 5 % der Arbeit, wird der Task am selben Tag fertig", () => {
    const k = kran([{ unternehmer: "Bau AG", personen: 4 }]); // 4 Leute = 32 h je Tag
    // 33 h: 1 h Rest = 3 % → heute fertig
    expect(termine(optimiereAuslastung([task("A", { mengen: { sch: 33 } })], stammdaten, KAL, "tage", k))).toEqual(["A 2026-11-09–2026-11-09"]);
    // 36 h: 4 h Rest = 11 % → am nächsten Tag weiter
    expect(termine(optimiereAuslastung([task("A", { mengen: { sch: 36 } })], stammdaten, KAL, "tage", k))).toEqual(["A 2026-11-09–2026-11-10"]);
  });

  it("keine neue Leistungsposition nach Arbeitsende: bleibt nur eine noch nicht begonnene Arbeit, geht sie auf den nächsten Tag", () => {
    // Schalung 32 h füllt den Tag, danach 1 h Bewehrung (3 % der Arbeit) — beginnt nicht in Überstunden, sondern am 10.11.
    const k = kran([{ unternehmer: "Bau AG", personen: 4 }]);
    const [a] = optimiereAuslastung([task("A", { mengen: { sch: 32, bew: 1 } })], stammdaten, KAL, "tage", k);
    expect(termine([a])).toEqual(["A 2026-11-09–2026-11-10"]);
    expect(a.tagesArbeit?.tage["2026-11-09"]?.map(l => l.pos)).toEqual(["sch::W"]);
    expect(a.tagesArbeit?.tage["2026-11-10"]?.map(l => `${l.pos} ${l.von}–${l.bis}`)).toEqual(["bew::W 0–0.5"]);
  });

  it("merkt sich den Ablauf je Tag: Tab AVOR rechnet und zeigt genau diesen statt gleichmässig über die Tage", () => {
    const k = kran([{ unternehmer: "Bau AG", personen: 4 }]);
    const [a] = optimiereAuslastung([task("A", { mengen: { sch: 40 } })], stammdaten, KAL, "tage", k); // 32 h + 8 h
    expect(a.tagesArbeit?.tage).toEqual({
      "2026-11-09": [{ pos: "sch::W", von: 0, bis: 8, leute: 4, ph: 32 }],
      "2026-11-10": [{ pos: "sch::W", von: 0, bis: 2, leute: 4, ph: 8 }],
    });
    const jeTag = aufwandJeTagFuerTask(a, stammdaten, KAL);
    expect(jeTag.get("2026-11-09")?.sch).toBeCloseTo(32);
    expect(jeTag.get("2026-11-10")?.sch).toBeCloseTo(8);
    const plan = tagesplan("2026-11-10", [a], stammdaten, KAL, k);
    expect(plan.tasks[0].quelle).toBe("optimiert");
    expect(plan.dauer).toBeCloseTo(2);
    // Termin von Hand geändert → wieder gleichmässig verteilt
    const verschoben = aufwandJeTagFuerTask({ ...a, end: "2026-11-11" }, stammdaten, KAL);
    expect(verschoben.get("2026-11-09")?.sch).toBeCloseTo(40 / 3);
    // Menge geändert → Ablauf gilt nicht mehr
    expect(aufwandJeTagFuerTask({ ...a, mengen: { sch: 48 } }, stammdaten, KAL).get("2026-11-09")?.sch).toBeCloseTo(24);
    // Kräne & Personal geändert → Arbeit je Tag bleibt, der Tag wird mit dem Rechenkern neu gerechnet
    const neuerKran = kran([{ unternehmer: "Bau AG", personen: 8 }]);
    expect(tagesplan("2026-11-09", [a], stammdaten, KAL, neuerKran).tasks[0].quelle).toBe("veraltet");
    expect(tagesplan("2026-11-09", [a], stammdaten, KAL, neuerKran).dauer).toBeCloseTo(4); // 32 h mit 8 Leuten
  });

  it("Tagesablauf gemischt: geplante Tasks behalten ihren Ablauf, neue bekommen nur das übrige Personal", () => {
    const k = kran([{ unternehmer: "Bau AG", personen: 4 }]);
    const [a] = optimiereAuslastung([task("A", { mengen: { sch: 32 } })], stammdaten, KAL, "tage", k); // 4 Leute den ganzen Tag
    const b = task("B", { mengen: { sch: 8 }, start: "2026-11-09", end: "2026-11-09" }); // neu, nicht optimiert
    const plan = tagesplan("2026-11-09", [a, b], stammdaten, KAL, k);
    expect(plan.tasks.map(z => z.quelle)).toEqual(["optimiert", "gleichmaessig"]);
    expect(plan.tasks[0].bis).toBeCloseTo(8);
    expect(plan.tasks[1].von).toBeCloseTo(8); // wartet, bis die Leute von A frei sind
    expect(plan.dauer).toBeCloseTo(10);
  });

  it("ohne Kran: je Gewerk + Unternehmer eine Kolonne, die am selben Tag von Arbeit zu Arbeit geht", () => {
    // Wand W und Stütze S: Schalung (Bau AG, Min. 4, 8 h = 2 h), dann Bewehrung (Eisen GmbH, Min. 2, 4 h = 2 h)
    const sd = { ...stammdaten, gewerke: stammdaten.gewerke.map(g => ({ ...g, raten: [...g.raten, ...g.raten.map(r => ({ ...r, kuerzel: "S" }))]
      .map(r => ({ ...r, kranpflichtig: false })) })) } as Stammdaten;
    const ts = [task("W", { mengen: { sch: 8, bew: 4 }, kraene: [] }), task("S", { mengen: { sch: 8, bew: 4 }, kraene: [], bauteilKuerzel: "S" })];
    const neu = optimiereAuslastung(ts, sd, KAL, "tage", []);
    expect(termine(neu)).toEqual(["W 2026-11-09–2026-11-09", "S 2026-11-09–2026-11-09"]);
    // Bewehrung der Stütze erst, wenn sie geschalt ist und die Eisenleger mit der Wand fertig sind
    const tag = neu.map(t => t.tagesArbeit?.tage["2026-11-09"]);
    expect(tag[0]).toEqual([{ pos: "sch::W", von: 0, bis: 2, leute: 4, ph: 8 }, { pos: "bew::W", von: 2, bis: 4, leute: 2, ph: 4 }]);
    expect(tag[1]).toEqual([{ pos: "sch::S", von: 2, bis: 4, leute: 4, ph: 8 }, { pos: "bew::S", von: 4, bis: 6, leute: 2, ph: 4 }]);
    // 5 % Überstunden gelten auch ohne Kran: 33 h mit Min. 4 = 8.25 h → heute fertig
    expect(termine(optimiereAuslastung([task("A", { mengen: { sch: 33 }, kraene: [] })], sd, KAL, "tage", []))).toEqual(["A 2026-11-09–2026-11-09"]);
  });

  it("nach dem Optimieren überzieht kein Tag im Tagesablauf: der Kran ist der Engpass, die Arbeit geht am nächsten Tag weiter", () => {
    // Kranzeit 50 %: 12 Leute bräuchten 1.5 Kräne → höchstens 8 Leute gleichzeitig unter dem Kran
    const halb = { ...stammdaten, gewerke: stammdaten.gewerke.map(g => ({ ...g, raten: g.raten.map(r => ({ ...r, kranzeitProzent: 50 })) })) } as Stammdaten;
    const k = kran([{ unternehmer: "Bau AG", personen: 12 }, { unternehmer: "Eisen GmbH", personen: 2 }]);
    const ts = ["A", "B", "C", "D", "E"].map(id => task(id, { mengen: { sch: 45, bew: 10 } }));
    const neu = optimiereAuslastung(ts, halb, KAL, "tage", k);
    const ende = neu.reduce((m, t) => t.end > m ? t.end : m, "");
    for (let d = new Date("2026-11-09T00:00:00"); ; d.setDate(d.getDate() + 1)) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (iso > ende) break;
      const plan = tagesplan(iso, neu, halb, KAL, k);
      expect(plan.dauer, iso).toBeLessThanOrEqual(8 * 1.05 + 0.25);
    }
  });
});
